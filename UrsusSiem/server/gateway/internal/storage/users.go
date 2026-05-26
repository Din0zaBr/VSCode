package storage

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

type User struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
	Agents       []string  `json:"agents"`
}

func (db *DB) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	row := db.pool.QueryRow(ctx,
		`SELECT id, username, password_hash, role, created_at FROM users WHERE username = $1`,
		username)
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	u.Agents = db.listUserAgents(ctx, u.ID)
	return &u, nil
}

func (db *DB) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := db.pool.Query(ctx,
		`SELECT id, username, password_hash, role, created_at FROM users ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt); err != nil {
			return nil, err
		}
		u.Agents = db.listUserAgents(ctx, u.ID)
		out = append(out, u)
	}
	return out, rows.Err()
}

func (db *DB) CreateUser(ctx context.Context, username, passwordHash, role string) (*User, error) {
	row := db.pool.QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role
		 RETURNING id, username, password_hash, role, created_at`,
		username, passwordHash, role)
	var u User
	if err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.CreatedAt); err != nil {
		return nil, err
	}
	return &u, nil
}

func (db *DB) DeleteUser(ctx context.Context, id int) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

func (db *DB) UpdateUserRole(ctx context.Context, id int, role string) error {
	_, err := db.pool.Exec(ctx, `UPDATE users SET role = $1 WHERE id = $2`, role, id)
	return err
}

func (db *DB) SetUserAgents(ctx context.Context, id int, agents []string) error {
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `DELETE FROM user_agents WHERE user_id = $1`, id); err != nil {
		return err
	}
	for _, a := range agents {
		if a == "" {
			continue
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO user_agents (user_id, agent_id) VALUES ($1, $2)
			 ON CONFLICT DO NOTHING`, id, a); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (db *DB) listUserAgents(ctx context.Context, userID int) []string {
	rows, err := db.pool.Query(ctx,
		`SELECT agent_id FROM user_agents WHERE user_id = $1 ORDER BY agent_id`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var a string
		if rows.Scan(&a) == nil {
			out = append(out, a)
		}
	}
	return out
}
