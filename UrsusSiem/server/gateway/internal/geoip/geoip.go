// Package geoip provides MMDB lookups (country + lat/lon) and a daily
// updater that fetches the latest GeoLite2-City database from the
// P3TERX/GeoLite.mmdb public mirror.
package geoip

import (
	"fmt"
	"os"

	maxminddb "github.com/oschwald/maxminddb-golang"
)

// Result is the minimal projection of a MaxMind City record we use
// (only what the impossible-travel detector needs).
type Result struct {
	CountryISO string // e.g. "RU"; "" if unknown
	Latitude   float64
	Longitude  float64
}

// DB is the read-only handle to a loaded MMDB file. Open it with Open.
type DB interface {
	Lookup(ip string) (Result, error)
	Close() error
}

// mmdb wraps maxminddb.Reader so we satisfy DB without leaking the
// concrete reader type to callers.
type mmdb struct {
	r *maxminddb.Reader
}

func (m *mmdb) Close() error { return m.r.Close() }

// Lookup is implemented in Task 4.
func (m *mmdb) Lookup(ip string) (Result, error) {
	return Result{}, fmt.Errorf("geoip: lookup not implemented yet")
}

// Open loads an MMDB file from disk. Returns a wrapped os.ErrNotExist
// if the file is missing, or a parse error if the file is not a valid
// MMDB.
func Open(path string) (DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("geoip: open %s: %w", path, err)
	}
	r, err := maxminddb.Open(path)
	if err != nil {
		return nil, fmt.Errorf("geoip: parse %s: %w", path, err)
	}
	return &mmdb{r: r}, nil
}
