package storage

import (
	"context"
	"encoding/json"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Baseline (anomaly_baseline table)
// ─────────────────────────────────────────────────────────────────────────────

type BaselineRow struct {
	ID          int       `json:"id"`
	ProfileKey  string    `json:"profile_key"`
	Metric      string    `json:"metric"`
	HourBucket  int16     `json:"hour_bucket"`
	MeanValue   float64   `json:"mean_value"`
	Stddev      float64   `json:"stddev"`
	SampleSize  int       `json:"sample_size"`
	ComputedAt  time.Time `json:"computed_at"`
}

func (db *DB) LoadBaseline(ctx context.Context) ([]BaselineRow, error) {
	rows, err := db.pool.Query(ctx, `
		SELECT id, profile_key, metric, hour_bucket, mean_value, stddev, sample_size, computed_at
		FROM anomaly_baseline`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []BaselineRow
	for rows.Next() {
		var r BaselineRow
		if err := rows.Scan(&r.ID, &r.ProfileKey, &r.Metric, &r.HourBucket,
			&r.MeanValue, &r.Stddev, &r.SampleSize, &r.ComputedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// ReplaceBaseline is run by the nightly job — wipes and reinserts the whole
// baseline atomically so the detector always sees a coherent snapshot.
func (db *DB) ReplaceBaseline(ctx context.Context, rows []BaselineRow) error {
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if _, err := tx.Exec(ctx, `TRUNCATE TABLE anomaly_baseline`); err != nil {
		return err
	}
	if len(rows) == 0 {
		return tx.Commit(ctx)
	}

	var sb strings.Builder
	sb.WriteString(`INSERT INTO anomaly_baseline
		(profile_key, metric, hour_bucket, mean_value, stddev, sample_size) VALUES `)
	args := make([]any, 0, len(rows)*6)
	for i, r := range rows {
		if i > 0 {
			sb.WriteString(",")
		}
		base := i * 6
		sb.WriteString("($" + itoa(base+1) + ",$" + itoa(base+2) + ",$" + itoa(base+3) +
			",$" + itoa(base+4) + ",$" + itoa(base+5) + ",$" + itoa(base+6) + ")")
		args = append(args, r.ProfileKey, r.Metric, r.HourBucket, r.MeanValue, r.Stddev, r.SampleSize)
	}
	if _, err := tx.Exec(ctx, sb.String(), args...); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerts (anomaly_alerts table)
// ─────────────────────────────────────────────────────────────────────────────

type AnomalyAlertRow struct {
	ID            int             `json:"id"`
	ProfileKey    string          `json:"profile_key"`
	Metric        string          `json:"metric"`
	Kind          string          `json:"kind"`
	Severity      string          `json:"severity"`
	CurrentValue  *float64        `json:"current_value,omitempty"`
	ExpectedValue *float64        `json:"expected_value,omitempty"`
	ZScore        *float64        `json:"z_score,omitempty"`
	Description   string          `json:"description"`
	DetectedAt    time.Time       `json:"detected_at"`
	WindowStart   *time.Time      `json:"window_start,omitempty"`
	WindowEnd     *time.Time      `json:"window_end,omitempty"`
	RelatedMeta   json.RawMessage `json:"related_meta"`
	Status        string          `json:"status"`
}

type AnomalyAlertInput struct {
	ProfileKey    string
	Metric        string
	Kind          string
	Severity      string
	CurrentValue  float64
	ExpectedValue float64
	ZScore        float64
	Description   string
	WindowStart   *time.Time
	WindowEnd     *time.Time
	RelatedMeta   json.RawMessage
}

func (db *DB) InsertAnomalyAlerts(ctx context.Context, alerts []AnomalyAlertInput) (int, error) {
	if len(alerts) == 0 {
		return 0, nil
	}
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	const q = `INSERT INTO anomaly_alerts
		(profile_key, metric, kind, severity, current_value, expected_value,
		 z_score, description, window_start, window_end, related_meta, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'open')`

	inserted := 0
	for _, a := range alerts {
		meta := a.RelatedMeta
		if len(meta) == 0 {
			meta = json.RawMessage("{}")
		}
		if _, err := tx.Exec(ctx, q,
			a.ProfileKey, a.Metric, a.Kind, a.Severity,
			a.CurrentValue, a.ExpectedValue, a.ZScore, a.Description,
			a.WindowStart, a.WindowEnd, meta); err != nil {
			return inserted, err
		}
		inserted++
	}
	return inserted, tx.Commit(ctx)
}

func (db *DB) ListAnomalyAlerts(ctx context.Context, status, kind string, limit int) ([]AnomalyAlertRow, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	where := []string{"1=1"}
	args := []any{}
	if status != "" {
		args = append(args, status)
		where = append(where, "status = $"+itoa(len(args)))
	}
	if kind != "" {
		args = append(args, kind)
		where = append(where, "kind = $"+itoa(len(args)))
	}
	args = append(args, limit)

	q := `SELECT id, profile_key, metric, kind, severity, current_value, expected_value,
	             z_score, description, detected_at, window_start, window_end, related_meta, status
	      FROM anomaly_alerts WHERE ` + strings.Join(where, " AND ") +
		` ORDER BY detected_at DESC LIMIT $` + itoa(len(args))

	rows, err := db.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []AnomalyAlertRow
	for rows.Next() {
		var r AnomalyAlertRow
		if err := rows.Scan(&r.ID, &r.ProfileKey, &r.Metric, &r.Kind, &r.Severity,
			&r.CurrentValue, &r.ExpectedValue, &r.ZScore, &r.Description, &r.DetectedAt,
			&r.WindowStart, &r.WindowEnd, &r.RelatedMeta, &r.Status); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (db *DB) UpdateAnomalyStatus(ctx context.Context, id int, status string) error {
	_, err := db.pool.Exec(ctx, `UPDATE anomaly_alerts SET status = $1 WHERE id = $2`, status, id)
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// Event pulls used by the scheduled jobs
// ─────────────────────────────────────────────────────────────────────────────

func (db *DB) RecentEvents(ctx context.Context, since time.Time, limit int) ([]LogEvent, error) {
	if limit <= 0 {
		limit = 50000
	}
	rows, err := db.pool.Query(ctx,
		`SELECT id, event_id, timestamp, host, agent_id, source, level, message, service, meta
		   FROM logs
		  WHERE timestamp >= $1
		  ORDER BY timestamp ASC
		  LIMIT $2`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LogEvent
	for rows.Next() {
		var e LogEvent
		if err := rows.Scan(&e.ID, &e.EventID, &e.Timestamp, &e.Host, &e.AgentID,
			&e.Source, &e.Level, &e.Message, &e.Service, &e.Meta); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
