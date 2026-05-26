package storage

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type Asset struct {
	ID          int             `json:"id"`
	Hostname    string          `json:"hostname"`
	IP          *string         `json:"ip,omitempty"`
	OS          *string         `json:"os,omitempty"`
	Department  *string         `json:"department,omitempty"`
	Owner       *string         `json:"owner,omitempty"`
	Criticality string          `json:"criticality"`
	Tags        json.RawMessage `json:"tags"`
	Notes       *string         `json:"notes,omitempty"`
	FirstSeen   time.Time       `json:"first_seen"`
	LastSeen    time.Time       `json:"last_seen"`
	Status      string          `json:"status"`
	CreatedAt   time.Time       `json:"created_at"`
	UpdatedAt   time.Time       `json:"updated_at"`
}

type AssetListResult struct {
	Total  int     `json:"total"`
	Assets []Asset `json:"assets"`
}

func (db *DB) ListAssetsFiltered(ctx context.Context, search, criticality, status string,
	limit, offset int) (*AssetListResult, error) {

	where := []string{"1=1"}
	args := []any{}
	if search != "" {
		args = append(args, "%"+strings.ToLower(search)+"%")
		where = append(where, "LOWER(hostname) LIKE $"+itoa(len(args)))
	}
	if criticality != "" {
		args = append(args, criticality)
		where = append(where, "criticality = $"+itoa(len(args)))
	}
	if status != "" {
		args = append(args, status)
		where = append(where, "status = $"+itoa(len(args)))
	}
	whereSQL := strings.Join(where, " AND ")

	var total int
	if err := db.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM assets WHERE `+whereSQL, args...).Scan(&total); err != nil {
		return nil, err
	}

	args = append(args, limit, offset)
	rows, err := db.pool.Query(ctx,
		`SELECT id, hostname, ip, os, department, owner, criticality, tags, notes,
		        first_seen, last_seen, status, created_at, updated_at
		 FROM assets WHERE `+whereSQL+
			` ORDER BY last_seen DESC
		   LIMIT $`+itoa(len(args)-1)+` OFFSET $`+itoa(len(args)), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Asset
	for rows.Next() {
		var a Asset
		if err := rows.Scan(&a.ID, &a.Hostname, &a.IP, &a.OS, &a.Department, &a.Owner,
			&a.Criticality, &a.Tags, &a.Notes, &a.FirstSeen, &a.LastSeen, &a.Status,
			&a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return &AssetListResult{Total: total, Assets: out}, rows.Err()
}

func (db *DB) CreateAsset(ctx context.Context, a Asset) (*Asset, error) {
	if len(a.Tags) == 0 {
		a.Tags = json.RawMessage("[]")
	}
	row := db.pool.QueryRow(ctx,
		`INSERT INTO assets (hostname, ip, os, department, owner, criticality, tags, notes, status)
		 VALUES ($1, $2, $3, $4, $5, COALESCE(NULLIF($6,''),'medium'), $7, $8, COALESCE(NULLIF($9,''),'active'))
		 ON CONFLICT (hostname) DO UPDATE SET
		   ip = EXCLUDED.ip, os = EXCLUDED.os, department = EXCLUDED.department,
		   owner = EXCLUDED.owner, criticality = EXCLUDED.criticality, tags = EXCLUDED.tags,
		   notes = EXCLUDED.notes, status = EXCLUDED.status, updated_at = NOW()
		 RETURNING id, hostname, ip, os, department, owner, criticality, tags, notes,
		           first_seen, last_seen, status, created_at, updated_at`,
		a.Hostname, a.IP, a.OS, a.Department, a.Owner, a.Criticality, a.Tags, a.Notes, a.Status)
	var out Asset
	if err := row.Scan(&out.ID, &out.Hostname, &out.IP, &out.OS, &out.Department, &out.Owner,
		&out.Criticality, &out.Tags, &out.Notes, &out.FirstSeen, &out.LastSeen, &out.Status,
		&out.CreatedAt, &out.UpdatedAt); err != nil {
		return nil, err
	}
	return &out, nil
}

func (db *DB) UpdateAsset(ctx context.Context, id int, a Asset) error {
	if len(a.Tags) == 0 {
		a.Tags = json.RawMessage("[]")
	}
	_, err := db.pool.Exec(ctx,
		`UPDATE assets SET hostname = $2, ip = $3, os = $4, department = $5, owner = $6,
		                   criticality = $7, tags = $8, notes = $9, status = $10, updated_at = NOW()
		 WHERE id = $1`,
		id, a.Hostname, a.IP, a.OS, a.Department, a.Owner, a.Criticality, a.Tags, a.Notes, a.Status)
	return err
}

func (db *DB) DeleteAsset(ctx context.Context, id int) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM assets WHERE id = $1`, id)
	return err
}

func (db *DB) GetAsset(ctx context.Context, id int) (*Asset, error) {
	row := db.pool.QueryRow(ctx,
		`SELECT id, hostname, ip, os, department, owner, criticality, tags, notes,
		        first_seen, last_seen, status, created_at, updated_at
		 FROM assets WHERE id = $1`, id)
	var a Asset
	if err := row.Scan(&a.ID, &a.Hostname, &a.IP, &a.OS, &a.Department, &a.Owner,
		&a.Criticality, &a.Tags, &a.Notes, &a.FirstSeen, &a.LastSeen, &a.Status,
		&a.CreatedAt, &a.UpdatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return &a, nil
}
