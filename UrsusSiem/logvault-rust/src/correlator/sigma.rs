use crate::models::{AlertStatus, CorrelationAlert, CorrelationRule, LogEvent};
use chrono::Utc;
use regex::Regex;
use std::collections::HashMap;
use uuid::Uuid;

/// Evaluate a SIGMA rule against a batch of events.
/// SIGMA rules are stored as JSONB with field detection conditions.
pub fn evaluate_sigma(rule: &CorrelationRule, events: &[LogEvent]) -> Vec<CorrelationAlert> {
    let cond = &rule.conditions;

    // Extract SIGMA detection block
    let detection = match cond.get("detection") {
        Some(d) => d,
        None => return vec![],
    };

    let window_sec = cond.get("window_sec").and_then(|v| v.as_u64()).unwrap_or(300);
    let now = Utc::now();
    let window_start = now - chrono::Duration::seconds(window_sec as i64);

    let matched: Vec<&LogEvent> = events
        .iter()
        .filter(|e| e.timestamp >= window_start && matches_sigma_detection(e, detection))
        .collect();

    // Check if count threshold met (optional SIGMA condition)
    let min_count = cond
        .get("min_count")
        .and_then(|v| v.as_u64())
        .unwrap_or(1) as usize;

    if matched.len() < min_count {
        return vec![];
    }

    let first = matched[0];
    vec![CorrelationAlert {
        id: Uuid::new_v4().to_string(),
        rule_id: rule.id.clone(),
        rule_name: rule.name.clone(),
        severity: rule.severity.clone(),
        source_ip: get_meta_str(first, "src.ip"),
        host: Some(first.host.clone()),
        message: format!(
            "{}: {} событий за {}с",
            rule.name,
            matched.len(),
            window_sec
        ),
        event_count: matched.len(),
        triggered_at: now,
        status: AlertStatus::Open,
    }]
}

/// Check if a single event matches SIGMA detection conditions.
/// Supports: field|contains, field|contains|any, field|startswith, field|endswith,
///           field|re, field|in, EventID, LogonType matching.
fn matches_sigma_detection(event: &LogEvent, detection: &serde_json::Value) -> bool {
    let Some(obj) = detection.as_object() else {
        return false;
    };

    // Collect all selection blocks
    let mut selection_results: HashMap<String, bool> = HashMap::new();

    for (key, conditions) in obj {
        if key == "condition" {
            continue;
        }
        let result = evaluate_selection_block(event, conditions);
        selection_results.insert(key.clone(), result);
    }

    // Evaluate the condition expression
    let condition = detection
        .get("condition")
        .and_then(|v| v.as_str())
        .unwrap_or("selection");

    evaluate_condition_expr(condition, &selection_results)
}

fn evaluate_selection_block(event: &LogEvent, block: &serde_json::Value) -> bool {
    let Some(fields) = block.as_object() else {
        return false;
    };

    for (field_spec, expected) in fields {
        if !matches_field(event, field_spec, expected) {
            return false;
        }
    }
    true
}

fn matches_field(event: &LogEvent, field_spec: &str, expected: &serde_json::Value) -> bool {
    let parts: Vec<&str> = field_spec.split('|').collect();
    let field_name = parts[0];
    let modifiers: Vec<&str> = parts[1..].to_vec();

    let has_any = modifiers.contains(&"any");
    let has_not = modifiers.contains(&"not");

    let value = get_event_field(event, field_name);

    let check = |val: &str, expected_val: &str| -> bool {
        if modifiers.contains(&"contains") {
            val.to_lowercase().contains(&expected_val.to_lowercase())
        } else if modifiers.contains(&"startswith") {
            val.to_lowercase().starts_with(&expected_val.to_lowercase())
        } else if modifiers.contains(&"endswith") {
            val.to_lowercase().ends_with(&expected_val.to_lowercase())
        } else if modifiers.contains(&"re") {
            Regex::new(expected_val).map_or(false, |re| re.is_match(val))
        } else {
            // Default: exact match (case-insensitive for strings)
            val.to_lowercase() == expected_val.to_lowercase()
        }
    };

    let result = match expected {
        serde_json::Value::Array(items) => {
            let values: Vec<&str> = items.iter().filter_map(|v| v.as_str()).collect();
            if has_any {
                // Field must match ANY of the values
                values.iter().any(|ev| {
                    if let Some(ref v) = value {
                        check(v, ev)
                    } else {
                        false
                    }
                })
            } else {
                // Field must match ALL of the values (rare in SIGMA, but supported)
                values.iter().all(|ev| {
                    if let Some(ref v) = value {
                        check(v, ev)
                    } else {
                        false
                    }
                })
            }
        }
        serde_json::Value::String(s) => value.as_deref().map_or(false, |v| check(v, s)),
        serde_json::Value::Number(n) => {
            let expected_str = n.to_string();
            value.as_deref().map_or(false, |v| v == expected_str)
        }
        _ => false,
    };

    if has_not { !result } else { result }
}

fn evaluate_condition_expr(condition: &str, results: &HashMap<String, bool>) -> bool {
    // Supports: "selection", "selection1 and selection2", "sel1 or sel2", "not sel1"
    // "sel1 and not sel2", "(sel1 and sel2) or sel3"
    let cond = condition.trim().to_lowercase();

    if let Some(inner) = cond.strip_prefix('(').and_then(|s| s.strip_suffix(')')) {
        return evaluate_condition_expr(inner, results);
    }

    if let Some(pos) = find_or_position(&cond) {
        let left = &cond[..pos];
        let right = &cond[pos + 3..]; // skip " or "
        return evaluate_condition_expr(left.trim(), results)
            || evaluate_condition_expr(right.trim(), results);
    }

    if let Some(pos) = find_and_position(&cond) {
        let left = &cond[..pos];
        let right = &cond[pos + 4..]; // skip " and "
        return evaluate_condition_expr(left.trim(), results)
            && evaluate_condition_expr(right.trim(), results);
    }

    if let Some(inner) = cond.strip_prefix("not ") {
        return !evaluate_condition_expr(inner.trim(), results);
    }

    // Leaf: look up selection result
    *results.get(cond.as_str()).unwrap_or(&false)
}

fn find_or_position(s: &str) -> Option<usize> {
    let mut depth = 0;
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b' ' if depth == 0 => {
                if s[i..].starts_with(" or ") {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn find_and_position(s: &str) -> Option<usize> {
    let mut depth = 0;
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b' ' if depth == 0 => {
                if s[i..].starts_with(" and ") {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn get_event_field(event: &LogEvent, field: &str) -> Option<String> {
    match field {
        "message" => Some(event.message.clone()),
        "host" => Some(event.host.clone()),
        "agent_id" => Some(event.agent_id.clone()),
        "service" => Some(event.service.clone()),
        "level" => Some(event.level.to_string()),
        "EventID" | "event_id" => event.meta.get("event_id").and_then(|v| {
            v.as_str().map(String::from).or_else(|| v.as_u64().map(|n| n.to_string()))
        }),
        "LogonType" => event
            .meta
            .get("LogonType")
            .and_then(|v| v.as_u64().map(|n| n.to_string())),
        _ => event.meta.get(field).and_then(|v| {
            v.as_str()
                .map(String::from)
                .or_else(|| v.as_u64().map(|n| n.to_string()))
                .or_else(|| v.as_f64().map(|n| n.to_string()))
        }),
    }
}

fn get_meta_str(event: &LogEvent, key: &str) -> Option<String> {
    event.meta.get(key).and_then(|v| v.as_str().map(String::from))
}
