package storage

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	pool *pgxpool.Pool
}

func NewDB(ctx context.Context, dsn string) (*DB, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	cfg.MaxConns = 20
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 30 * time.Minute
	cfg.HealthCheckPeriod = 1 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &DB{pool: pool}, nil
}

func (db *DB) Close() {
	db.pool.Close()
}

// LogEvent maps to the logs table row.
type LogEvent struct {
	ID        int64                  `json:"id"`
	EventID   string                 `json:"event_id"`
	Timestamp time.Time              `json:"timestamp"`
	Host      string                 `json:"host"`
	AgentID   string                 `json:"agent_id"`
	Source    string                 `json:"source"`
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Service   string                 `json:"service"`
	Meta      map[string]interface{} `json:"meta"`
}

// IngestLog is the raw payload from agents.
type IngestLog struct {
	EventID   string                 `json:"event_id"`
	Timestamp string                 `json:"timestamp"`
	Host      string                 `json:"host"`
	AgentID   string                 `json:"agent_id"`
	Source    string                 `json:"source"`
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Service   string                 `json:"service"`
	Meta      map[string]interface{} `json:"meta"`
}

// BulkIndex inserts a batch of log events, ignoring duplicates by event_id.
// Returns count of inserted rows and errors.
func (db *DB) BulkIndex(ctx context.Context, events []LogEvent) (inserted int, errors int) {
	batch := &pgx.Batch{}

	const q = `
		INSERT INTO logs (event_id, timestamp, host, agent_id, source, level, message, service, meta)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (event_id) DO NOTHING
	`

	for _, e := range events {
		batch.Queue(q,
			e.EventID, e.Timestamp, e.Host, e.AgentID,
			e.Source, e.Level, e.Message, e.Service, e.Meta,
		)
	}

	br := db.pool.SendBatch(ctx, batch)
	defer br.Close()

	for range events {
		_, err := br.Exec()
		if err != nil {
			errors++
		} else {
			inserted++
		}
	}
	return
}

// SearchParams holds full-text and filter parameters.
type SearchParams struct {
	Query   string
	Level   string
	AgentID string
	Service string
	Host    string
	Source  string
	From    time.Time
	To      time.Time
	Page    int
	Size    int
}

