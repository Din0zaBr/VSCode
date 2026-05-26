package storage

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type SigmaRule struct {
	ID           string    `json:"id"`
	RuleID       string    `json:"rule_id"`
	Title        string    `json:"title"`
	Description  string    `json:"description"`
	RuleYAML     string    `json:"rule_yaml"`
	Category     string    `json:"category"`
	Severity     string    `json:"severity"`
	Status       string    `json:"status"`
	ImportedFrom *string   `json:"imported_from,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

func (db *DB) ListSigmaRules(ctx context.Context, category, severity, status string) ([]SigmaRule, error) {
	q := `SELECT id, rule_id, title, description, rule_yaml, category, severity, status,
	       imported_from, created_at, updated_at
	      FROM sigma_rules WHERE 1=1`
	args := []any{}
	if category != "" {
		args = append(args, category)
		q += " AND category = $" + itoa(len(args))
	}
	if severity != "" {
		args = append(args, severity)
		q += " AND severity = $" + itoa(len(args))
	}
	if status != "" {
		args = append(args, status)
		q += " AND status = $" + itoa(len(args))
	}
	q += " ORDER BY updated_at DESC"

	rows, err := db.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SigmaRule
	for rows.Next() {
		var s SigmaRule
		if err := rows.Scan(&s.ID, &s.RuleID, &s.Title, &s.Description, &s.RuleYAML,
			&s.Category, &s.Severity, &s.Status, &s.ImportedFrom, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (db *DB) GetSigmaRule(ctx context.Context, id string) (*SigmaRule, error) {
	row := db.pool.QueryRow(ctx,
		`SELECT id, rule_id, title, description, rule_yaml, category, severity, status,
		        imported_from, created_at, updated_at
		   FROM sigma_rules WHERE id = $1`, id)
	var s SigmaRule
	if err := row.Scan(&s.ID, &s.RuleID, &s.Title, &s.Description, &s.RuleYAML,
		&s.Category, &s.Severity, &s.Status, &s.ImportedFrom, &s.CreatedAt, &s.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

func (db *DB) UpsertSigmaRule(ctx context.Context, r SigmaRule) (*SigmaRule, error) {
	row := db.pool.QueryRow(ctx,
		`INSERT INTO sigma_rules (rule_id, title, description, rule_yaml, category, severity, status, imported_from)
		 VALUES ($1, $2, $3, $4, $5, $6, COALESCE(NULLIF($7, ''), 'enabled'), $8)
		 ON CONFLICT (rule_id) DO UPDATE SET
		   title = EXCLUDED.title,
		   description = EXCLUDED.description,
		   rule_yaml = EXCLUDED.rule_yaml,
		   category = EXCLUDED.category,
		   severity = EXCLUDED.severity,
		   status = EXCLUDED.status,
		   imported_from = EXCLUDED.imported_from,
		   updated_at = NOW()
		 RETURNING id, rule_id, title, description, rule_yaml, category, severity, status,
		           imported_from, created_at, updated_at`,
		r.RuleID, r.Title, r.Description, r.RuleYAML, r.Category, r.Severity, r.Status, r.ImportedFrom)
	var out SigmaRule
	if err := row.Scan(&out.ID, &out.RuleID, &out.Title, &out.Description, &out.RuleYAML,
		&out.Category, &out.Severity, &out.Status, &out.ImportedFrom, &out.CreatedAt, &out.UpdatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

func (db *DB) UpdateSigmaRuleByID(ctx context.Context, id string, r SigmaRule) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE sigma_rules
		    SET title = $2, description = $3, rule_yaml = $4, category = $5,
		        severity = $6, status = $7, updated_at = NOW()
		  WHERE id = $1`,
		id, r.Title, r.Description, r.RuleYAML, r.Category, r.Severity, r.Status)
	return err
}

func (db *DB) ToggleSigmaRule(ctx context.Context, id string, enabled bool) error {
	status := "disabled"
	if enabled {
		status = "enabled"
	}
	_, err := db.pool.Exec(ctx,
		`UPDATE sigma_rules SET status = $1, updated_at = NOW() WHERE id = $2`, status, id)
	return err
}

func (db *DB) DeleteSigmaRule(ctx context.Context, id string) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM sigma_rules WHERE id = $1`, id)
	return err
}

func (db *DB) SigmaRuleStats(ctx context.Context) (map[string]any, error) {
	row := db.pool.QueryRow(ctx, `
		SELECT
		  COUNT(*)                                       AS total,
		  COUNT(*) FILTER (WHERE status = 'enabled')     AS enabled,
		  COUNT(*) FILTER (WHERE status = 'disabled')    AS disabled,
		  COUNT(*) FILTER (WHERE severity = 'critical')  AS critical,
		  COUNT(*) FILTER (WHERE severity = 'high')      AS high,
		  COUNT(*) FILTER (WHERE severity = 'medium')    AS medium,
		  COUNT(*) FILTER (WHERE severity = 'low')       AS low
		FROM sigma_rules`)
	var total, enabled, disabled, critical, high, medium, low int
	if err := row.Scan(&total, &enabled, &disabled, &critical, &high, &medium, &low); err != nil {
		return nil, err
	}
	return map[string]any{
		"total":    total,
		"enabled":  enabled,
		"disabled": disabled,
		"by_severity": map[string]int{
			"critical": critical, "high": high, "medium": medium, "low": low,
		},
	}, nil
}
