use crate::models::{AlertStatus, CorrelationAlert, CorrelationRule, LogEvent, RuleType, Severity};
use chrono::Utc;
use regex::Regex;
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

pub struct CorrelationEngine;

impl CorrelationEngine {
    pub fn new() -> Self {
        CorrelationEngine
    }

    pub fn evaluate(&self, rule: &CorrelationRule, events: &[LogEvent]) -> Vec<CorrelationAlert> {
        match rule.rule_type {
            RuleType::Threshold => self.eval_threshold(rule, events),
            RuleType::Pattern => self.eval_pattern(rule, events),
            RuleType::Keyword => self.eval_keyword(rule, events),
            RuleType::PortScan => self.eval_port_scan(rule, events),
            RuleType::Sigma => self.eval_sigma(rule, events),
        }
    }

    /// Threshold: count events matching pattern from same source within window
    fn eval_threshold(&self, rule: &CorrelationRule, events: &[LogEvent]) -> Vec<CorrelationAlert> {
        let cond = &rule.conditions;
        let pattern = cond["pattern"].as_str().unwrap_or("");
        let window_sec = cond["window_sec"].as_u64().unwrap_or(60);
        let threshold = cond["count"].as_u64().unwrap_or(5) as usize;
        let group_by = cond["group_by"].as_str().unwrap_or("source_ip");

        let Ok(re) = Regex::new(pattern) else {
            return vec![];
        };

        let now = Utc::now();
        let window_start = now - chrono::Duration::seconds(window_sec as i64);

        // Group matching events by the specified key
        let mut groups: HashMap<String, Vec<&LogEvent>> = HashMap::new();
        for event in events {
            if event.timestamp < window_start {
                continue;
            }
            if !re.is_match(&event.message) {
                continue;
            }
            let key = extract_group_key(event, group_by);
            groups.entry(key).or_default().push(event);
        }

        groups
            .into_iter()
            .filter(|(_, evts)| evts.len() >= threshold)
            .map(|(key, evts)| CorrelationAlert {
                id: Uuid::new_v4().to_string(),
                rule_id: rule.id.clone(),
                rule_name: rule.name.clone(),
                severity: rule.severity.clone(),
                source_ip: if group_by == "source_ip" || group_by == "src.ip" {
                    Some(key.clone())
                } else {
                    None
                },
                host: evts.first().map(|e| e.host.clone()),
                message: format!(
                    "{} — {} совпадений от '{}' за {}с (порог: {})",
                    rule.name,
                    evts.len(),
                    key,
                    window_sec,
                    threshold
                ),
                event_count: evts.len(),
                triggered_at: now,
                status: AlertStatus::Open,
            })
            .collect()
    }

