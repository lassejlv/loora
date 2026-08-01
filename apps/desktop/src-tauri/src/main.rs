use std::{
    collections::HashSet,
    env,
    path::{Path, PathBuf},
    sync::Arc,
};

use axum::{
    body::Body,
    extract::{
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
        Request, State,
    },
    http::{
        header::{
            ACCEPT, CACHE_CONTROL, CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, COOKIE,
            LOCATION, ORIGIN, REFERER, SET_COOKIE,
        },
        HeaderMap, HeaderName, Method, StatusCode,
    },
    response::{Html, IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use futures_util::{SinkExt, StreamExt};
use http_body_util::BodyExt;
use keyring::Entry;
use rand::RngCore;
use reqwest::redirect::Policy;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::{fs, net::TcpListener, sync::RwLock};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{
        client::IntoClientRequest,
        http::HeaderValue as WsHeaderValue,
        protocol::{frame::coding::CloseCode, CloseFrame as UpstreamCloseFrame},
        Message as UpstreamMessage,
    },
};
use url::Url;

const REALTIME_PROTOCOL: &str = "loora.realtime.v1";
const KEYRING_SERVICE: &str = "design.loora.desktop";
const KEYRING_ACCOUNT: &str = "session";

#[derive(Clone)]
struct Config {
    api_origin: Url,
    dev_server: Option<Url>,
    app_root: PathBuf,
}

#[derive(Clone)]
struct AppState {
    config: Config,
    client: reqwest::Client,
    port: u16,
    pending_state: Arc<RwLock<Option<String>>>,
    realtime_upstream: Arc<RwLock<Option<String>>>,
    session: SessionStore,
}

#[derive(Clone)]
struct SessionStore {
    token: Arc<RwLock<Option<String>>>,
    legacy_path: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionResponse {
    signed_in: bool,
    realtime: bool,
}

#[derive(Deserialize)]
struct OpenRequest {
    url: String,
}

impl Config {
    fn read(app: &tauri::AppHandle) -> Self {
        let api_origin = read_origin("LOORA_API_ORIGIN", "https://loora.design");
        let dev_server = env::var("LOORA_DESKTOP_DEV_SERVER")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .and_then(|value| Url::parse(value.trim()).ok())
            .or_else(|| {
                cfg!(debug_assertions).then(|| {
                    Url::parse("http://127.0.0.1:1421").expect("valid Vite development URL")
                })
            });
        let app_root = app
            .path()
            .resource_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("_up_")
            .join("dist")
            .join("app");

        Self {
            api_origin,
            dev_server,
            app_root,
        }
    }
}

impl SessionStore {
    async fn load() -> Self {
        let legacy_path = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join(if cfg!(target_os = "linux") {
                "loora"
            } else {
                "Loora"
            })
            .join("session.json");
        let entry = keyring_entry();
        let mut token = entry.as_ref().and_then(|entry| entry.get_password().ok());

        if token.is_none() {
            token = import_legacy_token(&legacy_path).await;
            if let (Some(entry), Some(value)) = (entry.as_ref(), token.as_ref()) {
                if let Err(error) = entry.set_password(value) {
                    eprintln!(
                        "[desktop] could not import the legacy session into keyring: {error}"
                    );
                } else {
                    let _ = fs::remove_file(&legacy_path).await;
                }
            }
        }

        Self {
            token: Arc::new(RwLock::new(token)),
            legacy_path,
        }
    }

    async fn get(&self) -> Option<String> {
        self.token.read().await.clone()
    }

    async fn set(&self, token: String) -> Result<(), String> {
        let entry = keyring_entry().ok_or_else(|| "keyring entry unavailable".to_owned())?;
        entry
            .set_password(&token)
            .map_err(|error| format!("could not save session: {error}"))?;
        *self.token.write().await = Some(token);
        let _ = fs::remove_file(&self.legacy_path).await;
        Ok(())
    }

    async fn clear(&self) {
        if let Some(entry) = keyring_entry() {
            if let Err(error) = entry.delete_credential() {
                eprintln!("[desktop] could not remove keyring session: {error}");
            }
        }
        *self.token.write().await = None;
        let _ = fs::remove_file(&self.legacy_path).await;
    }
}

fn keyring_entry() -> Option<Entry> {
    Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT)
        .map_err(|error| eprintln!("[desktop] could not open keyring: {error}"))
        .ok()
}

async fn import_legacy_token(path: &Path) -> Option<String> {
    let bytes = fs::read(path).await.ok()?;
    let value: Value = serde_json::from_slice(&bytes).ok()?;
    value
        .get("token")?
        .as_str()
        .filter(|token| !token.is_empty())
        .map(str::to_owned)
}

fn read_origin(name: &str, fallback: &str) -> Url {
    env::var(name)
        .ok()
        .and_then(|value| Url::parse(value.trim()).ok())
        .and_then(|url| Url::parse(&url.origin().ascii_serialization()).ok())
        .unwrap_or_else(|| Url::parse(fallback).expect("valid fallback origin"))
}

fn requested_port() -> u16 {
    if let Ok(value) = env::var("LOORA_DESKTOP_PORT") {
        if let Ok(port) = value.parse::<u16>() {
            if port > 0 {
                return port;
            }
        }
    }
    if cfg!(debug_assertions) {
        4300
    } else {
        0
    }
}

fn random_state() -> String {
    let mut bytes = [0_u8; 24];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn page(title: &str, message: &str) -> Response {
    let html = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" />\
     <title>{title}</title><style>html,body{{margin:0;height:100%;display:grid;\
     place-items:center;background:#09090b;color:#fafafa;font:14px/1.5 \
     ui-sans-serif,system-ui}}p{{max-width:34ch;text-align:center}}</style></head>\
     <body><p>{message}</p></body></html>"
    );
    (
        [
            (CONTENT_TYPE, "text/html; charset=utf-8"),
            (CACHE_CONTROL, "no-store"),
        ],
        Html(html),
    )
        .into_response()
}

async fn desktop_session(State(state): State<AppState>) -> impl IntoResponse {
    Json(SessionResponse {
        signed_in: state.session.get().await.is_some(),
        realtime: state.realtime_upstream.read().await.is_some(),
    })
}

async fn desktop_sign_in(State(state): State<AppState>) -> Response {
    let pending = random_state();
    *state.pending_state.write().await = Some(pending.clone());
    let mut target = state
        .config
        .api_origin
        .join("/desktop/auth")
        .expect("valid desktop auth URL");
    target
        .query_pairs_mut()
        .append_pair("port", &state.port.to_string())
        .append_pair("state", &pending);

    if let Err(error) = open_external(target.as_str()) {
        eprintln!("[desktop] could not open browser: {error}");
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "started": false })),
        )
            .into_response();
    }
    Json(json!({ "started": true })).into_response()
}

