use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Map, Value};
use toml_edit::{value, DocumentMut};

const SERVER_NAME: &str = "loora";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum McpClient {
    Claude,
    Codex,
    Cursor,
    OpenCode,
}

impl McpClient {
    pub const fn name(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
            Self::Codex => "Codex",
            Self::Cursor => "Cursor",
            Self::OpenCode => "OpenCode",
        }
    }
}

pub fn install_client(client: McpClient, endpoint: &str) -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "could not find your home folder".to_string())?;
    match client {
        McpClient::Claude => install_json(&home.join(".claude.json"), endpoint, JsonClient::Claude),
        McpClient::Codex => install_codex(&home.join(".codex/config.toml"), endpoint),
        McpClient::Cursor => {
            install_json(&home.join(".cursor/mcp.json"), endpoint, JsonClient::Cursor)
        }
        McpClient::OpenCode => install_opencode(&home, endpoint),
    }
}

fn install_codex(path: &Path, endpoint: &str) -> Result<PathBuf, String> {
    let current = read_optional(path)?;
    let updated = merge_codex_config(&current, endpoint)?;
    write_atomic(path, updated.as_bytes())?;
    Ok(path.to_path_buf())
}

#[derive(Clone, Copy)]
enum JsonClient {
    Claude,
    Cursor,
}

fn install_json(path: &Path, endpoint: &str, client: JsonClient) -> Result<PathBuf, String> {
    let current = read_optional(path)?;
    let updated = merge_json_config(&current, endpoint, client)?;
    write_atomic(path, updated.as_bytes())?;
    Ok(path.to_path_buf())
}

fn read_optional(path: &Path) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(contents) => Ok(contents),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(err) => Err(format!("could not read {}: {err}", path.display())),
    }
}

fn merge_codex_config(current: &str, endpoint: &str) -> Result<String, String> {
    let mut document = if current.trim().is_empty() {
        DocumentMut::new()
    } else {
        current
            .parse::<DocumentMut>()
            .map_err(|err| format!("Codex config is not valid TOML: {err}"))?
    };
    document["mcp_servers"][SERVER_NAME]["url"] = value(endpoint);
    Ok(document.to_string())
}

fn merge_json_config(current: &str, endpoint: &str, client: JsonClient) -> Result<String, String> {
    let mut root = if current.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str(current).map_err(|err| format!("config is not valid JSON: {err}"))?
    };
    let root = root
        .as_object_mut()
        .ok_or_else(|| "config must contain a JSON object".to_string())?;

    match client {
        JsonClient::Claude => {
            object_at(root, "mcpServers")?.insert(
                SERVER_NAME.to_string(),
                json!({ "type": "http", "url": endpoint }),
            );
        }
        JsonClient::Cursor => {
            object_at(root, "mcpServers")?
                .insert(SERVER_NAME.to_string(), json!({ "url": endpoint }));
        }
    }

    let mut output = serde_json::to_string_pretty(&root)
        .map_err(|err| format!("could not serialize config: {err}"))?;
    output.push('\n');
    Ok(output)
}

fn install_opencode(home: &Path, endpoint: &str) -> Result<PathBuf, String> {
    let executable = find_executable(
        "opencode",
        home,
        &[".bun/bin/opencode", ".local/bin/opencode"],
    )
    .ok_or_else(|| "OpenCode CLI was not found".to_string())?;
    let output = Command::new(&executable)
        .args(["mcp", "add", SERVER_NAME, "--url", endpoint])
        .output()
        .map_err(|err| format!("could not run {}: {err}", executable.display()))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "OpenCode could not update its MCP config".to_string()
        } else {
            format!("OpenCode could not update its MCP config: {detail}")
        });
    }

    let config_root = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));
    let config_dir = config_root.join("opencode");
    let jsonc = config_dir.join("opencode.jsonc");
    if jsonc.exists() {
        Ok(jsonc)
    } else {
        Ok(config_dir.join("opencode.json"))
    }
}

fn find_executable(name: &str, home: &Path, home_candidates: &[&str]) -> Option<PathBuf> {
    if let Some(paths) = std::env::var_os("PATH") {
        for path in std::env::split_paths(&paths) {
            let candidate = path.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    for relative in home_candidates {
        let candidate = home.join(relative);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    for root in ["/opt/homebrew/bin", "/usr/local/bin"] {
        let candidate = Path::new(root).join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn object_at<'a>(
    root: &'a mut Map<String, Value>,
    key: &str,
) -> Result<&'a mut Map<String, Value>, String> {
    let entry = root
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    entry
        .as_object_mut()
        .ok_or_else(|| format!("config field `{key}` must be an object"))
}

fn write_atomic(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent folder", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|err| format!("could not create {}: {err}", parent.display()))?;

    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("mcp-config");
    let temporary = parent.join(format!(".{file_name}.{}.tmp", std::process::id()));
    fs::write(&temporary, contents)
        .map_err(|err| format!("could not write {}: {err}", temporary.display()))?;

    #[cfg(unix)]
    if let Ok(metadata) = fs::metadata(path) {
        fs::set_permissions(&temporary, metadata.permissions()).map_err(|err| {
            format!(
                "could not preserve permissions for {}: {err}",
                path.display()
            )
        })?;
    }

    fs::rename(&temporary, path)
        .map_err(|err| format!("could not replace {}: {err}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ENDPOINT: &str = "http://127.0.0.1:6767/mcp";

    #[test]
    fn codex_merge_preserves_existing_settings_and_is_idempotent() {
        let current =
            "model = \"gpt-5\"\n\n[mcp_servers.other]\nurl = \"http://localhost:1/mcp\"\n";
        let once = merge_codex_config(current, ENDPOINT).unwrap();
        let twice = merge_codex_config(&once, ENDPOINT).unwrap();

        assert_eq!(once, twice);
        assert!(once.contains("model = \"gpt-5\""));
        assert!(once.contains("[mcp_servers.other]"));
        let document = once.parse::<DocumentMut>().unwrap();
        assert_eq!(
            document["mcp_servers"]["loora"]["url"].as_str(),
            Some(ENDPOINT)
        );
    }

    #[test]
    fn claude_merge_preserves_other_servers() {
        let current = r#"{"theme":"dark","mcpServers":{"other":{"command":"other"}}}"#;
        let merged = merge_json_config(current, ENDPOINT, JsonClient::Claude).unwrap();
        let value: Value = serde_json::from_str(&merged).unwrap();

        assert_eq!(value["theme"], "dark");
        assert_eq!(value["mcpServers"]["other"]["command"], "other");
        assert_eq!(value["mcpServers"]["loora"]["type"], "http");
        assert_eq!(value["mcpServers"]["loora"]["url"], ENDPOINT);
    }

    #[test]
    fn cursor_merge_uses_remote_url_shape() {
        let merged = merge_json_config("", ENDPOINT, JsonClient::Cursor).unwrap();
        let value: Value = serde_json::from_str(&merged).unwrap();

        assert_eq!(value["mcpServers"]["loora"]["url"], ENDPOINT);
    }

    #[test]
    fn json_merge_refuses_to_replace_non_object_sections() {
        let error =
            merge_json_config(r#"{"mcpServers":false}"#, ENDPOINT, JsonClient::Cursor).unwrap_err();

        assert!(error.contains("mcpServers"));
    }
}
