package storage

import (
	"context"
	"time"
)

type KnownAccount struct {
	ID               int64      `json:"id"`
	Username         string     `json:"username"`
	Domain           string     `json:"domain"`
	DisplayName      string     `json:"display_name"`
	Email            string     `json:"email"`
	Department       string     `json:"department"`
	Role             string     `json:"role"`
	RiskLevel        string     `json:"risk_level"`
	IsServiceAccount bool       `json:"is_service_account"`
	IsPrivileged     bool       `json:"is_privileged"`
	Notes            string     `json:"notes"`
	FirstSeen        *time.Time `json:"first_seen"`
	LastSeen         *time.Time `json:"last_seen"`
}

type Exclusion struct {
	ID            int64          `json:"id"`
	Name          string         `json:"name"`
	Description   string         `json:"description"`
	ExclusionType string         `json:"exclusion_type"`
	Conditions    map[string]any `json:"conditions"`
	Enabled       bool           `json:"enabled"`
	Scope         string         `json:"scope"`
	CreatedBy     string         `json:"created_by"`
	ExpiresAt     *time.Time     `json:"expires_at"`
	CreatedAt     time.Time      `json:"created_at"`
}

func (db *DB) ListAccounts(ctx context.Context, page, size int) ([]KnownAccount, int, error) {
	offset := (page - 1) * size
	rows, err := db.pool.Query(ctx,
		`SELECT id, username, domain, display_name, email, department, role,
		        risk_level, is_service_account, is_privileged, notes, first_seen, last_seen
		 FROM known_accounts ORDER BY username LIMIT $1 OFFSET $2`, size, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var accounts []KnownAccount
	for rows.Next() {
		var a KnownAccount
		if err := rows.Scan(&a.ID, &a.Username, &a.Domain, &a.DisplayName, &a.Email,
			&a.Department, &a.Role, &a.RiskLevel, &a.IsServiceAccount, &a.IsPrivileged,
			&a.Notes, &a.FirstSeen, &a.LastSeen); err != nil {
			return nil, 0, err
		}
		accounts = append(accounts, a)
	}

	var total int
	db.pool.QueryRow(ctx, `SELECT COUNT(*) FROM known_accounts`).Scan(&total)
	return accounts, total, nil
}

func (db *DB) CreateAccount(ctx context.Context, a KnownAccount) (KnownAccount, error) {
	err := db.pool.QueryRow(ctx,
		`INSERT INTO known_accounts (username, domain, display_name, email, department, role,
		  risk_level, is_service_account, is_privileged, notes)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
		a.Username, a.Domain, a.DisplayName, a.Email, a.Department, a.Role,
		a.RiskLevel, a.IsServiceAccount, a.IsPrivileged, a.Notes,
	).Scan(&a.ID)
	return a, err
}

func (db *DB) UpdateAccount(ctx context.Context, id int64, a KnownAccount) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE known_accounts SET username=$1, domain=$2, display_name=$3, email=$4,
		  department=$5, role=$6, risk_level=$7, is_service_account=$8, is_privileged=$9,
		  notes=$10, updated_at=NOW() WHERE id=$11`,
		a.Username, a.Domain, a.DisplayName, a.Email, a.Department, a.Role,
		a.RiskLevel, a.IsServiceAccount, a.IsPrivileged, a.Notes, id)
	return err
}

func (db *DB) DeleteAccount(ctx context.Context, id int64) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM known_accounts WHERE id=$1`, id)
	return err
}

func (db *DB) DiscoverAccounts(ctx context.Context) (int, error) {
	res, err := db.pool.Exec(ctx, `
		INSERT INTO known_accounts (username, domain, first_seen, last_seen)
		SELECT DISTINCT
		    COALESCE(meta->>'user', meta->>'username', meta->>'src.user', '') AS username,
		    COALESCE(meta->>'domain', '') AS domain,
		    MIN(timestamp), MAX(timestamp)
		FROM logs
		WHERE COALESCE(meta->>'user', meta->>'username', meta->>'src.user', '') != ''
		GROUP BY username, domain
		ON CONFLICT (username, domain) DO UPDATE
		    SET last_seen = EXCLUDED.last_seen,
		        updated_at = NOW()
	`)
	if err != nil {
		return 0, err
	}
	return int(res.RowsAffected()), nil
}

func (db *DB) ListExclusions(ctx context.Context, page, size int) ([]Exclusion, int, error) {
	offset := (page - 1) * size
	rows, err := db.pool.Query(ctx,
		`SELECT id, name, description, exclusion_type, conditions, enabled, scope,
		        created_by, expires_at, created_at
		 FROM exclusions ORDER BY created_at DESC LIMIT $1 OFFSET $2`, size, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []Exclusion
	for rows.Next() {
		var e Exclusion
		var condJSON []byte
		if err := rows.Scan(&e.ID, &e.Name, &e.Description, &e.ExclusionType, &condJSON,
			&e.Enabled, &e.Scope, &e.CreatedBy, &e.ExpiresAt, &e.CreatedAt); err != nil {
			return nil, 0, err
		}
		e.Conditions = map[string]any{}
		result = append(result, e)
	}

	var total int
	db.pool.QueryRow(ctx, `SELECT COUNT(*) FROM exclusions`).Scan(&total)
	return result, total, nil
}

func (db *DB) CreateExclusion(ctx context.Context, e Exclusion) (Exclusion, error) {
	err := db.pool.QueryRow(ctx,
		`INSERT INTO exclusions (name, description, exclusion_type, conditions, enabled, scope, created_by, expires_at)
		 VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8) RETURNING id, created_at`,
		e.Name, e.Description, e.ExclusionType, "{}", e.Enabled, e.Scope, e.CreatedBy, e.ExpiresAt,
	).Scan(&e.ID, &e.CreatedAt)
	return e, err
}

func (db *DB) UpdateExclusion(ctx context.Context, id int64, e Exclusion) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE exclusions SET name=$1, description=$2, exclusion_type=$3,
		  enabled=$4, scope=$5, expires_at=$6, updated_at=NOW() WHERE id=$7`,
		e.Name, e.Description, e.ExclusionType, e.Enabled, e.Scope, e.ExpiresAt, id)
	return err
}

func (db *DB) DeleteExclusion(ctx context.Context, id int64) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM exclusions WHERE id=$1`, id)
	return err
}
