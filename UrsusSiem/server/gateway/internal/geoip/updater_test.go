package geoip

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUpdater_freshFile_noDownload(t *testing.T) {
	tmp := t.TempDir()
	dest := filepath.Join(tmp, "GeoLite2-City.mmdb")

	// Write a non-empty placeholder and stamp its mtime as "1 hour ago".
	if err := os.WriteFile(dest, []byte("placeholder"), 0o644); err != nil {
		t.Fatal(err)
	}
	hourAgo := time.Now().Add(-1 * time.Hour)
	if err := os.Chtimes(dest, hourAgo, hourAgo); err != nil {
		t.Fatal(err)
	}

	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		_, _ = w.Write([]byte("UNEXPECTED"))
	}))
	defer srv.Close()

	u := &Updater{
		Mirror:   srv.URL + "/file",
		DestPath: dest,
		MaxAge:   24 * time.Hour, // file is 1h old, max is 24h -> fresh
	}

	got, err := u.Update(context.Background())
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if got != dest {
		t.Errorf("Update returned path %q, want %q", got, dest)
	}
	if hits != 0 {
		t.Errorf("expected 0 HTTP hits (file is fresh), got %d", hits)
	}
	data, _ := os.ReadFile(dest)
	if string(data) != "placeholder" {
		t.Errorf("file content changed: %q", string(data))
	}
}
