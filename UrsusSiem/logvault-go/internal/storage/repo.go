// Package storage exposes a backend-agnostic interface for log storage.
//
// In v1 the only implementation was PostgreSQL (pgxpool, see postgres.go).
// In v2 we add an optional DuckDB backend for the Micro tier (single-binary,
// embedded, no separate database process). All call sites in the gateway use
// the LogRepo interface, so the choice of backend is a runtime flag
// (URSUS_STORAGE=postgres|duckdb).
//
// Design notes:
//   * Read paths return concrete domain types defined in this package
//     (LogEvent, CorrelationAlert, etc.) — backends translate their native
//     rows into these types.
//   * Bulk write paths take batches to amortise per-row overhead.
//   * Heavy admin/CRUD endpoints (sigma_rules, scenarios, users, ...) live
//     in `*.go` next to this file and still target the pgx pool directly;
//     they will be migrated behind MetaRepo in Sprint 5 when YAML+SQLite
//     replaces them. Goal of *this* sprint is the hot path: ingest + search.
package storage

import (
	"context"
	"time"
)

// LogRepo is the hot-path interface used by /api/ingest, /api/search,
// /api/stats and the anomaly scheduler. Backends must implement it.
type LogRepo interface {
	// BulkIndex inserts a batch of events, ignoring duplicates by event_id.
	// Returns count of inserted rows and rows skipped/failed.
	BulkIndex(ctx context.Context, events []LogEvent) (inserted int, errors int)

	// Search runs a parameterised full-text + filter query (the existing
	// SearchParams shape, kept stable so handlers don't change).
	Search(ctx context.Context, p SearchParams) ([]LogEvent, int64, error)

	// ExecPDQL runs SQL produced by the Rust PDQL transpiler.
	// Backends may have different dialect quirks; the transpiler is
	// instructed which dialect to emit via PdqlRequest.Dialect.
	ExecPDQL(ctx context.Context, sql string, args []interface{}) ([]map[string]interface{}, error)

	// GetStats returns time-series aggregates for the dashboard.
	GetStats(ctx context.Context, interval string, from, to time.Time) (*StatsResult, error)

	// RecentEvents is used by the anomaly scheduler to pull training data.
	RecentEvents(ctx context.Context, since time.Time, limit int) ([]LogEvent, error)

	// QueryAgents returns per-agent last-seen + event counts.
	QueryAgents(ctx context.Context) ([]AgentSummary, error)

	// QueryHostsFromLogs returns distinct hosts derived from log metadata.
	QueryHostsFromLogs(ctx context.Context) ([]HostSummary, error)

	// QueryDistinct returns distinct values from a column (host, level, ...).
	QueryDistinct(ctx context.Context, column string) ([]string, error)

	// Close releases backend resources.
	Close()

	// Backend returns a short identifier used in logs and /health output.
	Backend() string
}

// Ensure *DB (the pgxpool-backed v1 implementation) satisfies LogRepo at
// compile time. If we ever drift the interface, this fails to build.
var _ LogRepo = (*DB)(nil)

// Backend reports which storage engine this DB is talking to. For the
// pgx-backed type the answer is always "postgres".
func (db *DB) Backend() string { return "postgres" }
