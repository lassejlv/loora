use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use redis::aio::ConnectionManager;
use tokio::sync::Mutex;

const COUNT_SCRIPT: &str = "local hits = redis.call('INCR', KEYS[1]) if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end return hits";
const MAX_MEMORY_KEYS: usize = 50_000;

#[derive(Clone, Copy)]
pub struct Decision {
    pub ok: bool,
    pub limit: u64,
    pub remaining: u64,
    pub retry_after: u64,
}

struct MemoryEntry {
    hits: u64,
    expires: Instant,
}
struct State {
    connection: Option<ConnectionManager>,
    unavailable_until: Option<Instant>,
    memory: HashMap<String, MemoryEntry>,
}

#[derive(Clone)]
pub struct RateLimiter {
    client: Option<redis::Client>,
    state: Arc<Mutex<State>>,
}

impl RateLimiter {
    pub fn new(url: Option<&str>) -> Self {
        Self {
            client: url.and_then(|url| redis::Client::open(url).ok()),
            state: Arc::new(Mutex::new(State {
                connection: None,
                unavailable_until: None,
                memory: HashMap::new(),
            })),
        }
    }

    pub async fn check(
        &self,
        bucket: &str,
        identity: &str,
        limit: u64,
        window: Duration,
    ) -> Decision {
        let key = format!("ratelimit:{bucket}:{identity}");
        let hits = self.count(&key, window).await;
        Decision {
            ok: hits <= limit,
            limit,
            remaining: limit.saturating_sub(hits),
            retry_after: window.as_secs().max(1),
        }
    }

    async fn count(&self, key: &str, window: Duration) -> u64 {
        let mut state = self.state.lock().await;
        let now = Instant::now();
        let can_try = state.unavailable_until.is_none_or(|until| until <= now);
        if can_try {
            if let Some(client) = &self.client {
                if state.connection.is_none() {
                    match tokio::time::timeout(
                        Duration::from_millis(1_500),
                        ConnectionManager::new(client.clone()),
                    )
                    .await
                    {
                        Ok(Ok(connection)) => state.connection = Some(connection),
                        _ => state.unavailable_until = Some(now + Duration::from_secs(10)),
                    }
                }
                if let Some(connection) = state.connection.as_mut() {
                    let result = tokio::time::timeout(
                        Duration::from_secs(1),
                        redis::cmd("EVAL")
                            .arg(COUNT_SCRIPT)
                            .arg(1)
                            .arg(key)
                            .arg(window.as_millis() as u64)
                            .query_async::<u64>(connection),
                    )
                    .await;
                    if let Ok(Ok(hits)) = result {
                        return hits;
                    }
                    state.connection = None;
                    state.unavailable_until = Some(now + Duration::from_secs(10));
                    tracing::warn!("rate-limit Redis unavailable; counting in memory");
                }
            }
        }
        if state
            .memory
            .get(key)
            .is_none_or(|entry| entry.expires <= now)
        {
            if state.memory.len() >= MAX_MEMORY_KEYS {
                state.memory.retain(|_, entry| entry.expires > now);
                if state.memory.len() >= MAX_MEMORY_KEYS {
                    if let Some(oldest) = state
                        .memory
                        .iter()
                        .min_by_key(|(_, entry)| entry.expires)
                        .map(|(key, _)| key.clone())
                    {
                        state.memory.remove(&oldest);
                    }
                }
            }
            state.memory.insert(
                key.into(),
                MemoryEntry {
                    hits: 1,
                    expires: now + window,
                },
            );
            1
        } else {
            let entry = state.memory.get_mut(key).expect("checked above");
            entry.hits += 1;
            entry.hits
        }
    }
}
