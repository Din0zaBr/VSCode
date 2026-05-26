package geoip

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"sync"
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

func TestUpdater_staleFile_downloadsAndReplaces(t *testing.T) {
	tmp := t.TempDir()
	dest := filepath.Join(tmp, "GeoLite2-City.mmdb")

	if err := os.WriteFile(dest, []byte("STALE"), 0o644); err != nil {
		t.Fatal(err)
	}
	twoDaysAgo := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(dest, twoDaysAgo, twoDaysAgo); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("FRESH-MMDB-BYTES"))
	}))
	defer srv.Close()

	u := &Updater{
		Mirror:   srv.URL + "/file",
		DestPath: dest,
		MaxAge:   24 * time.Hour,
	}

	got, err := u.Update(context.Background())
	if err != nil {
		t.Fatalf("Update returned error: %v", err)
	}
	if got != dest {
		t.Errorf("Update returned %q, want %q", got, dest)
	}

	data, err := os.ReadFile(dest)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "FRESH-MMDB-BYTES" {
		t.Errorf("file content = %q, want FRESH-MMDB-BYTES", string(data))
	}

	// mtime must have been refreshed (within last 5 seconds).
	info, _ := os.Stat(dest)
	if time.Since(info.ModTime()) > 5*time.Second {
		t.Errorf("mtime not refreshed: %v ago", time.Since(info.ModTime()))
	}
}

func TestUpdater_downloadError_keepsOldFile(t *testing.T) {
	tmp := t.TempDir()
	dest := filepath.Join(tmp, "GeoLite2-City.mmdb")

	if err := os.WriteFile(dest, []byte("OLD-BUT-VALID"), 0o644); err != nil {
		t.Fatal(err)
	}
	twoDaysAgo := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(dest, twoDaysAgo, twoDaysAgo); err != nil {
		t.Fatal(err)
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	u := &Updater{
		Mirror:   srv.URL + "/file",
		DestPath: dest,
		MaxAge:   24 * time.Hour,
	}

	_, err := u.Update(context.Background())
	if err == nil {
		t.Fatal("expected error from 500 response")
	}

	// Old file content must still be there.
	data, _ := os.ReadFile(dest)
	if string(data) != "OLD-BUT-VALID" {
		t.Errorf("old file overwritten: now %q", string(data))
	}

	// And no leftover .tmp.
	if _, err := os.Stat(dest + ".tmp"); !os.IsNotExist(err) {
		t.Errorf("temp file leaked: %v", err)
	}
}

func TestUpdater_atomicReplace_noHalfWrittenFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("os.Rename is not atomic under open file handles on Windows; tracked separately")
	}

	tmp := t.TempDir()
	dest := filepath.Join(tmp, "GeoLite2-City.mmdb")

	if err := os.WriteFile(dest, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	stale := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(dest, stale, stale); err != nil {
		t.Fatal(err)
	}

	// Mirror sends the payload in two parts with a 50ms gap, so the
	// rename window straddles concurrent reads.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("v2-"))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
		time.Sleep(50 * time.Millisecond)
		_, _ = w.Write([]byte("part2"))
	}))
	defer srv.Close()

	u := &Updater{Mirror: srv.URL, DestPath: dest, MaxAge: 24 * time.Hour}

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := u.Update(context.Background()); err != nil {
			t.Errorf("Update failed: %v", err)
		}
	}()

	// During the write window, read repeatedly. Every read must see
	// either the full old content or the full new content — never a
	// partial write.
	deadline := time.Now().Add(100 * time.Millisecond)
	reads := 0
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(dest)
		if err != nil {
			continue // file briefly absent during rename is acceptable
		}
		s := string(data)
		if s != "v1" && s != "v2-part2" {
			t.Errorf("read #%d saw partial content %q", reads, s)
		}
		reads++
	}
	wg.Wait()

	if reads == 0 {
		t.Fatal("test made zero reads — invalid timing")
	}
	final, _ := os.ReadFile(dest)
	if string(final) != "v2-part2" {
		t.Errorf("final content = %q, want v2-part2", string(final))
	}
}
