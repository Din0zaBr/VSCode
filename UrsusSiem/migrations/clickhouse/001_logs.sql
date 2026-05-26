-- ClickHouse schema for URSUS SIEM (S/M tier, Sprint 8).
-- Run via clickhouse-client --multiquery < 001_logs.sql.

CREATE DATABASE IF NOT EXISTS ursus;
USE ursus;

-- ── Logs: MergeTree partitioned by day, ordered by (host, agent_id, ts) ───
CREATE TABLE IF NOT EXISTS logs
(
    timestamp     DateTime64(3) CODEC(DoubleDelta, LZ4),
    event_id      String,
    host          LowCardinality(String),
    agent_id      LowCardinality(String),
    source        LowCardinality(String),
    level         LowCardinality(String),
    service       LowCardinality(String),
    message       String CODEC(ZSTD(3)),
    meta          String CODEC(ZSTD(3)),       -- JSON-as-string
    ocsf          String CODEC(ZSTD(3)) DEFAULT '',

    INDEX idx_msg     message TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 4,
    INDEX idx_meta_ip JSONExtractString(meta, 'src.ip') TYPE bloom_filter GRANULARITY 8
)
ENGINE = MergeTree
PARTITION BY toYYYYMMDD(timestamp)
ORDER BY (host, agent_id, timestamp)
TTL toDateTime(timestamp) + INTERVAL 90 DAY DELETE;

-- ── Correlation alerts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS correlation_alerts
(
    id         String,
    rule_id    String,
    rule_name  String,
    severity   LowCardinality(String),
    status     LowCardinality(String) DEFAULT 'open',
    host       String,
    agent_id   String,
    note       String,
    created_at DateTime64(3) DEFAULT now64(),
    updated_at DateTime64(3) DEFAULT now64(),
    updated_by String DEFAULT ''
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY (id);

-- ── Anomaly alerts ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_alerts
(
    id              Int64,
    profile_key     String,
    metric          LowCardinality(String),
    kind            LowCardinality(String),
    severity        LowCardinality(String) DEFAULT 'medium',
    current_value   Float64,
    expected_value  Float64,
    z_score         Float64,
    description     String,
    detected_at     DateTime64(3) DEFAULT now64(),
    window_start    Nullable(DateTime64(3)),
    window_end      Nullable(DateTime64(3)),
    related_meta    String DEFAULT '{}',
    status          LowCardinality(String) DEFAULT 'open'
)
ENGINE = MergeTree
ORDER BY (detected_at, profile_key);

-- ── Audit log (append-only) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log
(
    id           Int64,
    occurred_at  DateTime64(3) DEFAULT now64(),
    actor        String,
    actor_ip     Nullable(String),
    action       LowCardinality(String),
    target_type  LowCardinality(String),
    target_id    Nullable(String),
    diff         String DEFAULT '{}',
    outcome      LowCardinality(String) DEFAULT 'ok',
    notes        Nullable(String)
)
ENGINE = MergeTree
ORDER BY (occurred_at, actor);
