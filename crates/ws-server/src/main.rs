use std::{
    net::{Ipv4Addr, SocketAddr},
    process::ExitCode,
};

use loora_ws_server::{
    config::Config,
    server::{router, AppState},
};
use tokio::{net::TcpListener, signal};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> ExitCode {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();
    let config = match Config::from_env() {
        Ok(config) => config,
        Err(error) => {
            tracing::error!("[loora-ws] {error}");
            return ExitCode::FAILURE;
        }
    };
    let address = SocketAddr::from((Ipv4Addr::UNSPECIFIED, config.port));
    let state = match AppState::new(config.clone()).await {
        Ok(state) => state,
        Err(error) => {
            tracing::error!("[loora-ws] invalid Redis configuration: {error}");
            return ExitCode::FAILURE;
        }
    };
    let listener = match TcpListener::bind(address).await {
        Ok(listener) => listener,
        Err(error) => {
            tracing::error!("[loora-ws] could not bind {address}: {error}");
            return ExitCode::FAILURE;
        }
    };
    tracing::info!(
        "[loora-ws] listening on :{} — bus {}, origins {}",
        config.port,
        state_bus(&config),
        config
            .allowed_origins
            .as_ref()
            .map(|values| values.join(", "))
            .unwrap_or_else(|| "any".into())
    );
    let shutdown_state = state.clone();
    let result = axum::serve(listener, router(state))
        .with_graceful_shutdown(async move {
            shutdown_signal().await;
            shutdown_state.shutdown().await;
        })
        .await;
    if let Err(error) = result {
        tracing::error!("[loora-ws] server failed: {error}");
        return ExitCode::FAILURE;
    }
    ExitCode::SUCCESS
}

fn state_bus(config: &Config) -> &'static str {
    if config.redis_url.is_some() {
        "redis"
    } else {
        "memory"
    }
}

async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        if let Ok(mut signal) = signal::unix::signal(signal::unix::SignalKind::terminate()) {
            signal.recv().await;
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = ctrl_c => {}, _ = terminate => {} }
}