    /// Pattern: any event matching regex in window
    fn eval_pattern(&self, rule: &CorrelationRule, events: &[LogEvent]) -> Vec<CorrelationAlert> {
        let cond = &rule.conditions;
        let pattern = cond["pattern"].as_str().unwrap_or("");
        let window_sec = cond["window_sec"].as_u64().unwrap_or(300);

        let Ok(re) = Regex::new(pattern) else {
            return vec![];
        };

        let now = Utc::now();
        let window_start = now - chrono::Duration::seconds(window_sec as i64);

        let matched: Vec<&LogEvent> = events
            .iter()
            .filter(|e| e.timestamp >= window_start && re.is_match(&e.message))
            .collect();

        if matched.is_empty() {
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
                "{} — паттерн '{}' найден в {} событиях",
                rule.name,
                pattern,
                matched.len()
            ),
            event_count: matched.len(),
            triggered_at: now,
            status: AlertStatus::Open,
        }]
    }

    /// Keyword: all specified keywords present in events within window
    fn eval_keyword(&self, rule: &CorrelationRule, events: &[LogEvent]) -> Vec<CorrelationAlert> {
        let cond = &rule.conditions;
        let keywords: Vec<String> = cond["keywords"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let window_sec = cond["window_sec"].as_u64().unwrap_or(300);

        if keywords.is_empty() {
            return vec![];
        }

        let now = Utc::now();
        let window_start = now - chrono::Duration::seconds(window_sec as i64);

        let matched: Vec<&LogEvent> = events
            .iter()
            .filter(|e| {
                e.timestamp >= window_start
                    && keywords
                        .iter()
                        .all(|kw| e.message.to_lowercase().contains(&kw.to_lowercase()))
            })
            .collect();

        if matched.is_empty() {
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
                "{} — ключевые слова {:?} найдены в {} событиях",
                rule.name,
                keywords,
                matched.len()
            ),
            event_count: matched.len(),
            triggered_at: now,
            status: AlertStatus::Open,
        }]
    }

    /// Port scan: N unique destination ports from single source in window
    fn eval_port_scan(&self, rule: &CorrelationRule, events: &[LogEvent]) -> Vec<CorrelationAlert> {
        let cond = &rule.conditions;
        let window_sec = cond["window_sec"].as_u64().unwrap_or(30);
        let unique_ports = cond["unique_ports"].as_u64().unwrap_or(20) as usize;

        let port_re = Regex::new(r"DPT=(\d+)|dst\.port[=:\s]+(\d+)|port\s+(\d+)").unwrap();

        let now = Utc::now();
        let window_start = now - chrono::Duration::seconds(window_sec as i64);

        // src_ip -> set of ports
        let mut src_ports: HashMap<String, HashSet<u16>> = HashMap::new();
        for event in events {
            if event.timestamp < window_start {
                continue;
            }
            let src_ip = match get_meta_str(event, "src.ip") {
                Some(ip) => ip,
                None => continue,
            };
            for cap in port_re.captures_iter(&event.message) {
                let port_str = cap
                    .get(1)
                    .or_else(|| cap.get(2))
                    .or_else(|| cap.get(3))
                    .map(|m| m.as_str());
                if let Some(p) = port_str.and_then(|s| s.parse::<u16>().ok()) {
                    src_ports.entry(src_ip.clone()).or_default().insert(p);
                }
            }
        }

        src_ports
            .into_iter()
            .filter(|(_, ports)| ports.len() >= unique_ports)
            .map(|(src_ip, ports)| CorrelationAlert {
                id: Uuid::new_v4().to_string(),
                rule_id: rule.id.clone(),
                rule_name: rule.name.clone(),
                severity: rule.severity.clone(),
                source_ip: Some(src_ip.clone()),
                host: None,
                message: format!(
                    "Сканирование портов: {} → {} уникальных портов за {}с",
                    src_ip,
                    ports.len(),
                    window_sec
                ),
                event_count: ports.len(),
                triggered_at: now,
                status: AlertStatus::Open,
            })
            .collect()
    }

    /// SIGMA rule evaluation (simplified — field matching + count conditions)
    fn eval_sigma(&self, rule: &CorrelationRule, events: &[LogEvent]) -> Vec<CorrelationAlert> {
        use super::sigma::evaluate_sigma;
        evaluate_sigma(rule, events)
    }
}

fn extract_group_key(event: &LogEvent, group_by: &str) -> String {
    match group_by {
        "source_ip" | "src.ip" => get_meta_str(event, "src.ip").unwrap_or_else(|| event.host.clone()),
        "host" => event.host.clone(),
        "agent_id" => event.agent_id.clone(),
        "service" => event.service.clone(),
        "subject.name" => get_meta_str(event, "subject.name").unwrap_or_default(),
        _ => get_meta_str(event, group_by).unwrap_or_else(|| event.host.clone()),
    }
}

fn get_meta_str(event: &LogEvent, key: &str) -> Option<String> {
    event
        .meta
        .get(key)
        .and_then(|v| v.as_str().map(String::from))
}
