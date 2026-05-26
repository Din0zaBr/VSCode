//go:build !duckdb

package storage

import (
	"context"
	"errors"
)

// openDuckDB is a compile-time placeholder used when the binary was built
// without the `duckdb` build tag. We keep the symbol so factory.go compiles
// unconditionally, but the call fails with a clear hint at runtime.
//
// To enable DuckDB: install gcc/musl, set CGO_ENABLED=1, and
// `go build -tags duckdb ./cmd/...` (see docs/duckdb.md).
func openDuckDB(_ context.Context, _ Config) (LogRepo, error) {
	return nil, errors.New(
		"DuckDB backend is not compiled in: rebuild with `-tags duckdb` and CGO_ENABLED=1 " +
			"(see docs/duckdb.md), or set URSUS_STORAGE=postgres",
	)
}
