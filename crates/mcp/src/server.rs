use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde_json::{json, Value};

use crate::{DEFAULT_PORT, TOOLS_JSON};

const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;
const TOOL_TIMEOUT: Duration = Duration::from_secs(120);

pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
    pub reply: mpsc::SyncSender<Result<Value, String>>,
}

pub type ToolCallReceiver = async_channel::Receiver<ToolCall>;

pub struct McpServer {
    address: SocketAddr,
    shutdown: Arc<AtomicBool>,
    listener_thread: Option<JoinHandle<()>>,
}

impl McpServer {
    pub fn address(&self) -> SocketAddr {
        self.address
    }

    pub fn endpoint(&self) -> String {
        format!("http://{}/mcp", self.address)
    }
}

impl Drop for McpServer {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        let _ = TcpStream::connect_timeout(&self.address, Duration::from_millis(100));
        if let Some(thread) = self.listener_thread.take() {
            let _ = thread.join();
        }
    }
}

/// Start the built-in, loopback-only MCP server.
///
/// `LOORA_MCP_PORT` may override the default port. The address is deliberately
/// fixed to 127.0.0.1 so the no-auth local server is never exposed to the LAN.
pub fn start() -> Result<(McpServer, ToolCallReceiver), String> {
    let port = match std::env::var("LOORA_MCP_PORT") {
        Ok(value) => value
            .parse::<u16>()
            .map_err(|_| format!("LOORA_MCP_PORT must be between 1 and 65535, got {value:?}"))?,
        Err(_) => DEFAULT_PORT,
    };
    start_on(port)
}

pub fn start_on(port: u16) -> Result<(McpServer, ToolCallReceiver), String> {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, port))
        .map_err(|error| format!("bind local MCP server on 127.0.0.1:{port}: {error}"))?;
    listener
        .set_nonblocking(true)
        .map_err(|error| format!("configure local MCP listener: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("read local MCP address: {error}"))?;
    let shutdown = Arc::new(AtomicBool::new(false));
    let listener_shutdown = shutdown.clone();
    let (sender, receiver) = async_channel::unbounded();

    let listener_thread = thread::Builder::new()
        .name("loora-mcp-listener".into())
        .spawn(move || {
            while !listener_shutdown.load(Ordering::Acquire) {
                match listener.accept() {
                    Ok((stream, peer)) => {
                        if !peer.ip().is_loopback() {
                            continue;
                        }
                        let sender = sender.clone();
                        let _ = thread::Builder::new()
                            .name("loora-mcp-request".into())
                            .spawn(move || handle_connection(stream, sender));
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(20));
                    }
                    Err(error) => {
                        eprintln!("loora-mcp: listener error: {error}");
                        thread::sleep(Duration::from_millis(100));
                    }
                }
            }
        })
        .map_err(|error| format!("start local MCP listener: {error}"))?;

    Ok((
        McpServer {
            address,
            shutdown,
            listener_thread: Some(listener_thread),
        },
        receiver,
    ))
}

fn handle_connection(mut stream: TcpStream, sender: async_channel::Sender<ToolCall>) {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(10)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
    let response = match read_request(&mut stream) {
        Ok(request) => route_request(request, &sender),
        Err(error) => HttpResponse::json(400, json!({"error": error})),
    };
    let _ = write_response(&mut stream, response);
}

struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

struct HttpResponse {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
    protocol_version: Option<String>,
}

impl HttpResponse {
    fn json(status: u16, value: Value) -> Self {
        Self {
            status,
            content_type: "application/json",
            body: serde_json::to_vec(&value).unwrap_or_default(),
            protocol_version: None,
        }
    }

