mod enrichment;
mod formats;

pub use enrichment::enrich;
pub use formats::{parse_syslog_rfc5424, parse_syslog_rfc3164, parse_cef, parse_http_access};

use crate::models::{LogEvent, LogLevel, ParseRequest};
use anyhow::Result;
use chrono::Utc;
use std::collections::HashMap;
use uuid::Uuid;

/// Parse and enrich a raw log event. Returns an enriched LogEvent ready for storage.
pub fn parse_and_enrich(req: ParseRequest) -> Result<LogEvent> {
    let timestamp = parse_timestamp(&req.timestamp).unwrap_or_else(|_| Utc::now());
    let level = detect_level(&req.level, &req.message);

    let mut meta: HashMap<String, serde_json::Value> = HashMap::new();

    // Try structured format parsing first (RFC5424, CEF, HTTP access)
    let parsed_meta = try_parse_structured(&req.message);
    meta.extend(parsed_meta);

    // Always run enrichment (category detection, IP extraction, etc.)
    let enrichment = enrich(&req.message, &req.source, &req.host);
    meta.extend(enrichment);

    // Ensure level is consistent with detected severity
    let final_level = if let Some(sev) = meta.get("severity_hint") {
        if let Some(s) = sev.as_str() {
            LogLevel::from(s)
        } else {
            level
        }
    } else {
        level
    };

    Ok(LogEvent {
        event_id: req.event_id,
        timestamp,
        host: req.host,
        agent_id: req.agent_id,
        source: req.source,
        level: final_level,
        message: req.message,
        service: req.service,
        meta,
    })
}

fn parse_timestamp(s: &str) -> Result<chrono::DateTime<Utc>> {
    // ISO 8601 with Z
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(s) {
        return Ok(dt.with_timezone(&Utc));
    }
    // ISO 8601 with microseconds
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S%.f") {
        return Ok(dt.and_utc());
    }
    // BSD syslog format (Nov 15 12:34:56)
    let current_year = Utc::now().year();
    let with_year = format!("{} {}", current_year, s);
    if let Ok(dt) = chrono::NaiveDateTime::parse_from_str(&with_year, "%Y %b %d %H:%M:%S") {
        return Ok(dt.and_utc());
    }
    // HTTP access log format (15/Nov/2024:12:34:56 +0000)
    if let Ok(dt) = chrono::DateTime::parse_from_str(s, "%d/%b/%Y:%H:%M:%S %z") {
        return Ok(dt.with_timezone(&Utc));
    }
    anyhow::bail!("Cannot parse timestamp: {}", s)
}

fn detect_level(raw: &str, message: &str) -> LogLevel {
    let level = LogLevel::from(raw);
    // If level is just "info" by default, check message content
    if level == LogLevel::Info {
        let msg_lower = message.to_lowercase();
        if msg_lower.contains("error") || msg_lower.contains("failed") || msg_lower.contains("denied") {
            return LogLevel::Error;
        }
        if msg_lower.contains("critical") || msg_lower.contains("crit") {
            return LogLevel::Critical;
        }
        if msg_lower.contains("warn") {
            return LogLevel::Warning;
        }
    }
    level
}

fn try_parse_structured(message: &str) -> HashMap<String, serde_json::Value> {
    let mut meta = HashMap::new();

    if let Some(rfc5424) = parse_syslog_rfc5424(message) {
        meta.extend(rfc5424);
    } else if let Some(rfc3164) = parse_syslog_rfc3164(message) {
        meta.extend(rfc3164);
    } else if let Some(cef) = parse_cef(message) {
        meta.extend(cef);
    } else if let Some(http) = parse_http_access(message) {
        meta.extend(http);
    }

    meta
}

trait Year {
    fn year(&self) -> i32;
}

impl Year for chrono::DateTime<Utc> {
    fn year(&self) -> i32 {
        chrono::Datelike::year(self)
    }
}
