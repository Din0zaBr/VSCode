// Package geoip provides MMDB lookups (country + lat/lon) and a daily
// updater that fetches the latest GeoLite2-City database from the
// P3TERX/GeoLite.mmdb public mirror.
package geoip

import (
	"fmt"
	"net"
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

// Lookup resolves an IP (v4 or v6 string) to a Result. Returns an
// error if the IP is unparseable. A valid-but-unknown IP returns an
// empty Result with a nil error (caller treats it as "no data").
func (m *mmdb) Lookup(ip string) (Result, error) {
	parsed := net.ParseIP(ip)
	if parsed == nil {
		return Result{}, fmt.Errorf("geoip: invalid ip %q", ip)
	}

	var record struct {
		Country struct {
			ISOCode string `maxminddb:"iso_code"`
		} `maxminddb:"country"`
		Location struct {
			Latitude  float64 `maxminddb:"latitude"`
			Longitude float64 `maxminddb:"longitude"`
		} `maxminddb:"location"`
	}
	if err := m.r.Lookup(parsed, &record); err != nil {
		return Result{}, fmt.Errorf("geoip: lookup %s: %w", ip, err)
	}
	return Result{
		CountryISO: record.Country.ISOCode,
		Latitude:   record.Location.Latitude,
		Longitude:  record.Location.Longitude,
	}, nil
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
