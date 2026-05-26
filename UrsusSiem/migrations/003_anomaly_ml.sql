-- Classical ML tables: behavioural baselines and detected anomalies.
-- Designed for explainable detection — Z-scores, DGA scoring, beaconing
-- periodicity — no opaque models.

-- ── Behavioural baseline (mean / stddev per profile · metric · hour) ────────
CREATE TABLE IF NOT EXISTS anomaly_baseline (
    id           SERIAL      PRIMARY KEY,
    profile_key  TEXT        NOT NULL,   -- "user:ivanov", "host:web-01"
    metric       TEXT        NOT NULL,   -- "events_per_hour", "logins_per_hour", "data_out_mb"
    hour_bucket  SMALLINT    NOT NULL,   -- 0..23 (-1 = day-aggregate)
    mean_value   DOUBLE PRECISION NOT NULL,
    stddev       DOUBLE PRECISION NOT NULL,
    sample_size  INTEGER     NOT NULL,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (profile_key, metric, hour_bucket)
);

CREATE INDEX IF NOT EXISTS anomaly_baseline_profile_idx ON anomaly_baseline (profile_key);

-- ── Anomaly alerts (detector output) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id              SERIAL      PRIMARY KEY,
    profile_key     TEXT        NOT NULL,
    metric          TEXT        NOT NULL,
    kind            TEXT        NOT NULL,   -- spike | drop | rare_hour | dga | beaconing | impossible_travel
    severity        TEXT        NOT NULL DEFAULT 'medium',
    current_value   DOUBLE PRECISION,
    expected_value  DOUBLE PRECISION,
    z_score         DOUBLE PRECISION,
    description     TEXT        NOT NULL DEFAULT '',
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_start    TIMESTAMPTZ,
    window_end      TIMESTAMPTZ,
    related_meta    JSONB       NOT NULL DEFAULT '{}',
    status          TEXT        NOT NULL DEFAULT 'open'   -- open | acknowledged | resolved | false_positive
);

CREATE INDEX IF NOT EXISTS anomaly_alerts_detected_idx ON anomaly_alerts (detected_at DESC);
CREATE INDEX IF NOT EXISTS anomaly_alerts_status_idx   ON anomaly_alerts (status);
CREATE INDEX IF NOT EXISTS anomaly_alerts_kind_idx     ON anomaly_alerts (kind);
CREATE INDEX IF NOT EXISTS anomaly_alerts_profile_idx  ON anomaly_alerts (profile_key);