// Search runs a parameterized full-text + filter query.
func (db *DB) Search(ctx context.Context, p SearchParams) ([]LogEvent, int64, error) {
	if p.Size <= 0 || p.Size > 500 {
		p.Size = 50
	}
	if p.Page < 0 {
		p.Page = 0
	}

	args := []interface{}{}
	where := []string{}
	idx := 1

	if p.Query != "" {
		where = append(where, fmt.Sprintf("message ILIKE $%d", idx))
		args = append(args, "%"+p.Query+"%")
		idx++
	}
	if p.Level != "" {
		where = append(where, fmt.Sprintf("level = $%d", idx))
		args = append(args, p.Level)
		idx++
	}
	if p.AgentID != "" {
		where = append(where, fmt.Sprintf("agent_id = $%d", idx))
		args = append(args, p.AgentID)
		idx++
	}
	if p.Service != "" {
		where = append(where, fmt.Sprintf("service = $%d", idx))
		args = append(args, p.Service)
		idx++
	}
	if p.Host != "" {
		where = append(where, fmt.Sprintf("host = $%d", idx))
		args = append(args, p.Host)
		idx++
	}
	if !p.From.IsZero() {
		where = append(where, fmt.Sprintf("timestamp >= $%d", idx))
		args = append(args, p.From)
		idx++
	}
	if !p.To.IsZero() {
		where = append(where, fmt.Sprintf("timestamp <= $%d", idx))
		args = append(args, p.To)
		idx++
	}

	whereSql := ""
	if len(where) > 0 {
		whereSql = "WHERE " + joinWith(where, " AND ")
	}

	countSQL := fmt.Sprintf("SELECT COUNT(*) FROM logs %s", whereSql)
	var total int64
	if err := db.pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := p.Page * p.Size
	dataSQL := fmt.Sprintf(`
		SELECT id, event_id, timestamp, host, agent_id, source, level, message, service, meta
		FROM logs %s
		ORDER BY timestamp DESC
		LIMIT %d OFFSET %d
	`, whereSql, p.Size, offset)

	rows, err := db.pool.Query(ctx, dataSQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var results []LogEvent
	for rows.Next() {
		var e LogEvent
		if err := rows.Scan(
			&e.ID, &e.EventID, &e.Timestamp, &e.Host, &e.AgentID,
			&e.Source, &e.Level, &e.Message, &e.Service, &e.Meta,
		); err != nil {
			return nil, 0, err
		}
		results = append(results, e)
	}
	return results, total, nil
}

// ExecPDQL executes a pre-translated SQL query from the Rust PDQL engine.
func (db *DB) ExecPDQL(ctx context.Context, sql string, args []interface{}) ([]map[string]interface{}, error) {
	rows, err := db.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	fields := rows.FieldDescriptions()
	var results []map[string]interface{}

	for rows.Next() {
		vals, err := rows.Values()
		if err != nil {
			return nil, err
		}
		row := make(map[string]interface{}, len(fields))
		for i, f := range fields {
			row[string(f.Name)] = vals[i]
		}
		results = append(results, row)
	}
	return results, nil
}

// GetStats returns time-series aggregated stats.
type TimeBucket struct {
	Key      int64                    `json:"key"`
	DocCount int64                    `json:"doc_count"`
	ByLevel  []TermBucket             `json:"by_level,omitempty"`
}

type TermBucket struct {
	Key      string `json:"key"`
	DocCount int64  `json:"doc_count"`
}

type StatsResult struct {
	OverTime []TimeBucket `json:"over_time"`
	ByLevel  []TermBucket `json:"by_level"`
	ByHost   []TermBucket `json:"by_host"`
}

func (db *DB) GetStats(ctx context.Context, interval string, from, to time.Time) (*StatsResult, error) {
	step := intervalToStep(interval)

	// Time series
	tsSQL := fmt.Sprintf(`
		SELECT EXTRACT(EPOCH FROM date_bin('%s'::interval, timestamp, TIMESTAMP '1970-01-01')) * 1000 AS bucket,
		       COUNT(*) AS cnt
		FROM logs
		WHERE timestamp BETWEEN $1 AND $2
		GROUP BY bucket
		ORDER BY bucket ASC
	`, step)

	tsRows, err := db.pool.Query(ctx, tsSQL, from, to)
	if err != nil {
		return nil, err
	}
	defer tsRows.Close()

	var overTime []TimeBucket
	for tsRows.Next() {
		var b TimeBucket
		if err := tsRows.Scan(&b.Key, &b.DocCount); err != nil {
			return nil, err
		}
		overTime = append(overTime, b)
	}

	// By level
	lvlRows, err := db.pool.Query(ctx,
		`SELECT level, COUNT(*) FROM logs WHERE timestamp BETWEEN $1 AND $2 GROUP BY level ORDER BY COUNT(*) DESC`,
		from, to,
	)
	if err != nil {
		return nil, err
	}
	defer lvlRows.Close()

	var byLevel []TermBucket
	for lvlRows.Next() {
		var b TermBucket
		if err := lvlRows.Scan(&b.Key, &b.DocCount); err != nil {
			return nil, err
		}
		byLevel = append(byLevel, b)
	}

	// By host
	hostRows, err := db.pool.Query(ctx,
		`SELECT host, COUNT(*) FROM logs WHERE timestamp BETWEEN $1 AND $2 GROUP BY host ORDER BY COUNT(*) DESC LIMIT 10`,
		from, to,
	)
	if err != nil {
		return nil, err
	}
	defer hostRows.Close()

	var byHost []TermBucket
	for hostRows.Next() {
		var b TermBucket
		if err := hostRows.Scan(&b.Key, &b.DocCount); err != nil {
			return nil, err
		}
		byHost = append(byHost, b)
	}

	return &StatsResult{
		OverTime: overTime,
		ByLevel:  byLevel,
		ByHost:   byHost,
	}, nil
}

func intervalToStep(interval string) string {
	switch interval {
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
	case "30d":
		return "30 days"
	default:
		return "1 hour"
	}
}

func joinWith(parts []string, sep string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
	}
	return result
}

// AgentSummary holds per-agent aggregated stats.
type AgentSummary struct {
	AgentID    string    `json:"agent_id"`
	Host       string    `json:"host"`
	LastSeen   time.Time `json:"last_seen"`
	EventCount int64     `json:"event_count"`
	Status     string    `json:"status"`
}

