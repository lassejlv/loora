use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use axum::{
    body::{to_bytes, Body},
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::{header, HeaderMap, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use subtle::ConstantTimeEq;
use tokio::sync::{mpsc, watch, Mutex};

use crate::{
    bus::{memory_bus, redis_bus, Bus},
    config::Config,
    protocol::{
        channel_for, now_ms, parse_client_message, parse_ingest, parse_state_request,
        presence_author, verify_ticket, with_sent_at, Activity, ClientMessage, IngestMessage, Peer,
        Target, TicketClaims, CONNECTION_TTL_MS, MAX_PRESENCE_PEERS, TICKET_PROTOCOL,
    },
};

const CLIENT_MESSAGE_LIMIT: u64 = 60;
const CLIENT_MESSAGE_WINDOW: Duration = Duration::from_secs(1);
const MAX_SOCKET_PAYLOAD: usize = 16 * 1024;
const MAX_INGEST_BYTES: usize = 64 * 1024;
const INGEST_LIMIT: u64 = 6_000;
const INGEST_WINDOW: Duration = Duration::from_secs(60);
const MAX_SOCKETS_PER_USER: usize = 20;

#[derive(Default)]
struct Counters {
    ticket_invalid: AtomicU64,
    ticket_replayed: AtomicU64,
    origin_refused: AtomicU64,
    ingest_unauthorized: AtomicU64,
    ingest_invalid: AtomicU64,
    ingest_throttled: AtomicU64,
    messages_dropped: AtomicU64,
    sockets_evicted: AtomicU64,
}

impl Counters {
    fn snapshot(&self) -> Value {
        json!({
            "ticketInvalid": self.ticket_invalid.load(Ordering::Relaxed),
            "ticketReplayed": self.ticket_replayed.load(Ordering::Relaxed),
            "originRefused": self.origin_refused.load(Ordering::Relaxed),
            "ingestUnauthorized": self.ingest_unauthorized.load(Ordering::Relaxed),
            "ingestInvalid": self.ingest_invalid.load(Ordering::Relaxed),
            "ingestThrottled": self.ingest_throttled.load(Ordering::Relaxed),
            "messagesDropped": self.messages_dropped.load(Ordering::Relaxed),
            "socketsEvicted": self.sockets_evicted.load(Ordering::Relaxed),
        })
    }
}

struct RateLimiter {
    started: Instant,
    used: u64,
    limit: u64,
    window: Duration,
}

impl RateLimiter {
    fn new(limit: u64, window: Duration) -> Self {
        Self {
            started: Instant::now(),
            used: 0,
            limit,
            window,
        }
    }

    fn allow(&mut self) -> bool {
        if self.started.elapsed() >= self.window {
            self.started = Instant::now();
            self.used = 0;
        }
        self.used += 1;
        self.used <= self.limit
    }
}

enum Outbound {
    Text(String),
    Close(u16, &'static str),
}

struct Connection {
    user_id: String,
    session_id: String,
    channel: String,
    tx: mpsc::UnboundedSender<Outbound>,
}

#[derive(Default)]
struct Connections {
    next_id: u64,
    all: HashMap<u64, Connection>,
    by_user: HashMap<String, VecDeque<u64>>,
}

impl Connections {
    fn add(
        &mut self,
        claims: &TicketClaims,
        channel: String,
        tx: mpsc::UnboundedSender<Outbound>,
        counters: &Counters,
    ) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        let mine = self.by_user.entry(claims.user_id.clone()).or_default();
        mine.push_back(id);
        while mine.len() > MAX_SOCKETS_PER_USER {
            if let Some(oldest) = mine.pop_front() {
                if let Some(socket) = self.all.get(&oldest) {
                    counters.sockets_evicted.fetch_add(1, Ordering::Relaxed);
                    let _ = socket
                        .tx
                        .send(Outbound::Close(4002, "Too many connections"));
                }
            }
        }
        self.all.insert(
            id,
            Connection {
                user_id: claims.user_id.clone(),
                session_id: claims.session_id.clone(),
                channel,
                tx,
            },
        );
        id
    }

    fn remove(&mut self, id: u64) {
        let Some(connection) = self.all.remove(&id) else {
            return;
        };
        if let Some(mine) = self.by_user.get_mut(&connection.user_id) {
            mine.retain(|candidate| *candidate != id);
            if mine.is_empty() {
                self.by_user.remove(&connection.user_id);
            }
        }
    }
}

pub struct AppState {
    config: Config,
    bus: Arc<dyn Bus>,
    counters: Counters,
    connections: Mutex<Connections>,
    rooms: Mutex<HashMap<String, usize>>,
    ingest_limiter: Mutex<RateLimiter>,
    shutdown: watch::Sender<bool>,
}

impl AppState {
    pub async fn new(config: Config) -> Result<Arc<Self>, redis::RedisError> {
        let (delivery_tx, mut delivery_rx) = mpsc::unbounded_channel();
        let bus = match &config.redis_url {
            Some(url) => redis_bus(url, delivery_tx).await?,
            None => memory_bus(delivery_tx),
        };
        let (shutdown, _) = watch::channel(false);
        let state = Arc::new(Self {
            config,
            bus,
            counters: Counters::default(),
            connections: Mutex::new(Connections::default()),
            rooms: Mutex::new(HashMap::new()),
            ingest_limiter: Mutex::new(RateLimiter::new(INGEST_LIMIT, INGEST_WINDOW)),
            shutdown,
        });
        let deliver_state = state.clone();
        tokio::spawn(async move {
            while let Some((channel, payload)) = delivery_rx.recv().await {
                deliver_state.deliver(&channel, payload).await;
            }
        });
        Ok(state)
    }

    async fn join(&self, channel: &str) -> Result<(), ()> {
        let mut rooms = self.rooms.lock().await;
        let watchers = rooms.get(channel).copied().unwrap_or(0);
        rooms.insert(channel.to_owned(), watchers + 1);
        if watchers > 0 {
            return Ok(());
        }
        if self.bus.subscribe(channel).await.is_err() {
            rooms.remove(channel);
            return Err(());
        }
        Ok(())
    }

    async fn leave(&self, channel: &str) {
        let mut rooms = self.rooms.lock().await;
        let watchers = rooms.get(channel).copied().unwrap_or(0);
        if watchers <= 1 {
            rooms.remove(channel);
            self.bus.unsubscribe(channel).await;
        } else {
            rooms.insert(channel.to_owned(), watchers - 1);
        }
    }

    async fn deliver(&self, channel: &str, payload: String) {
        let author = presence_author(&payload);
        let connections = self.connections.lock().await;
        for socket in connections.all.values() {
            if socket.channel != channel || author.as_deref() == Some(socket.session_id.as_str()) {
                continue;
            }
            let _ = socket.tx.send(Outbound::Text(payload.clone()));
        }
    }

    async fn publish_event(&self, channel: &str, event: Value) -> bool {
        let Some(payload) = with_sent_at(event) else {
            return false;
        };
        self.bus.publish(channel, &payload).await
    }

    async fn publish_presence(&self, channel: &str, peer: Peer) -> bool {
        if self.bus.write_presence(channel, &peer).await.is_err() {
            return false;
        }
        self.publish_event(
            channel,
            json!({
                "type": "presence.peer",
                "sessionId": peer.session_id,
                "peer": peer,
            }),
        )
        .await
    }

    async fn clear_presence(&self, channel: &str, session_id: &str) -> bool {
        self.bus.clear_presence(channel, session_id).await;
        self.publish_event(
            channel,
            json!({
                "type": "presence.peer",
                "sessionId": session_id,
                "peer": null,
            }),
        )
        .await
    }

    async fn publish_activity(&self, channel: &str, activity: Option<Activity>) -> bool {
        if self
            .bus
            .write_activity(channel, activity.as_ref())
            .await
            .is_err()
        {
            return false;
        }
        self.publish_event(
            channel,
            json!({
                "type": "agent.activity",
                "activity": activity,
            }),
        )
        .await
    }

    async fn room_state(&self, channel: &str) -> (Vec<Peer>, Option<Activity>) {
        tokio::join!(
            self.bus.read_presence(channel),
            self.bus.read_activity(channel)
        )
    }

    pub async fn shutdown(&self) {
        let _ = self.shutdown.send(true);
        let sockets: Vec<_> = {
            let connections = self.connections.lock().await;
            connections
                .all
                .values()
                .map(|socket| {
                    (
                        socket.channel.clone(),
                        socket.session_id.clone(),
                        socket.tx.clone(),
                    )
                })
                .collect()
        };
        for (channel, session_id, tx) in sockets {
            self.bus.clear_presence(&channel, &session_id).await;
            let _ = tx.send(Outbound::Close(1012, "Restarting"));
        }
        self.bus.close().await;
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/publish", post(publish))
        .route("/state", post(read_state))
        .route("/canvas", any(canvas))
        .with_state(state)
}

async fn health(State(state): State<Arc<AppState>>) -> Json<Value> {
    let sockets = state.connections.lock().await.all.len();
    let rooms = state.rooms.lock().await.len();
    Json(json!({
        "name": "loora-ws",
        "bus": state.bus.kind(),
        "sockets": sockets,
        "rooms": rooms,
        "rejections": state.counters.snapshot(),
    }))
}

async fn ready(State(state): State<Arc<AppState>>) -> Response {
    let ready = state.bus.ping().await;
    (
        if ready {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(json!({
            "service": "ws", "ready": ready, "bus": state.bus.kind()
        })),
    )
        .into_response()
}

async fn publish(State(state): State<Arc<AppState>>, request: Request<Body>) -> Response {
    let value = match guarded_json(&state, request).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some(message) = parse_ingest(&value) else {
        state
            .counters
            .ingest_invalid
            .fetch_add(1, Ordering::Relaxed);
        return error(StatusCode::BAD_REQUEST, "Invalid realtime message");
    };
    let published = match message {
        IngestMessage::Event {
            owner,
            target,
            event,
        } => {
            state
                .publish_event(&channel_for(&owner, &target), event)
                .await
        }
        IngestMessage::Activity {
            owner,
            target,
            activity,
        } => {
            state
                .publish_activity(&channel_for(&owner, &target), activity)
                .await
        }
        IngestMessage::Presence {
            owner,
            target,
            peer,
        } => {
            state
                .publish_presence(&channel_for(&owner, &target), peer)
                .await
        }
        IngestMessage::PresenceClear {
            owner,
            target,
            session_id,
        } => {
            state
                .clear_presence(&channel_for(&owner, &target), &session_id)
                .await
        }
    };
    if published {
        Json(json!({ "published": true })).into_response()
    } else {
        error(StatusCode::SERVICE_UNAVAILABLE, "Could not publish")
    }
}

async fn read_state(State(state): State<Arc<AppState>>, request: Request<Body>) -> Response {
    let value = match guarded_json(&state, request).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let Some((owner, target)) = parse_state_request(&value) else {
        state
            .counters
            .ingest_invalid
            .fetch_add(1, Ordering::Relaxed);
        return error(StatusCode::BAD_REQUEST, "Invalid state request");
    };
    let (peers, activity) = state.room_state(&channel_for(&owner, &target)).await;
    Json(json!({ "peers": peers, "activity": activity })).into_response()
}

async fn guarded_json(state: &AppState, request: Request<Body>) -> Result<Value, Response> {
    let header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let token = header.strip_prefix("Bearer ").unwrap_or("");
    let expected = state.config.internal_token.as_bytes();
    if token.len() != expected.len() || !bool::from(token.as_bytes().ct_eq(expected)) {
        state
            .counters
            .ingest_unauthorized
            .fetch_add(1, Ordering::Relaxed);
        return Err(error(StatusCode::UNAUTHORIZED, "Unauthorized"));
    }
    let declared = request
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if declared > MAX_INGEST_BYTES {
        state
            .counters
            .ingest_invalid
            .fetch_add(1, Ordering::Relaxed);
        return Err(error(StatusCode::PAYLOAD_TOO_LARGE, "Payload too large"));
    }
    if !state.ingest_limiter.lock().await.allow() {
        state
            .counters
            .ingest_throttled
            .fetch_add(1, Ordering::Relaxed);
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            [(header::RETRY_AFTER, "1")],
            Json(json!({ "error": "Too many requests" })),
        )
            .into_response());
    }
    let bytes = to_bytes(request.into_body(), MAX_INGEST_BYTES)
        .await
        .map_err(|_| {
            state
                .counters
                .ingest_invalid
                .fetch_add(1, Ordering::Relaxed);
            error(StatusCode::PAYLOAD_TOO_LARGE, "Payload too large")
        })?;
    serde_json::from_slice(&bytes).map_err(|_| {
        state
            .counters
            .ingest_invalid
            .fetch_add(1, Ordering::Relaxed);
        error(StatusCode::BAD_REQUEST, "Invalid JSON")
    })
}

#[derive(Deserialize)]
struct CanvasQuery {
    ticket: Option<String>,
}

async fn canvas(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CanvasQuery>,
    headers: HeaderMap,
    ws: Result<WebSocketUpgrade, axum::extract::ws::rejection::WebSocketUpgradeRejection>,
) -> Response {
    if let Some(allowed) = &state.config.allowed_origins {
        if let Some(origin) = headers
            .get(header::ORIGIN)
            .and_then(|value| value.to_str().ok())
        {
            if !allowed.iter().any(|allowed| allowed == origin) {
                state
                    .counters
                    .origin_refused
                    .fetch_add(1, Ordering::Relaxed);
                return (StatusCode::FORBIDDEN, "Forbidden origin").into_response();
            }
        }
    }
    let offered = headers
        .get(header::SEC_WEBSOCKET_PROTOCOL)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let ticket = offered
        .iter()
        .find(|value| **value != TICKET_PROTOCOL)
        .copied()
        .map(str::to_owned)
        .or(query.ticket)
        .unwrap_or_default();
    let Some(claims) = verify_ticket(&ticket, &state.config.ticket_secrets, now_ms()) else {
        state
            .counters
            .ticket_invalid
            .fetch_add(1, Ordering::Relaxed);
        return (StatusCode::UNAUTHORIZED, "Invalid ticket").into_response();
    };
    let ttl = (claims.expires_at - now_ms() as f64 + 5_000.0)
        .round()
        .max(1_000.0) as u64;
    if !state.bus.claim_ticket(&claims.jti, ttl).await {
        state
            .counters
            .ticket_replayed
            .fetch_add(1, Ordering::Relaxed);
        return (StatusCode::UNAUTHORIZED, "Ticket already used").into_response();
    }
    let Ok(ws) = ws else {
        return (StatusCode::UPGRADE_REQUIRED, "Expected a WebSocket upgrade").into_response();
    };
    let protocol_offered = offered.contains(&TICKET_PROTOCOL);
    let ws = ws.max_message_size(MAX_SOCKET_PAYLOAD);
    let ws = if protocol_offered {
        ws.protocols([TICKET_PROTOCOL])
    } else {
        ws
    };
    ws.on_upgrade(move |socket| socket_session(state, socket, claims))
}

async fn socket_session(state: Arc<AppState>, socket: WebSocket, claims: TicketClaims) {
    let channel = channel_for(
        &claims.owner_user_id,
        &Target {
            design_id: claims.design_id.clone(),
            draft_id: claims.draft_id.clone(),
        },
    );
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel();
    let id =
        state
            .connections
            .lock()
            .await
            .add(&claims, channel.clone(), outbound_tx, &state.counters);
    if state.join(&channel).await.is_err() {
        state.connections.lock().await.remove(id);
        return;
    }
    let (peers, activity) = state.room_state(&channel).await;
    let ready = json!({
        "type": "ready",
        "sessionId": claims.session_id,
        "role": claims.role,
        "peers": peers.into_iter().take(MAX_PRESENCE_PEERS).collect::<Vec<_>>(),
        "activity": activity,
        "sentAt": now_ms(),
    })
    .to_string();
    let (mut sender, mut receiver) = socket.split();
    if sender.send(Message::Text(ready.into())).await.is_err() {
        cleanup_socket(&state, id, &channel, &claims.session_id).await;
        return;
    }
    let mut limiter = RateLimiter::new(CLIENT_MESSAGE_LIMIT, CLIENT_MESSAGE_WINDOW);
    let expiry = tokio::time::sleep(Duration::from_millis(CONNECTION_TTL_MS));
    let idle = tokio::time::sleep(Duration::from_secs(120));
    tokio::pin!(expiry, idle);
    loop {
        tokio::select! {
            _ = &mut expiry => {
                let _ = sender.send(close_message(4001, "Ticket expired")).await;
                break;
            }
            _ = &mut idle => break,
            outbound = outbound_rx.recv() => match outbound {
                Some(Outbound::Text(payload)) => if sender.send(Message::Text(payload.into())).await.is_err() { break; },
                Some(Outbound::Close(code, reason)) => { let _ = sender.send(close_message(code, reason)).await; break; }
                None => break,
            },
            incoming = receiver.next() => match incoming {
                Some(Ok(Message::Text(raw))) => {
                    idle.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(120));
                    if !limiter.allow() {
                        state.counters.messages_dropped.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    match parse_client_message(raw.as_str()) {
                        Some(ClientMessage::Ping) => {
                            if sender.send(Message::Text(json!({ "type": "pong", "sentAt": now_ms() }).to_string().into())).await.is_err() { break; }
                        }
                        Some(ClientMessage::Presence { cursor, selection }) => {
                            let peer = Peer {
                                session_id: claims.session_id.clone(), user_id: claims.user_id.clone(),
                                name: claims.name.clone(), image: claims.image.clone(), color: claims.color.clone(),
                                role: claims.role.clone(), cursor, selection, updated_at: now_ms() as f64,
                            };
                            state.publish_presence(&channel, peer).await;
                        }
                        None => {}
                    }
                }
                Some(Ok(Message::Binary(raw))) => {
                    idle.as_mut().reset(tokio::time::Instant::now() + Duration::from_secs(120));
                    if !limiter.allow() {
                        state.counters.messages_dropped.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                    if let Ok(raw) = std::str::from_utf8(&raw) {
                        match parse_client_message(raw) {
                            Some(ClientMessage::Ping) => {
                                let _ = sender.send(Message::Text(json!({ "type": "pong", "sentAt": now_ms() }).to_string().into())).await;
                            }
                            Some(ClientMessage::Presence { cursor, selection }) => {
                                let peer = Peer {
                                    session_id: claims.session_id.clone(), user_id: claims.user_id.clone(),
                                    name: claims.name.clone(), image: claims.image.clone(), color: claims.color.clone(),
                                    role: claims.role.clone(), cursor, selection, updated_at: now_ms() as f64,
                                };
                                state.publish_presence(&channel, peer).await;
                            }
                            None => {}
                        }
                    }
                }
                Some(Ok(Message::Ping(value))) => { let _ = sender.send(Message::Pong(value)).await; }
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                _ => {}
            }
        }
    }
    cleanup_socket(&state, id, &channel, &claims.session_id).await;
}

async fn cleanup_socket(state: &AppState, id: u64, channel: &str, session_id: &str) {
    state.connections.lock().await.remove(id);
    state.clear_presence(channel, session_id).await;
    state.leave(channel).await;
}

fn close_message(code: u16, reason: &'static str) -> Message {
    Message::Close(Some(CloseFrame {
        code,
        reason: reason.into(),
    }))
}

fn error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}
