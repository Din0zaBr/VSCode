package storage

import (
	"context"
	"encoding/json"
	"time"
)

// CorrelationRule is a detection rule stored in the database.
type CorrelationRule struct {
	ID          string                 `json:"id"`
	Name        string                 `json:"name"`
	Description string                 `json:"description"`
	Severity    string                 `json:"severity"`
	Enabled     bool                   `json:"enabled"`
	SigmaRule   string                 `json:"sigma_rule"`
	Conditions  map[string]interface{} `json:"conditions"`
	HitCount    int64                  `json:"hit_count"`
	CreatedAt   time.Time              `json:"created_at"`
	UpdatedAt   time.Time              `json:"updated_at"`
}

func (db *DB) ListCorrelationRules(ctx context.Context) ([]CorrelationRule, error) {
	rows, err := db.pool.Query(ctx,
		`SELECT id, name, description, severity, enabled, sigma_rule, conditions, hit_count, created_at, updated_at
		 FROM correlation_rules ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []CorrelationRule
	for rows.Next() {
		var r CorrelationRule
		var condRaw []byte
		if err := rows.Scan(&r.ID, &r.Name, &r.Description, &r.Severity, &r.Enabled,
			&r.SigmaRule, &condRaw, &r.HitCount, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		if len(condRaw) > 0 {
			json.Unmarshal(condRaw, &r.Conditions)
		}
		rules = append(rules, r)
	}
	return rules, nil
}

func (db *DB) GetCorrelationRule(ctx context.Context, id string) (*CorrelationRule, error) {
	var r CorrelationRule
	var condRaw []byte
	err := db.pool.QueryRow(ctx,
		`SELECT id, name, description, severity, enabled, sigma_rule, conditions, hit_count, created_at, updated_at
		 FROM correlation_rules WHERE id = $1`,
		id,
	).Scan(&r.ID, &r.Name, &r.Description, &r.Severity, &r.Enabled,
		&r.SigmaRule, &condRaw, &r.HitCount, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if len(condRaw) > 0 {
		json.Unmarshal(condRaw, &r.Conditions)
	}
	return &r, nil
}

func (db *DB) CreateCorrelationRule(ctx context.Context, r *CorrelationRule) (*CorrelationRule, error) {
	condJSON, _ := json.Marshal(r.Conditions)
	var result CorrelationRule
	var condRaw []byte
	err := db.pool.QueryRow(ctx,
		`INSERT INTO correlation_rules (name, description, severity, enabled, sigma_rule, conditions)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id, name, description, severity, enabled, sigma_rule, conditions, hit_count, created_at, updated_at`,
		r.Name, r.Description, r.Severity, r.Enabled, r.SigmaRule, condJSON,
	).Scan(&result.ID, &result.Name, &result.Description, &result.Severity, &result.Enabled,
		&result.SigmaRule, &condRaw, &result.HitCount, &result.CreatedAt, &result.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if len(condRaw) > 0 {
		json.Unmarshal(condRaw, &result.Conditions)
	}
	return &result, nil
}

func (db *DB) UpdateCorrelationRule(ctx context.Context, id string, r *CorrelationRule) (*CorrelationRule, error) {
	condJSON, _ := json.Marshal(r.Conditions)
	var result CorrelationRule
	var condRaw []byte
	err := db.pool.QueryRow(ctx,
		`UPDATE correlation_rules
		 SET name=$1, description=$2, severity=$3, enabled=$4, sigma_rule=$5, conditions=$6, updated_at=NOW()
		 WHERE id=$7
		 RETURNING id, name, description, severity, enabled, sigma_rule, conditions, hit_count, created_at, updated_at`,
		r.Name, r.Description, r.Severity, r.Enabled, r.SigmaRule, condJSON, id,
	).Scan(&result.ID, &result.Name, &result.Description, &result.Severity, &result.Enabled,
		&result.SigmaRule, &condRaw, &result.HitCount, &result.CreatedAt, &result.UpdatedAt)
	if err != nil {
		return nil, err
	}
	if len(condRaw) > 0 {
		json.Unmarshal(condRaw, &result.Conditions)
	}
	return &result, nil
}

func (db *DB) DeleteCorrelationRule(ctx context.Context, id string) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM correlation_rules WHERE id = $1`, id)
	return err
}
