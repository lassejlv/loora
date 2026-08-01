use std::{collections::HashMap, sync::Arc, time::Duration};

use axum::{
    extract::{Request, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use reqwest::Client;
use rmcp::{
    model::{
        CallToolRequestParams, CallToolResponse, CallToolResult, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    transport::streamable_http_server::{
        session::never::NeverSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData as McpError, RoleServer, ServerHandler, ServiceExt,
};
use serde_json::{json, Value};
use tokio_util::sync::CancellationToken;
use tower_http::cors::{Any, CorsLayer};
use url::Url;

use crate::{
    auth::AuthVerifier,
    config::Config,
    rate_limit::{Decision, RateLimiter},
};

const TOOLS_JSON: &str = include_str!("tools.json");

pub struct AppState {
    config: Config,
    http: Client,
    auth: AuthVerifier,
    tools: Value,
    schemas: HashMap<String, Value>,
    rates: RateLimiter,
}

#[derive(Clone)]
struct LooraHandler {
    state: Arc<AppState>,
    fixed_user_id: Option<String>,
}

impl LooraHandler {
    fn user_id(&self, context: &RequestContext<RoleServer>) -> Result<String, McpError> {
        if let Some(user_id) = &self.fixed_user_id {
            return Ok(user_id.clone());
        }
        context
            .extensions
            .get::<http::request::Parts>()
            .and_then(|parts| parts.extensions.get::<AuthenticatedUser>())
            .map(|user| user.0.clone())
            .ok_or_else(|| {
                McpError::internal_error("Authenticated account context is missing", None)
            })
    }
}

impl ServerHandler for LooraHandler {
    fn get_info(&self) -> ServerInfo {
        let mut info = ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_tool_list_changed()
                .build(),
        );
        info.server_info.name = "loora".to_owned();
        info.server_info.version = "0.3.0".to_owned();
        info
    }

    fn supported_protocol_versions(&self) -> std::borrow::Cow<'static, [ProtocolVersion]> {
        std::borrow::Cow::Borrowed(&[
            ProtocolVersion::V_2024_11_05,
            ProtocolVersion::V_2025_03_26,
            ProtocolVersion::V_2025_06_18,
        ])
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let tools = serde_json::from_value::<Vec<Tool>>(self.state.tools.clone())
            .map_err(|error| McpError::internal_error(error.to_string(), None))?;
        Ok(ListToolsResult::with_all_items(tools))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.state
            .tools
            .as_array()?
            .iter()
            .find(|tool| tool.get("name").and_then(Value::as_str) == Some(name))
            .and_then(|tool| serde_json::from_value(tool.clone()).ok())
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        let user_id = self.user_id(&context)?;
        let name = request.name.as_ref();
        let mut arguments = Value::Object(request.arguments.unwrap_or_default());
        normalize_json_arguments(&mut arguments);
        if let Some(schema) = self.state.schemas.get(name) {
            if let Err(error) = jsonschema::draft7::validate(schema, &arguments) {
                return Ok(
                    CallToolResult::error(vec![rmcp::model::ContentBlock::text(format!(
                        "Invalid arguments for tool {name}: {error}"
                    ))])
                    .into(),
                );
            }
        }
        let value = match self
            .state
            .internal(json!({
                "action":"execute",
                "userId":user_id,
                "tool":name,
                "arguments":arguments
            }))
            .await
        {
            Ok(value) => value,
            Err(error) => {
                return Ok(
                    CallToolResult::error(vec![rmcp::model::ContentBlock::text(error)]).into(),
                )
            }
        };
        let result = serde_json::from_value::<CallToolResult>(value)
            .map_err(|error| McpError::internal_error(error.to_string(), None))?;
        Ok(result.into())
    }
}

#[derive(Clone)]
struct AuthenticatedUser(String);

impl AppState {
    pub async fn new(config: Config) -> Result<Arc<Self>, String> {
        let auth = AuthVerifier::new(
            &config.auth_origin,
            config.auth_timeout_ms,
            config.auth_cache_ttl_ms,
        );
        let tools: Value = serde_json::from_str(TOOLS_JSON).expect("valid embedded MCP tools");
        let schemas = tools
            .as_array()
            .expect("tool manifest array")
            .iter()
            .filter_map(|tool| {
                Some((
                    tool.get("name")?.as_str()?.to_owned(),
                    tool.get("inputSchema")?.clone(),
                ))
            })
            .collect();
        let rates = RateLimiter::new(config.rate_limit_redis_url.as_deref());
        Ok(Arc::new(Self {
            config,
            http: Client::builder()
                .timeout(Duration::from_secs(120))
                .build()
                .map_err(|error| error.to_string())?,
            auth,
            tools,
            schemas,
            rates,
        }))
    }

    async fn internal(&self, body: Value) -> Result<Value, String> {
        let response = self
            .http
            .post(&self.config.internal_api_url)
            .bearer_auth(&self.config.internal_token)
            .json(&body)
            .send()
            .await
            .map_err(|_| "Loora's MCP execution service is temporarily unavailable.".to_owned())?;
        let status = response.status();
        let value: Value = response.json().await.map_err(|_| {
            "Loora's MCP execution service returned an invalid response.".to_owned()
        })?;
        if status.is_success() {
            Ok(value)
        } else {
            Err(value
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("Loora's MCP execution service rejected the request.")
                .to_owned())
        }
    }

    async fn allow(&self, bucket: &str, identity: &str, limit: u64) -> Decision {
        self.rates
            .check(bucket, identity, limit, Duration::from_secs(60))
            .await
    }
}

pub fn router(state: Arc<AppState>) -> Router {
    let public_host = Url::parse(&state.config.public_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    let mut allowed_hosts = vec![
        "localhost".to_owned(),
        "127.0.0.1".to_owned(),
        "::1".to_owned(),
    ];
    if let Some(host) = public_host {
        allowed_hosts.push(host);
    }
    let transport = StreamableHttpService::new(
        {
            let state = state.clone();
            move || {
                Ok(LooraHandler {
                    state: state.clone(),
                    fixed_user_id: None,
                })
            }
        },
        Arc::new(NeverSessionManager::default()),
        StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            .with_json_response(true)
            .with_sse_keep_alive(None)
            .with_allowed_hosts(allowed_hosts)
            .with_max_request_body_bytes(32 * 1024 * 1024)
            .with_cancellation_token(CancellationToken::new()),
    );
    let mcp = Router::new()
        .nest_service("/mcp", transport)
        .layer(middleware::from_fn_with_state(state.clone(), authorize_mcp));
    Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .route("/ready", get(ready))
        .route("/.well-known/oauth-protected-resource", get(metadata))
        .route("/.well-known/oauth-protected-resource/mcp", get(metadata))
        .merge(mcp)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
                .allow_headers(Any)
                .max_age(Duration::from_secs(86_400))
                .expose_headers([
                    header::WWW_AUTHENTICATE,
                    HeaderName::from_static("mcp-session-id"),
                    HeaderName::from_static("server-timing"),
                    HeaderName::from_static("x-request-id"),
                ]),
        )
        .fallback(not_found)
        .with_state(state)
}

async fn authorize_mcp(
    State(state): State<Arc<AppState>>,
    mut request: Request,
    next: Next,
) -> Response {
    if request.method() == Method::OPTIONS {
        return StatusCode::NO_CONTENT.into_response();
    }
    if request.method() != Method::POST {
        return json_response(
            StatusCode::METHOD_NOT_ALLOWED,
            rpc_error("Method not allowed"),
        );
    }
    let address = caller_identity(request.headers());
    let by_address = state.allow("mcp-address", &address, 600).await;
    if !by_address.ok {
        return rate_limited(by_address);
    }
    let Some(session) = state.auth.get_session(request.headers()).await else {
        let anonymous = state.allow("mcp-anonymous", &address, 60).await;
        if !anonymous.ok {
            return rate_limited(anonymous);
        }
        let mut result = json_response(
            StatusCode::UNAUTHORIZED,
            rpc_error("Unauthorized: Authentication required"),
        );
        result.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_str(&format!(
                "Bearer resource_metadata=\"{}/.well-known/oauth-protected-resource\"",
                state.config.public_url
            ))
            .expect("valid resource metadata challenge"),
        );
        return result;
    };
    let by_account = state
        .allow("mcp", &format!("user:{}", session.user_id), 240)
        .await;
    if !by_account.ok {
        return rate_limited(by_account);
    }
    if let Err(error) = state
        .internal(json!({"action":"access","userId":session.user_id}))
        .await
    {
        return json_response(StatusCode::FORBIDDEN, rpc_error(&error));
    }
    request
        .extensions_mut()
        .insert(AuthenticatedUser(session.user_id));
    next.run(request).await
}

pub async fn run_stdio(state: Arc<AppState>) -> Result<(), String> {
    let selector = std::env::var("LOORA_MCP_USER")
        .map_err(|_| "LOORA_MCP_USER is required in stdio mode".to_owned())?;
    let account = state
        .internal(json!({"action":"resolveUser","selector":selector.trim()}))
        .await?;
    let user_id = account
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Internal MCP service did not return a user id")?
        .to_owned();
    eprintln!(
        "[loora-mcp] stdio ready as {}",
        account
            .get("email")
            .and_then(Value::as_str)
            .unwrap_or(&user_id)
    );
    let handler = LooraHandler {
        state,
        fixed_user_id: Some(user_id),
    };
    let service = handler
        .serve(rmcp::transport::stdio())
        .await
        .map_err(|error| error.to_string())?;
    service.waiting().await.map_err(|error| error.to_string())?;
    Ok(())
}

async fn health(State(state): State<Arc<AppState>>) -> Response {
    json_response(
        StatusCode::OK,
        json!({"name":"loora-mcp","endpoint":format!("{}/mcp",state.config.public_url)}),
    )
}

async fn ready(State(state): State<Arc<AppState>>) -> Response {
    let ready = state.internal(json!({"action":"ready"})).await.is_ok();
    json_response(
        if ready {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        json!({"service":"mcp","ready":ready}),
    )
}

async fn metadata(State(state): State<Arc<AppState>>) -> Response {
    json_response(
        StatusCode::OK,
        json!({"resource":format!("{}/mcp",state.config.public_url),"authorization_servers":[state.config.auth_origin],"bearer_methods_supported":["header"]}),
    )
}

async fn not_found() -> Response {
    json_response(StatusCode::NOT_FOUND, json!({"error":"Not found"}))
}

fn rate_limited(decision: Decision) -> Response {
    let mut result = json_response(
        StatusCode::TOO_MANY_REQUESTS,
        rpc_error("Too many requests. Try again shortly."),
    );
    result.headers_mut().insert(
        header::RETRY_AFTER,
        HeaderValue::from_str(&decision.retry_after.to_string()).expect("numeric header"),
    );
    result.headers_mut().insert(
        HeaderName::from_static("x-ratelimit-limit"),
        HeaderValue::from_str(&decision.limit.to_string()).expect("numeric header"),
    );
    result.headers_mut().insert(
        HeaderName::from_static("x-ratelimit-remaining"),
        HeaderValue::from_str(&decision.remaining.to_string()).expect("numeric header"),
    );
    result
}

fn json_response(status: StatusCode, value: Value) -> Response {
    (status, Json(value)).into_response()
}

fn rpc_error(message: &str) -> Value {
    json!({"jsonrpc":"2.0","error":{"code":-32000,"message":message},"id":null})
}

fn caller_identity(headers: &HeaderMap) -> String {
    if let Some(value) = headers
        .get("cf-connecting-ip")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return format!("ip:{value}");
    }
    if let Some(value) = headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty() && !value.contains(','))
    {
        return format!("ip:{value}");
    }
    "ip:unknown".into()
}