async fn callback(State(state): State<AppState>, request: Request) -> Response {
    let query = request.uri().query().unwrap_or_default();
    let params: HashSet<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
        .into_owned()
        .collect();
    let token = params
        .iter()
        .find(|(key, _)| key == "token")
        .map(|(_, value)| value.clone());
    let returned_state = params
        .iter()
        .find(|(key, _)| key == "state")
        .map(|(_, value)| value.clone());
    let expected = state.pending_state.read().await.clone();

    if expected.is_none() || token.is_none() || expected != returned_state {
        return page("Loora", "That sign-in link is not one this app asked for.");
    }
    *state.pending_state.write().await = None;

    let target = state
        .config
        .api_origin
        .join("/api/auth/one-time-token/verify")
        .expect("valid verification URL");
    let response = state
        .client
        .post(target)
        .header(
            ORIGIN.as_str(),
            state.config.api_origin.as_str().trim_end_matches('/'),
        )
        .json(&json!({ "token": token.unwrap() }))
        .send()
        .await;
    let Ok(response) = response else {
        return page(
            "Loora",
            "Could not reach Loora. Check your connection and try again.",
        );
    };
    let session = response
        .headers()
        .get("set-auth-token")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    if !response.status().is_success() || session.is_none() {
        return page(
            "Loora",
            "That sign-in code had expired. Try signing in again.",
        );
    }
    if state.session.set(session.unwrap()).await.is_err() {
        return page(
            "Loora",
            "Loora could not store the session in your system keyring.",
        );
    }
    page(
        "Loora",
        "Signed in. You can close this window and go back to Loora.",
    )
}

async fn desktop_sign_out(State(state): State<AppState>) -> Response {
    if let Some(token) = state.session.get().await {
        let target = state
            .config
            .api_origin
            .join("/api/auth/sign-out")
            .expect("valid sign-out URL");
        let _ = state
            .client
            .post(target)
            .bearer_auth(token)
            .header(
                ORIGIN.as_str(),
                state.config.api_origin.as_str().trim_end_matches('/'),
            )
            .json(&json!({}))
            .send()
            .await;
    }
    state.session.clear().await;
    Json(json!({ "signedIn": false })).into_response()
}

