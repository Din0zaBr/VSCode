package storage

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type CustomField struct {
	ID           string          `json:"id"`
	EntityType   string          `json:"entity_type"`
	FieldName    string          `json:"field_name"`
	FieldType    string          `json:"field_type"`
	FieldLabel   string          `json:"field_label"`
	FieldGroup   *string         `json:"field_group,omitempty"`
	Options      json.RawMessage `json:"options"`
	DefaultValue *string         `json:"default_value,omitempty"`
	Required     bool            `json:"required"`
	Description  *string         `json:"description,omitempty"`
	CreatedAt    time.Time       `json:"created_at"`
	UpdatedAt    time.Time       `json:"updated_at"`
}

func (db *DB) ListCustomFields(ctx context.Context, entityType string) ([]CustomField, error) {
	q := `SELECT id, entity_type, field_name, field_type, field_label, field_group,
	             options, default_value, required, description, created_at, updated_at
	      FROM custom_fields WHERE 1=1`
	args := []any{}
	if entityType != "" {
		args = append(args, entityType)
		q += " AND entity_type = $" + itoa(len(args))
	}
	q += " ORDER BY entity_type, field_group NULLS LAST, field_name"

	rows, err := db.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CustomField
	for rows.Next() {
		var cf CustomField
		if err := rows.Scan(&cf.ID, &cf.EntityType, &cf.FieldName, &cf.FieldType, &cf.FieldLabel,
			&cf.FieldGroup, &cf.Options, &cf.DefaultValue, &cf.Required, &cf.Description,
			&cf.CreatedAt, &cf.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, cf)
	}
	return out, rows.Err()
}

func (db *DB) CreateCustomField(ctx context.Context, cf CustomField) (*CustomField, error) {
	if len(cf.Options) == 0 {
		cf.Options = json.RawMessage("[]")
	}
	if cf.EntityType == "" {
		cf.EntityType = "incident_scenario"
	}
	row := db.pool.QueryRow(ctx,
		`INSERT INTO custom_fields (entity_type, field_name, field_type, field_label,
		                            field_group, options, default_value, required, description)
		 VALUES ($1, $2, COALESCE(NULLIF($3,''),'text'), $4, $5, $6, $7, $8, $9)
		 RETURNING id, entity_type, field_name, field_type, field_label, field_group,
		           options, default_value, required, description, created_at, updated_at`,
		cf.EntityType, cf.FieldName, cf.FieldType, cf.FieldLabel, cf.FieldGroup,
		cf.Options, cf.DefaultValue, cf.Required, cf.Description)
	var out CustomField
	if err := row.Scan(&out.ID, &out.EntityType, &out.FieldName, &out.FieldType, &out.FieldLabel,
		&out.FieldGroup, &out.Options, &out.DefaultValue, &out.Required, &out.Description,
		&out.CreatedAt, &out.UpdatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

func (db *DB) UpdateCustomField(ctx context.Context, id string, cf CustomField) error {
	if len(cf.Options) == 0 {
		cf.Options = json.RawMessage("[]")
	}
	_, err := db.pool.Exec(ctx,
		`UPDATE custom_fields
		    SET field_name = $2, field_type = $3, field_label = $4, field_group = $5,
		        options = $6, default_value = $7, required = $8, description = $9,
		        updated_at = NOW()
		  WHERE id = $1`,
		id, cf.FieldName, cf.FieldType, cf.FieldLabel, cf.FieldGroup,
		cf.Options, cf.DefaultValue, cf.Required, cf.Description)
	return err
}

func (db *DB) DeleteCustomField(ctx context.Context, id string) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM custom_fields WHERE id = $1`, id)
	return err
}

// GetCustomField is exposed for completeness, mirroring the Python service.
func (db *DB) GetCustomField(ctx context.Context, id string) (*CustomField, error) {
	row := db.pool.QueryRow(ctx,
		`SELECT id, entity_type, field_name, field_type, field_label, field_group,
		        options, default_value, required, description, created_at, updated_at
		 FROM custom_fields WHERE id = $1`, id)
	var cf CustomField
	if err := row.Scan(&cf.ID, &cf.EntityType, &cf.FieldName, &cf.FieldType, &cf.FieldLabel,
		&cf.FieldGroup, &cf.Options, &cf.DefaultValue, &cf.Required, &cf.Description,
		&cf.CreatedAt, &cf.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &cf, nil
}
