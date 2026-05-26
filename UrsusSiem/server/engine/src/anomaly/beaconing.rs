//! C2 beaconing detector.
//!
//! Malware often "phones home" on a near-constant interval (every N seconds
//! plus jitter). We pass in connection timestamps grouped by (src,dst) pair
//! and compute the coefficient of variation of inter-arrival times — when it
//! is small AND the sample is large enough, the channel is a likely beacon.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionSample {
    pub src: String, // source host or ip
    pub dst: String, // destination host or ip
    pub timestamps: Vec<DateTime<Utc>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeaconingRequest {
    pub samples: Vec<ConnectionSample>,
    /// Minimum number of connections to trust the periodicity (default 8).
    #[serde(default = "default_min_samples")]
    pub min_samples: usize,
    /// Coefficient of variation threshold (default 0.15). Lower = more
    /// periodic. 0.15 means stddev is < 15 % of mean interval.
    #[serde(default = "default_cv_threshold")]
    pub cv_threshold: f64,
}

fn default_min_samples() -> usize {
    8
}
fn default_cv_threshold() -> f64 {
    0.15
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeaconingAlert {
    pub src: String,
    pub dst: String,
    pub mean_interval_seconds: f64,
    pub stddev_seconds: f64,
    pub coefficient_of_variation: f64,
    pub samples: usize,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BeaconingResponse {
    pub alerts: Vec<BeaconingAlert>,
}

pub fn detect_beaconing(req: BeaconingRequest) -> BeaconingResponse {
    let mut alerts = Vec::new();
    for sample in req.samples {
        if sample.timestamps.len() < req.min_samples {
            continue;
        }
        let mut times = sample.timestamps.clone();
        times.sort();
        let intervals: Vec<f64> = times
            .windows(2)
            .map(|w| (w[1] - w[0]).num_milliseconds() as f64 / 1000.0)
            .filter(|x| *x > 0.0)
            .collect();
        if intervals.len() < req.min_samples - 1 {
            continue;
        }
        let (mean, stddev) = mean_stddev(&intervals);
        if mean < 5.0 {
            // very chatty channel — not a beacon
            continue;
        }
        let cv = if mean > 0.0 { stddev / mean } else { f64::INFINITY };
        if cv > req.cv_threshold {
            continue;
        }
        alerts.push(BeaconingAlert {
            src: sample.src.clone(),
            dst: sample.dst.clone(),
            mean_interval_seconds: mean,
            stddev_seconds: stddev,
            coefficient_of_variation: cv,
            samples: sample.timestamps.len(),
            description: format!(
                "Подозрение на C2-маяк: {} → {}, интервал {:.1}±{:.1}с (CV={:.2}, {} соединений)",
                sample.src, sample.dst, mean, stddev, cv, sample.timestamps.len()
            ),
        });
    }

    BeaconingResponse { alerts }
}

fn mean_stddev(values: &[f64]) -> (f64, f64) {
    if values.is_empty() {
        return (0.0, 0.0);
    }
    let n = values.len() as f64;
    let mean = values.iter().sum::<f64>() / n;
    if values.len() == 1 {
        return (mean, 0.0);
    }
    let var = values.iter().map(|v| (v - mean).powi(2)).sum::<f64>() / (n - 1.0);
    (mean, var.sqrt())
}

