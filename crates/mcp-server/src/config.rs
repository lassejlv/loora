use std::env;

use thiserror::Error;

#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub public_url: String,
    pub auth_origin: String,
    pub authorization_server_url: String,
    pub auth_timeout_ms: u64,
    pub auth_cache_ttl_ms: u64,
    pub internal_api_url: String,
    pub internal_token: String,
    pub rate_limit_redis_url: Option<String>,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("PORT must be a valid TCP port")]
    Port,
    #[error("{0} must be an absolute HTTP URL")]
    Url(&'static str),
    #[error("MCP_INTERNAL_TOKEN must be set")]
    InternalToken,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_values(|key| env::var(key).ok())
    }

    fn from_values(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let port = get("PORT")
            .unwrap_or_else(|| "4100".into())
            .parse()
            .map_err(|_| ConfigError::Port)?;
        let public_url = clean_url(
            "MCP_PUBLIC_URL",
            get("MCP_PUBLIC_URL").unwrap_or_else(|| format!("http://localhost:{port}")),
        )?;
        let auth_origin = clean_origin(
            "BETTER_AUTH_URL",
            get("BETTER_AUTH_URL").unwrap_or_else(|| "http://localhost:3000".into()),
        )?;
        let authorization_server_url = clean_origin(
            "MCP_AUTHORIZATION_SERVER_URL",
            get("MCP_AUTHORIZATION_SERVER_URL").unwrap_or_else(|| auth_origin.clone()),
        )?;
        let internal_api_url = clean_url(
            "MCP_INTERNAL_API_URL",
            get("MCP_INTERNAL_API_URL")
                .unwrap_or_else(|| format!("{auth_origin}/api/internal/mcp")),
        )?;
        Ok(Self {
            port,
            public_url,
            auth_origin,
            authorization_server_url,
            auth_timeout_ms: bounded_u64(get("MCP_AUTH_TIMEOUT_MS"), 100, 30_000, 5_000),
            auth_cache_ttl_ms: bounded_u64(get("MCP_AUTH_CACHE_TTL_MS"), 0, 600_000, 60_000),
            internal_api_url,
            internal_token: optional(&get, "MCP_INTERNAL_TOKEN")
                .ok_or(ConfigError::InternalToken)?,
            rate_limit_redis_url: optional(&get, "REDIS_RATELIMIT_URL"),
        })
    }
}

fn optional(get: &impl Fn(&str) -> Option<String>, name: &str) -> Option<String> {
    get(name)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn bounded_u64(value: Option<String>, min: u64, max: u64, fallback: u64) -> u64 {
    value
        .and_then(|value| value.trim().parse().ok())
        .filter(|value| (*value >= min) && (*value <= max))
        .unwrap_or(fallback)
}

fn clean_url(name: &'static str, value: String) -> Result<String, ConfigError> {
    let parsed = url::Url::parse(value.trim()).map_err(|_| ConfigError::Url(name))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(ConfigError::Url(name));
    }
    Ok(value.trim().trim_end_matches('/').to_owned())
}

fn clean_origin(name: &'static str, value: String) -> Result<String, ConfigError> {
    let parsed = url::Url::parse(value.trim()).map_err(|_| ConfigError::Url(name))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(ConfigError::Url(name));
    }
    Ok(parsed.origin().ascii_serialization())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn normalizes_origins_and_defaults_internal_endpoint() {
        let values = HashMap::from([
            ("MCP_INTERNAL_TOKEN", "secret".to_owned()),
            (
                "BETTER_AUTH_URL",
                "https://loora.test:8443/some/path?ignored=true".to_owned(),
            ),
            (
                "MCP_AUTHORIZATION_SERVER_URL",
                "https://accounts.loora.test/oauth?ignored=true".to_owned(),
            ),
            ("MCP_AUTH_TIMEOUT_MS", "100".to_owned()),
            ("MCP_AUTH_CACHE_TTL_MS", "600000".to_owned()),
        ]);
        let config = Config::from_values(|key| values.get(key).cloned()).unwrap();
        assert_eq!(config.auth_origin, "https://loora.test:8443");
        assert_eq!(
            config.authorization_server_url,
            "https://accounts.loora.test"
        );
        assert_eq!(
            config.internal_api_url,
            "https://loora.test:8443/api/internal/mcp"
        );
        assert_eq!(config.auth_timeout_ms, 100);
        assert_eq!(config.auth_cache_ttl_ms, 600_000);
    }

    #[test]
    fn defaults_the_authorization_server_to_the_auth_origin() {
        let values = HashMap::from([
            ("MCP_INTERNAL_TOKEN", "secret".to_owned()),
            ("BETTER_AUTH_URL", "https://loora.test/auth".to_owned()),
        ]);

        let config = Config::from_values(|key| values.get(key).cloned()).unwrap();

        assert_eq!(config.authorization_server_url, "https://loora.test");
    }

    #[test]
    fn requires_the_internal_token() {
        assert!(matches!(
            Config::from_values(|_| None),
            Err(ConfigError::InternalToken)
        ));
    }
}
