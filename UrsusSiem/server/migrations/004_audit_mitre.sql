-- Sprint 3: audit trail (compliance-grade) and MITRE coverage cache.

-- ── Audit log — immutable; only INSERT allowed by application code ──────────
CREATE TABLE IF NOT EXISTS audit_log (
    id           BIGSERIAL    PRIMARY KEY,
    occurred_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    actor        TEXT         NOT NULL DEFAULT '',   -- username or "system"
    actor_ip     TEXT,
    action       TEXT         NOT NULL,              -- e.g. "rule.create"
    target_type  TEXT         NOT NULL,              -- "sigma_rule" | "user" | "scenario" | …
    target_id    TEXT,
    diff         JSONB        NOT NULL DEFAULT '{}', -- before/after fragments
    outcome      TEXT         NOT NULL DEFAULT 'ok', -- ok | denied | error
    notes        TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_occurred_idx ON audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_idx    ON audit_log (actor);
CREATE INDEX IF NOT EXISTS audit_log_action_idx   ON audit_log (action);

-- ── MITRE coverage cache (technique → rule_count) ──────────────────────────
CREATE TABLE IF NOT EXISTS mitre_coverage (
    technique_id  TEXT PRIMARY KEY,           -- e.g. T1059.001
    tactic        TEXT NOT NULL DEFAULT '',
    rule_count    INTEGER NOT NULL DEFAULT 0,
    enabled_count INTEGER NOT NULL DEFAULT 0,
    last_hit      TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
