# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates/ws-server/Cargo.toml crates/ws-server/Cargo.toml
COPY crates/mcp-server/Cargo.toml crates/mcp-server/Cargo.toml
RUN mkdir -p crates/ws-server/src && printf 'fn main() {}\n' > crates/ws-server/src/main.rs
RUN mkdir -p crates/mcp-server/src && printf 'fn main() {}\n' > crates/mcp-server/src/main.rs
RUN cargo build --release -p loora-mcp-server

COPY crates/mcp-server/src crates/mcp-server/src
RUN touch crates/mcp-server/src/main.rs && cargo build --release -p loora-mcp-server

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

ENV PORT=4100
COPY --from=builder /app/target/release/loora-mcp-server /usr/local/bin/loora-mcp-server

USER nobody
EXPOSE 4100
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["loora-mcp-server"]
