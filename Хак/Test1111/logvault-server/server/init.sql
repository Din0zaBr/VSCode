CREATE TABLE IF NOT EXISTS services (
    id   SERIAL PRIMARY KEY,
    name VARCHAR(128) UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS logs (
    id         BIGSERIAL PRIMARY KEY,
    event_id   VARCHAR(64) UNIQUE NOT NULL,
    timestamp  TIMESTAMPTZ NOT NULL DEFAULT now(),
    host       VARCHAR(255) NOT NULL DEFAULT '',
    agent_id   VARCHAR(128) NOT NULL DEFAULT '',
    source     VARCHAR(512) NOT NULL DEFAULT '',
    level      VARCHAR(16)  NOT NULL DEFAULT 'INFO',
    message    TEXT         NOT NULL DEFAULT '',
    service_id INTEGER      REFERENCES services(id),
    meta       JSONB        NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp  ON logs (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level      ON logs (level);
CREATE INDEX IF NOT EXISTS idx_logs_agent_id   ON logs (agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_service_id ON logs (service_id);
CREATE INDEX IF NOT EXISTS idx_logs_host       ON logs (host);
CREATE INDEX IF NOT EXISTS idx_logs_source     ON logs (source);
CREATE INDEX IF NOT EXISTS idx_logs_message_ft ON logs USING gin (to_tsvector('simple', message));
CREATE INDEX IF NOT EXISTS idx_logs_category   ON logs USING gin ((meta->'category'));

CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    username   VARCHAR(64) UNIQUE NOT NULL,
    password   VARCHAR(256) NOT NULL,
    role       VARCHAR(32) NOT NULL DEFAULT 'operator',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'role'
    ) THEN
        ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'operator';
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_agents (
    id       SERIAL PRIMARY KEY,
    user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id VARCHAR(128) NOT NULL,
    UNIQUE(user_id, agent_id)
);

-- ── Correlation rules ───────────��───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS correlation_rules (
    id          VARCHAR(64) PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    severity    VARCHAR(20) DEFAULT 'MEDIUM',
    enabled     BOOLEAN DEFAULT TRUE,
    conditions  JSONB NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    hit_count   INTEGER DEFAULT 0
);

-- ── Correlation alerts ──────────���───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS correlation_alerts (
    id          SERIAL PRIMARY KEY,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    rule_id     VARCHAR(64),
    rule_name   VARCHAR(255),
    severity    VARCHAR(20),
    status      VARCHAR(20) DEFAULT 'OPEN',
    source_ip   VARCHAR(45),
    description TEXT,
    event_ids   JSONB,
    notes       TEXT
);

CREATE INDEX IF NOT EXISTS idx_corr_alerts_status   ON correlation_alerts (status);
CREATE INDEX IF NOT EXISTS idx_corr_alerts_severity ON correlation_alerts (severity);
CREATE INDEX IF NOT EXISTS idx_corr_alerts_created  ON correlation_alerts (created_at DESC);

-- ── Assets (hosts) ─────────────────────────────���────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
    id          SERIAL PRIMARY KEY,
    hostname    VARCHAR(255) UNIQUE NOT NULL,
    ip          VARCHAR(45),
    os          VARCHAR(128),
    department  VARCHAR(128),
    owner       VARCHAR(128),
    criticality VARCHAR(20) DEFAULT 'MEDIUM',
    tags        JSONB DEFAULT '[]',
    notes       TEXT,
    first_seen  TIMESTAMPTZ DEFAULT NOW(),
    last_seen   TIMESTAMPTZ DEFAULT NOW(),
    status      VARCHAR(20) DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Known accounts ────���─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS known_accounts (
    id                 SERIAL PRIMARY KEY,
    username           VARCHAR(255) NOT NULL,
    domain             VARCHAR(255) DEFAULT '',
    display_name       VARCHAR(255),
    email              VARCHAR(255),
    department         VARCHAR(128),
    role               VARCHAR(128),
    risk_level         VARCHAR(20) DEFAULT 'NORMAL',
    is_service_account BOOLEAN DEFAULT FALSE,
    is_privileged      BOOLEAN DEFAULT FALSE,
    notes              TEXT,
    first_seen         TIMESTAMPTZ DEFAULT NOW(),
    last_seen          TIMESTAMPTZ DEFAULT NOW(),
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(username, domain)
);

-- ── Exclusions ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS exclusions (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    exclusion_type  VARCHAR(32) NOT NULL,
    conditions      JSONB NOT NULL,
    enabled         BOOLEAN DEFAULT TRUE,
    scope           VARCHAR(32) DEFAULT 'all',
    created_by      VARCHAR(64),
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