async fn desktop_open(Json(payload): Json<OpenRequest>) -> Response {
    let Ok(url) = Url::parse(&payload.url) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "opened": false }))).into_response();
    };
    if url.scheme() != "https" {
        return (StatusCode::BAD_REQUEST, Json(json!({ "opened": false }))).into_response();
    }
    match open_external(url.as_str()) {
        Ok(()) => Json(json!({ "opened": true })).into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({ "opened": false })),
        )
            .into_response(),
    }
}

fn open_external(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("cmd");
        command.args(["/c", "start", "", url]);
        return command.spawn().map(|_| ());
    };
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(url).spawn().map(|_| ())
}

fn is_hop_by_hop(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "connection"
            | "content-length"
            | "host"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

async fn proxy_api(State(state): State<AppState>, request: Request) -> Response {
    let path = request
        .uri()
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/api/")
        .to_owned();
    let target = match state.config.api_origin.join(&path) {
        Ok(target) => target,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid API target").into_response(),
    };
    let method = request.method().clone();
    let accepts_html = request
        .headers()
        .get(ACCEPT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.contains("text/html"));
    let mut upstream = state.client.request(method.clone(), target);
    for (name, value) in request.headers() {
        if !is_hop_by_hop(name) && name != COOKIE {
            upstream = upstream.header(name, value);
        }
    }
    upstream = upstream
        .header(
            ORIGIN.as_str(),
            state.config.api_origin.as_str().trim_end_matches('/'),
        )
        .header(REFERER.as_str(), state.config.api_origin.as_str());
    if let Some(token) = state.session.get().await {
        upstream = upstream.bearer_auth(token);
    }
    if method != Method::GET && method != Method::HEAD {
        let body = match request.into_body().collect().await {
            Ok(body) => body.to_bytes(),
            Err(_) => return (StatusCode::BAD_REQUEST, "Could not read request").into_response(),
        };
        upstream = upstream.body(body);
    }
    let response = match upstream.send().await {
        Ok(response) => response,
        Err(error) => {
            eprintln!("[desktop] proxy failed: {error}");
            return (StatusCode::BAD_GATEWAY, "Loora is unreachable").into_response();
        }
    };

    if let Some(token) = response
        .headers()
        .get("set-auth-token")
        .and_then(|value| value.to_str().ok())
    {
        if let Err(error) = state.session.set(token.to_owned()).await {
            eprintln!("[desktop] could not refresh keyring session: {error}");
        }
    }
    if path.starts_with("/api/auth/sign-out") && response.status().is_success() {
        state.session.clear().await;
    }

    if let Some(location) = response
        .headers()
        .get(LOCATION)
        .and_then(|value| value.to_str().ok())
    {
        if let Ok(destination) = state.config.api_origin.join(location) {
            if destination.origin() != state.config.api_origin.origin() {
                let _ = open_external(destination.as_str());
                if accepts_html {
                    return page(
                        "Loora",
                        "Continue in your browser — this window will go back.",
                    );
                }
                return Json(json!({ "openedExternally": destination.as_str() })).into_response();
            }
            let mut builder = Response::builder().status(response.status());
            let local_location = format!(
                "{}{}",
                destination.path(),
                destination
                    .query()
                    .map(|q| format!("?{q}"))
                    .unwrap_or_default()
            );
            builder = builder.header(LOCATION, local_location);
            return builder
                .body(Body::empty())
                .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response());
        }
    }

    let status = response.status();
    let mut headers = response.headers().clone();
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(_) => {
            return (StatusCode::BAD_GATEWAY, "Could not read Loora response").into_response()
        }
    };

    if path.starts_with("/api/realtime-ticket") && status.is_success() {
        if let Ok(mut ticket) = serde_json::from_slice::<Value>(&body) {
            if let Some(url) = ticket.get("url").and_then(Value::as_str).map(str::to_owned) {
                *state.realtime_upstream.write().await = Some(url);
                ticket["url"] = Value::String(format!("ws://127.0.0.1:{}/realtime", state.port));
            }
            return (
                StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK),
                [(CACHE_CONTROL, "no-store")],
                Json(ticket),
            )
                .into_response();
        }
    }

    headers.remove(SET_COOKIE);
    headers.remove("set-auth-token");
    headers.remove(CONTENT_ENCODING);
    headers.remove(CONTENT_LENGTH);
    for name in [
        "connection",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
    let mut result = Response::builder().status(status);
    for (name, value) in &headers {
        result = result.header(name, value);
    }
    result
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

async fn realtime(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Response {
    let protocols = headers
        .get("sec-websocket-protocol")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if !protocols
        .iter()
        .any(|protocol| protocol == REALTIME_PROTOCOL)
    {
        return (
            StatusCode::BAD_REQUEST,
            "Expected the Loora realtime protocol",
        )
            .into_response();
    }
    let upstream = state.realtime_upstream.read().await.clone();
    let Some(upstream) = upstream else {
        return (StatusCode::SERVICE_UNAVAILABLE, "No realtime target yet").into_response();
    };
    let origin = state.config.api_origin.to_string();
    ws.protocols([REALTIME_PROTOCOL])
        .on_upgrade(move |socket| bridge_realtime(socket, upstream, protocols, origin))
}

async fn bridge_realtime(
    client: WebSocket,
    upstream: String,
    protocols: Vec<String>,
    origin: String,
) {
    let Ok(mut request) = upstream.into_client_request() else {
        return;
    };
    if let Ok(value) = WsHeaderValue::from_str(&protocols.join(", ")) {
        request
            .headers_mut()
            .insert("sec-websocket-protocol", value);
    }
    if let Ok(value) = WsHeaderValue::from_str(origin.trim_end_matches('/')) {
        request.headers_mut().insert("origin", value);
    }
    let Ok((server, _)) = connect_async(request).await else {
        return;
    };
    let (mut client_write, mut client_read) = client.split();
    let (mut server_write, mut server_read) = server.split();

    let to_server = async {
        while let Some(Ok(message)) = client_read.next().await {
            let upstream = match message {
                Message::Text(text) => UpstreamMessage::Text(text.to_string().into()),
                Message::Binary(bytes) => UpstreamMessage::Binary(bytes),
                Message::Ping(bytes) => UpstreamMessage::Ping(bytes),
                Message::Pong(bytes) => UpstreamMessage::Pong(bytes),
                Message::Close(frame) => {
                    UpstreamMessage::Close(frame.map(|frame| UpstreamCloseFrame {
                        code: CloseCode::from(frame.code),
                        reason: frame.reason.to_string().into(),
                    }))
                }
            };
            if server_write.send(upstream).await.is_err() {
                break;
            }
        }
    };
    let to_client = async {
        while let Some(Ok(message)) = server_read.next().await {
            let downstream = match message {
                UpstreamMessage::Text(text) => Message::Text(text.to_string().into()),
                UpstreamMessage::Binary(bytes) => Message::Binary(bytes),
                UpstreamMessage::Ping(bytes) => Message::Ping(bytes),
                UpstreamMessage::Pong(bytes) => Message::Pong(bytes),
                UpstreamMessage::Close(frame) => Message::Close(frame.map(|frame| CloseFrame {
                    code: frame.code.into(),
                    reason: frame.reason.to_string().into(),
                })),
                UpstreamMessage::Frame(_) => continue,
            };
            if client_write.send(downstream).await.is_err() {
                break;
            }
        }
    };
    tokio::select! {
      _ = to_server => {}
      _ = to_client => {}
    }
}

async fn serve_app(State(state): State<AppState>, request: Request) -> Response {
    if let Some(dev_server) = &state.config.dev_server {
        return proxy_dev_server(&state, dev_server, request).await;
    }
    let relative = request.uri().path().trim_start_matches('/');
    if !relative.is_empty() && !relative.contains("..") {
        let path = state.config.app_root.join(relative);
        if let Ok(bytes) = fs::read(&path).await {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            let cache = if relative == "index.html" {
                "no-store"
            } else {
                "max-age=31536000, immutable"
            };
            return (
                [(CONTENT_TYPE, mime.as_ref()), (CACHE_CONTROL, cache)],
                bytes,
            )
                .into_response();
        }
    }
    let index = state.config.app_root.join("index.html");
    match fs::read(index).await {
        Ok(bytes) => (
            [
                (CONTENT_TYPE, "text/html; charset=utf-8"),
                (CACHE_CONTROL, "no-store"),
            ],
            bytes,
        )
            .into_response(),
        Err(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "The interface has not been built. Run `bun run build:desktop`.",
        )
            .into_response(),
    }
}

/// Keep the window on the host origin in development.
///
/// A 302 over to Vite moves `/desktop/session` onto a different origin and
/// leaves the sign-in gate polling a copy of the app that never sees the
/// token the callback just stored. Proxy the bytes instead so the hand-off
/// and the window share one loopback server.
async fn proxy_dev_server(state: &AppState, dev_server: &Url, request: Request) -> Response {
    let mut target = dev_server.clone();
    target.set_path(request.uri().path());
    target.set_query(request.uri().query());
    let method = request.method().clone();
    let mut upstream = state.client.request(method.clone(), target);
    for (name, value) in request.headers() {
        if !is_hop_by_hop(name) {
            upstream = upstream.header(name, value);
        }
    }
    if method != Method::GET && method != Method::HEAD {
        let body = match request.into_body().collect().await {
            Ok(body) => body.to_bytes(),
            Err(_) => return (StatusCode::BAD_REQUEST, "Could not read request").into_response(),
        };
        upstream = upstream.body(body);
    }
    let response = match upstream.send().await {
        Ok(response) => response,
        Err(error) => {
            eprintln!("[desktop] Vite development proxy failed: {error}");
            return (
                StatusCode::BAD_GATEWAY,
                "The development interface is not running.",
            )
                .into_response();
        }
    };
    let status = response.status();
    let mut headers = response.headers().clone();
    let body = match response.bytes().await {
        Ok(body) => body,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                "Could not read the development interface.",
            )
                .into_response()
        }
    };
    headers.remove(CONTENT_ENCODING);
    headers.remove(CONTENT_LENGTH);
    for name in [
        "connection",
        "host",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
    let mut result = Response::builder().status(status);
    for (name, value) in &headers {
        result = result.header(name, value);
    }
    result
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response())
}

