use std::{
    process::{Child, Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{SinkExt, StreamExt};
use hmac::{Hmac, Mac};
use loora_ws_server::{
    config::Config,
    server::{router, AppState},
};
use serde_json::{json, Value};
use sha2::Sha256;
use tokio::net::TcpListener;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};

const SECRET: &str = "ssssssssssssssssssssssssssssssss";
const TOKEN: &str = "tttttttttttttttttttttttttttttttt";

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

fn ticket(jti: &str, session_id: &str) -> String {
    let now = now_ms();
    let claims = json!({
        "v": 1,
        "jti": jti,
        "userId": "user-1",
        "sessionId": session_id,
        "ownerUserId": "owner-1",
        "designId": "design-1",
        "draftId": null,
        "role": "owner",
        "name": "Ada",
        "image": null,
        "color": "#6c5ce7",
        "issuedAt": now,
        "expiresAt": now + 60_000,
    });
    let body = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).unwrap());
    let mut mac = Hmac::<Sha256>::new_from_slice(SECRET.as_bytes()).unwrap();
    mac.update(body.as_bytes());
    format!(
        "{body}.{}",
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    )
}

async fn start() -> (String, std::sync::Arc<AppState>) {
    start_with_redis(None).await
}

async fn start_with_redis(redis_url: Option<String>) -> (String, std::sync::Arc<AppState>) {
    let state = AppState::new(Config {
        port: 0,
        ticket_secrets: vec![SECRET.into()],
        internal_token: TOKEN.into(),
        redis_url,
        allowed_origins: None,
    })
    .await
    .unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = router(state.clone());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}"), state)
}

struct RedisProcess(Child);

impl Drop for RedisProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn redis_server() -> Option<(RedisProcess, String)> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").ok()?;
    let port = listener.local_addr().ok()?.port();
    drop(listener);
    let child = Command::new("redis-server")
        .args([
            "--bind",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--save",
            "",
            "--appendonly",
            "no",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let url = format!("redis://127.0.0.1:{port}");
    for _ in 0..50 {
        if tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .is_ok()
        {
            return Some((RedisProcess(child), url));
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    None
}

async fn connect(
    origin: &str,
    ticket: String,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let mut request = origin.replace("http://", "ws://").to_string();
    request.push_str("/canvas");
    let mut request = request.into_client_request().unwrap();
    request.headers_mut().insert(
        "Sec-WebSocket-Protocol",
        format!("loora.realtime.v1, {ticket}").parse().unwrap(),
    );
    let (socket, response) = connect_async(request).await.unwrap();
    assert_eq!(
        response.headers().get("Sec-WebSocket-Protocol").unwrap(),
        "loora.realtime.v1"
    );
    socket
}

async fn next_json(
    socket: &mut tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) -> Value {
    let message = tokio::time::timeout(std::time::Duration::from_secs(2), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    serde_json::from_str(message.to_text().unwrap()).unwrap()
}

#[tokio::test]
async fn websocket_and_ingest_match_the_existing_contract() {
    let (origin, state) = start().await;
    let mut socket = connect(&origin, ticket("ticket-1", "session-1")).await;
    let ready = next_json(&mut socket).await;
    assert_eq!(ready["type"], "ready");
    assert_eq!(ready["role"], "owner");

    socket
        .send(Message::Text(r#"{"type":"ping"}"#.into()))
        .await
        .unwrap();
    assert_eq!(next_json(&mut socket).await["type"], "pong");

    let response = reqwest::Client::new()
        .post(format!("{origin}/publish"))
        .bearer_auth(TOKEN)
        .json(&json!({
            "kind": "event",
            "ownerUserId": "owner-1",
            "target": { "designId": "design-1", "draftId": null },
            "event": { "type": "canvas.changed", "revision": 4, "nodeIds": ["node-1"] },
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let changed = next_json(&mut socket).await;
    assert_eq!(changed["type"], "canvas.changed");
    assert_eq!(changed["revision"], 4);

    socket.close(None).await.unwrap();
    state.shutdown().await;
}

#[tokio::test]
async fn tickets_are_single_use() {
    let (origin, state) = start().await;
    let ticket = ticket("ticket-replay", "session-replay");
    let mut socket = connect(&origin, ticket.clone()).await;
    next_json(&mut socket).await;
    let response = reqwest::get(format!("{origin}/canvas?ticket={ticket}"))
        .await
        .unwrap();
    assert_eq!(response.status(), 401);
    assert_eq!(response.text().await.unwrap(), "Ticket already used");
    socket.close(None).await.unwrap();
    state.shutdown().await;
}

#[tokio::test]
async fn presence_is_stamped_not_echoed_and_cleared() {
    let (origin, state) = start().await;
    let mut mover = connect(&origin, ticket("presence-1", "mover")).await;
    next_json(&mut mover).await;
    let mut watcher = connect(&origin, ticket("presence-2", "watcher")).await;
    next_json(&mut watcher).await;

    mover
        .send(Message::Text(
            json!({
                "type": "presence",
                "cursor": { "x": 12.4, "y": 8 },
                "selection": ["node-1"],
                "userId": "impostor",
                "name": "Impostor",
            })
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
    let presence = next_json(&mut watcher).await;
    assert_eq!(presence["type"], "presence.peer");
    assert_eq!(presence["sessionId"], "mover");
    assert_eq!(presence["peer"]["userId"], "user-1");
    assert_eq!(presence["peer"]["name"], "Ada");
    assert_eq!(presence["peer"]["cursor"], json!({ "x": 12.0, "y": 8.0 }));

    mover
        .send(Message::Text(r#"{"type":"ping"}"#.into()))
        .await
        .unwrap();
    assert_eq!(next_json(&mut mover).await["type"], "pong");
    mover.close(None).await.unwrap();
    let cleared = next_json(&mut watcher).await;
    assert_eq!(cleared["type"], "presence.peer");
    assert_eq!(cleared["sessionId"], "mover");
    assert!(cleared["peer"].is_null());

    watcher.close(None).await.unwrap();
    state.shutdown().await;
}

#[tokio::test]
async fn redis_shares_events_and_ticket_claims_between_instances() {
    let Some((_redis, redis_url)) = redis_server().await else {
        return;
    };
    let (alpha_origin, alpha) = start_with_redis(Some(redis_url.clone())).await;
    let (beta_origin, beta) = start_with_redis(Some(redis_url)).await;
    let shared_ticket = ticket("redis-ticket", "redis-session");
    let mut socket = connect(&beta_origin, shared_ticket.clone()).await;
    next_json(&mut socket).await;

    let response = reqwest::Client::new()
        .post(format!("{alpha_origin}/publish"))
        .bearer_auth(TOKEN)
        .json(&json!({
            "kind": "event",
            "ownerUserId": "owner-1",
            "target": { "designId": "design-1", "draftId": null },
            "event": { "type": "canvas.changed", "revision": 11, "nodeIds": [] },
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(next_json(&mut socket).await["revision"], 11);

    let replay = reqwest::get(format!("{alpha_origin}/canvas?ticket={shared_ticket}"))
        .await
        .unwrap();
    assert_eq!(replay.status(), 401);
    socket.close(None).await.unwrap();
    alpha.shutdown().await;
    beta.shutdown().await;
}
