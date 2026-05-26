//! Classical, explainable ML detectors:
//!   * `baseline`  — per-profile mean/stddev profiles over time buckets
//!   * `detector`  — Z-score anomalies, rare-hour activity, impossible travel
//!   * `dga`       — character n-gram score for Domain Generation Algorithms
//!   * `beaconing` — periodicity detection in network flows
//!
//! All detectors are deterministic and produce a human-readable
//! `description` field, so the operator can inspect *why* the alert fired.

pub mod baseline;
pub mod beaconing;
pub mod detector;
pub mod dga;
pub mod ueba;

pub use baseline::{compute_baseline, BaselineEntry, BaselineRequest, BaselineResponse};
pub use beaconing::{detect_beaconing, BeaconingRequest, BeaconingResponse};
pub use detector::{detect_anomalies, AnomalyAlert, DetectRequest, DetectResponse};
pub use dga::{check_domain, DgaRequest, DgaResponse};
pub use ueba::{detect_ueba, UebaRequest, UebaResponse, WelfordState};
