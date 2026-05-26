mod engine;
mod sigma;

pub use engine::CorrelationEngine;
use crate::models::{CorrelationAlert, CorrelationRule, LogEvent, RuleType};

/// Run correlation rules against a batch of events. Returns triggered alerts.
pub fn correlate(events: &[LogEvent], rules: &[CorrelationRule]) -> Vec<CorrelationAlert> {
    let engine = CorrelationEngine::new();
    rules
        .iter()
        .filter(|r| r.enabled)
        .flat_map(|rule| engine.evaluate(rule, events))
        .collect()
}
