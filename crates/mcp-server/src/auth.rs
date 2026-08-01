use std::{
    collections::{HashMap, VecDeque},
    sync::Arc,
    time::{Duration, Instant},
};

use axum::http::{header, HeaderMap};
use chrono::{DateTime, Utc};
use reqwest::Client;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::Mutex;

const AUTH_CACHE_MAX_ENTRIES: usize = 1_000;
const CLEANUP_BATCH_SIZE: usize = 64;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VerifiedSession {
    pub user_id: String,
    pub access_token_expires_at: Option<DateTime<Utc>>,
}

#[derive(Clone)]
pub struct AuthVerifier {
    auth_url: String,
    client: Client,
    cache_ttl: Duration,
    cache: Arc<Mutex<SessionCache>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    user_id: String,
    access_token_expires_at: Option<DateTime<Utc>>,
}

struct CachedSession {
    session: VerifiedSession,
    expires_at: Instant,
    generation: u64,
}

#[derive(Default)]
struct SessionCache {
    entries: HashMap<[u8; 32], CachedSession>,
    order: VecDeque<([u8; 32], u64)>,
    next_generation: u64,
}

impl AuthVerifier {
    pub fn new(auth_origin: &str, timeout_ms: u64, cache_ttl_ms: u64) -> Self {
        Self {
            auth_url: format!(
                "{}/api/auth/mcp/get-session",
                auth_origin.trim_end_matches('/')
            ),
            client: Client::builder()
                .timeout(Duration::from_millis(timeout_ms))
                .build()
                .expect("auth HTTP client"),
            cache_ttl: Duration::from_millis(cache_ttl_ms),
            cache: Arc::new(Mutex::new(SessionCache::default())),
        }
    }

    pub async fn get_session(&self, headers: &HeaderMap) -> Option<VerifiedSession> {
        let token = headers
            .get(header::AUTHORIZATION)?
            .to_str()
            .ok()?
            .strip_prefix("Bearer ")?
            .trim();
        if token.is_empty() {
            return None;
        }
        self.verify_token(token).await
    }

    pub async fn verify_token(&self, token: &str) -> Option<VerifiedSession> {
        let key: [u8; 32] = Sha256::digest(token.as_bytes()).into();
        let now = Instant::now();

        if !self.cache_ttl.is_zero() {
            let cache = self.cache.lock().await;
            if let Some(entry) = cache.entries.get(&key) {
                if entry.expires_at > now {
                    return Some(entry.session.clone());
                }
            }
        }

        let response = self
            .client
            .get(&self.auth_url)
            .bearer_auth(token)
            .send()
            .await
            .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let response: SessionResponse = response.json().await.ok()?;
        if response.user_id.is_empty() {
            return None;
        }
        let session = VerifiedSession {
            user_id: response.user_id,
            access_token_expires_at: response.access_token_expires_at,
        };

        if self.cache_ttl.is_zero() {
            return Some(session);
        }

        let cache_duration = match session.access_token_expires_at {
            Some(expires_at) => (expires_at - Utc::now())
                .to_std()
                .unwrap_or(Duration::ZERO)
                .min(self.cache_ttl),
            None => self.cache_ttl,
        };
        if cache_duration.is_zero() {
            return Some(session);
        }

        let mut cache = self.cache.lock().await;
        cache.insert(key, session.clone(), now + cache_duration);
        Some(session)
    }
}

impl SessionCache {
    fn insert(&mut self, key: [u8; 32], session: VerifiedSession, expires_at: Instant) {
        self.cleanup(Instant::now());
        if let Some(entry) = self.entries.get_mut(&key) {
            entry.session = session;
            entry.expires_at = expires_at;
            return;
        }
        while self.entries.len() >= AUTH_CACHE_MAX_ENTRIES {
            if !self.evict_oldest() {
                break;
            }
        }

        let generation = self.next_generation;
        self.next_generation = self.next_generation.wrapping_add(1);
        self.entries.insert(
            key,
            CachedSession {
                session,
                expires_at,
                generation,
            },
        );
        self.order.push_back((key, generation));
    }

