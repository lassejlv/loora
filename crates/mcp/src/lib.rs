mod clients;
mod executor;
mod server;

pub use clients::{install_client, McpClient};
pub use executor::{execute_tool, Execution, UiEffect};
pub use server::{start, start_on, McpServer, ToolCall, ToolCallReceiver};

pub const DEFAULT_PORT: u16 = 6767;
pub const TOOLS_JSON: &str = include_str!("tools.json");
