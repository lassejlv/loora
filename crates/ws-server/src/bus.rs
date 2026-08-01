use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use futures_util::StreamExt;
use redis::aio::ConnectionManager;
use tokio::sync::{mpsc, oneshot, watch, Mutex, RwLock};

use crate::protocol::{now_ms, Activity, Peer, MAX_PRESENCE_PEERS, PRESENCE_TTL_MS};

pub type Delivery = mpsc::UnboundedSender<(String, String)>;

#[async_trait]
pub trait Bus: Send + Sync {
    fn kind(&self) -> &'static str;
    async fn subscribe(&self, channel: &str) -> Result<(), ()>;
    async fn unsubscribe(&self, channel: &str);
    async fn publish(&self, channel: &str, message: &str) -> bool;
    async fn write_presence(&self, channel: &str, peer: &Peer) -> Result<(), ()>;
    async fn clear_presence(&self, channel: &str, session_id: &str);
    async fn read_presence(&self, channel: &str) -> Vec<Peer>;
    async fn write_activity(&self, channel: &str, activity: Option<&Activity>) -> Result<(), ()>;
    async fn read_activity(&self, channel: &str) -> Option<Activity>;
    async fn claim_ticket(&self, ticket_id: &str, ttl_ms: u64) -> bool;
    async fn ping(&self) -> bool;
    async fn close(&self);
}

pub fn memory_bus(delivery: Delivery) -> Arc<dyn Bus> {
    Arc::new(MemoryBus {
        delivery,
        subscribed: RwLock::new(HashSet::new()),
        presence: RwLock::new(HashMap::new()),
        activity: RwLock::new(HashMap::new()),
        tickets: Mutex::new(HashMap::new()),
    })
}

pub async fn redis_bus(url: &str, delivery: Delivery) -> Result<Arc<dyn Bus>, redis::RedisError> {
    Ok(Arc::new(RedisBus::new(url, delivery).await?))
}

struct MemoryBus {
    delivery: Delivery,
    subscribed: RwLock<HashSet<String>>,
    presence: RwLock<HashMap<String, HashMap<String, Peer>>>,
    activity: RwLock<HashMap<String, Activity>>,
    tickets: Mutex<HashMap<String, u64>>,
}

#[async_trait]
impl Bus for MemoryBus {
    fn kind(&self) -> &'static str {
        "memory"
    }

    async fn subscribe(&self, channel: &str) -> Result<(), ()> {
        self.subscribed.write().await.insert(channel.to_owned());
        Ok(())
    }

    async fn unsubscribe(&self, channel: &str) {
        self.subscribed.write().await.remove(channel);
    }

    async fn publish(&self, channel: &str, message: &str) -> bool {
        if self.subscribed.read().await.contains(channel) {
            let _ = self.delivery.send((channel.to_owned(), message.to_owned()));
        }
        true
    }

    async fn write_presence(&self, channel: &str, peer: &Peer) -> Result<(), ()> {
        self.presence
            .write()
            .await
            .entry(channel.to_owned())
            .or_default()
            .insert(peer.session_id.clone(), peer.clone());
        Ok(())
    }

    async fn clear_presence(&self, channel: &str, session_id: &str) {
        let mut presence = self.presence.write().await;
        if let Some(room) = presence.get_mut(channel) {
            room.remove(session_id);
            if room.is_empty() {
                presence.remove(channel);
            }
        }
    }

    async fn read_presence(&self, channel: &str) -> Vec<Peer> {
        let now = now_ms() as f64;
        let mut presence = self.presence.write().await;
        let Some(room) = presence.get_mut(channel) else {
            return Vec::new();
        };
        room.retain(|_, peer| now - peer.updated_at < PRESENCE_TTL_MS as f64);
        room.values().take(MAX_PRESENCE_PEERS).cloned().collect()
    }

    async fn write_activity(&self, channel: &str, activity: Option<&Activity>) -> Result<(), ()> {
        let mut values = self.activity.write().await;
        if let Some(activity) = activity {
            values.insert(channel.to_owned(), activity.clone());
        } else {
            values.remove(channel);
        }
        Ok(())
    }

    async fn read_activity(&self, channel: &str) -> Option<Activity> {
        let mut values = self.activity.write().await;
        let activity = values.get(channel)?.clone();
        if activity.expires_at <= now_ms() as f64 {
            values.remove(channel);
            return None;
        }
        Some(activity)
    }

    async fn claim_ticket(&self, ticket_id: &str, ttl_ms: u64) -> bool {
        let now = now_ms();
        let mut tickets = self.tickets.lock().await;
        tickets.retain(|_, expires_at| *expires_at > now);
        if tickets.contains_key(ticket_id) {
            return false;
        }
        tickets.insert(ticket_id.to_owned(), now.saturating_add(ttl_ms));
        true
    }

    async fn ping(&self) -> bool {
        true
    }

    async fn close(&self) {
        self.subscribed.write().await.clear();
        self.presence.write().await.clear();
        self.activity.write().await.clear();
        self.tickets.lock().await.clear();
    }
}

