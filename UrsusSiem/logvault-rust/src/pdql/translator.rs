use super::parser::{Command, Expr, SortItem};
use anyhow::{bail, Result};
use serde_json::Value;

/// Direct column names in the logs table
const DIRECT_COLUMNS: &[&str] = &[
    "id", "timestamp", "message", "level", "agent_id", "source", "service", "host",
];

/// Translate PDQL AST into PostgreSQL SQL with positional params.
pub fn translate(
    ast: Vec<Command>,
    allowed_agents: Option<Vec<String>>,
    max_limit: Option<usize>,
) -> Result<(String, Vec<Value>, usize)> {
    let mut where_clauses: Vec<String> = Vec::new();
    let mut params: Vec<Value> = Vec::new();
    let mut select_cols: Option<Vec<String>> = None;
    let mut sort_parts: Vec<String> = Vec::new();
    let mut limit_val: usize = 100;
    let mut group_cols: Vec<String> = Vec::new();
    let mut agg_cols: Vec<String> = Vec::new();

    // Apply agent ACL
    if let Some(agents) = allowed_agents {
        if !agents.is_empty() {
            let placeholders: Vec<String> = agents
                .iter()
                .enumerate()
                .map(|(i, _)| format!("${}", params.len() + i + 1))
                .collect();
            where_clauses.push(format!("agent_id IN ({})", placeholders.join(", ")));
            params.extend(agents.iter().map(|a| Value::String(a.clone())));
        }
    }

    for cmd in ast {
        match cmd {
            Command::Filter(expr) => {
                let clause = expr_to_sql(&expr, &mut params)?;
                where_clauses.push(format!("({})", clause));
            }
            Command::Select(cols) => {
                select_cols = Some(cols.iter().map(|c| field_to_sql(c)).collect());
            }
            Command::Sort(items) => {
                for item in items {
                    let col = field_to_sql(&item.field);
                    let dir = if item.desc { "DESC" } else { "ASC" };
                    sort_parts.push(format!("{} {}", col, dir));
                }
            }
            Command::Limit(n) => {
                limit_val = n.min(max_limit.unwrap_or(10_000));
            }
            Command::Group(cols) => {
                group_cols = cols.iter().map(|c| field_to_sql(c)).collect();
            }
            Command::Aggregate(funcs) => {
                agg_cols = funcs.iter().map(|f| aggregate_to_sql(f)).collect();
            }
        }
    }

    // Build SELECT clause
    let select = if !group_cols.is_empty() {
        let mut cols = group_cols.clone();
        cols.extend(agg_cols.clone());
        cols.join(", ")
    } else if let Some(cols) = select_cols {
        cols.join(", ")
    } else {
        "id, timestamp, host, agent_id, source, level, message, service, meta".to_string()
    };

    let mut sql = format!("SELECT {} FROM logs", select);

    if !where_clauses.is_empty() {
        sql.push_str(&format!(" WHERE {}", where_clauses.join(" AND ")));
    }

    if !group_cols.is_empty() {
        sql.push_str(&format!(" GROUP BY {}", group_cols.join(", ")));
    }

    if sort_parts.is_empty() {
        sql.push_str(" ORDER BY timestamp DESC");
    } else {
        sql.push_str(&format!(" ORDER BY {}", sort_parts.join(", ")));
    }

    sql.push_str(&format!(" LIMIT {}", limit_val));

    Ok((sql, params, limit_val))
}

