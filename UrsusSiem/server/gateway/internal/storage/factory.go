package storage

import (
	"context"
	"errors"
	"fmt"
	"strings"
)

// BackendKind selects which storage implementation is used at runtime.
type BackendKind string

const (
	BackendPostgres BackendKind = "postgres"
	BackendDuckDB   BackendKind = "duckdb"
)

// Config drives the factory below.
type Config struct {
	Backend BackendKind // "postgres" | "duckdb"

	// Postgres-specific
	DatabaseURL string

	// DuckDB-specific (file path; ":memory:" for tests)
	DuckDBPath string
}

// ParseBackend turns the URSUS_STORAGE env value into a BackendKind.
func ParseBackend(s string) (BackendKind, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "postgres", "pg", "postgresql":
		return BackendPostgres, nil
	case "duckdb":
		return BackendDuckDB, nil
	default:
		return "", fmt.Errorf("unknown storage backend %q (allowed: postgres, duckdb)", s)
	}
}

// Open dispatches to the right backend constructor. Returned LogRepo is
// expected to be Closed by the caller.
//
// DuckDB requires CGO and the `duckdb` build tag. Without that tag the
// duckdb path returns an error pointing the operator at the right install
// recipe — the Postgres path stays available for default `go build`.
func Open(ctx context.Context, cfg Config) (LogRepo, error) {
	switch cfg.Backend {
	case BackendPostgres, "":
		if cfg.DatabaseURL == "" {
			return nil, errors.New("postgres backend selected but DATABASE_URL is empty")
		}
		return NewDB(ctx, cfg.DatabaseURL)
	case BackendDuckDB:
		return openDuckDB(ctx, cfg)
	default:
		return nil, fmt.Errorf("unsupported backend: %q", cfg.Backend)
	}
}
