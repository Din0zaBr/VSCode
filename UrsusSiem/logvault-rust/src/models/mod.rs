use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub event_id: String,
    pub timestamp: DateTime<Utc>,
    pub host: String,
    pub agent_id: String,
    pub source: String,
    pub level: LogLevel,
    pub message: String,
    pub service: String,
    pub meta: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogLevel {
    Debug,
    Info,
    Notice,
    Warning,
    Error,
    Critical,
    Alert,
    Emergency,
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            LogLevel::Debug => "DEBUG",
            LogLevel::Info => "INFO",
            LogLevel::Notice => "NOTICE",
            LogLevel::Warning => "WARNING",
            LogLevel::Error => "ERROR",
            LogLevel::Critical => "CRITICAL",
            LogLevel::Alert => "ALERT",
            LogLevel::Emergency => "EMERGENCY",
        };
        write!(f, "{}", s)
    }
}

impl From<&str> for LogLevel {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "debug" | "7" => LogLevel::Debug,
            "info" | "informational" | "6" => LogLevel::Info,
            "notice" | "5" => LogLevel::Notice,
            "warning" | "warn" | "4" => LogLevel::Warning,
            "error" | "err" | "3" => LogLevel::Error,
            "critical" | "crit" | "2" => LogLevel::Critical,
            "alert" | "1" => LogLevel::Alert,
            "emergency" | "emerg" | "0" => LogLevel::Emergency,
            _ => LogLevel::Info,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseRequest {
    pub event_id: String,
    pub timestamp: String,
    pub host: String,
    pub agent_id: String,
    pub source: String,
    pub level: String,
    pub message: String,
    pub service: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseResponse {
    pub event: LogEvent,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseBatchRequest {
    pub events: Vec<ParseRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParseBatchResponse {
    pub events: Vec<LogEvent>,
    pub parsed: usize,
    pub errors: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelationRule {
    pub id: String,
    pub name: String,
    pub description: String,
    pub severity: Severity,
    pub rule_type: RuleType,
    pub conditions: serde_json::Value,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Severity {
    Low,
    Medium,
    High,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum RuleType {
    Threshold,
    Pattern,
    Keyword,
    PortScan,
    Sigma,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelationAlert {
    pub id: String,
    pub rule_id: String,
    pub rule_name: String,
    pub severity: Severity,
    pub source_ip: Option<String>,
    pub host: Option<String>,
    pub message: String,
    pub event_count: usize,
    pub triggered_at: DateTime<Utc>,
    pub status: AlertStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum AlertStatus {
    Open,
    Investigating,
    Resolved,
    FalsePositive,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelateRequest {
    pub events: Vec<LogEvent>,
    pub rules: Vec<CorrelationRule>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CorrelateResponse {
    pub alerts: Vec<CorrelationAlert>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdqlRequest {
    pub query: String,
    pub allowed_agents: Option<Vec<String>>,
    pub max_limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PdqlResponse {
    pub sql: String,
    pub params: Vec<serde_json::Value>,
    pub limit: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Category {
    pub generic: String,
    pub high: String,
    pub low: String,
}
