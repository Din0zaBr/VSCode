mod anomaly;
mod correlator;
mod models;
mod ocsf;
mod parser;
mod pdql;
mod threat_intel;

use anomaly::{
    compute_baseline, detect_anomalies, detect_beaconing, detect_ueba, check_domain,
    BaselineRequest, BeaconingRequest, DetectRequest, DgaRequest, UebaRequest,
};
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
        .route("/anomaly/baseline", post(handle_baseline))
        .route("/anomaly/detect", post(handle_detect))
        .route("/anomaly/dga", post(handle_dga))
        .route("/anomaly/beaconing", post(handle_beaconing))
        .route("/ocsf/map", post(handle_ocsf_map))
        .route("/threat-intel/parse", post(handle_ti_parse))
        .route("/threat-intel/lookup", post(handle_ti_lookup))
        .route("/anomaly/ueba", post(handle_ueba))
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

/// POST /anomaly/baseline — compute per-profile mean/stddev from N days of events
async fn handle_baseline(Json(req): Json<BaselineRequest>) -> impl IntoResponse {
    let resp = compute_baseline(req);
    (StatusCode::OK, Json(resp))
}

/// POST /anomaly/detect — score recent events against a previously built baseline
async fn handle_detect(Json(req): Json<DetectRequest>) -> impl IntoResponse {
    let resp = detect_anomalies(req);
    (StatusCode::OK, Json(resp))
}

/// POST /anomaly/dga — score domain names for DGA likelihood
async fn handle_dga(Json(req): Json<DgaRequest>) -> impl IntoResponse {
    let resp = check_domain(req);
    (StatusCode::OK, Json(resp))
}

/// POST /anomaly/beaconing — detect periodic C2 beacons in connection flows
async fn handle_beaconing(Json(req): Json<BeaconingRequest>) -> impl IntoResponse {
    let resp = detect_beaconing(req);
    (StatusCode::OK, Json(resp))
}

/// POST /ocsf/map — normalise a batch of events to OCSF v1.1 schema
async fn handle_ocsf_map(Json(req): Json<ocsf::OcsfMapRequest>) -> impl IntoResponse {
    let resp = ocsf::map_batch(req);
    (StatusCode::OK, Json(resp))
}

/// POST /threat-intel/parse — parse a feed body into a structured IOC batch
async fn handle_ti_parse(Json(req): Json<threat_intel::FetchRequest>) -> impl IntoResponse {
    let resp = threat_intel::feeds::parse(req);
    (StatusCode::OK, Json(resp))
}

/// POST /threat-intel/lookup — build bloom-filter from IOCs and match events
async fn handle_ti_lookup(Json(req): Json<threat_intel::LookupRequest>) -> impl IntoResponse {
    let resp = threat_intel::lookup::lookup(req);
    (StatusCode::OK, Json(resp))
}

/// POST /anomaly/ueba — user/entity behavioural drift detection
async fn handle_ueba(Json(req): Json<UebaRequest>) -> impl IntoResponse {
    let resp = detect_ueba(req);
    (StatusCode::OK, Json(resp))
}
