//! IOC feed parsing. We deliberately accept already-fetched feed bodies
//! (Go side does HTTP), so this module is testable without network access.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum FeedKind {
    /// Plain text, one IOC per line, "#" comments — e.g. URLhaus / Feodo.
    AbuseChPlain,
    /// CSV with a header line — e.g. Feodo Tracker CSV.
    AbuseChCsv,
    /// OTX pulse JSON.
    OtxPulse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchRequest {
    pub feed:  FeedKind,
    pub body:  String,
    pub label: String,         // identifier embedded in event tags
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IocBatch {
    pub label:        String,
    pub ip_indicators:     Vec<String>,
    pub url_indicators:    Vec<String>,
    pub domain_indicators: Vec<String>,
    pub hash_indicators:   Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FetchResponse {
    pub batch:  IocBatch,
    pub parsed: usize,
}

pub fn parse(req: FetchRequest) -> FetchResponse {
    let batch = match req.feed {
        FeedKind::AbuseChPlain => parse_plain(&req.body, req.label.clone()),
        FeedKind::AbuseChCsv   => parse_csv(&req.body, req.label.clone()),
        FeedKind::OtxPulse     => parse_otx(&req.body, req.label.clone()),
    };
    let parsed = batch.ip_indicators.len()
        + batch.url_indicators.len()
        + batch.domain_indicators.len()
        + batch.hash_indicators.len();
    FetchResponse { batch, parsed }
}

fn parse_plain(body: &str, label: String) -> IocBatch {
    let mut b = IocBatch {
        label,
        ip_indicators: vec![],
        url_indicators: vec![],
        domain_indicators: vec![],
        hash_indicators: vec![],
    };
    for line in body.lines() {
        let s = line.trim();
        if s.is_empty() || s.starts_with('#') {
            continue;
        }
        classify(s, &mut b);
    }
    b
}

fn parse_csv(body: &str, label: String) -> IocBatch {
    // First non-comment line is treated as header — accept any column
    // count, classify columns 1..n. AbuseCH CSVs follow "first_seen,
    // dst_ip, dst_port, …" — we only need the IP/URL/hash columns.
    let mut b = IocBatch {
        label,
        ip_indicators: vec![],
        url_indicators: vec![],
        domain_indicators: vec![],
        hash_indicators: vec![],
    };
    let mut seen_header = false;
    for line in body.lines() {
        let s = line.trim();
        if s.is_empty() || s.starts_with('#') {
            continue;
        }
        if !seen_header {
            seen_header = true;
            continue;
        }
        for field in s.split(',') {
            let v = field.trim().trim_matches('"');
            if v.is_empty() {
                continue;
            }
            classify(v, &mut b);
        }
    }
    b
}

fn parse_otx(body: &str, label: String) -> IocBatch {
    // OTX pulses come as JSON: { pulses: [{ indicators: [{indicator, type}] }] }
    // Be permissive — accept either shape (single pulse or list).
    let mut b = IocBatch {
        label,
        ip_indicators: vec![],
        url_indicators: vec![],
        domain_indicators: vec![],
        hash_indicators: vec![],
    };
    let v: serde_json::Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return b,
    };

    let pulses = v.get("pulses").or(Some(&v));
    if let Some(arr) = pulses.and_then(|v| v.as_array()) {
        for pulse in arr {
            if let Some(inds) = pulse.get("indicators").and_then(|i| i.as_array()) {
                for ind in inds {
                    let ind_type = ind.get("type").and_then(|v| v.as_str()).unwrap_or("");
                    let value = ind.get("indicator").and_then(|v| v.as_str()).unwrap_or("");
                    if value.is_empty() {
                        continue;
                    }
                    match ind_type {
                        "IPv4" | "IPv6" => b.ip_indicators.push(value.to_string()),
                        "URL"           => b.url_indicators.push(value.to_string()),
                        "domain"        => b.domain_indicators.push(value.to_string()),
                        "FileHash-SHA256" | "FileHash-MD5" | "FileHash-SHA1"
                                        => b.hash_indicators.push(value.to_lowercase()),
                        _ => {}
                    }
                }
            }
        }
    }
    b
}

fn classify(s: &str, b: &mut IocBatch) {
    if looks_like_ip(s)             { b.ip_indicators.push(s.to_string()); return; }
    if looks_like_url(s)            { b.url_indicators.push(s.to_string()); return; }
    if looks_like_hash(s)           { b.hash_indicators.push(s.to_lowercase()); return; }
    if looks_like_domain(s)         { b.domain_indicators.push(s.to_string()); }
}

fn looks_like_ip(s: &str) -> bool {
    s.parse::<std::net::IpAddr>().is_ok()
}

fn looks_like_url(s: &str) -> bool {
    s.starts_with("http://") || s.starts_with("https://")
}

fn looks_like_hash(s: &str) -> bool {
    let len = s.len();
    (len == 32 || len == 40 || len == 64) && s.chars().all(|c| c.is_ascii_hexdigit())
}

fn looks_like_domain(s: &str) -> bool {
    if s.contains('/') || s.contains(' ') {
        return false;
    }
    s.contains('.') && s.split('.').all(|seg| !seg.is_empty()
        && seg.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
}