enum SubscriptionCommand {
    Subscribe(String, oneshot::Sender<bool>),
    Unsubscribe(String),
}

struct RedisBus {
    client: redis::Client,
    manager: Mutex<Option<ConnectionManager>>,
    desired: Arc<RwLock<HashSet<String>>>,
    subscription_tx: mpsc::Sender<SubscriptionCommand>,
    shutdown: watch::Sender<bool>,
}

impl RedisBus {
    async fn new(url: &str, delivery: Delivery) -> Result<Self, redis::RedisError> {
        let client = redis::Client::open(url)?;
        let desired = Arc::new(RwLock::new(HashSet::new()));
        let (subscription_tx, subscription_rx) = mpsc::channel(128);
        let (shutdown, shutdown_rx) = watch::channel(false);
        tokio::spawn(subscription_loop(
            client.clone(),
            desired.clone(),
            subscription_rx,
            delivery,
            shutdown_rx,
        ));
        Ok(Self {
            client,
            manager: Mutex::new(None),
            desired,
            subscription_tx,
            shutdown,
        })
    }

    async fn command<T: redis::FromRedisValue>(
        &self,
        command: &mut redis::Cmd,
    ) -> redis::RedisResult<T> {
        let mut manager = self.manager.lock().await;
        if manager.is_none() {
            let connected = tokio::time::timeout(
                Duration::from_secs(3),
                ConnectionManager::new(self.client.clone()),
            )
            .await
            .map_err(|_| {
                redis::RedisError::from((redis::ErrorKind::IoError, "Redis connection timed out"))
            })??;
            *manager = Some(connected);
        }
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            command.query_async(manager.as_mut().expect("initialized above")),
        )
        .await
        .map_err(|_| {
            redis::RedisError::from((redis::ErrorKind::IoError, "Redis command timed out"))
        })?;
        if result.is_err() {
            *manager = None;
        }
        result
    }
}

