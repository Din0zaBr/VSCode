package geoip

import (
	"context"
	"fmt"
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
	return "", fmt.Errorf("geoip: download not yet implemented")
}
