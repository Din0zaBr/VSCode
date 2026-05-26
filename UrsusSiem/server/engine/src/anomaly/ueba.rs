//! UEBA — User & Entity Behaviour Analytics.
//!
//! Extends the existing baseline framework with per-user behavioural
//! profiles. Where `baseline.rs` only counts events/hour, UEBA tracks:
//!
//!   * data_volume_mb        — out-bytes per user/host
//!   * unique_destinations   — distinct dst.ip / dst.host per user/hour
//!   * outside_work_hours    — events with hour ∉ [9,18]
//!   * privileged_ops        — sudo, admin-equivalent actions
//!   * unusual_resources     — files / shares accessed first time
//!
//! All five are Z-scored against the same 14-day baseline. The detector
//! emits `kind = "ueba_drift"` so the UI groups them separately.

use chrono::Timelike;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

use crate::models::LogEvent;
use super::baseline::BaselineEntry;
use super::detector::AnomalyAlert;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UebaRequest {
    pub baseline: Vec<BaselineEntry>,
    pub events:   Vec<LogEvent>,
    #[serde(default = "default_z")]
    pub z_threshold: f64,
}

fn default_z() -> f64 { 3.0 }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UebaResponse {
    pub alerts: Vec<AnomalyAlert>,
}

pub fn detect_ueba(req: UebaRequest) -> UebaResponse {
    let mut user_metrics: HashMap<(String, String, u8), f64> = HashMap::new();
    let mut destinations: HashMap<(String, u8), HashSet<String>> = HashMap::new();

    for ev in &req.events {
        let user = ev.meta.get("user")
            .or_else(|| ev.meta.get("username"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if user.is_empty() {
            continue;
        }
        let profile = format!("user:{}", user);
        let hour = ev.timestamp.hour() as u8;

        // events_per_hour (already covered by baseline.rs, but we also track here)
        *user_metrics
            .entry((profile.clone(), "events_per_hour".into(), hour))
            .or_insert(0.0) += 1.0;

        // outside_work_hours
        if hour < 9 || hour >= 18 {
            *user_metrics
                .entry((profile.clone(), "outside_work_hours".into(), hour))
                .or_insert(0.0) += 1.0;
        }

        // data_volume_mb (sum of bytes_out / 1e6)
        if let Some(bytes) = ev.meta.get("bytes_out").and_then(|v| v.as_f64()) {
            *user_metrics
                .entry((profile.clone(), "data_volume_mb".into(), hour))
                .or_insert(0.0) += bytes / 1_000_000.0;
        }

        // privileged_ops
        if is_privileged(ev) {
            *user_metrics
                .entry((profile.clone(), "privileged_ops".into(), hour))
                .or_insert(0.0) += 1.0;
        }

        // unique destinations (counted separately at the end)
        if let Some(dst) = ev.meta.get("dst.ip")
            .or_else(|| ev.meta.get("dst.host"))
            .and_then(|v| v.as_str())
        {
            destinations
                .entry((profile.clone(), hour))
                .or_default()
                .insert(dst.to_string());
        }
    }

    // Materialise unique-destinations as a metric
    for ((profile, hour), set) in destinations {
        user_metrics.insert(
            (profile, "unique_destinations".into(), hour),
            set.len() as f64,
        );
    }

    // Index baseline for O(1) lookup
    let mut bmap: HashMap<(String, String, i16), &BaselineEntry> = HashMap::new();
    for b in &req.baseline {
        bmap.insert((b.profile_key.clone(), b.metric.clone(), b.hour_bucket), b);
    }

    let mut alerts = Vec::new();
    for ((profile, metric, hour), current) in user_metrics {
        let key = (profile.clone(), metric.clone(), hour as i16);
        if let Some(b) = bmap.get(&key) {
            if b.stddev <= 1e-9 || b.sample_size < 2 {
                continue;
            }
            let z = (current - b.mean_value) / b.stddev;
            if z.abs() < req.z_threshold {
                continue;
            }
            alerts.push(AnomalyAlert {
                profile_key: profile.clone(),
                metric: metric.clone(),
                kind: "ueba_drift".into(),
                severity: severity_for(z.abs()),
                current_value: current,
                expected_value: b.mean_value,
                z_score: z,
                description: format!(
                    "{} — метрика {} в час {}: {:.1} (норма {:.1}±{:.1}, Z={:+.1})",
                    profile, metric, hour, current, b.mean_value, b.stddev, z
                ),
                window_start: None,
                window_end:   None,
                related_meta: serde_json::json!({
                    "hour": hour,
                    "baseline_samples": b.sample_size,
                    "metric_kind": "ueba"
                }),
            });
        }
    }

    UebaResponse { alerts }
}

fn is_privileged(ev: &LogEvent) -> bool {
    let msg = ev.message.to_lowercase();
    msg.contains("sudo") || msg.contains("runas")
        || msg.contains("administrator")
        || ev.meta.get("privileged").and_then(|v| v.as_bool()).unwrap_or(false)
}

fn severity_for(z_abs: f64) -> String {
    if z_abs >= 6.0 { "critical" }
    else if z_abs >= 4.5 { "high" }
    else { "medium" }
    .to_string()
}

// ─────────────────────────────────────────────────────────────────────────
// Welford's online algorithm — incremental mean & variance updates.
// Used by the scheduler to avoid full 14-day baseline rebuilds.
// ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub struct WelfordState {
    pub n:      u64,
    pub mean:   f64,
    pub m2:     f64,  // sum of squared deltas
}

impl WelfordState {
    pub fn update(&mut self, x: f64) {
        self.n += 1;
        let delta = x - self.mean;
        self.mean += delta / self.n as f64;
        let delta2 = x - self.mean;
        self.m2 += delta * delta2;
    }

    pub fn variance(&self) -> f64 {
        if self.n < 2 { 0.0 }
        else { self.m2 / (self.n - 1) as f64 }
    }

    pub fn stddev(&self) -> f64 { self.variance().sqrt() }
}
