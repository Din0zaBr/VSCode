package geoip

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// Updater fetches the latest MMDB from a mirror and atomically replaces
// the local copy. Safe to call repeatedly — re-runs without a new
// release are no-ops bounded by MaxAge.
type Updater struct {
	Mirror   string        // full URL to the MMDB blob
	DestPath string        // where to keep the cached file
	MaxAge   time.Duration // re-download if the local file is older than this
}

// Update returns the effective path of the current MMDB file. It only
// hits the network if no local file exists or the existing file is
// older than MaxAge.
func (u *Updater) Update(ctx context.Context) (string, error) {
	if u.DestPath == "" {
		return "", fmt.Errorf("geoip: Updater.DestPath is empty")
	}
	if info, err := os.Stat(u.DestPath); err == nil {
		if u.MaxAge > 0 && time.Since(info.ModTime()) < u.MaxAge {
			return u.DestPath, nil
		}
	}

	// Stale or missing — download.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.Mirror, nil)
	if err != nil {
		return "", fmt.Errorf("geoip: build request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("geoip: GET %s: %w", u.Mirror, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("geoip: mirror returned %d", resp.StatusCode)
	}

	// Write to a sibling temp file, then rename — atomic on POSIX.
	tmpPath := u.DestPath + ".tmp"
	f, err := os.Create(tmpPath)
	if err != nil {
		return "", fmt.Errorf("geoip: create temp: %w", err)
	}
	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.Remove(tmpPath)
		return "", fmt.Errorf("geoip: write temp: %w", err)
	}
	if err := f.Close(); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("geoip: close temp: %w", err)
	}
	if err := os.Rename(tmpPath, u.DestPath); err != nil {
		os.Remove(tmpPath)
		return "", fmt.Errorf("geoip: rename to dest: %w", err)
	}
	return u.DestPath, nil
}
