CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS cleanup_log (
    id         SERIAL PRIMARY KEY,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION log_cleanup() RETURNS void AS $$
DECLARE
    msk_hour INTEGER;
    total_deleted INTEGER := 0;
    batch_deleted INTEGER;
BEGIN
    msk_hour := EXTRACT(HOUR FROM now() AT TIME ZONE 'Europe/Moscow');
    IF msk_hour >= 6 THEN
        RETURN;
    END IF;

    LOOP
        DELETE FROM logs
        WHERE id IN (
            SELECT id FROM logs
            WHERE timestamp < now() - INTERVAL '14 days'
            ORDER BY timestamp ASC
            LIMIT 5000
        );
        GET DIAGNOSTICS batch_deleted = ROW_COUNT;
        total_deleted := total_deleted + batch_deleted;
        EXIT WHEN batch_deleted < 5000;

        msk_hour := EXTRACT(HOUR FROM now() AT TIME ZONE 'Europe/Moscow');
        IF msk_hour >= 6 THEN
            EXIT;
        END IF;

        PERFORM pg_sleep(2);
    END LOOP;

    IF total_deleted > 0 THEN
        INSERT INTO cleanup_log (deleted) VALUES (total_deleted);
    END IF;
END;
$$ LANGUAGE plpgsql;

SELECT cron.schedule(
    'log-retention-14d',
    '*/5 0-2 * * *',
    $$SELECT log_cleanup()$$
);
