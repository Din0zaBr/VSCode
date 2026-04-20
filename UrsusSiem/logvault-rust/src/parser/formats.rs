use once_cell::sync::Lazy;
use regex::Regex;
use std::collections::HashMap;
use serde_json::Value;

// RFC 5424: <PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD-ELEMENT] MSG
static RFC5424: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^<(\d{1,3})>(\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)(?:\s+\S+)?\s+(.*)$")
        .unwrap()
});

// RFC 3164: <PRI>TIMESTAMP HOSTNAME PROGRAM[PID]: MSG
static RFC3164: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"^<(\d{1,3})>(\w+\s+\d+\s+\d+:\d+:\d+)\s+(\S+)\s+(\S+?)(?:\[(\d+)\])?:\s+(.*)$")
        .unwrap()
});

// CEF: CEF:VERSION|DEVICE_VENDOR|DEVICE_PRODUCT|DEVICE_VERSION|SIGNATURE_ID|NAME|SEVERITY|EXTENSIONS
static CEF: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"CEF:(\d+)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|(\d+)\|(.*)$")
        .unwrap()
});

// Nginx/Apache access log
static HTTP_ACCESS: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(\d+\.\d+\.\d+\.\d+)\s+\S+\s+(\S+)\s+\[([^\]]+)\]\s+"(\w+)\s+([^\s"]+)\s+HTTP/[\d.]+"\s+(\d+)\s+(\d+)"#,
    )
    .unwrap()
});

/// Parse RFC 5424 syslog message
pub fn parse_syslog_rfc5424(message: &str) -> Option<HashMap<String, Value>> {
    let caps = RFC5424.captures(message)?;
    let pri: u8 = caps[1].parse().ok()?;
    let facility = pri >> 3;
    let severity = pri & 0x07;

    let mut meta = HashMap::new();
    meta.insert("syslog.facility".into(), Value::Number(facility.into()));
    meta.insert("syslog.severity".into(), Value::Number(severity.into()));
    meta.insert("syslog.version".into(), Value::String(caps[2].to_string()));
    meta.insert("event_src.host".into(), Value::String(caps[4].to_string()));
    meta.insert("event_src.title".into(), Value::String(caps[5].to_string()));

    if caps.get(6).map(|m| m.as_str()) != Some("-") {
        meta.insert(
            "subject.process.id".into(),
            Value::String(caps[6].to_string()),
        );
    }
    meta.insert(
        "severity_hint".into(),
        Value::String(syslog_severity_to_str(severity).into()),
    );
    Some(meta)
}

/// Parse RFC 3164 (BSD) syslog message
pub fn parse_syslog_rfc3164(message: &str) -> Option<HashMap<String, Value>> {
    let caps = RFC3164.captures(message)?;
    let pri: u8 = caps[1].parse().ok()?;
    let severity = pri & 0x07;

    let mut meta = HashMap::new();
    meta.insert("syslog.timestamp".into(), Value::String(caps[2].to_string()));
    meta.insert("event_src.host".into(), Value::String(caps[3].to_string()));
    meta.insert("event_src.title".into(), Value::String(caps[4].to_string()));
    if let Some(pid) = caps.get(5) {
        meta.insert(
            "subject.process.id".into(),
            Value::String(pid.as_str().to_string()),
        );
    }
    meta.insert(
        "severity_hint".into(),
        Value::String(syslog_severity_to_str(severity).into()),
    );
    Some(meta)
}

/// Parse CEF (Common Event Format)
pub fn parse_cef(message: &str) -> Option<HashMap<String, Value>> {
    let caps = CEF.captures(message)?;
    let severity_num: u8 = caps[7].parse().ok()?;

    let mut meta = HashMap::new();
    meta.insert(
        "event_src.vendor".into(),
        Value::String(caps[2].to_string()),
    );
    meta.insert(
        "event_src.product".into(),
        Value::String(caps[3].to_string()),
    );
    meta.insert(
        "event_src.version".into(),
        Value::String(caps[4].to_string()),
    );
    meta.insert(
        "event.signature_id".into(),
        Value::String(caps[5].to_string()),
    );
    meta.insert(
        "event.name".into(),
        Value::String(caps[6].to_string()),
    );
    meta.insert(
        "cef.severity".into(),
        Value::Number(severity_num.into()),
    );
    meta.insert(
        "severity_hint".into(),
        Value::String(cef_severity_to_str(severity_num).into()),
    );

    // Parse CEF extensions (key=value pairs)
    for kv in caps[8].split_whitespace().collect::<Vec<_>>().windows(1) {
        if let Some((k, v)) = kv[0].split_once('=') {
            let mapped_key = map_cef_key(k);
            meta.insert(mapped_key, Value::String(v.to_string()));
        }
    }

    Some(meta)
}

/// Parse Nginx/Apache HTTP access log
pub fn parse_http_access(message: &str) -> Option<HashMap<String, Value>> {
    let caps = HTTP_ACCESS.captures(message)?;

    let status: u16 = caps[6].parse().ok()?;
    let bytes: u64 = caps[7].parse().unwrap_or(0);

    let severity = if status >= 500 {
        "ERROR"
    } else if status >= 400 {
        "WARNING"
    } else {
        "INFO"
    };

    let mut meta = HashMap::new();
    meta.insert("src.ip".into(), Value::String(caps[1].to_string()));
    meta.insert(
        "subject.name".into(),
        Value::String(caps[2].to_string()),
    );
    meta.insert("http.timestamp".into(), Value::String(caps[3].to_string()));
    meta.insert("action".into(), Value::String(caps[4].to_string()));
    meta.insert("object.path".into(), Value::String(caps[5].to_string()));
    meta.insert(
        "status".into(),
        Value::Number(status.into()),
    );
    meta.insert(
        "count.bytes".into(),
        Value::Number(bytes.into()),
    );
    meta.insert(
        "severity_hint".into(),
        Value::String(severity.to_string()),
    );
    Some(meta)
}

fn syslog_severity_to_str(sev: u8) -> &'static str {
    match sev {
        0 => "EMERGENCY",
        1 => "ALERT",
        2 => "CRITICAL",
        3 => "ERROR",
        4 => "WARNING",
        5 => "NOTICE",
        6 => "INFO",
        7 => "DEBUG",
        _ => "INFO",
    }
}

fn cef_severity_to_str(sev: u8) -> &'static str {
    match sev {
        8..=10 => "CRITICAL",
        6..=7 => "ERROR",
        4..=5 => "WARNING",
        1..=3 => "INFO",
        _ => "DEBUG",
    }
}

fn map_cef_key(key: &str) -> String {
    match key {
        "src" => "src.ip",
        "dst" => "dst.ip",
        "spt" => "src.port",
        "dpt" => "dst.port",
        "shost" => "src.host",
        "dhost" => "dst.host",
        "proto" => "protocol",
        "act" => "action",
        "msg" => "reason",
        "fname" => "object.name",
        "fpath" => "object.path",
        "suser" => "subject.name",
        "duser" => "object.user",
        "cn1" => "count",
        "cn2" => "count.bytes",
        _ => key,
    }
    .to_string()
}
