package storage

import (
	"context"
	"time"
)

type Canary struct {
	ID          int        `json:"id"`
	Kind        string     `json:"kind"`     // file | ad_account | db_table | web_path
	Name        string     `json:"name"`
	Location    string     `json:"location"`
	Host        *string    `json:"host,omitempty"`
	Description *string    `json:"description,omitempty"`
	DeployedBy  string     `json:"deployed_by"`
	DeployedAt  time.Time  `json:"deployed_at"`
	LastCheck   *time.Time `json:"last_check,omitempty"`
	Enabled     bool       `json:"enabled"`
}

type CanaryHit struct {
	ID          int64     `json:"id"`
	CanaryID    int       `json:"canary_id"`
	HitAt       time.Time `json:"hit_at"`
	Actor       *string   `json:"actor,omitempty"`
	Action      *string   `json:"action,omitempty"`
	SourceEvent *string   `json:"source_event,omitempty"`
	Severity    string    `json:"severity"`
	Notes       *string   `json:"notes,omitempty"`
}

func (db *DB) ListCanaries(ctx context.Context) ([]Canary, error) {
	rows, err := db.pool.Query(ctx,
		`SELECT id, kind, name, location, host, description, deployed_by,
		        deployed_at, last_check, enabled
		 FROM canaries ORDER BY deployed_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Canary
	for rows.Next() {
		var c Canary
		if err := rows.Scan(&c.ID, &c.Kind, &c.Name, &c.Location, &c.Host,
			&c.Description, &c.DeployedBy, &c.DeployedAt, &c.LastCheck, &c.Enabled); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (db *DB) CreateCanary(ctx context.Context, c Canary) (*Canary, error) {
	row := db.pool.QueryRow(ctx,
		`INSERT INTO canaries (kind, name, location, host, description, deployed_by)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (kind, name, location) DO UPDATE SET enabled = TRUE
		 RETURNING id, kind, name, location, host, description, deployed_by,
		           deployed_at, last_check, enabled`,
		c.Kind, c.Name, c.Location, c.Host, c.Description, c.DeployedBy)
	var out Canary
	if err := row.Scan(&out.ID, &out.Kind, &out.Name, &out.Location, &out.Host,
		&out.Description, &out.DeployedBy, &out.DeployedAt, &out.LastCheck, &out.Enabled); err != nil {
		return nil, err
	}
	return &out, nil
}

func (db *DB) DeleteCanary(ctx context.Context, id int) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM canaries WHERE id = $1`, id)
	return err
}

func (db *DB) RecordCanaryHit(ctx context.Context, canaryID int, actor, action, sourceEvent, notes string) (*CanaryHit, error) {
	var actorPtr, actionPtr, eventPtr, notesPtr any
	if actor != "" {
		actorPtr = actor
	}
	if action != "" {
		actionPtr = action
	}
	if sourceEvent != "" {
		eventPtr = sourceEvent
	}
	if notes != "" {
		notesPtr = notes
	}
	row := db.pool.QueryRow(ctx,
		`INSERT INTO canary_hits (canary_id, actor, action, source_event, notes)
		 VALUES ($1, $2, $3, $4, $5)
		 RETURNING id, canary_id, hit_at, actor, action, source_event, severity, notes`,
		canaryID, actorPtr, actionPtr, eventPtr, notesPtr)
	var h CanaryHit
	if err := row.Scan(&h.ID, &h.CanaryID, &h.HitAt, &h.Actor, &h.Action,
		&h.SourceEvent, &h.Severity, &h.Notes); err != nil {
		return nil, err
	}
	return &h, nil
}

func (db *DB) ListCanaryHits(ctx context.Context, limit int) ([]CanaryHit, error) {
	if limit <= 0 || limit > 1000 {
		limit = 100
	}
	rows, err := db.pool.Query(ctx,
		`SELECT id, canary_id, hit_at, actor, action, source_event, severity, notes
		 FROM canary_hits ORDER BY hit_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CanaryHit
	for rows.Next() {
		var h CanaryHit
		if err := rows.Scan(&h.ID, &h.CanaryID, &h.HitAt, &h.Actor, &h.Action,
			&h.SourceEvent, &h.Severity, &h.Notes); err != nil {
			return nil, err
		}
		out = append(out, h)
	}
	return out, rows.Err()
}