// QueryAgents returns per-agent summary derived from the logs table.
func (db *DB) QueryAgents(ctx context.Context) ([]AgentSummary, error) {
	rows, err := db.pool.Query(ctx, `
		SELECT agent_id,
		       MAX(host)      AS host,
		       MAX(timestamp) AS last_seen,
		       COUNT(*)       AS event_count
		FROM logs
		GROUP BY agent_id
		ORDER BY last_seen DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	threshold := time.Now().Add(-5 * time.Minute)
	var agents []AgentSummary
	for rows.Next() {
		var a AgentSummary
		if err := rows.Scan(&a.AgentID, &a.Host, &a.LastSeen, &a.EventCount); err != nil {
			return nil, err
		}
		if a.LastSeen.After(threshold) {
			a.Status = "online"
		} else {
			a.Status = "offline"
		}
		agents = append(agents, a)
	}
	return agents, nil
}

// QueryDistinct returns sorted distinct values for the given column.
func (db *DB) QueryDistinct(ctx context.Context, column string) ([]string, error) {
	// column is internal and not user-supplied, so direct formatting is safe here.
	rows, err := db.pool.Query(ctx, fmt.Sprintf(
		"SELECT DISTINCT %s FROM logs WHERE %s IS NOT NULL AND %s != '' ORDER BY %s LIMIT 500",
		column, column, column, column,
	))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var values []string
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			return nil, err
		}
		values = append(values, v)
	}
	return values, nil
}

// CorrelationAlert represents a triggered correlation rule alert.
type CorrelationAlert struct {
	ID        string    `json:"id"`
	RuleID    string    `json:"rule_id"`
	RuleName  string    `json:"rule_name"`
	Severity  string    `json:"severity"`
	Status    string    `json:"status"`
	Host      string    `json:"host"`
	AgentID   string    `json:"agent_id"`
	Note      string    `json:"note"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	UpdatedBy string    `json:"updated_by"`
}

// GetCorrelationAlerts fetches alerts, optionally filtered by status.
func (db *DB) GetCorrelationAlerts(ctx context.Context, status string) ([]CorrelationAlert, error) {
	q := `SELECT id, rule_id, rule_name, severity, status, host, agent_id, note, created_at, updated_at, updated_by
	      FROM correlation_alerts`
	args := []interface{}{}
	if status != "" {
		q += " WHERE status = $1"
		args = append(args, status)
	}
	q += " ORDER BY created_at DESC LIMIT 500"

	rows, err := db.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var alerts []CorrelationAlert
	for rows.Next() {
		var a CorrelationAlert
		if err := rows.Scan(
			&a.ID, &a.RuleID, &a.RuleName, &a.Severity, &a.Status,
			&a.Host, &a.AgentID, &a.Note, &a.CreatedAt, &a.UpdatedAt, &a.UpdatedBy,
		); err != nil {
			return nil, err
		}
		alerts = append(alerts, a)
	}
	return alerts, nil
}

// UpdateAlertStatus changes the status and optional note on an alert.
func (db *DB) UpdateAlertStatus(ctx context.Context, id, status, note, updatedBy string) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE correlation_alerts SET status=$1, note=$2, updated_by=$3, updated_at=NOW() WHERE id=$4`,
		status, note, updatedBy, id,
	)
	return err
}

// Asset represents a network asset derived from log metadata.
type Asset struct {
	Host      string    `json:"host"`
	IP        string    `json:"ip"`
	AgentID   string    `json:"agent_id"`
	LastSeen  time.Time `json:"last_seen"`
	EventCount int64   `json:"event_count"`
}

// QueryAssets returns distinct hosts and their metadata from logs.
func (db *DB) QueryAssets(ctx context.Context) ([]Asset, error) {
	rows, err := db.pool.Query(ctx, `
		SELECT host,
		       COALESCE(meta->>'src.ip', '') AS ip,
		       agent_id,
		       MAX(timestamp) AS last_seen,
		       COUNT(*)       AS event_count
		FROM logs
		WHERE host IS NOT NULL AND host != ''
		GROUP BY host, meta->>'src.ip', agent_id
		ORDER BY last_seen DESC
		LIMIT 1000
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var assets []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.Host, &a.IP, &a.AgentID, &a.LastSeen, &a.EventCount); err != nil {
			return nil, err
		}
		assets = append(assets, a)
	}
	return assets, nil
}
