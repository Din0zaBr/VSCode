-- Users table for authentication
CREATE TABLE IF NOT EXISTS users (
    id           BIGSERIAL   PRIMARY KEY,
    username     TEXT        NOT NULL UNIQUE,
    password_hash TEXT       NOT NULL,
    role         TEXT        NOT NULL DEFAULT 'analyst',  -- admin | analyst | viewer
    allowed_agents TEXT[]    NOT NULL DEFAULT '{}',
    is_active    BOOLEAN     NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_username_idx ON users (username);

-- API keys for agent ingestion
CREATE TABLE IF NOT EXISTS api_keys (
    id           BIGSERIAL   PRIMARY KEY,
    name         TEXT        NOT NULL,
    key_hash     TEXT        NOT NULL UNIQUE,
    key_preview  TEXT        NOT NULL,
    created_by   TEXT        NOT NULL DEFAULT '',
    enabled      BOOLEAN     NOT NULL DEFAULT true,
    last_used    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_keys_hash_idx ON api_keys (key_hash);
CREATE INDEX IF NOT EXISTS api_keys_enabled_idx ON api_keys (enabled);

-- Correlation rules (PDQL-based detection rules)
CREATE TABLE IF NOT EXISTS correlation_rules (
    id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
    name        TEXT        NOT NULL,
    description TEXT        NOT NULL DEFAULT '',
    severity    TEXT        NOT NULL DEFAULT 'medium',
    enabled     BOOLEAN     NOT NULL DEFAULT true,
    sigma_rule  TEXT        NOT NULL DEFAULT '',
    conditions  JSONB       NOT NULL DEFAULT '{}',
    hit_count   BIGINT      NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS corr_rules_enabled_idx  ON correlation_rules (enabled);
CREATE INDEX IF NOT EXISTS corr_rules_severity_idx ON correlation_rules (severity);
