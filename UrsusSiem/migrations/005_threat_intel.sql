-- Sprint 4: Threat Intel persistence (used by scheduler & UI listings).

CREATE TABLE IF NOT EXISTS ti_feeds (
    id           SERIAL      PRIMARY KEY,
    name         TEXT        UNIQUE NOT NULL,
    kind         TEXT        NOT NULL,            -- abusech_plain | abusech_csv | otx_pulse
    url          TEXT        NOT NULL,
    enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
    last_pull_at TIMESTAMPTZ,
    last_count   INTEGER     NOT NULL DEFAULT 0,
    last_error   TEXT
);

CREATE TABLE IF NOT EXISTS ti_indicators (
    id         BIGSERIAL    PRIMARY KEY,
    feed_id    INTEGER      NOT NULL REFERENCES ti_feeds(id) ON DELETE CASCADE,
    kind       TEXT         NOT NULL,            -- ip | url | domain | hash
    value      TEXT         NOT NULL,
    added_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (kind, value)
);

CREATE INDEX IF NOT EXISTS ti_indicators_kind_idx ON ti_indicators (kind);

-- Seed default feeds (free, no key required).
INSERT INTO ti_feeds (name, kind, url, enabled) VALUES
  ('abusech_feodo',     'abusech_plain', 'https://feodotracker.abuse.ch/downloads/ipblocklist.txt',  true),
  ('abusech_urlhaus',   'abusech_csv',   'https://urlhaus.abuse.ch/downloads/csv_recent/',           true),
  ('abusech_malware',   'abusech_csv',   'https://bazaar.abuse.ch/export/csv/recent/',               false)
ON CONFLICT (name) DO NOTHING;
