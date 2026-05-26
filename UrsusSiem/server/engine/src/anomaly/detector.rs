//! Z-score anomaly detection against a previously computed baseline.
//!
//! Produces structured alerts with `kind ∈ {spike, drop, rare_hour}` plus an
//! `impossible_travel` detector that flags login events from geographically
//! distant IPs within a short window.

use chrono::{DateTime, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::baseline::BaselineEntry;
use crate::models::LogEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectRequest {
    /// Baseline entries previously computed by `compute_baseline`.
    pub baseline: Vec<BaselineEntry>,
    /// Recent events to score (e.g. last hour or day).
    pub events: Vec<LogEvent>,
    /// Z-score threshold to fire (default 3.0 ⇒ "spike" alert).
    #[serde(default = "default_z_threshold")]
    pub z_threshold: f64,
    /// If a (profile, hour) sample size is below this, treat the bucket as
    /// "rare hour" instead of computing Z (default 2).
    #[serde(default = "default_rare_threshold")]
    pub rare_min_samples: u32,
}

fn default_z_threshold() -> f64 {
    3.0
}
fn default_rare_threshold() -> u32 {
    2
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnomalyAlert {
    pub profile_key: String,
    pub metric: String,
    pub kind: String, // spike | drop | rare_hour | impossible_travel
    pub severity: String,
    pub current_value: f64,
    pub expected_value: f64,
    pub z_score: f64,
    pub description: String,
    pub window_start: Option<DateTime<Utc>>,
    pub window_end: Option<DateTime<Utc>>,
    pub related_meta: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectResponse {
    pub alerts: Vec<AnomalyAlert>,
}

/// Top-level detector — runs all enabled analyses on the supplied events.
pub fn detect_anomalies(req: DetectRequest) -> DetectResponse {
    let mut alerts = Vec::new();
    alerts.extend(zscore_alerts(&req));
    alerts.extend(impossible_travel_alerts(&req.events));
    DetectResponse { alerts }
}

// ─────────────────────────────────────────────────────────────────────────────
// Z-score against baseline
// ─────────────────────────────────────────────────────────────────────────────

fn zscore_alerts(req: &DetectRequest) -> Vec<AnomalyAlert> {
    if req.baseline.is_empty() {
        return Vec::new();
    }

    // Index baseline for O(1) lookup
    let mut bmap: HashMap<(String, String, i16), &BaselineEntry> = HashMap::new();
    for b in &req.baseline {
        bmap.insert((b.profile_key.clone(), b.metric.clone(), b.hour_bucket), b);
    }

    // Aggregate current events: counts[(profile, metric, hour)] = n
    let mut counts: HashMap<(String, String, u8), (u32, Option<DateTime<Utc>>, Option<DateTime<Utc>>)> =
        HashMap::new();
    for ev in &req.events {
        let hour = ev.timestamp.hour() as u8;
        let profiles = profiles_for(ev);
        let metrics = metrics_for(ev);
        for profile in &profiles {
            for metric in &metrics {
                let entry = counts
                    .entry((profile.clone(), metric.clone(), hour))
                    .or_insert((0, None, None));
                entry.0 += 1;
                entry.1 = Some(min_dt(entry.1, ev.timestamp));
                entry.2 = Some(max_dt(entry.2, ev.timestamp));
            }
        }
    }

    let mut out = Vec::new();
    for ((profile, metric, hour), (n, start, end)) in counts {
        let key = (profile.clone(), metric.clone(), hour as i16);
        match bmap.get(&key) {
            Some(b) if b.sample_size >= req.rare_min_samples => {
                if b.stddev <= 1e-9 {
                    continue;
                }
                let z = (n as f64 - b.mean_value) / b.stddev;
                if z.abs() < req.z_threshold {
                    continue;
                }
                let kind = if z > 0.0 { "spike" } else { "drop" };
                let severity = severity_from_z(z.abs());
                let desc = format!(
                    "{}: {:.0} {} в час {} (среднее {:.1}±{:.1}, Z={:+.1})",
                    profile, n as f64, metric, hour, b.mean_value, b.stddev, z
                );
                out.push(AnomalyAlert {
                    profile_key: profile.clone(),
                    metric: metric.clone(),
                    kind: kind.to_string(),
                    severity,
                    current_value: n as f64,
                    expected_value: b.mean_value,
                    z_score: z,
                    description: desc,
                    window_start: start,
                    window_end: end,
                    related_meta: serde_json::json!({
                        "hour": hour,
                        "stddev": b.stddev,
                        "baseline_samples": b.sample_size,
                    }),
                });
            }
            _ => {
                // No baseline for this (profile, metric, hour) — flag as
                // "rare_hour" only if the event count is meaningfully large.
                if n >= 5 {
                    out.push(AnomalyAlert {
                        profile_key: profile.clone(),
                        metric: metric.clone(),
                        kind: "rare_hour".to_string(),
                        severity: "low".to_string(),
                        current_value: n as f64,
                        expected_value: 0.0,
                        z_score: 0.0,
                        description: format!(
                            "{}: {} событий ({}) в час {} — нет baseline (новый профиль/время)",
                            profile, n, metric, hour
                        ),
                        window_start: start,
                        window_end: end,
                        related_meta: serde_json::json!({
                            "hour": hour, "reason": "no_baseline"
                        }),
                    });
                }
            }
        }
    }
    out
}

fn severity_from_z(z_abs: f64) -> String {
    if z_abs >= 6.0 {
        "critical"
    } else if z_abs >= 4.5 {
        "high"
    } else {
        "medium"
    }
    .to_string()
}

// ─────────────────────────────────────────────────────────────────────────────
// Impossible-travel: same user, two far-apart IP geo-bins, short interval
// ─────────────────────────────────────────────────────────────────────────────

fn impossible_travel_alerts(events: &[LogEvent]) -> Vec<AnomalyAlert> {
    // Group login events by user
    let mut by_user: HashMap<String, Vec<(&LogEvent, &str)>> = HashMap::new();
    for ev in events {
        if !looks_like_login(ev) {
            continue;
        }
        let user = ev.meta.get("user").and_then(|v| v.as_str()).unwrap_or("");
        let ip = ev
            .meta
            .get("src.ip")
            .or_else(|| ev.meta.get("source_ip"))
            .or_else(|| ev.meta.get("ip"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if user.is_empty() || ip.is_empty() {
            continue;
        }
        by_user.entry(user.to_string()).or_default().push((ev, ip));
    }

    let mut out = Vec::new();
    for (user, mut logins) in by_user {
        if logins.len() < 2 {
            continue;
        }
        logins.sort_by_key(|(ev, _)| ev.timestamp);
        for win in logins.windows(2) {
            let (a, ip_a) = win[0];
            let (b, ip_b) = win[1];
            let dt = (b.timestamp - a.timestamp).num_seconds();
            if dt <= 0 || dt > 6 * 3600 {
                continue;
            }
            // Cheap proxy for "geographically different": different /16
            if same_slash16(ip_a, ip_b) {
                continue;
            }
            out.push(AnomalyAlert {
                profile_key: format!("user:{}", user),
                metric: "impossible_travel".to_string(),
                kind: "impossible_travel".to_string(),
                severity: if dt < 1800 { "high" } else { "medium" }.to_string(),
                current_value: dt as f64,
                expected_value: 0.0,
                z_score: 0.0,
                description: format!(
                    "Пользователь {} зашёл с {} и {} за {} мин — невозможное перемещение",
                    user,
                    ip_a,
                    ip_b,
                    (dt / 60).max(1)
                ),
                window_start: Some(a.timestamp),
                window_end: Some(b.timestamp),
                related_meta: serde_json::json!({
                    "ip_a": ip_a, "ip_b": ip_b, "delta_seconds": dt
                }),
            });
        }
    }
    out
}

fn looks_like_login(ev: &LogEvent) -> bool {
    let cat = ev
        .meta
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if cat.contains("auth") || cat.contains("login") {
        return true;
    }
    let msg = ev.message.to_lowercase();
    msg.contains("accepted password")
        || msg.contains("session opened")
        || msg.contains("logon")
        || msg.contains("logged in")
}

fn same_slash16(a: &str, b: &str) -> bool {
    let aa: Vec<&str> = a.split('.').collect();
    let bb: Vec<&str> = b.split('.').collect();
    if aa.len() < 2 || bb.len() < 2 {
        return false;
    }
    aa[0] == bb[0] && aa[1] == bb[1]
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

fn profiles_for(ev: &LogEvent) -> Vec<String> {
    let mut out = Vec::new();
    if !ev.host.is_empty() {
        out.push(format!("host:{}", ev.host));
    }
    if let Some(user) = ev
        .meta
        .get("user")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        out.push(format!("user:{}", user));
    }
    if out.is_empty() {
        out.push("global".to_string());
    }
    out
}

fn metrics_for(ev: &LogEvent) -> Vec<&'static str> {
    let mut out = vec!["events_per_hour"];
    if is_failed_auth(ev) {
        out.push("failed_auth_per_hour");
    }
    out
}

fn is_failed_auth(ev: &LogEvent) -> bool {
    let cat = ev
        .meta
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if cat.contains("auth") || cat.contains("login") {
        let outcome = ev
            .meta
            .get("outcome")
            .or_else(|| ev.meta.get("action"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if matches!(outcome, "failure" | "fail" | "denied" | "blocked") {
            return true;
        }
    }
    let msg = ev.message.to_lowercase();
    msg.contains("failed password") || msg.contains("authentication failure")
}

fn min_dt(cur: Option<DateTime<Utc>>, v: DateTime<Utc>) -> DateTime<Utc> {
    match cur {
        Some(c) if c < v => c,
        _ => v,
    }
}

fn max_dt(cur: Option<DateTime<Utc>>, v: DateTime<Utc>) -> DateTime<Utc> {
    match cur {
        Some(c) if c > v => c,
        _ => v,
    }
}

