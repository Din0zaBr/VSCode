//! Behavioural baseline:
//! aggregate events into (profile, metric, hour-of-day) buckets and compute
//! mean + stddev. The detector later flags anything outside N stddev.
//!
//! profile_key examples:
//!   `user:ivanov`, `host:web-01`, `agent:agent-001`
//!
//! metric examples:
//!   `events_per_hour`, `logins_per_hour`, `failed_auth_per_hour`

use chrono::{DateTime, Datelike, Timelike, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::LogEvent;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineRequest {
    /// Events from the last N days (e.g. 14) used as training history.
    pub events: Vec<LogEvent>,
    /// Optional override; default = ["events_per_hour", "failed_auth_per_hour"].
    #[serde(default)]
    pub metrics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineEntry {
    pub profile_key: String,
    pub metric: String,
    /// Hour-of-day bucket (0..23). -1 means day-aggregate.
    pub hour_bucket: i16,
    pub mean_value: f64,
    pub stddev: f64,
    pub sample_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaselineResponse {
    pub entries: Vec<BaselineEntry>,
    pub profiles_built: usize,
    pub events_processed: usize,
}

/// Build per-profile · per-metric · per-hour mean/stddev statistics.
///
/// We accumulate (day, hour) totals first, then derive mean/stddev across all
/// observed (day, hour) samples for a given (profile, metric, hour-of-day).
pub fn compute_baseline(req: BaselineRequest) -> BaselineResponse {
    let metrics = if req.metrics.is_empty() {
        vec![
            "events_per_hour".to_string(),
            "failed_auth_per_hour".to_string(),
        ]
    } else {
        req.metrics
    };

    // counts[(profile, metric, day, hour)] = n
    let mut counts: HashMap<(String, String, i32, u8), u32> = HashMap::new();
    let event_count = req.events.len();

    for ev in &req.events {
        let day_key = day_of_year(&ev.timestamp);
        let hour = ev.timestamp.hour() as u8;

        for profile in profiles_for(ev) {
            for metric in metrics_for(ev, &metrics) {
                let k = (profile.clone(), metric.clone(), day_key, hour);
                *counts.entry(k).or_insert(0) += 1;
            }
        }
    }

    // Group day-level counts into samples per (profile, metric, hour-of-day).
    let mut samples: HashMap<(String, String, u8), Vec<u32>> = HashMap::new();
    for ((profile, metric, _day, hour), n) in counts {
        samples
            .entry((profile, metric, hour))
            .or_default()
            .push(n);
    }

    let mut entries = Vec::with_capacity(samples.len());
    let mut profiles = std::collections::HashSet::new();

    for ((profile, metric, hour), values) in samples {
        if values.is_empty() {
            continue;
        }
        let (mean, stddev) = mean_stddev(&values);
        profiles.insert(profile.clone());
        entries.push(BaselineEntry {
            profile_key: profile,
            metric,
            hour_bucket: hour as i16,
            mean_value: mean,
            stddev,
            sample_size: values.len() as u32,
        });
    }

    BaselineResponse {
        entries,
        profiles_built: profiles.len(),
        events_processed: event_count,
    }
}

/// Profiles a single event participates in. We track both the user and the
/// host so anomalies on either dimension surface.
fn profiles_for(ev: &LogEvent) -> Vec<String> {
    let mut out = Vec::with_capacity(3);
    if !ev.host.is_empty() {
        out.push(format!("host:{}", ev.host));
    }
    if !ev.agent_id.is_empty() {
        out.push(format!("agent:{}", ev.agent_id));
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

/// Which metrics a given event contributes to (counts) — generic vs auth.
fn metrics_for(ev: &LogEvent, enabled: &[String]) -> Vec<String> {
    let mut out = Vec::with_capacity(2);
    if enabled.iter().any(|m| m == "events_per_hour") {
        out.push("events_per_hour".to_string());
    }
    if enabled.iter().any(|m| m == "failed_auth_per_hour") && is_failed_auth(ev) {
        out.push("failed_auth_per_hour".to_string());
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
    // Fallback: keyword heuristic over message
    let msg = ev.message.to_lowercase();
    msg.contains("failed password") || msg.contains("authentication failure")
}

fn day_of_year(ts: &DateTime<Utc>) -> i32 {
    ts.year() * 1000 + ts.ordinal() as i32
}

fn mean_stddev(values: &[u32]) -> (f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0);
    }
    let n = values.len() as f64;
    let mean = values.iter().map(|&v| v as f64).sum::<f64>() / n;
    if values.len() == 1 {
        // Single sample — give a small floor stddev so the detector still works.
        return (mean, mean.sqrt().max(1.0));
    }
    let var = values
        .iter()
        .map(|&v| {
            let d = v as f64 - mean;
            d * d
        })
        .sum::<f64>()
        / (n - 1.0);
    (mean, var.sqrt())
}