fn normalize_json_arguments(args: &mut Value) {
    const STRUCTURED: &[&str] = &[
        "activeThemeId",
        "animations",
        "changes",
        "children",
        "focus",
        "hover",
        "layout",
        "nodeIds",
        "nodes",
        "parent",
        "play",
        "presets",
        "press",
        "ref",
        "refs",
        "remove",
        "resolutions",
        "root",
        "states",
        "style",
        "themes",
        "tokens",
        "transition",
        "types",
    ];
    let Some(object) = args.as_object_mut() else {
        return;
    };
    for key in STRUCTURED {
        let Some(value) = object.get_mut(*key) else {
            continue;
        };
        let Some(text) = value.as_str() else { continue };
        let trimmed = text.trim();
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            if let Ok(parsed) = serde_json::from_str(trimmed) {
                *value = parsed;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use axum::{
        body::{to_bytes, Body},
        routing::{get, post},
    };
    use tower::ServiceExt;

    use super::*;

    #[test]
    fn embeds_the_complete_typescript_tool_manifest() {
        let tools: Value = serde_json::from_str(TOOLS_JSON).unwrap();
        let names = tools
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 33);
        assert_eq!(names.first(), Some(&"getUsage"));
        assert!(names.contains(&"getScreenshot"));
        assert_eq!(names.last(), Some(&"listAssets"));
    }

    #[test]
    fn decodes_structured_arguments_sent_as_json_text() {
        let mut args = json!({
            "designId":"d1",
            "nodes":"[{\"type\":\"text\",\"text\":\"Hello\"}]",
            "query":"[literal text]"
        });
        normalize_json_arguments(&mut args);
        assert!(args["nodes"].is_array());
        assert_eq!(args["query"], "[literal text]");
    }

    #[tokio::test]
    async fn authenticated_tool_calls_are_forwarded_to_the_internal_executor() {
        let internal = Router::new()
            .route(
                "/api/auth/mcp/get-session",
                get(|| async {
                    Json(json!({
                        "userId": "user-test",
                        "accessTokenExpiresAt": "2099-01-01T00:00:00Z"
                    }))
                }),
            )
            .route(
                "/api/internal/mcp",
                post(|headers: HeaderMap, Json(body): Json<Value>| async move {
                    assert_eq!(
                        headers.get(header::AUTHORIZATION).unwrap(),
                        "Bearer shared-secret"
                    );
                    match body["action"].as_str() {
                        Some("access") => Json(json!({ "allowed": true })),
                        Some("execute") => {
                            assert_eq!(body["userId"], "user-test");
                            assert_eq!(body["tool"], "getUsage");
                            Json(json!({
                                "content": [{ "type": "text", "text": "forwarded" }]
                            }))
                        }
                        action => panic!("unexpected internal action: {action:?}"),
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move {
            axum::serve(listener, internal).await.unwrap();
        });
        let state = AppState::new(Config {
            port: 4100,
            public_url: "http://localhost:4100".into(),
            auth_origin: origin.clone(),
            auth_timeout_ms: 5_000,
            auth_cache_ttl_ms: 60_000,
            internal_api_url: format!("{origin}/api/internal/mcp"),
            internal_token: "shared-secret".into(),
            rate_limit_redis_url: None,
        })
        .await
        .unwrap();
        let request = Request::builder()
            .method(Method::POST)
            .uri("/mcp")
            .header(header::AUTHORIZATION, "Bearer oauth-token")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::ACCEPT, "application/json, text/event-stream")
            .header(header::HOST, "localhost:4100")
            .header("mcp-protocol-version", "2025-06-18")
            .body(Body::from(
                json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": { "name": "getUsage", "arguments": {} }
                })
                .to_string(),
            ))
            .unwrap();
        let response = router(state).oneshot(request).await.unwrap();
        let status = response.status();
        let body: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024 * 1024).await.unwrap())
                .unwrap();
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["result"]["content"][0]["text"], "forwarded");
        task.abort();
    }
}
