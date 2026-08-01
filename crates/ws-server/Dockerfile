# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
COPY crates/ws-server/Cargo.toml crates/ws-server/Cargo.toml
RUN mkdir -p crates/ws-server/src && printf 'fn main() {}\n' > crates/ws-server/src/main.rs
RUN cargo build --release -p loora-ws-server

COPY crates/ws-server/src crates/ws-server/src
RUN touch crates/ws-server/src/main.rs && cargo build --release -p loora-ws-server

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV PORT=4200
COPY --from=builder /app/target/release/loora-ws-server /usr/local/bin/loora-ws-server

USER nobody
EXPOSE 4200
CMD ["loora-ws-server"]
