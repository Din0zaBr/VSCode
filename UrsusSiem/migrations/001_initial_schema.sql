-- logvault initial schema
-- Runs automatically when PostgreSQL container initializes.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core log events table
CREATE TABLE IF NOT EXISTS logs (
    id         BIGSERIAL PRIMARY KEY,
    event_id   TEXT        NOT NULL UNIQUE,
    timestamp  TIMESTAMPTZ NOT NULL,
    host       TEXT        NOT NULL DEFAULT '',
    agent_id   TEXT        NOT NULL DEFAULT '',
    source     TEXT        NOT NULL DEFAULT '',
    level      TEXT        NOT NULL DEFAULT 'info',
    message    TEXT        NOT NULL DEFAULT '',
    service    TEXT        NOT NULL DEFAULT '',
    meta       JSONB       NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS logs_timestamp_idx  ON logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS logs_agent_id_idx   ON logs (agent_id);
CREATE INDEX IF NOT EXISTS logs_host_idx       ON logs (host);
CREATE INDEX IF NOT EXISTS logs_level_idx      ON logs (level);
CREATE INDEX IF NOT EXISTS logs_service_idx    ON logs (service);
CREATE INDEX IF NOT EXISTS logs_meta_gin_idx   ON logs USING GIN (meta);

-- Correlation alerts raised by the Rust engine
CREATE TABLE IF NOT EXISTS correlation_alerts (
    id         TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    rule_id    TEXT        NOT NULL,
    rule_name  TEXT        NOT NULL,
    severity   TEXT        NOT NULL DEFAULT 'medium',
    status     TEXT        NOT NULL DEFAULT 'open',   -- open | acknowledged | resolved
    host       TEXT        NOT NULL DEFAULT '',
    agent_id   TEXT        NOT NULL DEFAULT '',
    note       TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS alerts_status_idx     ON correlation_alerts (status);
CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON correlation_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_severity_idx   ON correlation_alerts (severity);

-- SIGMA correlation rules
CREATE TABLE IF NOT EXISTS sigma_rules (
    id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    rule_id       TEXT        NOT NULL UNIQUE,
    title         TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    rule_yaml     TEXT        NOT NULL,
    category      TEXT        NOT NULL DEFAULT '',
    severity      TEXT        NOT NULL DEFAULT 'medium',
    status        TEXT        NOT NULL DEFAULT 'enabled',  -- enabled | disabled | deprecated
    imported_from TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sigma_rules_category_idx ON sigma_rules (category);
CREATE INDEX IF NOT EXISTS sigma_rules_severity_idx ON sigma_rules (severity);
CREATE INDEX IF NOT EXISTS sigma_rules_status_idx   ON sigma_rules (status);

-- Custom fields for incident scenarios
CREATE TABLE IF NOT EXISTS custom_fields (
    id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    entity_type   TEXT        NOT NULL DEFAULT 'incident_scenario',
    field_name    TEXT        NOT NULL,
    field_type    TEXT        NOT NULL DEFAULT 'text',  -- text|textarea|dropdown|date|number|checkbox
    field_label   TEXT        NOT NULL,
    field_group   TEXT,
    options       JSONB       NOT NULL DEFAULT '[]',
    default_value TEXT,
    required      BOOLEAN     NOT NULL DEFAULT false,
    description   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, field_name)
);

-- Incident scenarios (templates)
CREATE TABLE IF NOT EXISTS incident_scenarios (
    id              TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name            TEXT        NOT NULL,
    customer        TEXT,
    criticality     TEXT        NOT NULL DEFAULT 'medium',
    description     TEXT        NOT NULL DEFAULT '',
    template_data   JSONB       NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      TEXT        NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS scenarios_criticality_idx ON incident_scenarios (criticality);
CREATE INDEX IF NOT EXISTS scenarios_created_at_idx  ON incident_scenarios (created_at DESC);
