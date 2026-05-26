-- Second migration: tables previously served by the Python backend.
-- Runs automatically when PostgreSQL container initializes (after 001).

-- ── Users / RBAC ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL      PRIMARY KEY,
    username      TEXT        UNIQUE NOT NULL,
    password_hash TEXT        NOT NULL,
    role          TEXT        NOT NULL DEFAULT 'operator',  -- admin | operator
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_agents (
    id       SERIAL  PRIMARY KEY,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id TEXT    NOT NULL,
    UNIQUE (user_id, agent_id)
);

-- ── API keys ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS api_keys (
    id         SERIAL      PRIMARY KEY,
    name       TEXT        NOT NULL,
    key_value  TEXT        UNIQUE NOT NULL,
    created_by TEXT        NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used  TIMESTAMPTZ,
    enabled    BOOLEAN     NOT NULL DEFAULT TRUE
);

-- ── Assets (hosts) ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
    id          SERIAL      PRIMARY KEY,
    hostname    TEXT        UNIQUE NOT NULL,
    ip          TEXT,
    os          TEXT,
    department  TEXT,
    owner       TEXT,
    criticality TEXT        NOT NULL DEFAULT 'medium',
    tags        JSONB       NOT NULL DEFAULT '[]',
    notes       TEXT,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status      TEXT        NOT NULL DEFAULT 'active',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assets_hostname_idx    ON assets (hostname);
CREATE INDEX IF NOT EXISTS assets_criticality_idx ON assets (criticality);

-- ── Known accounts ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS known_accounts (
    id                 SERIAL      PRIMARY KEY,
    username           TEXT        NOT NULL,
    domain             TEXT        NOT NULL DEFAULT '',
    display_name       TEXT,
    email              TEXT,
    department         TEXT,
    role               TEXT,
    risk_level         TEXT        NOT NULL DEFAULT 'normal',
    is_service_account BOOLEAN     NOT NULL DEFAULT FALSE,
    is_privileged      BOOLEAN     NOT NULL DEFAULT FALSE,
    notes              TEXT,
    first_seen         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (username, domain)
);

-- ── Exclusions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exclusions (
    id             SERIAL      PRIMARY KEY,
    name           TEXT        NOT NULL,
    description    TEXT,
    exclusion_type TEXT        NOT NULL,
    conditions     JSONB       NOT NULL,
    enabled        BOOLEAN     NOT NULL DEFAULT TRUE,
    scope          TEXT        NOT NULL DEFAULT 'all',
    created_by     TEXT,
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Correlation rules (rule definitions, separate from alerts) ─────────────
CREATE TABLE IF NOT EXISTS correlation_rules (
    id          TEXT        PRIMARY KEY,
    name        TEXT        NOT NULL,
    description TEXT,
    severity    TEXT        NOT NULL DEFAULT 'medium',
    enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    conditions  JSONB       NOT NULL,
    sigma_rule  TEXT        NOT NULL DEFAULT '',
    hit_count   INTEGER     NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Integration sync log ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_sync_log (
    id            SERIAL      PRIMARY KEY,
    integration   TEXT        NOT NULL,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at   TIMESTAMPTZ,
    status        TEXT        NOT NULL DEFAULT 'running',   -- running | ok | error
    events_pulled INTEGER     NOT NULL DEFAULT 0,
    error_message TEXT,
    UNIQUE (id)
);

CREATE INDEX IF NOT EXISTS sync_log_integration_idx ON integration_sync_log (integration);
CREATE INDEX IF NOT EXISTS sync_log_started_idx     ON integration_sync_log (started_at DESC);
