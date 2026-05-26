//go:build duckdb

// DuckDB-backed implementation of LogRepo for the Micro tier.
//
// Build with:
//   CGO_ENABLED=1 go build -tags duckdb ./cmd/logvault-go
//
// Schema is created on first open. It mirrors the Postgres `logs` table
// closely but uses DuckDB-native types: TIMESTAMP, JSON, VARCHAR. We rely on
// DuckDB's columnar storage + bloom filters on (host, agent_id, level) for
// the hot search path.

package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "github.com/marcboeker/go-duckdb"
)

type DuckDB struct {
	db *sql.DB
	mu sync.Mutex // DuckDB allows only one writer at a time
}

func openDuckDB(ctx context.Context, cfg Config) (LogRepo, error) {
	path := cfg.DuckDBPath
	if path == "" {
		return nil, errors.New("duckdb backend requires DuckDBPath (set URSUS_DUCKDB_PATH)")
	}
	db, err := sql.Open("duckdb", path)
	if err != nil {
		return nil, fmt.Errorf("open duckdb %q: %w", path, err)
	}
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("duckdb ping: %w", err)
	}
	d := &DuckDB{db: db}
	if err := d.bootstrap(ctx); err != nil {
		_ = db.Close()
		return nil, err
	}
	return d, nil
}

func (d *DuckDB) Backend() string { return "duckdb" }
func (d *DuckDB) Close()           { _ = d.db.Close() }

