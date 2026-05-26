package storage

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type Scenario struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Customer     *string         `json:"customer,omitempty"`
	Criticality  string          `json:"criticality"`
	Description  string          `json:"description"`
	TemplateData json.RawMessage `json:"template_data"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
	CreatedBy    string          `json:"created_by"`
}

func (db *DB) ListScenarios(ctx context.Context, criticality string) ([]Scenario, error) {
	q := `SELECT id, name, customer, criticality, description, template_data, created_at, updated_at, created_by
	      FROM incident_scenarios WHERE 1=1`
	args := []any{}
	if criticality != "" {
		args = append(args, criticality)
		q += " AND criticality = $" + itoa(len(args))
	}
	q += " ORDER BY created_at DESC"

	rows, err := db.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Scenario
	for rows.Next() {
		var s Scenario
		if err := rows.Scan(&s.ID, &s.Name, &s.Customer, &s.Criticality, &s.Description,
			&s.TemplateData, &s.CreatedAt, &s.UpdatedAt, &s.CreatedBy); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (db *DB) GetScenario(ctx context.Context, id string) (*Scenario, error) {
	row := db.pool.QueryRow(ctx,
		`SELECT id, name, customer, criticality, description, template_data,
		        created_at, updated_at, created_by
		 FROM incident_scenarios WHERE id = $1`, id)
	var s Scenario
	if err := row.Scan(&s.ID, &s.Name, &s.Customer, &s.Criticality, &s.Description,
		&s.TemplateData, &s.CreatedAt, &s.UpdatedAt, &s.CreatedBy); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &s, nil
}

func (db *DB) CreateScenario(ctx context.Context, s Scenario) (*Scenario, error) {
	if len(s.TemplateData) == 0 {
		s.TemplateData = json.RawMessage("{}")
	}
	row := db.pool.QueryRow(ctx,
		`INSERT INTO incident_scenarios (name, customer, criticality, description, template_data, created_by)
		 VALUES ($1, $2, COALESCE(NULLIF($3,''),'medium'), $4, $5, $6)
		 RETURNING id, name, customer, criticality, description, template_data,
		           created_at, updated_at, created_by`,
		s.Name, s.Customer, s.Criticality, s.Description, s.TemplateData, s.CreatedBy)
	var out Scenario
	if err := row.Scan(&out.ID, &out.Name, &out.Customer, &out.Criticality, &out.Description,
		&out.TemplateData, &out.CreatedAt, &out.UpdatedAt, &out.CreatedBy); err != nil {
		return nil, err
	}
	return &out, nil
}

func (db *DB) UpdateScenario(ctx context.Context, id string, s Scenario) error {
	if len(s.TemplateData) == 0 {
		s.TemplateData = json.RawMessage("{}")
	}
	_, err := db.pool.Exec(ctx,
		`UPDATE incident_scenarios
		    SET name = $2, customer = $3, criticality = $4, description = $5,
		        template_data = $6, updated_at = NOW()
		  WHERE id = $1`,
		id, s.Name, s.Customer, s.Criticality, s.Description, s.TemplateData)
	return err
}

func (db *DB) DeleteScenario(ctx context.Context, id string) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM incident_scenarios WHERE id = $1`, id)
	return err
}
