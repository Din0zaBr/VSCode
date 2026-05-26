-- Sprint 13: cloud connector state.

CREATE TABLE IF NOT EXISTS cloud_connectors (
    id            SERIAL       PRIMARY KEY,
    name          TEXT         UNIQUE NOT NULL,           -- "yc-prod", "aws-account-1"
    provider      TEXT         NOT NULL,                  -- yandex_cloud | aws_cloudtrail | …
    enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
    credentials   JSONB        NOT NULL DEFAULT '{}',     -- {"iam_token":..., "sa_key":...}
    options       JSONB        NOT NULL DEFAULT '{}',     -- {"log_group_id":..., "region":...}
    cursor        TEXT         NOT NULL DEFAULT '',       -- last successful checkpoint
    last_pull_at  TIMESTAMPTZ,
    last_count    INTEGER      NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
