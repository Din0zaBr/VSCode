FROM rust:1.82-slim-bookworm AS builder

WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
# Pre-build dependencies layer
RUN mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src

COPY src ./src
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/logvault-rust /app/logvault-rust
ENV ENGINE_ADDR=0.0.0.0:8001
EXPOSE 8001
CMD ["/app/logvault-rust"]
