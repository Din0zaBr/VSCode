//! OCSF (Open Cybersecurity Schema Framework) normalisation.
//! See <https://schema.ocsf.io>. We map our heterogeneous `meta` fields to
//! the top-10 OCSF classes that cover ~95% of SIEM events.
//!
//! Storage strategy: every event ends up with both `meta` (raw) and `ocsf`
//! (normalised) in the database. Searches and ML can use either.
//!
//! Class IDs (OCSF v1.1):
//!   1001 — File System Activity
//!   1007 — Process Activity
//!   3002 — Authentication
//!   3005 — Account Change
//!   4001 — Network Activity
//!   4002 — HTTP Activity
//!   4003 — DNS Activity
//!   6003 — API Activity
//!   1003 — Memory Activity (mostly EDR)
//!
//! When the class is uncertain we fall back to **6003 (API Activity)** with
//! activity_id = 6 (Other).

use crate::models::LogEvent;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcsfMapRequest {
    pub events: Vec<LogEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcsfMapResponse {
    pub events: Vec<OcsfEvent>,
}

/// OcsfEvent keeps the raw event reference and the normalised JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcsfEvent {
    pub event_id: String,
    pub class_uid: i32,
    pub class_name: &'static str,
    pub ocsf: Value,
}

pub fn map_batch(req: OcsfMapRequest) -> OcsfMapResponse {
    let events = req.events.into_iter().map(map_one).collect();
    OcsfMapResponse { events }
}

pub fn map_one(ev: LogEvent) -> OcsfEvent {
    let category = ev
        .meta
        .get("category")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_lowercase();
    let msg = ev.message.to_lowercase();

    let (class_uid, class_name) = pick_class(&category, &msg);

    let ocsf = match class_uid {
        3002 => map_authentication(&ev),
        1001 => map_file_activity(&ev),
        1007 => map_process_activity(&ev),
        4001 => map_network_activity(&ev),
        4002 => map_http_activity(&ev),
        4003 => map_dns_activity(&ev),
        _ => map_generic(&ev, class_uid, class_name),
    };

    OcsfEvent {
        event_id: ev.event_id,
        class_uid,
        class_name,
        ocsf,
    }
}

fn pick_class(category: &str, msg: &str) -> (i32, &'static str) {
    if category.contains("auth") || category.contains("login") {
        return (3002, "Authentication");
    }
    if category.contains("process") || msg.contains("execve") || msg.contains("powershell") {
        return (1007, "Process Activity");
    }
    if category.contains("file") || msg.contains("inotify") {
        return (1001, "File System Activity");
    }
    if category.contains("http") || category.contains("web") {
        return (4002, "HTTP Activity");
    }
    if category.contains("dns") {
        return (4003, "DNS Activity");
    }
    if category.contains("network") || category.contains("flow") {
        return (4001, "Network Activity");
    }
    (6003, "API Activity")
}

// ─────────────────────────────────────────────────────────────────────────
// Per-class mappers — all defensive (use serde_json::Value, not unwraps).
// ─────────────────────────────────────────────────────────────────────────

fn map_authentication(ev: &LogEvent) -> Value {
    let user = first_str(ev, &["user", "username", "actor_user"]);
    let src_ip = first_str(ev, &["src.ip", "source_ip", "ip"]);
    let outcome = first_str(ev, &["outcome", "action"]);
    let status_id = match outcome.as_str() {
        "success" | "ok" => 1,         // Success
        "failure" | "fail" | "denied" => 2, // Failure
        _ => 0,                         // Unknown
    };
    json!({
        "class_uid": 3002,
        "class_name": "Authentication",
        "category_uid": 3,
        "type_uid": 300201,
        "time": ev.timestamp.timestamp_millis(),
        "severity_id": severity_id(&ev.level),
        "status_id": status_id,
        "actor": { "user": { "name": user } },
        "src_endpoint": { "ip": src_ip, "hostname": ev.host },
        "metadata": {
            "product": { "vendor_name": "URSUS", "name": "SIEM" },
            "version": "1.1.0"
        },
        "message": ev.message,
    })
}

fn map_file_activity(ev: &LogEvent) -> Value {
    let path = first_str(ev, &["path", "file.path", "filename"]);
    let action = first_str(ev, &["action", "operation"]);
    let activity_id = match action.as_str() {
        "create" => 1,
        "read" => 2,
        "update" | "modify" => 3,
        "delete" | "remove" => 4,
        "rename" => 5,
        _ => 99,
    };
    json!({
        "class_uid": 1001,
        "class_name": "File System Activity",
        "category_uid": 1,
        "activity_id": activity_id,
        "time": ev.timestamp.timestamp_millis(),
        "severity_id": severity_id(&ev.level),
        "file": { "name": path },
        "device": { "hostname": ev.host },
        "message": ev.message,
    })
}

