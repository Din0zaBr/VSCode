package storage

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// User represents a SIEM user account.
type User struct {
	ID            int64     `json:"id"`
	Username      string    `json:"username"`
	PasswordHash  string    `json:"-"`
	Role          string    `json:"role"`
	AllowedAgents []string  `json:"agents"`
	IsActive      bool      `json:"is_active"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// ApiKey represents an agent API key.
type ApiKey struct {
	ID         int64      `json:"id"`
	Name       string     `json:"name"`
	KeyHash    string     `json:"-"`
	KeyPreview string     `json:"key_preview"`
	KeyValue   string     `json:"key_value,omitempty"` // only on creation
	CreatedBy  string     `json:"created_by"`
	Enabled    bool       `json:"enabled"`
	LastUsed   *time.Time `json:"last_used"`
	CreatedAt  time.Time  `json:"created_at"`
}

// ── Users ─────────────────────────────────────────────────────────────────────

func (db *DB) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := db.pool.Query(ctx,
		`SELECT id, username, role, allowed_agents, is_active, created_at, updated_at
		 FROM users ORDER BY created_at ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Username, &u.Role, &u.AllowedAgents, &u.IsActive, &u.CreatedAt, &u.UpdatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, nil
}

func (db *DB) GetUserByUsername(ctx context.Context, username string) (*User, error) {
	var u User
	err := db.pool.QueryRow(ctx,
		`SELECT id, username, password_hash, role, allowed_agents, is_active, created_at, updated_at
		 FROM users WHERE username = $1 AND is_active = true`,
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role, &u.AllowedAgents, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func (db *DB) CreateUser(ctx context.Context, username, password, role string) (*User, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return nil, err
	}
	var u User
	err = db.pool.QueryRow(ctx,
		`INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
		 RETURNING id, username, role, allowed_agents, is_active, created_at, updated_at`,
		username, string(hash), role,
	).Scan(&u.ID, &u.Username, &u.Role, &u.AllowedAgents, &u.IsActive, &u.CreatedAt, &u.UpdatedAt)
	return &u, err
}

func (db *DB) DeleteUser(ctx context.Context, id int64) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, id)
	return err
}

func (db *DB) UpdateUserRole(ctx context.Context, id int64, role string) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`,
		role, id,
	)
	return err
}

func (db *DB) SetUserAgents(ctx context.Context, id int64, agents []string) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE users SET allowed_agents = $1, updated_at = NOW() WHERE id = $2`,
		agents, id,
	)
	return err
}

func (db *DB) UpdateUserPassword(ctx context.Context, id int64, password string) error {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 10)
	if err != nil {
		return err
	}
	_, err = db.pool.Exec(ctx,
		`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
		string(hash), id,
	)
	return err
}

// ── API Keys ──────────────────────────────────────────────────────────────────

func (db *DB) ListApiKeys(ctx context.Context) ([]ApiKey, error) {
	rows, err := db.pool.Query(ctx,
		`SELECT id, name, key_preview, created_by, enabled, last_used, created_at
		 FROM api_keys ORDER BY created_at DESC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []ApiKey
	for rows.Next() {
		var k ApiKey
		if err := rows.Scan(&k.ID, &k.Name, &k.KeyPreview, &k.CreatedBy, &k.Enabled, &k.LastUsed, &k.CreatedAt); err != nil {
			return nil, err
		}
		keys = append(keys, k)
	}
	return keys, nil
}

func sha256Hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

func (db *DB) CreateApiKey(ctx context.Context, name, createdBy string) (*ApiKey, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return nil, err
	}
	keyValue := hex.EncodeToString(raw)
	preview := keyValue[:8] + "..."
	keyHash := sha256Hex(keyValue)

	var k ApiKey
	err := db.pool.QueryRow(ctx,
		`INSERT INTO api_keys (name, key_hash, key_preview, created_by)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, name, key_preview, created_by, enabled, last_used, created_at`,
		name, keyHash, preview, createdBy,
	).Scan(&k.ID, &k.Name, &k.KeyPreview, &k.CreatedBy, &k.Enabled, &k.LastUsed, &k.CreatedAt)
	if err != nil {
		return nil, err
	}
	k.KeyValue = keyValue
	return &k, nil
}

func (db *DB) DeleteApiKey(ctx context.Context, id int64) error {
	_, err := db.pool.Exec(ctx, `DELETE FROM api_keys WHERE id = $1`, id)
	return err
}

func (db *DB) ToggleApiKey(ctx context.Context, id int64, enabled bool) error {
	_, err := db.pool.Exec(ctx,
		`UPDATE api_keys SET enabled = $1 WHERE id = $2`,
		enabled, id,
	)
	return err
}

// ValidateApiKey checks if the provided raw key matches any enabled API key in the DB.
// Uses SHA256 hash comparison (O(1) lookup).
func (db *DB) ValidateApiKey(ctx context.Context, rawKey string) bool {
	keyHash := sha256Hex(rawKey)
	var id int64
	err := db.pool.QueryRow(ctx,
		`SELECT id FROM api_keys WHERE key_hash = $1 AND enabled = true`,
		keyHash,
	).Scan(&id)
	if err != nil {
		return false
	}
	go db.pool.Exec(context.Background(),
		`UPDATE api_keys SET last_used = NOW() WHERE id = $1`, id,
	)
	return true
}
