run:
    cargo run --release -p loora-desktop

build:
    cargo build --release -p loora-desktop

check:
    cargo check -p gpui-router -p loora-engine -p loora-ui -p loora-desktop

dev:
    cargo run -p loora-desktop