    fn cleanup(&mut self, now: Instant) {
        for _ in 0..CLEANUP_BATCH_SIZE {
            let Some((key, generation)) = self.order.front().copied() else {
                break;
            };
            let remove = self
                .entries
                .get(&key)
                .is_none_or(|entry| entry.generation != generation || entry.expires_at <= now);
            if !remove {
                break;
            }
            self.order.pop_front();
            if self
                .entries
                .get(&key)
                .is_some_and(|entry| entry.generation == generation)
            {
                self.entries.remove(&key);
            }
        }
    }

    fn evict_oldest(&mut self) -> bool {
        while let Some((key, generation)) = self.order.pop_front() {
            if self
                .entries
                .get(&key)
                .is_some_and(|entry| entry.generation == generation)
            {
                self.entries.remove(&key);
                return true;
            }
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::{routing::get, Json, Router};
    use serde_json::json;
    use tokio::net::TcpListener;

    use super::*;

    async fn mock_auth<H, T>(handler: H) -> (String, tokio::task::JoinHandle<()>)
    where
        H: axum::handler::Handler<T, ()> + Clone + Send + 'static,
        T: 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                Router::new().route("/api/auth/mcp/get-session", get(handler)),
            )
            .await
            .unwrap();
        });
        (format!("http://{address}"), server)
    }

    fn bearer(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {token}").parse().unwrap(),
        );
        headers
    }

    #[tokio::test]
    async fn verifies_and_caches_successful_sessions() {
        let requests = Arc::new(AtomicUsize::new(0));
        let request_count = requests.clone();
        let (origin, server) = mock_auth(move || {
            let request_count = request_count.clone();
            async move {
                request_count.fetch_add(1, Ordering::Relaxed);
                Json(json!({
                    "userId": "user-id",
                    "accessTokenExpiresAt": "2099-01-01T00:00:00Z"
                }))
            }
        })
        .await;
        let verifier = AuthVerifier::new(&origin, 5_000, 60_000);

        let first = verifier.get_session(&bearer("token")).await.unwrap();
        let second = verifier.get_session(&bearer("token")).await.unwrap();

        assert_eq!(first.user_id, "user-id");
        assert!(first.access_token_expires_at.is_some());
        assert_eq!(second, first);
        assert_eq!(requests.load(Ordering::Relaxed), 1);
        server.abort();
    }

    #[tokio::test]
    async fn does_not_cache_failures_or_when_ttl_is_zero() {
        let requests = Arc::new(AtomicUsize::new(0));
        let request_count = requests.clone();
        let (origin, server) = mock_auth(move || {
            let request_count = request_count.clone();
            async move {
                let request = request_count.fetch_add(1, Ordering::Relaxed);
                if request < 2 {
                    (axum::http::StatusCode::UNAUTHORIZED, Json(json!({})))
                } else {
                    (
                        axum::http::StatusCode::OK,
                        Json(json!({ "userId": "user-id" })),
                    )
                }
            }
        })
        .await;
        let verifier = AuthVerifier::new(&origin, 5_000, 0);
        let headers = bearer("token");

        assert!(verifier.get_session(&headers).await.is_none());
        assert!(verifier.get_session(&headers).await.is_none());
        assert!(verifier.get_session(&headers).await.is_some());
        assert!(verifier.get_session(&headers).await.is_some());
        assert_eq!(requests.load(Ordering::Relaxed), 4);
        server.abort();
    }

    #[tokio::test]
    async fn expires_cached_sessions_with_the_access_token() {
        let requests = Arc::new(AtomicUsize::new(0));
        let request_count = requests.clone();
        let expires_at = (Utc::now() + chrono::Duration::milliseconds(50)).to_rfc3339();
        let (origin, server) = mock_auth(move || {
            let request_count = request_count.clone();
            let expires_at = expires_at.clone();
            async move {
                request_count.fetch_add(1, Ordering::Relaxed);
                Json(json!({
                    "userId": "user-id",
                    "accessTokenExpiresAt": expires_at
                }))
            }
        })
        .await;
        let verifier = AuthVerifier::new(&origin, 5_000, 60_000);
        let headers = bearer("token");

        assert!(verifier.get_session(&headers).await.is_some());
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(verifier.get_session(&headers).await.is_some());
        assert_eq!(requests.load(Ordering::Relaxed), 2);
        server.abort();
    }
}