#[async_trait]
impl Bus for RedisBus {
    fn kind(&self) -> &'static str {
        "redis"
    }

    async fn subscribe(&self, channel: &str) -> Result<(), ()> {
        self.desired.write().await.insert(channel.to_owned());
        let (tx, rx) = oneshot::channel();
        if self
            .subscription_tx
            .send(SubscriptionCommand::Subscribe(channel.to_owned(), tx))
            .await
            .is_err()
        {
            self.desired.write().await.remove(channel);
            return Err(());
        }
        match tokio::time::timeout(Duration::from_secs(4), rx).await {
            Ok(Ok(true)) => Ok(()),
            _ => {
                self.desired.write().await.remove(channel);
                Err(())
            }
        }
    }

    async fn unsubscribe(&self, channel: &str) {
        self.desired.write().await.remove(channel);
        let _ = self
            .subscription_tx
            .send(SubscriptionCommand::Unsubscribe(channel.to_owned()))
            .await;
    }

    async fn publish(&self, channel: &str, message: &str) -> bool {
        self.command::<i64>(redis::cmd("PUBLISH").arg(channel).arg(message))
            .await
            .is_ok()
    }

    async fn write_presence(&self, channel: &str, peer: &Peer) -> Result<(), ()> {
        let key = format!("{channel}:presence");
        let value = serde_json::to_string(peer).map_err(|_| ())?;
        self.command::<i64>(
            redis::cmd("HSET")
                .arg(&key)
                .arg(&peer.session_id)
                .arg(value),
        )
        .await
        .map_err(|_| ())?;
        self.command::<bool>(redis::cmd("PEXPIRE").arg(&key).arg(PRESENCE_TTL_MS * 4))
            .await
            .map_err(|_| ())?;
        Ok(())
    }

    async fn clear_presence(&self, channel: &str, session_id: &str) {
        let _: redis::RedisResult<i64> = self
            .command(
                redis::cmd("HDEL")
                    .arg(format!("{channel}:presence"))
                    .arg(session_id),
            )
            .await;
    }

    async fn read_presence(&self, channel: &str) -> Vec<Peer> {
        let values: HashMap<String, String> = match self
            .command(redis::cmd("HGETALL").arg(format!("{channel}:presence")))
            .await
        {
            Ok(values) => values,
            Err(_) => return Vec::new(),
        };
        let now = now_ms() as f64;
        values
            .values()
            .filter_map(|value| serde_json::from_str::<Peer>(value).ok())
            .filter(|peer| {
                crate::protocol::validate_peer(peer)
                    && now - peer.updated_at < PRESENCE_TTL_MS as f64
            })
            .take(MAX_PRESENCE_PEERS)
            .collect()
    }

    async fn write_activity(&self, channel: &str, activity: Option<&Activity>) -> Result<(), ()> {
        let key = format!("{channel}:agent");
        if let Some(activity) = activity {
            let value = serde_json::to_string(activity).map_err(|_| ())?;
            let ttl = (activity.expires_at - activity.updated_at)
                .round()
                .max(1000.0) as u64;
            self.command::<String>(redis::cmd("SET").arg(key).arg(value).arg("PX").arg(ttl))
                .await
                .map_err(|_| ())?;
        } else {
            self.command::<i64>(redis::cmd("DEL").arg(key))
                .await
                .map_err(|_| ())?;
        }
        Ok(())
    }

    async fn read_activity(&self, channel: &str) -> Option<Activity> {
        let value: Option<String> = self
            .command(redis::cmd("GET").arg(format!("{channel}:agent")))
            .await
            .ok()?;
        let activity: Activity = serde_json::from_str(&value?).ok()?;
        (crate::protocol::validate_activity(&activity) && activity.expires_at > now_ms() as f64)
            .then_some(activity)
    }

    async fn claim_ticket(&self, ticket_id: &str, ttl_ms: u64) -> bool {
        let key = format!("loora:realtime:ticket:{ticket_id}");
        let result: redis::RedisResult<Option<String>> = self
            .command(
                redis::cmd("SET")
                    .arg(key)
                    .arg("1")
                    .arg("NX")
                    .arg("PX")
                    .arg(ttl_ms.max(1000)),
            )
            .await;
        matches!(result, Ok(Some(value)) if value == "OK")
    }

    async fn ping(&self) -> bool {
        matches!(self.command::<String>(&mut redis::cmd("PING")).await, Ok(value) if value == "PONG")
    }

    async fn close(&self) {
        let _ = self.shutdown.send(true);
    }
}

async fn subscription_loop(
    client: redis::Client,
    desired: Arc<RwLock<HashSet<String>>>,
    mut commands: mpsc::Receiver<SubscriptionCommand>,
    delivery: Delivery,
    mut shutdown: watch::Receiver<bool>,
) {
    let mut delay = Duration::from_secs(1);
    loop {
        if *shutdown.borrow() {
            return;
        }
        let connection =
            tokio::time::timeout(Duration::from_secs(3), client.get_async_pubsub()).await;
        let Ok(Ok(mut pubsub)) = connection else {
            tokio::select! {
                _ = tokio::time::sleep(delay) => {},
                _ = shutdown.changed() => return,
            }
            delay = (delay * 2).min(Duration::from_secs(15));
            continue;
        };
        let channels: Vec<_> = desired.read().await.iter().cloned().collect();
        let mut subscribed = true;
        for channel in channels {
            if pubsub.subscribe(channel).await.is_err() {
                subscribed = false;
                break;
            }
        }
        if !subscribed {
            continue;
        }
        delay = Duration::from_secs(1);
        let (mut sink, mut stream) = pubsub.split();
        loop {
            tokio::select! {
                _ = shutdown.changed() => return,
                command = commands.recv() => match command {
                    Some(SubscriptionCommand::Subscribe(channel, reply)) => {
                        let wanted = desired.read().await.contains(&channel);
                        let ok = !wanted || sink.subscribe(channel).await.is_ok();
                        let _ = reply.send(ok);
                        if !ok { break; }
                    }
                    Some(SubscriptionCommand::Unsubscribe(channel)) => {
                        if sink.unsubscribe(channel).await.is_err() { break; }
                    }
                    None => return,
                },
                message = stream.next() => match message {
                    Some(message) => {
                        if let (Ok(channel), Ok(payload)) = (message.get_channel::<String>(), message.get_payload::<String>()) {
                            let _ = delivery.send((channel, payload));
                        }
                    }
                    None => break,
                }
            }
        }
    }
}