// bootstrap creates the schema. DuckDB CREATE TABLE IF NOT EXISTS is
// idempotent so this runs safely on every start.
func (d *DuckDB) bootstrap(ctx context.Context) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS logs (
			id          BIGINT,
			event_id    VARCHAR PRIMARY KEY,
			timestamp   TIMESTAMP,
			host        VARCHAR,
			agent_id    VARCHAR,
			source      VARCHAR,
			level       VARCHAR,
			message     VARCHAR,
			service     VARCHAR,
			meta        JSON
		)`,
		`CREATE SEQUENCE IF NOT EXISTS logs_id_seq START 1`,
		`CREATE INDEX IF NOT EXISTS logs_ts_idx       ON logs (timestamp)`,
		`CREATE INDEX IF NOT EXISTS logs_host_idx     ON logs (host)`,
		`CREATE INDEX IF NOT EXISTS logs_agent_idx    ON logs (agent_id)`,
		`CREATE INDEX IF NOT EXISTS logs_level_idx    ON logs (level)`,
	}
	for _, s := range stmts {
		if _, err := d.db.ExecContext(ctx, s); err != nil {
			return fmt.Errorf("duckdb bootstrap %q: %w", s, err)
		}
	}
	return nil
}

// ─────────────────────────────────────────────────────────────────────────
// LogRepo implementation
// ─────────────────────────────────────────────────────────────────────────

func (d *DuckDB) BulkIndex(ctx context.Context, events []LogEvent) (inserted, errs int) {
	if len(events) == 0 {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()

	tx, err := d.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, len(events)
	}
	stmt, err := tx.PrepareContext(ctx,
		`INSERT INTO logs (id, event_id, timestamp, host, agent_id, source, level, message, service, meta)
		 VALUES (nextval('logs_id_seq'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (event_id) DO NOTHING`)
	if err != nil {
		_ = tx.Rollback()
		return 0, len(events)
	}
	defer stmt.Close()

	for _, e := range events {
		meta, _ := json.Marshal(e.Meta)
		if _, err := stmt.ExecContext(ctx,
			e.EventID, e.Timestamp, e.Host, e.AgentID, e.Source,
			e.Level, e.Message, e.Service, string(meta)); err != nil {
			errs++
			continue
		}
		inserted++
	}
	if err := tx.Commit(); err != nil {
		return 0, len(events)
	}
	return
}

func (d *DuckDB) Search(ctx context.Context, p SearchParams) ([]LogEvent, int64, error) {
	if p.Size <= 0 || p.Size > 500 {
		p.Size = 50
	}
	if p.Page < 0 {
		p.Page = 0
	}
	where := []string{"1=1"}
	args := []any{}
	add := func(cond string, v any) {
		args = append(args, v)
		where = append(where, strings.Replace(cond, "?", "?", 1))
	}
	if p.Query != "" {
		add("message ILIKE ?", "%"+p.Query+"%")
	}
	if p.Level != "" {
		add("level = ?", p.Level)
	}
	if p.AgentID != "" {
		add("agent_id = ?", p.AgentID)
	}
	if p.Service != "" {
		add("service = ?", p.Service)
	}
	if p.Host != "" {
		add("host = ?", p.Host)
	}
	if !p.From.IsZero() {
		add("timestamp >= ?", p.From)
	}
	if !p.To.IsZero() {
		add("timestamp <= ?", p.To)
	}
	whereSQL := strings.Join(where, " AND ")

	var total int64
	if err := d.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM logs WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, p.Size, p.Page*p.Size)
	rows, err := d.db.QueryContext(ctx,
		`SELECT id, event_id, timestamp, host, agent_id, source, level, message, service, meta
		   FROM logs WHERE `+whereSQL+`
		   ORDER BY timestamp DESC
		   LIMIT ? OFFSET ?`, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []LogEvent
	for rows.Next() {
		var e LogEvent
		var metaStr string
		if err := rows.Scan(&e.ID, &e.EventID, &e.Timestamp, &e.Host, &e.AgentID,
			&e.Source, &e.Level, &e.Message, &e.Service, &metaStr); err != nil {
			return nil, 0, err
		}
		if metaStr != "" {
			_ = json.Unmarshal([]byte(metaStr), &e.Meta)
		}
		out = append(out, e)
	}
	return out, total, rows.Err()
}

func (d *DuckDB) ExecPDQL(ctx context.Context, query string, args []interface{}) ([]map[string]interface{}, error) {
	// PDQL transpiler emits Postgres dialect by default; for DuckDB it has
	// to be configured to emit a compatible dialect (Sprint 2). For now we
	// run the SQL as-is — almost all of it works in DuckDB unchanged.
	rows, err := d.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	out := []map[string]interface{}{}
	for rows.Next() {
		vals := make([]interface{}, len(cols))
		ptrs := make([]interface{}, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(map[string]interface{}, len(cols))
		for i, c := range cols {
			row[c] = vals[i]
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func (d *DuckDB) GetStats(ctx context.Context, interval string, from, to time.Time) (*StatsResult, error) {
	bucket := durationFromInterval(interval)
	res := &StatsResult{}

	// Time series
	tsRows, err := d.db.QueryContext(ctx, `
		SELECT (epoch_ms(time_bucket(INTERVAL `+quoteStr(bucket)+`, timestamp))) AS bucket,
		       COUNT(*) AS n
		FROM logs
		WHERE timestamp BETWEEN ? AND ?
		GROUP BY bucket
		ORDER BY bucket ASC`, from, to)
	if err != nil {
		return nil, err
	}
	for tsRows.Next() {
		var b TimeBucket
		if err := tsRows.Scan(&b.Key, &b.DocCount); err != nil {
			tsRows.Close()
			return nil, err
		}
		res.OverTime = append(res.OverTime, b)
	}
	tsRows.Close()

	// By level
	lvlRows, err := d.db.QueryContext(ctx,
		`SELECT level, COUNT(*) AS n FROM logs WHERE timestamp BETWEEN ? AND ? GROUP BY level ORDER BY n DESC`,
		from, to)
	if err != nil {
		return nil, err
	}
	for lvlRows.Next() {
		var b TermBucket
		if err := lvlRows.Scan(&b.Key, &b.DocCount); err == nil {
			res.ByLevel = append(res.ByLevel, b)
		}
	}
	lvlRows.Close()

	// By host
	hostRows, err := d.db.QueryContext(ctx,
		`SELECT host, COUNT(*) AS n FROM logs WHERE timestamp BETWEEN ? AND ? AND host <> '' GROUP BY host ORDER BY n DESC LIMIT 20`,
		from, to)
	if err != nil {
		return nil, err
	}
	defer hostRows.Close()
	for hostRows.Next() {
		var b TermBucket
		if err := hostRows.Scan(&b.Key, &b.DocCount); err == nil {
			res.ByHost = append(res.ByHost, b)
		}
	}
	return res, nil
}

// quoteStr is used because DuckDB's INTERVAL literal is a string and
// can't be bound as a regular parameter in some driver versions.
func quoteStr(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func (d *DuckDB) RecentEvents(ctx context.Context, since time.Time, limit int) ([]LogEvent, error) {
	if limit <= 0 {
		limit = 50000
	}
	rows, err := d.db.QueryContext(ctx, `
		SELECT id, event_id, timestamp, host, agent_id, source, level, message, service, meta
		FROM logs
		WHERE timestamp >= ?
		ORDER BY timestamp ASC
		LIMIT ?`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LogEvent
	for rows.Next() {
		var e LogEvent
		var metaStr string
		if err := rows.Scan(&e.ID, &e.EventID, &e.Timestamp, &e.Host, &e.AgentID,
			&e.Source, &e.Level, &e.Message, &e.Service, &metaStr); err != nil {
			return nil, err
		}
		if metaStr != "" {
			_ = json.Unmarshal([]byte(metaStr), &e.Meta)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (d *DuckDB) QueryAgents(ctx context.Context) ([]AgentSummary, error) {
	rows, err := d.db.QueryContext(ctx, `
		SELECT
		  agent_id,
		  COALESCE(any_value(host), '') AS host,
		  MAX(timestamp)                AS last_seen,
		  COUNT(*)                      AS n
		FROM logs
		WHERE agent_id <> ''
		GROUP BY agent_id
		ORDER BY last_seen DESC
		LIMIT 1000`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AgentSummary
	for rows.Next() {
		var a AgentSummary
		if err := rows.Scan(&a.AgentID, &a.Host, &a.LastSeen, &a.EventCount); err != nil {
			return nil, err
		}
		// Heuristic: agent is "online" if last_seen is within 5 minutes
		if time.Since(a.LastSeen) < 5*time.Minute {
			a.Status = "online"
		} else {
			a.Status = "offline"
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (d *DuckDB) QueryHostsFromLogs(ctx context.Context) ([]HostSummary, error) {
	rows, err := d.db.QueryContext(ctx, `
		SELECT host,
		       COALESCE(json_extract_string(meta, '$.src.ip'), '') AS ip,
		       agent_id,
		       MAX(timestamp) AS last_seen,
		       COUNT(*)       AS n
		FROM logs
		WHERE host <> ''
		GROUP BY host, ip, agent_id
		ORDER BY last_seen DESC
		LIMIT 1000`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HostSummary
	for rows.Next() {
		var h HostSummary
		if err := rows.Scan(&h.Host, &h.IP, &h.AgentID, &h.LastSeen, &h.EventCount); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

func (d *DuckDB) QueryDistinct(ctx context.Context, column string) ([]string, error) {
	// whitelist to avoid SQL injection
	allowed := map[string]bool{"host": true, "agent_id": true, "level": true, "service": true, "source": true}
	if !allowed[column] {
		return nil, fmt.Errorf("column %q not allowed", column)
	}
	rows, err := d.db.QueryContext(ctx,
		`SELECT DISTINCT `+column+` FROM logs WHERE `+column+` <> '' ORDER BY 1 LIMIT 500`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err == nil {
			out = append(out, s)
		}
	}
	return out, rows.Err()
}

// durationFromInterval mirrors the helper in postgres.go so both backends
// accept the same stats?interval=... values.
func durationFromInterval(interval string) string {
	switch interval {
	case "1m":
		return "1 minute"
	case "5m":
		return "5 minutes"
	case "15m":
		return "15 minutes"
	case "30m":
		return "30 minutes"
	case "1h":
		return "1 hour"
	case "6h":
		return "6 hours"
	case "12h":
		return "12 hours"
	case "1d":
		return "1 day"
	case "7d":
		return "7 days"
	default:
		return "1 hour"
	}
}
