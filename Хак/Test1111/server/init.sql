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