fn router(state: AppState) -> Router {
    Router::new()
        .route("/desktop/session", get(desktop_session))
        .route("/desktop/sign-in", post(desktop_sign_in))
        .route("/desktop/sign-out", post(desktop_sign_out))
        .route("/desktop/open", post(desktop_open))
        .route("/callback", get(callback))
        .route("/realtime", get(realtime))
        .route("/api/{*path}", any(proxy_api))
        .fallback(serve_app)
        .with_state(state)
}

fn main() {
    rustls::crypto::ring::default_provider()
        .install_default()
        .expect("install rustls crypto provider");
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async move {
                let listener = TcpListener::bind(("127.0.0.1", requested_port()))
                    .await
                    .map_err(|error| format!("could not bind desktop host: {error}"))?;
                let port = listener
                    .local_addr()
                    .map_err(|error| format!("could not read desktop host port: {error}"))?
                    .port();
                let config = Config::read(&handle);
                let session = SessionStore::load().await;
                let state = AppState {
                    config,
                    client: reqwest::Client::builder()
                        .redirect(Policy::none())
                        .build()
                        .map_err(|error| format!("could not create HTTP client: {error}"))?,
                    port,
                    pending_state: Arc::new(RwLock::new(None)),
                    realtime_upstream: Arc::new(RwLock::new(None)),
                    session,
                };
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = axum::serve(listener, router(state)).await {
                        eprintln!("[desktop] loopback host stopped: {error}");
                    }
                });

                let url = Url::parse(&format!("http://127.0.0.1:{port}/"))
                    .map_err(|error| format!("could not build desktop URL: {error}"))?;
                WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
                    .title("Loora")
                    .inner_size(1440.0, 900.0)
                    .min_inner_size(960.0, 640.0)
                    .decorations(true)
                    .build()
                    .map_err(|error| format!("could not create desktop window: {error}"))?;
                Ok::<(), String>(())
            })?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Loora");
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::header::{AUTHORIZATION, CONNECTION, HOST};

    #[test]
    fn random_state_matches_web_handoff_contract() {
        let state = random_state();
        assert_eq!(state.len(), 32);
        assert!(state
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_'));
    }

    #[test]
    fn hop_by_hop_headers_are_removed() {
        assert!(is_hop_by_hop(&CONNECTION));
        assert!(is_hop_by_hop(&HOST));
        assert!(!is_hop_by_hop(&AUTHORIZATION));
    }

    #[test]
    fn invalid_origin_falls_back_to_loora() {
        let variable = "LOORA_DESKTOP_TEST_ORIGIN";
        std::env::set_var(variable, "not a URL");
        assert_eq!(
            read_origin(variable, "https://loora.design").as_str(),
            "https://loora.design/"
        );
        std::env::remove_var(variable);
    }

    #[tokio::test]
    async fn imports_a_legacy_session_token() {
        let path = std::env::temp_dir().join(format!("loora-session-{}.json", random_state()));
        fs::write(&path, br#"{"token":"legacy-token"}"#)
            .await
            .unwrap();
        assert_eq!(
            import_legacy_token(&path).await.as_deref(),
            Some("legacy-token")
        );
        fs::remove_file(path).await.unwrap();
    }

    #[tokio::test]
    async fn rejects_an_invalid_legacy_session() {
        let path = std::env::temp_dir().join(format!("loora-session-{}.json", random_state()));
        fs::write(&path, br#"{"token":42}"#).await.unwrap();
        assert!(import_legacy_token(&path).await.is_none());
        fs::remove_file(path).await.unwrap();
    }
}
