package storage

import (
	"context"
	"log/slog"
)

// RunMigrations applies any pending schema changes.
// Uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS so it is idempotent.
func (db *DB) RunMigrations(ctx context.Context) error {
	migrations := []struct {
		name string
		sql  string
	}{
		{
			name: "001_initial_schema",
			sql: `
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS logs (
    id         BIGSERIAL PRIMARY KEY,
    event_id   TEXT NOT NULL UNIQUE,
    timestamp  TIMESTAMPTZ NOT NULL,
    host       TEXT NOT NULL DEFAULT '',
    agent_id   TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT '',
    level      TEXT NOT NULL DEFAULT 'info',
    message    TEXT NOT NULL DEFAULT '',
    service    TEXT NOT NULL DEFAULT '',
    meta       JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS logs_timestamp_idx ON logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS logs_agent_id_idx  ON logs (agent_id);
CREATE INDEX IF NOT EXISTS logs_host_idx      ON logs (host);
CREATE INDEX IF NOT EXISTS logs_level_idx     ON logs (level);
CREATE INDEX IF NOT EXISTS logs_service_idx   ON logs (service);
CREATE INDEX IF NOT EXISTS logs_meta_gin_idx  ON logs USING GIN (meta);

CREATE TABLE IF NOT EXISTS correlation_alerts (
    id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    rule_id    TEXT NOT NULL,
    rule_name  TEXT NOT NULL,
    severity   TEXT NOT NULL DEFAULT 'medium',
    status     TEXT NOT NULL DEFAULT 'open',
    host       TEXT NOT NULL DEFAULT '',
    agent_id   TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS alerts_status_idx     ON correlation_alerts (status);
CREATE INDEX IF NOT EXISTS alerts_created_at_idx ON correlation_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS alerts_severity_idx   ON correlation_alerts (severity);
`,
		},
		{
			name: "003_accounts_exclusions",
			sql: `
CREATE TABLE IF NOT EXISTS known_accounts (
    id           BIGSERIAL PRIMARY KEY,
    username     TEXT NOT NULL,
    domain       TEXT NOT NULL DEFAULT '',
    display_name TEXT NOT NULL DEFAULT '',
    email        TEXT NOT NULL DEFAULT '',
    department   TEXT NOT NULL DEFAULT '',
    role         TEXT NOT NULL DEFAULT '',
    risk_level   TEXT NOT NULL DEFAULT 'low',
    is_service_account BOOLEAN NOT NULL DEFAULT false,
    is_privileged      BOOLEAN NOT NULL DEFAULT false,
    notes        TEXT NOT NULL DEFAULT '',
    first_seen   TIMESTAMPTZ,
    last_seen    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (username, domain)
);
CREATE INDEX IF NOT EXISTS accounts_username_idx ON known_accounts (username);

CREATE TABLE IF NOT EXISTS exclusions (
    id             BIGSERIAL PRIMARY KEY,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    exclusion_type TEXT NOT NULL DEFAULT 'filter',
    conditions     JSONB NOT NULL DEFAULT '{}',
    enabled        BOOLEAN NOT NULL DEFAULT true,
    scope          TEXT NOT NULL DEFAULT 'global',
    created_by     TEXT NOT NULL DEFAULT '',
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS exclusions_enabled_idx ON exclusions (enabled);
CREATE INDEX IF NOT EXISTS exclusions_type_idx    ON exclusions (exclusion_type);
`,
		},
		{
			name: "002_users_api_keys_rules",
			sql: `
CREATE TABLE IF NOT EXISTS users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'analyst',
    allowed_agents TEXT[] NOT NULL DEFAULT '{}',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS users_username_idx ON users (username);

CREATE TABLE IF NOT EXISTS api_keys (
    id           BIGSERIAL PRIMARY KEY,
    name         TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    key_preview  TEXT NOT NULL,
    created_by   TEXT NOT NULL DEFAULT '',
    enabled      BOOLEAN NOT NULL DEFAULT true,
    last_used    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS api_keys_hash_idx    ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_enabled_idx ON api_keys (enabled);

CREATE TABLE IF NOT EXISTS correlation_rules (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    severity    TEXT NOT NULL DEFAULT 'medium',
    enabled     BOOLEAN NOT NULL DEFAULT true,
    sigma_rule  TEXT NOT NULL DEFAULT '',
    conditions  JSONB NOT NULL DEFAULT '{}',
    hit_count   BIGINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS corr_rules_enabled_idx  ON correlation_rules (enabled);
CREATE INDEX IF NOT EXISTS corr_rules_severity_idx ON correlation_rules (severity);

CREATE TABLE IF NOT EXISTS sigma_rules (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    rule_id       TEXT NOT NULL UNIQUE,
    title         TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    rule_yaml     TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT '',
    severity      TEXT NOT NULL DEFAULT 'medium',
    status        TEXT NOT NULL DEFAULT 'enabled',
    imported_from TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sigma_rules_category_idx ON sigma_rules (category);
CREATE INDEX IF NOT EXISTS sigma_rules_severity_idx ON sigma_rules (severity);
CREATE INDEX IF NOT EXISTS sigma_rules_status_idx   ON sigma_rules (status);

CREATE TABLE IF NOT EXISTS custom_fields (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    entity_type   TEXT NOT NULL DEFAULT 'incident_scenario',
    field_name    TEXT NOT NULL,
    field_type    TEXT NOT NULL DEFAULT 'text',
    field_label   TEXT NOT NULL,
    field_group   TEXT,
    options       JSONB NOT NULL DEFAULT '[]',
    default_value TEXT,
    required      BOOLEAN NOT NULL DEFAULT false,
    description   TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (entity_type, field_name)
);

CREATE TABLE IF NOT EXISTS incident_scenarios (
    id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name          TEXT NOT NULL,
    customer      TEXT,
    criticality   TEXT NOT NULL DEFAULT 'medium',
    description   TEXT NOT NULL DEFAULT '',
    template_data JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by    TEXT NOT NULL DEFAULT ''
);
`,
		},
	}

	for _, m := range migrations {
		if _, err := db.pool.Exec(ctx, m.sql); err != nil {
			slog.Error("migration failed", "name", m.name, "error", err)
			return err
		}
		slog.Info("migration applied", "name", m.name)
	}
	return nil
}