fn expr_to_sql(expr: &Expr, params: &mut Vec<Value>) -> Result<String> {
    match expr {
        Expr::And(left, right) => {
            let l = expr_to_sql(left, params)?;
            let r = expr_to_sql(right, params)?;
            Ok(format!("({} AND {})", l, r))
        }
        Expr::Or(left, right) => {
            let l = expr_to_sql(left, params)?;
            let r = expr_to_sql(right, params)?;
            Ok(format!("({} OR {})", l, r))
        }
        Expr::Not(inner) => {
            let s = expr_to_sql(inner, params)?;
            Ok(format!("NOT ({})", s))
        }
        Expr::Comparison { field, op, value } => {
            let col = field_to_sql(field);
            let idx = params.len() + 1;
            params.push(value.clone());
            let sql = match op.as_str() {
                "contains" => format!("{} ILIKE ${}::text", col, idx),
                "startswith" => {
                    // Modify param to add % prefix/suffix
                    if let Some(s) = params.last_mut().and_then(|v| v.as_str().map(String::from)) {
                        *params.last_mut().unwrap() = Value::String(format!("{}%", s));
                    }
                    format!("{} ILIKE ${}::text", col, idx)
                }
                "endswith" => {
                    if let Some(s) = params.last_mut().and_then(|v| v.as_str().map(String::from)) {
                        *params.last_mut().unwrap() = Value::String(format!("%{}", s));
                    }
                    format!("{} ILIKE ${}::text", col, idx)
                }
                "match" => format!("{} ~ ${}::text", col, idx),
                "in_subnet" => {
                    format!("{} <<= ${}::inet", col, idx)
                }
                "!=" => format!("{} != ${}", col, idx),
                _ => format!("{} {} ${}", col, op, idx),
            };

            // For contains, wrap param in %...%
            if op == "contains" {
                if let Some(s) = params.last_mut().and_then(|v| v.as_str().map(String::from)) {
                    *params.last_mut().unwrap() = Value::String(format!("%{}%", s));
                }
            }

            Ok(sql)
        }
        Expr::In { field, values } => {
            let col = field_to_sql(field);
            let placeholders: Vec<String> = values
                .iter()
                .map(|v| {
                    params.push(v.clone());
                    format!("${}", params.len())
                })
                .collect();
            Ok(format!("{} IN ({})", col, placeholders.join(", ")))
        }
    }
}

pub fn field_to_sql(field: &str) -> String {
    if DIRECT_COLUMNS.contains(&field) {
        return field.to_string();
    }
    // Map PDQL fields to JSONB paths
    match field {
        "time" => "timestamp".to_string(),
        "count" => "COUNT(*)".to_string(),
        "src.ip" => "meta->>'src.ip'".to_string(),
        "dst.ip" => "meta->>'dst.ip'".to_string(),
        "src.port" => "(meta->>'src.port')::integer".to_string(),
        "dst.port" => "(meta->>'dst.port')::integer".to_string(),
        "src.host" => "meta->>'src.host'".to_string(),
        "dst.host" => "meta->>'dst.host'".to_string(),
        "protocol" => "meta->>'protocol'".to_string(),
        "action" => "meta->>'action'".to_string(),
        "status" => "meta->>'status'".to_string(),
        "event_type" => "meta->>'event_type'".to_string(),
        "subject.name" => "meta->>'subject.name'".to_string(),
        "subject.domain" => "meta->>'subject.domain'".to_string(),
        "object.name" => "meta->>'object.name'".to_string(),
        "object.path" => "meta->>'object.path'".to_string(),
        "event_src.host" => "meta->>'event_src.host'".to_string(),
        "event_src.ip" => "meta->>'event_src.ip'".to_string(),
        "event_src.vendor" => "meta->>'event_src.vendor'".to_string(),
        "category.generic" => "meta->'category'->>'generic'".to_string(),
        "category.high" => "meta->'category'->>'high'".to_string(),
        "category.low" => "meta->'category'->>'low'".to_string(),
        "count.bytes" => "(meta->>'count.bytes')::bigint".to_string(),
        "duration" => "(meta->>'duration')::float".to_string(),
        _ => format!("meta->>'{}' ", field),
    }
}

fn aggregate_to_sql(func: &str) -> String {
    match func {
        "count()" => "COUNT(*) AS count".to_string(),
        "count_distinct(src.ip)" => "COUNT(DISTINCT meta->>'src.ip') AS count_distinct_src_ip".to_string(),
        "count_distinct(dst.port)" => "COUNT(DISTINCT (meta->>'dst.port')::integer) AS count_distinct_dst_port".to_string(),
        "sum(count.bytes)" => "SUM((meta->>'count.bytes')::bigint) AS sum_bytes".to_string(),
        "avg(duration)" => "AVG((meta->>'duration')::float) AS avg_duration".to_string(),
        "min(time)" | "min(timestamp)" => "MIN(timestamp) AS min_time".to_string(),
        "max(time)" | "max(timestamp)" => "MAX(timestamp) AS max_time".to_string(),
        "first(message)" => "MIN(message) AS first_message".to_string(),
        "last(message)" => "MAX(message) AS last_message".to_string(),
        _ => {
            // Generic: count() -> COUNT(*)
            if func.starts_with("count(") {
                "COUNT(*) AS count".to_string()
            } else {
                func.to_string()
            }
        }
    }
}
