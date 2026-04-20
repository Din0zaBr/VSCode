mod correlator;
mod models;
mod parser;
mod pdql;

use axum::{
    extract::Json,
    http::StatusCode,
    response::IntoResponse,
    routing::post,
    Router,
};
use models::{
    CorrelateRequest, CorrelateResponse, ParseBatchRequest, ParseBatchResponse, PdqlRequest,
};
use tower_http::cors::CorsLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let addr = std::env::var("ENGINE_ADDR").unwrap_or_else(|_| "0.0.0.0:8001".to_string());

    let app = Router::new()
        .route("/parse", post(handle_parse))
        .route("/correlate", post(handle_correlate))
        .route("/pdql", post(handle_pdql))
        .route("/health", axum::routing::get(health))
        .layer(CorsLayer::permissive());

    tracing::info!("URSUS SIEM Engine listening on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

/// POST /parse — parse and enrich a batch of raw log events
async fn handle_parse(Json(req): Json<ParseBatchRequest>) -> impl IntoResponse {
    let total = req.events.len();
    let mut enriched = Vec::with_capacity(total);
    let mut errors = 0usize;

    for raw in req.events {
        match parser::parse_and_enrich(raw) {
            Ok(event) => enriched.push(event),
            Err(e) => {
                tracing::warn!("Parse error: {}", e);
                errors += 1;
            }
        }
    }

    let parsed = enriched.len();
    (
        StatusCode::OK,
        Json(ParseBatchResponse {
            events: enriched,
            parsed,
            errors,
        }),
    )
}

/// POST /correlate — evaluate correlation rules against a batch of events
async fn handle_correlate(Json(req): Json<CorrelateRequest>) -> impl IntoResponse {
    let alerts = correlator::correlate(&req.events, &req.rules);
    (StatusCode::OK, Json(CorrelateResponse { alerts }))
}

/// POST /pdql — translate a PDQL query to PostgreSQL SQL
async fn handle_pdql(Json(req): Json<PdqlRequest>) -> impl IntoResponse {
    match pdql::pdql_to_sql(req) {
        Ok(resp) => (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())),
        Err(e) => (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": e.to_string() })),
        ),
    }
}

async fn health() -> &'static str {
    "ok"
}
