run:
    cargo run --release -p loora-desktop

build:
    cargo build --release -p loora-desktop

check:
    cargo check -p gpui-router -p loora-engine -p loora-ui -p loora-desktop

icons:
    bash scripts/generate-app-icons.sh

dev:
    cargo run -p loora-desktop
