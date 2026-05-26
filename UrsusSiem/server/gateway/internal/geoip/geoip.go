// Package geoip provides MMDB lookups (country + lat/lon) and a daily
// updater that fetches the latest GeoLite2-City database from the
// P3TERX/GeoLite.mmdb public mirror.
package geoip

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
