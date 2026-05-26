-- Sprint 12: honeypot / canary tokens.
-- See PLAN_V2.md §25.2.

CREATE TABLE IF NOT EXISTS canaries (
    id          SERIAL      PRIMARY KEY,
    kind        TEXT        NOT NULL,                 -- file | ad_account | db_table | web_path
    name        TEXT        NOT NULL,                 -- "Пароли.xlsx", "backup_admin", …
    location    TEXT        NOT NULL,                 -- path / host / DB / URL
    host        TEXT,
    description TEXT,
    deployed_by TEXT        NOT NULL DEFAULT '',
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_check  TIMESTAMPTZ,
    enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    UNIQUE (kind, name, location)
);

CREATE TABLE IF NOT EXISTS canary_hits (
    id           BIGSERIAL    PRIMARY KEY,
    canary_id    INTEGER      NOT NULL REFERENCES canaries(id) ON DELETE CASCADE,
    hit_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actor        TEXT,                                  -- user, IP, process
    action       TEXT,                                  -- open, read, login_attempt
    source_event TEXT,                                  -- event_id from logs
    severity     TEXT         NOT NULL DEFAULT 'critical',
    notes        TEXT
);

CREATE INDEX IF NOT EXISTS canary_hits_canary_idx ON canary_hits (canary_id);
CREATE INDEX IF NOT EXISTS canary_hits_at_idx     ON canary_hits (hit_at DESC);
