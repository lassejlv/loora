use std::env;

use thiserror::Error;

#[derive(Clone, Debug)]
pub struct Config {
    pub port: u16,
    pub ticket_secrets: Vec<String>,
    pub internal_token: String,
    pub redis_url: Option<String>,
    pub allowed_origins: Option<Vec<String>>,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("REALTIME_TICKET_SECRET must be set to at least 32 characters.")]
    TicketSecret,
    #[error("REALTIME_INTERNAL_TOKEN must be set to at least 32 characters.")]
    InternalToken,
    #[error("PORT must be a valid TCP port.")]
    Port,
}

impl Config {
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_values(|key| env::var(key).ok())
    }

    fn from_values(get: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let ticket_secret = trimmed(get("REALTIME_TICKET_SECRET"));
        if ticket_secret.as_ref().is_none_or(|value| value.len() < 32) {
            return Err(ConfigError::TicketSecret);
        }
        let internal_token = trimmed(get("REALTIME_INTERNAL_TOKEN"));
        if internal_token.as_ref().is_none_or(|value| value.len() < 32) {
            return Err(ConfigError::InternalToken);
        }
        let port = get("PORT")
            .unwrap_or_else(|| "4200".to_owned())
            .parse()
            .map_err(|_| ConfigError::Port)?;
        let ticket_secret = ticket_secret.expect("validated above");
        let mut ticket_secrets = vec![ticket_secret.clone()];
        if let Some(previous) = trimmed(get("REALTIME_TICKET_SECRET_PREVIOUS")) {
            if previous != ticket_secret {
                ticket_secrets.push(previous);
            }
        }

        Ok(Self {
            port,
            ticket_secrets,
            internal_token: internal_token.expect("validated above"),
            redis_url: trimmed(get("REDIS_URL")),
            allowed_origins: origins(
                trimmed(get("REALTIME_ALLOWED_ORIGINS"))
                    .or_else(|| trimmed(get("BETTER_AUTH_URL"))),
            ),
        })
    }
}

fn trimmed(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn origins(value: Option<String>) -> Option<Vec<String>> {
    let values: Vec<_> = value?
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(origin)
        .collect();
    (!values.is_empty()).then_some(values)
}

fn origin(value: &str) -> String {
    url::Url::parse(value)
        .ok()
        .and_then(|url| {
            let host = url.host_str()?;
            let port = url
                .port()
                .map(|port| format!(":{port}"))
                .unwrap_or_default();
            Some(format!("{}://{host}{port}", url.scheme()))
        })
        .unwrap_or_else(|| value.to_owned())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    #[test]
    fn reads_rotation_and_origins() {
        let values = HashMap::from([
            ("REALTIME_TICKET_SECRET", "s".repeat(32)),
            ("REALTIME_TICKET_SECRET_PREVIOUS", "p".repeat(32)),
            ("REALTIME_INTERNAL_TOKEN", "t".repeat(32)),
            (
                "REALTIME_ALLOWED_ORIGINS",
                "https://loora.design/path, http://localhost:3000".into(),
            ),
        ]);
        let config = Config::from_values(|key| values.get(key).cloned()).unwrap();
        assert_eq!(config.ticket_secrets.len(), 2);
        assert_eq!(
            config.allowed_origins.unwrap(),
            ["https://loora.design", "http://localhost:3000"]
        );
    }
}