fn map_process_activity(ev: &LogEvent) -> Value {
    let exe = first_str(ev, &["process.executable", "exe", "image"]);
    let cmdline = first_str(ev, &["process.command_line", "cmdline", "commandline"]);
    let pid = first_num(ev, &["process.pid", "pid"]);
    let ppid = first_num(ev, &["process.parent.pid", "ppid"]);
    json!({
        "class_uid": 1007,
        "class_name": "Process Activity",
        "category_uid": 1,
        "activity_id": 1,
        "time": ev.timestamp.timestamp_millis(),
        "severity_id": severity_id(&ev.level),
        "process": {
            "name": exe,
            "cmd_line": cmdline,
            "pid": pid,
            "parent_process": { "pid": ppid }
        },
        "device": { "hostname": ev.host },
        "message": ev.message,
    })
}

fn map_network_activity(ev: &LogEvent) -> Value {
    json!({
        "class_uid": 4001,
        "class_name": "Network Activity",
        "category_uid": 4,
        "time": ev.timestamp.timestamp_millis(),
        "severity_id": severity_id(&ev.level),
        "src_endpoint": {
            "ip": first_str(ev, &["src.ip", "source_ip"]),
            "port": first_num(ev, &["src.port", "source_port"]),
        },
        "dst_endpoint": {
            "ip": first_str(ev, &["dst.ip", "dest_ip"]),
            "port": first_num(ev, &["dst.port", "dest_port"]),
        },
        "connection_info": {
            "protocol_name": first_str(ev, &["proto", "protocol"]),
        },
        "device": { "hostname": ev.host },
        "message": ev.message,
    })
}

fn map_http_activity(ev: &LogEvent) -> Value {
    json!({
        "class_uid": 4002,
        "class_name": "HTTP Activity",
        "category_uid": 4,
        "time": ev.timestamp.timestamp_millis(),
        "severity_id": severity_id(&ev.level),
        "http_request": {
            "url": { "path": first_str(ev, &["url", "request.uri", "path"]) },
            "http_method": first_str(ev, &["method", "request.method"]),
        },
        "http_response": { "code": first_num(ev, &["status", "response.status"]) },
        "src_endpoint": { "ip": first_str(ev, &["src.ip", "client_ip"]) },
        "device": { "hostname": ev.host },
        "message": ev.message,
    })
}

fn map_dns_activity(ev: &LogEvent) -> Value {
    json!({
        "class_uid": 4003,
        "class_name": "DNS Activity",
        "category_uid": 4,
        "time": ev.timestamp.timestamp_millis(),
        "severity_id": severity_id(&ev.level),
        "query": {
            "hostname": first_str(ev, &["query", "dns.query", "name"]),
            "type": first_str(ev, &["qtype", "dns.qtype"]),
        },
        "src_endpoint": { "ip": first_str(ev, &["src.ip"]) },
        "device": { "hostname": ev.host },
        "message": ev.message,
    })
}

fn map_generic(ev: &LogEvent, class_uid: i32, class_name: &str) -> Value {
    json!({
        "class_uid": class_uid,
        "class_name": class_name,
        "time": ev.timestamp.timestamp_millis(),
        "severity_id": severity_id(&ev.level),
        "device": { "hostname": ev.host },
        "message": ev.message,
        "raw_data": ev.meta,
    })
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

fn first_str(ev: &LogEvent, keys: &[&str]) -> String {
    for k in keys {
        if let Some(v) = ev.meta.get(*k).and_then(|x| x.as_str()) {
            if !v.is_empty() {
                return v.to_string();
            }
        }
    }
    String::new()
}

fn first_num(ev: &LogEvent, keys: &[&str]) -> i64 {
    for k in keys {
        if let Some(v) = ev.meta.get(*k) {
            if let Some(n) = v.as_i64() {
                return n;
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.parse::<i64>() {
                    return n;
                }
            }
        }
    }
    0
}

fn severity_id(level: &crate::models::LogLevel) -> i32 {
    use crate::models::LogLevel as L;
    match level {
        L::Emergency | L::Alert | L::Critical => 5,
        L::Error => 4,
        L::Warning => 3,
        L::Notice | L::Info => 1,
        L::Debug => 0,
    }
}
