//! IOC lookup: build a Bloom-filter snapshot from a list of indicators and
//! check incoming events against it.
//!
//! Snapshots are built by the Go scheduler from feed batches and pushed to
//! this service via /threat-intel/snapshot. Subsequent /threat-intel/lookup
//! requests are O(k) per event.

use serde::{Deserialize, Serialize};
use super::bloom::Bloom;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookupRequest {
    /// IOCs grouped by kind for snapshot building.
    pub ip_indicators:     Vec<String>,
    pub url_indicators:    Vec<String>,
    pub domain_indicators: Vec<String>,
    pub hash_indicators:   Vec<String>,
    /// Events to check. Each is a flat key/value map (we just look up
    /// well-known fields).
    pub events:            Vec<serde_json::Map<String, serde_json::Value>>,
    /// Optional label to attach to matches (e.g. "abusech/feodo").
    #[serde(default)]
    pub label:             String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookupResult {
    pub event_index: usize,
    pub matched:     Vec<MatchInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchInfo {
    pub kind:  String, // ip | url | domain | hash
    pub value: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LookupResponse {
    pub results: Vec<LookupResult>,
    pub bloom_stats: BloomStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloomStats {
    pub ip_items:     usize,
    pub url_items:    usize,
    pub domain_items: usize,
    pub hash_items:   usize,
    pub total_bits:   usize,
}

pub fn lookup(req: LookupRequest) -> LookupResponse {
    let ip_bloom     = build(&req.ip_indicators);
    let url_bloom    = build(&req.url_indicators);
    let domain_bloom = build(&req.domain_indicators);
    let hash_bloom   = build(&req.hash_indicators);

    let mut results = Vec::new();
    for (i, ev) in req.events.iter().enumerate() {
        let mut matches = Vec::new();

        // IPs — check src/dst/source/dest
        for key in ["src.ip", "dst.ip", "source_ip", "dest_ip", "ip", "client_ip"] {
            if let Some(v) = ev.get(key).and_then(|x| x.as_str()) {
                if !v.is_empty() && ip_bloom.contains(v) {
                    matches.push(MatchInfo {
                        kind: "ip".into(), value: v.into(), label: req.label.clone(),
                    });
                }
            }
        }
        // URLs
        for key in ["url", "request.uri", "http.url"] {
            if let Some(v) = ev.get(key).and_then(|x| x.as_str()) {
                if !v.is_empty() && url_bloom.contains(v) {
                    matches.push(MatchInfo {
                        kind: "url".into(), value: v.into(), label: req.label.clone(),
                    });
                }
            }
        }
        // Domains
        for key in ["domain", "query", "dns.query", "host"] {
            if let Some(v) = ev.get(key).and_then(|x| x.as_str()) {
                if !v.is_empty() && domain_bloom.contains(v) {
                    matches.push(MatchInfo {
                        kind: "domain".into(), value: v.into(), label: req.label.clone(),
                    });
                }
            }
        }
        // Hashes
        for key in ["file.hash", "hash.sha256", "hash.md5", "hash.sha1"] {
            if let Some(v) = ev.get(key).and_then(|x| x.as_str()) {
                let lower = v.to_lowercase();
                if !lower.is_empty() && hash_bloom.contains(&lower) {
                    matches.push(MatchInfo {
                        kind: "hash".into(), value: lower, label: req.label.clone(),
                    });
                }
            }
        }

        if !matches.is_empty() {
            results.push(LookupResult { event_index: i, matched: matches });
        }
    }

    LookupResponse {
        results,
        bloom_stats: BloomStats {
            ip_items:     ip_bloom.len(),
            url_items:    url_bloom.len(),
            domain_items: domain_bloom.len(),
            hash_items:   hash_bloom.len(),
            total_bits:   ip_bloom.bits() + url_bloom.bits() + domain_bloom.bits() + hash_bloom.bits(),
        },
    }
}

fn build(items: &[String]) -> Bloom {
    let cap = items.len().max(1024);
    let mut b = Bloom::new(cap);
    for it in items {
        b.insert(it);
    }
    b
}
