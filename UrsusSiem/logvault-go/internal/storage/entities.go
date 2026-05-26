package storage

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// ─────────────────────────────────────────────────────────────────────────────
// KnownAccount
// ─────────────────────────────────────────────────────────────────────────────

type KnownAccount struct {
	ID               int       `json:"id"`
	Username         string    `json:"username"`
	Domain           string    `json:"domain"`
	DisplayName      *string   `json:"display_name,omitempty"`
	Email            *string   `json:"email,omitempty"`
	Department       *string   `json:"department,omitempty"`
	Role             *string   `json:"role,omitempty"`
	RiskLevel        string    `json:"risk_level"`
	IsServiceAccount bool      `json:"is_service_account"`
	IsPrivileged     bool      `json:"is_privileged"`
	Notes            *string   `json:"notes,omitempty"`
	FirstSeen        time.Time `json:"first_seen"`
	LastSeen         time.Time `json:"last_seen"`
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

type AccountListResult struct {
	Total    int            `json:"total"`
	Accounts []KnownAccount `json:"accounts"`
}

func (db *DB) ListAccounts(ctx context.Context, search, riskLevel string, limit, offset int) (*AccountListResult, error) {
	where := []string{"1=1"}
	args := []any{}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		where = append(where, "(LOWER(username) LIKE $"+itoa(len(args))+" OR LOWER(COALESCE(display_name,'')) LIKE $"+itoa(len(args))+")")
	}
	if riskLevel != "" {
		args = append(args, riskLevel)
		where = append(where, "risk_level = $"+itoa(len(args)))
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := db.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM known_accounts WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	args = append(args, limit, offset)
	rows, err := db.pool.Query(ctx,
		`SELECT id, username, domain, display_name, email, department, role, risk_level,
		        is_service_account, is_privileged, notes,
		        first_seen, last_seen, created_at, updated_at
		 FROM known_accounts WHERE `+whereSQL+
			` ORDER BY last_seen DESC LIMIT $`+itoa(len(args)-1)+` OFFSET $`+itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []KnownAccount
	for rows.Next() {
		var a KnownAccount
		if err := rows.Scan(&a.ID, &a.Username, &a.Domain, &a.DisplayName, &a.Email,
			&a.Department, &a.Role, &a.RiskLevel, &a.IsServiceAccount, &a.IsPrivileged,
			&a.Notes, &a.FirstSeen, &a.LastSeen, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return &AccountListResult{Total: total, Accounts: out}, rows.Err()
}

func (db *DB) CreateAccount(ctx context.Context, a KnownAccount) (*KnownAccount, error) {
	row := db.pool.QueryRow(ctx,
		`INSERT INTO known_accounts (username, domain, display_name, email, department, role,
		                              risk_level, is_service_account, is_privileged, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, COALESCE(NULLIF($7,''),'normal'), $8, $9, $10)
		 ON CONFLICT (username, domain) DO UPDATE SET
		   display_name = EXCLUDED.display_name, email = EXCLUDED.email,
		   department = EXCLUDED.department, role = EXCLUDED.role,
		   risk_level = EXCLUDED.risk_level,
		   is_service_account = EXCLUDED.is_service_account,
		   is_privileged = EXCLUDED.is_privileged,
		   notes = EXCLUDED.notes, updated_at = NOW()
		 RETURNING id, username, domain, display_name, email, department, role, risk_level,
		           is_service_account, is_privileged, notes,
		           first_seen, last_seen, created_at, updated_at`,
		a.Username, a.Domain, a.DisplayName, a.Email, a.Department, a.Role, a.RiskLevel,
		a.IsServiceAccount, a.IsPrivileged, a.Notes)
	var out KnownAccount
	if err := row.Scan(&out.ID, &out.Username, &out.Domain, &out.DisplayName, &out.Email,
		&out.Department, &out.Role, &out.RiskLevel, &out.IsServiceAccount, &out.IsPrivileged,
		&out.Notes, &out.FirstSeen, &out.LastSeen, &out.CreatedAt, &out.UpdatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

func (db *DB) UpdateAccount(ctx context.Context, id int, a KnownAccount) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE known_accounts SET username=$2, domain=$3, display_name=$4, email=$5,
		   department=$6, role=$7, risk_level=$8, is_service_account=$9, is_privileged=$10,
		   notes=$11, updated_at=NOW()
		 WHERE id=$1`,
		id, a.Username, a.Domain, a.DisplayName, a.Email, a.Department, a.Role,
		a.RiskLevel, a.IsServiceAccount, a.IsPrivileged, a.Notes)
	return err
}

func (db *DB) DeleteAccount(ctx context.Context, id int) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM known_accounts WHERE id = $1`, id)
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// Exclusion
// ─────────────────────────────────────────────────────────────────────────────

type Exclusion struct {
	ID            int             `json:"id"`
	Name          string          `json:"name"`
	Description   *string         `json:"description,omitempty"`
	ExclusionType string          `json:"exclusion_type"`
	Conditions    json.RawMessage `json:"conditions"`
	Enabled       bool            `json:"enabled"`
	Scope         string          `json:"scope"`
	CreatedBy     *string         `json:"created_by,omitempty"`
	ExpiresAt     *time.Time      `json:"expires_at,omitempty"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

type ExclusionListResult struct {
	Total      int         `json:"total"`
	Exclusions []Exclusion `json:"exclusions"`
}

func (db *DB) ListExclusions(ctx context.Context, search, scope string, enabled *bool, limit, offset int) (*ExclusionListResult, error) {
	where := []string{"1=1"}
	args := []any{}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		where = append(where, "LOWER(name) LIKE $"+itoa(len(args)))
	}
	if scope != "" {
		args = append(args, scope)
		where = append(where, "scope = $"+itoa(len(args)))
	}
	if enabled != nil {
		args = append(args, *enabled)
		where = append(where, "enabled = $"+itoa(len(args)))
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := db.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM exclusions WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	args = append(args, limit, offset)
	rows, err := db.pool.Query(ctx,
		`SELECT id, name, description, exclusion_type, conditions, enabled, scope,
		        created_by, expires_at, created_at, updated_at
		 FROM exclusions WHERE `+whereSQL+
			` ORDER BY created_at DESC LIMIT $`+itoa(len(args)-1)+` OFFSET $`+itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Exclusion
	for rows.Next() {
		var e Exclusion
		if err := rows.Scan(&e.ID, &e.Name, &e.Description, &e.ExclusionType, &e.Conditions,
			&e.Enabled, &e.Scope, &e.CreatedBy, &e.ExpiresAt, &e.CreatedAt, &e.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return &ExclusionListResult{Total: total, Exclusions: out}, rows.Err()
}

func (db *DB) CreateExclusion(ctx context.Context, e Exclusion) (*Exclusion, error) {
	if len(e.Conditions) == 0 {
		e.Conditions = json.RawMessage("{}")
	}
	row := db.pool.QueryRow(ctx,
		`INSERT INTO exclusions (name, description, exclusion_type, conditions, enabled, scope, created_by, expires_at)
		 VALUES ($1, $2, $3, $4, $5, COALESCE(NULLIF($6,''),'all'), $7, $8)
		 RETURNING id, name, description, exclusion_type, conditions, enabled, scope,
		           created_by, expires_at, created_at, updated_at`,
		e.Name, e.Description, e.ExclusionType, e.Conditions, e.Enabled, e.Scope, e.CreatedBy, e.ExpiresAt)
	var out Exclusion
	if err := row.Scan(&out.ID, &out.Name, &out.Description, &out.ExclusionType, &out.Conditions,
		&out.Enabled, &out.Scope, &out.CreatedBy, &out.ExpiresAt, &out.CreatedAt, &out.UpdatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

func (db *DB) UpdateExclusion(ctx context.Context, id int, e Exclusion) error {
	if len(e.Conditions) == 0 {
		e.Conditions = json.RawMessage("{}")
	}
	_, err := db.pool.Exec(ctx,
		`UPDATE exclusions SET name=$2, description=$3, exclusion_type=$4, conditions=$5,
		   enabled=$6, scope=$7, expires_at=$8, updated_at=NOW()
		 WHERE id=$1`,
		id, e.Name, e.Description, e.ExclusionType, e.Conditions, e.Enabled, e.Scope, e.ExpiresAt)
	return err
}

func (db *DB) DeleteExclusion(ctx context.Context, id int) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM exclusions WHERE id = $1`, id)
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// CorrelationRule (definitions, separate from triggered alerts)
// ─────────────────────────────────────────────────────────────────────────────

type CorrelationRule struct {
	ID          string          `json:"id"`
	Name        string          `json:"name"`
	Description *string         `json:"description,omitempty"`
	Severity    string          `json:"severity"`
	Enabled     bool            `json:"enabled"`
	Conditions  json.RawMessage `json:"conditions"`
	SigmaRule   string          `json:"sigma_rule"`
	HitCount    int             `json:"hit_count"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

func (db *DB) ListCorrelationRules(ctx context.Context) ([]CorrelationRule, error) {
	rows, err := db.pool.Query(ctx,
		`SELECT id, name, description, severity, enabled, conditions, sigma_rule, hit_count, created_at, updated_at
		 FROM correlation_rules ORDER BY updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CorrelationRule
	for rows.Next() {
		var r CorrelationRule
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.Severity, &r.Enabled,
			&r.Conditions, &r.SigmaRule, &r.HitCount, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (db *DB) UpsertCorrelationRule(ctx context.Context, r CorrelationRule) (*CorrelationRule, error) {
	if len(r.Conditions) == 0 {
		r.Conditions = json.RawMessage("{}")
	}
	row := db.pool.QueryRow(ctx,
		`INSERT INTO correlation_rules (id, name, description, severity, enabled, conditions, sigma_rule)
		 VALUES ($1, $2, $3, COALESCE(NULLIF($4,''),'medium'), $5, $6, $7)
		 ON CONFLICT (id) DO UPDATE SET
		   name=EXCLUDED.name, description=EXCLUDED.description, severity=EXCLUDED.severity,
		   enabled=EXCLUDED.enabled, conditions=EXCLUDED.conditions, sigma_rule=EXCLUDED.sigma_rule,
		   updated_at=NOW()
		 RETURNING id, name, description, severity, enabled, conditions, sigma_rule, hit_count, created_at, updated_at`,
		r.ID, r.Name, r.Description, r.Severity, r.Enabled, r.Conditions, r.SigmaRule)
	var out CorrelationRule
	if err := row.Scan(&out.ID, &out.Name, &out.Description, &out.Severity, &out.Enabled,
		&out.Conditions, &out.SigmaRule, &out.HitCount, &out.CreatedAt, &out.UpdatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

func (db *DB) DeleteCorrelationRule(ctx context.Context, id string) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM correlation_rules WHERE id = $1`, id)
	return err
}

func (db *DB) DeleteCorrelationAlert(ctx context.Context, id string) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM correlation_alerts WHERE id = $1`, id)
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// APIKey (managed keys, separate from static API_KEYS env var)
// ─────────────────────────────────────────────────────────────────────────────

type APIKey struct {
	ID        int        `json:"id"`
	Name      string     `json:"name"`
	KeyValue  string     `json:"key_value"`
	CreatedBy string     `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	LastUsed  *time.Time `json:"last_used,omitempty"`
	Enabled   bool       `json:"enabled"`
}

func (db *DB) ListAPIKeys(ctx context.Context) ([]APIKey, error) {
	rows, err := db.pool.Query(ctx,
		`SELECT id, name, key_value, created_by, created_at, last_used, enabled
		 FROM api_keys ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []APIKey
	for rows.Next() {
		var k APIKey
		if err := rows.Scan(&k.ID, &k.Name, &k.KeyValue, &k.CreatedBy, &k.CreatedAt, &k.LastUsed, &k.Enabled); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (db *DB) CreateAPIKey(ctx context.Context, name, keyValue, createdBy string) (*APIKey, error) {
	row := db.pool.QueryRow(ctx,
		`INSERT INTO api_keys (name, key_value, created_by)
		 VALUES ($1, $2, $3)
		 RETURNING id, name, key_value, created_by, created_at, last_used, enabled`,
		name, keyValue, createdBy)
	var k APIKey
	if err := row.Scan(&k.ID, &k.Name, &k.KeyValue, &k.CreatedBy, &k.CreatedAt, &k.LastUsed, &k.Enabled); err != nil {
		return nil, err
	}
	return &k, nil
}

func (db *DB) SetAPIKeyEnabled(ctx context.Context, id int, enabled bool) error {
	_, err := db.pool.Exec(ctx, `UPDATE api_keys SET enabled = $1 WHERE id = $2`, enabled, id)
	return err
}

func (db *DB) DeleteAPIKey(ctx context.Context, id int) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM api_keys WHERE id = $1`, id)
	return err
}

func (db *DB) IsAPIKeyValid(ctx context.Context, key string) (bool, error) {
	var ok bool
	row := db.pool.QueryRow(ctx,
		`SELECT enabled FROM api_keys WHERE key_value = $1`, key)
	if err := row.Scan(&ok); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return ok, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Integration sync log
// ─────────────────────────────────────────────────────────────────────────────

type SyncLog struct {
	ID           int        `json:"id"`
	Integration  string     `json:"integration"`
	StartedAt    time.Time  `json:"started_at"`
	FinishedAt   *time.Time `json:"finished_at,omitempty"`
	Status       string     `json:"status"`
	EventsPulled int        `json:"events_pulled"`
	ErrorMessage *string    `json:"error_message,omitempty"`
}

func (db *DB) ListSyncLog(ctx context.Context, integration string, limit int) ([]SyncLog, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	args := []any{}
	q := `SELECT id, integration, started_at, finished_at, status, events_pulled, error_message
	      FROM integration_sync_log WHERE 1=1`
	if integration != "" {
		args = append(args, integration)
		q += " AND integration = $" + itoa(len(args))
	}
	args = append(args, limit)
	q += " ORDER BY started_at DESC LIMIT $" + itoa(len(args))

	rows, err := db.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SyncLog
	for rows.Next() {
		var s SyncLog
		if err := rows.Scan(&s.ID, &s.Integration, &s.StartedAt, &s.FinishedAt, &s.Status,
			&s.EventsPulled, &s.ErrorMessage); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (db *DB) SyncStats(ctx context.Context) (map[string]any, error) {
	rows, err := db.pool.Query(ctx, `
		SELECT integration,
		       COUNT(*) FILTER (WHERE status = 'ok') AS ok_count,
		       COUNT(*) FILTER (WHERE status = 'error') AS error_count,
		       COALESCE(SUM(events_pulled), 0) AS total_events,
		       MAX(started_at) AS last_run
		FROM integration_sync_log
		GROUP BY integration`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]any{}
	for rows.Next() {
		var integration string
		var okCount, errorCount int
		var totalEvents int64
		var lastRun *time.Time
		if err := rows.Scan(&integration, &okCount, &errorCount, &totalEvents, &lastRun); err != nil {
			return nil, err
		}
		result[integration] = map[string]any{
			"ok_count":     okCount,
			"error_count":  errorCount,
			"total_events": totalEvents,
			"last_run":     lastRun,
		}
	}
	return result, rows.Err()
}

func (db *DB) RecordSyncRun(ctx context.Context, integration, status string, eventsPulled int, errMsg string) error {
	var errPtr *string
	if errMsg != "" {
		errPtr = &errMsg
	}
	_, err := db.pool.Exec(ctx,
		`INSERT INTO integration_sync_log (integration, finished_at, status, events_pulled, error_message)
		 VALUES ($1, NOW(), $2, $3, $4)`,
		integration, status, eventsPulled, errPtr)
	return err
}

// ─────────────────────────────────────────────────────────────────────────────
// System health: simple counters across tables
// ─────────────────────────────────────────────────────────────────────────────

func (db *DB) SystemHealth(ctx context.Context) (map[string]any, error) {
	counts := map[string]int{}
	for _, t := range []string{"logs", "correlation_alerts", "sigma_rules", "incident_scenarios", "assets", "known_accounts", "exclusions", "api_keys", "users"} {
		var n int
		if err := db.pool.QueryRow(ctx,
			`SELECT COUNT(*) FROM `+t).Scan(&n); err != nil {
			n = -1
		}
		counts[t] = n
	}
	var dbSize string
	_ = db.pool.QueryRow(ctx,
		`SELECT pg_size_pretty(pg_database_size(current_database()))`).Scan(&dbSize)
	return map[string]any{
		"counts":  counts,
		"db_size": dbSize,
		"ts":      time.Now().UTC(),
	}, nil
}