    fn empty(status: u16) -> Self {
        Self {
            status,
            content_type: "application/json",
            body: Vec::new(),
            protocol_version: None,
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut bytes = Vec::with_capacity(4096);
    let mut scratch = [0_u8; 8192];
    let header_end = loop {
        let read = stream
            .read(&mut scratch)
            .map_err(|error| format!("read request: {error}"))?;
        if read == 0 {
            return Err("connection closed before request headers".into());
        }
        bytes.extend_from_slice(&scratch[..read]);
        if bytes.len() > MAX_REQUEST_BYTES {
            return Err("request exceeds 32 MiB limit".into());
        }
        if let Some(index) = find_bytes(&bytes, b"\r\n\r\n") {
            break index + 4;
        }
    };

    let headers = std::str::from_utf8(&bytes[..header_end])
        .map_err(|_| "request headers are not valid UTF-8".to_string())?;
    let mut lines = headers.split("\r\n");
    let request_line = lines.next().ok_or("missing request line")?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or("missing HTTP method")?
        .to_owned();
    let path = request_parts
        .next()
        .ok_or("missing request path")?
        .to_owned();
    let headers = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_owned()))
        .collect::<HashMap<_, _>>();
    let content_length = headers
        .get("content-length")
        .map(|value| value.parse::<usize>())
        .transpose()
        .map_err(|_| "invalid Content-Length header")?
        .unwrap_or(0);
    if content_length > MAX_REQUEST_BYTES {
        return Err("request body exceeds 32 MiB limit".into());
    }

