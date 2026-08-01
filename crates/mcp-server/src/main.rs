use loora_mcp_server::{
    config::Config,
    server::{router, run_stdio, AppState},
};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "loora_mcp_server=info".into()),
        )
        .init();
    let config = Config::from_env().expect("invalid MCP configuration");
    if std::env::args().any(|argument| argument == "--stdio") {
        run_stdio(AppState::new(config).await.expect("initialize MCP server"))
            .await
            .expect("run stdio MCP server");
        return;
    }
    let address = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&address)
        .await
        .expect("bind MCP server");
    let state = AppState::new(config).await.expect("initialize MCP server");
    tracing::info!(%address, "Loora MCP server listening");
    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("serve MCP requests");
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut terminate =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                .expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