    while bytes.len().saturating_sub(header_end) < content_length {
        let read = stream
            .read(&mut scratch)
            .map_err(|error| format!("read request body: {error}"))?;
        if read == 0 {
            return Err("connection closed before request body".into());
        }
        bytes.extend_from_slice(&scratch[..read]);
    }
    let body = bytes[header_end..header_end + content_length].to_vec();
    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn route_request(request: HttpRequest, sender: &async_channel::Sender<ToolCall>) -> HttpResponse {
    if !request
        .headers
        .get("host")
        .is_some_and(|host| is_loopback_authority(host))
    {
        return HttpResponse::json(403, json!({"error": "Loopback Host required"}));
    }
    if request
        .headers
        .get("origin")
        .is_some_and(|origin| !is_loopback_origin(origin))
    {
        return HttpResponse::json(403, json!({"error": "Cross-origin access denied"}));
    }
    if request.method == "OPTIONS" {
        return HttpResponse::empty(204);
    }
    if request.method == "GET" && matches!(request.path.as_str(), "/" | "/health" | "/ready") {
        return HttpResponse::json(
            200,
            json!({
                "name": "loora-local-mcp",
                "ready": true,
                "endpoint": "/mcp",
                "auth": false,
            }),
        );
    }
    if request.path != "/mcp" {
        return HttpResponse::json(404, json!({"error": "Not found"}));
    }
    if request.method != "POST" {
        return HttpResponse::json(405, rpc_error(Value::Null, -32600, "Method not allowed"));
    }

    let message: Value = match serde_json::from_slice(&request.body) {
        Ok(value) => value,
        Err(error) => {
            return HttpResponse::json(
                400,
                rpc_error(Value::Null, -32700, &format!("Parse error: {error}")),
            )
        }
    };
    let id = message.get("id").cloned().unwrap_or(Value::Null);
    let method = message.get("method").and_then(Value::as_str).unwrap_or("");
    if id.is_null() {
        return HttpResponse::empty(202);
    }

    let mut response = match method {
        "initialize" => {
            let requested = message
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18");
            let protocol = match requested {
                "2024-11-05" | "2025-03-26" | "2025-06-18" => requested,
                _ => "2025-06-18",
            };
            let mut response = HttpResponse::json(
                200,
                rpc_result(
                    id,
                    json!({
                        "protocolVersion": protocol,
                        "capabilities": {"tools": {"listChanged": false}},
                        "serverInfo": {"name": "loora-local", "version": env!("CARGO_PKG_VERSION")},
                        "instructions": "Local-first Loora canvas server. Calls mutate the open desktop canvas in real time. No authentication is required because the server only binds to loopback."
                    }),
                ),
            );
            response.protocol_version = Some(protocol.to_owned());
            response
        }
        "ping" => HttpResponse::json(200, rpc_result(id, json!({}))),
        "tools/list" => match advertised_tools() {
            Ok(tools) => HttpResponse::json(200, rpc_result(id, json!({"tools": tools}))),
            Err(error) => HttpResponse::json(500, rpc_error(id, -32603, &error)),
        },
        "tools/call" => call_tool(id, &message, sender),
        _ => HttpResponse::json(200, rpc_error(id, -32601, "Method not found")),
    };
    if response.protocol_version.is_none() {
        response.protocol_version = Some("2025-06-18".into());
    }
    response
}

fn is_loopback_origin(origin: &str) -> bool {
    origin
        .strip_prefix("http://")
        .or_else(|| origin.strip_prefix("https://"))
        .and_then(|value| value.split('/').next())
        .is_some_and(is_loopback_authority)
}

fn is_loopback_authority(authority: &str) -> bool {
    let authority = authority.trim().to_ascii_lowercase();
    authority == "localhost"
        || authority.starts_with("localhost:")
        || authority == "127.0.0.1"
        || authority.starts_with("127.0.0.1:")
        || authority == "[::1]"
        || authority.starts_with("[::1]:")
}

fn call_tool(id: Value, message: &Value, sender: &async_channel::Sender<ToolCall>) -> HttpResponse {
    let Some(name) = message.pointer("/params/name").and_then(Value::as_str) else {
        return HttpResponse::json(200, rpc_error(id, -32602, "Missing tool name"));
    };
    let mut arguments = message
        .pointer("/params/arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    normalize_json_arguments(&mut arguments);
    if let Err(error) = validate_arguments(name, &arguments) {
        return HttpResponse::json(200, rpc_result(id, tool_error(error)));
    }

    let (reply, receive) = mpsc::sync_channel(1);
    let call = ToolCall {
        name: name.to_owned(),
        arguments,
        reply,
    };
    if sender.send_blocking(call).is_err() {
        return HttpResponse::json(
            200,
            rpc_result(id, tool_error("The Loora canvas is no longer available.")),
        );
    }
    match receive.recv_timeout(TOOL_TIMEOUT) {
        Ok(Ok(mut value)) => {
            let content = value
                .as_object_mut()
                .and_then(|object| object.remove("_mcpContent"))
                .and_then(|content| content.as_array().cloned())
                .unwrap_or_else(|| {
                    vec![json!({
                        "type": "text",
                        "text": serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string())
                    })]
                });
            HttpResponse::json(
                200,
                rpc_result(
                    id,
                    json!({"content": content, "structuredContent": value, "isError": false}),
                ),
            )
        }
        Ok(Err(error)) => HttpResponse::json(200, rpc_result(id, tool_error(error))),
        Err(mpsc::RecvTimeoutError::Timeout) => HttpResponse::json(
            200,
            rpc_result(
                id,
                tool_error("The local canvas did not respond within 120 seconds."),
            ),
        ),
        Err(mpsc::RecvTimeoutError::Disconnected) => HttpResponse::json(
            200,
            rpc_result(
                id,
                tool_error("The Loora canvas closed before the tool completed."),
            ),
        ),
    }
}

fn advertised_tools() -> Result<Value, String> {
    let mut tools: Value = serde_json::from_str(TOOLS_JSON)
        .map_err(|error| format!("invalid embedded tools.json: {error}"))?;
    normalize_advertised_schemas(&mut tools);
    Ok(tools)
}

fn validate_arguments(name: &str, arguments: &Value) -> Result<(), String> {
    let manifest: Value = serde_json::from_str(TOOLS_JSON)
        .map_err(|error| format!("invalid embedded tools.json: {error}"))?;
    let tool = manifest
        .as_array()
        .and_then(|tools| {
            tools
                .iter()
                .find(|tool| tool.get("name").and_then(Value::as_str) == Some(name))
        })
        .ok_or_else(|| format!("Unknown tool {name}"))?;
    let object = arguments
        .as_object()
        .ok_or_else(|| format!("Arguments for {name} must be an object"))?;
    if let Some(required) = tool
        .pointer("/inputSchema/required")
        .and_then(Value::as_array)
    {
        for property in required.iter().filter_map(Value::as_str) {
            if !object.contains_key(property) {
                return Err(format!(
                    "Invalid arguments for {name}: missing required property {property}"
                ));
            }
        }
    }
    Ok(())
}

fn normalize_advertised_schemas(value: &mut Value) {
    match value {
        Value::Array(values) => {
            for value in values {
                normalize_advertised_schemas(value);
            }
        }
        Value::Object(map) => {
            for value in map.values_mut() {
                normalize_advertised_schemas(value);
            }
            let Some(Value::Array(tuple_items)) = map.get_mut("items") else {
                return;
            };
            let mut variants = Vec::new();
            for item in std::mem::take(tuple_items) {
                if !variants.contains(&item) {
                    variants.push(item);
                }
            }
            map.insert("items".to_owned(), json!({"anyOf": variants}));
        }
        _ => {}
    }
}

fn normalize_json_arguments(arguments: &mut Value) {
    const STRUCTURED: &[&str] = &[
        "activeThemeId",
        "animations",
        "changes",
        "children",
        "clear",
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
    let Some(object) = arguments.as_object_mut() else {
        return;
    };
    for key in STRUCTURED {
        let Some(value) = object.get_mut(*key) else {
            continue;
        };
        let Some(text) = value.as_str() else {
            continue;
        };
        let trimmed = text.trim();
        if trimmed.starts_with('{') || trimmed.starts_with('[') {
            if let Ok(parsed) = serde_json::from_str(trimmed) {
                *value = parsed;
            }
        }
    }
}

fn rpc_result(id: Value, result: Value) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "result": result})
}

fn rpc_error(id: Value, code: i32, message: &str) -> Value {
    json!({"jsonrpc": "2.0", "id": id, "error": {"code": code, "message": message}})
}

fn tool_error(message: impl Into<String>) -> Value {
    json!({
        "content": [{"type": "text", "text": message.into()}],
        "isError": true,
    })
}

fn write_response(stream: &mut TcpStream, response: HttpResponse) -> std::io::Result<()> {
    let reason = match response.status {
        200 => "OK",
        202 => "Accepted",
        204 => "No Content",
        400 => "Bad Request",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        500 => "Internal Server Error",
        _ => "OK",
    };
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        reason,
        response.content_type,
        response.body.len(),
    );
    if let Some(protocol) = response.protocol_version {
        headers.push_str(&format!("MCP-Protocol-Version: {protocol}\r\n"));
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes())?;
    stream.write_all(&response.body)?;
    stream.flush()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::IpAddr;

    fn post_json(address: SocketAddr, body: Value) -> Value {
        let body = body.to_string();
        let mut stream = TcpStream::connect(address).unwrap();
        write!(
            stream,
            "POST /mcp HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nAccept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            address,
            body.len(),
            body
        )
        .unwrap();
        stream.flush().unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        let body = find_bytes(&response, b"\r\n\r\n").unwrap() + 4;
        serde_json::from_slice(&response[body..]).unwrap()
    }

    #[test]
    fn embeds_all_canonical_tools() {
        let tools: Value = serde_json::from_str(TOOLS_JSON).unwrap();
        let names = tools
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 33);
        assert_eq!(names.first(), Some(&"getUsage"));
        assert!(names.contains(&"createPage"));
        assert_eq!(names.last(), Some(&"listAssets"));
    }

    #[test]
    fn listener_is_loopback_only() {
        let (server, _receiver) = start_on(0).unwrap();
        assert_eq!(server.address().ip(), IpAddr::V4(Ipv4Addr::LOCALHOST));
    }

    #[test]
    fn validates_required_arguments() {
        assert!(validate_arguments("createDesign", &json!({})).is_err());
        assert!(validate_arguments("createDesign", &json!({"name": "New"})).is_ok());
        assert!(validate_arguments("notReal", &json!({})).is_err());
    }

    #[test]
    fn rejects_non_loopback_hosts_and_origins() {
        assert!(is_loopback_authority("127.0.0.1:6767"));
        assert!(is_loopback_authority("localhost:6767"));
        assert!(is_loopback_origin("http://localhost:3000"));
        assert!(!is_loopback_authority("local.loora.test"));
        assert!(!is_loopback_origin("https://attacker.example"));
        assert!(!is_loopback_origin("http://localhost.attacker.example"));
    }

    #[test]
    fn completes_a_real_initialize_list_and_tool_call_round_trip() {
        let (server, receiver) = start_on(0).unwrap();
        let address = server.address();
        let worker = thread::spawn(move || {
            let call = receiver.recv_blocking().unwrap();
            assert_eq!(call.name, "getUsage");
            call.reply.send(Ok(json!({"local": true}))).unwrap();
        });

        let initialized = post_json(
            address,
            json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {"protocolVersion": "2025-06-18"}
            }),
        );
        assert_eq!(initialized["result"]["serverInfo"]["name"], "loora-local");

        let listed = post_json(
            address,
            json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}),
        );
        assert_eq!(listed["result"]["tools"].as_array().unwrap().len(), 33);

        let called = post_json(
            address,
            json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "getUsage", "arguments": {}}
            }),
        );
        assert_eq!(called["result"]["structuredContent"]["local"], true);
        assert_eq!(called["result"]["isError"], false);
        worker.join().unwrap();
    }
}
