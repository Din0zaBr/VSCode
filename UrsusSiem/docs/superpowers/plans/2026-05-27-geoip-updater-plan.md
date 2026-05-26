# GeoIP Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained Go package that opens MaxMind MMDB
files, looks up IPs to country/coords, and refreshes the local DB from
the P3TERX/GeoLite.mmdb daily mirror.

**Architecture:** A single package `server/gateway/internal/geoip` with
two responsibilities split across two files: `geoip.go` (read-only
`DB` + `Open` + `Lookup`) and `updater.go` (`Updater` that fetches and
atomically replaces the on-disk file). All tests use stdlib `testing`
+ `httptest`. No real GitHub hits in tests.

**Tech Stack:**
- Go 1.21 (matches existing `server/gateway/go.mod`)
- `github.com/oschwald/maxminddb-golang v1.13.1` (canonical MMDB reader, MIT-licensed)
- stdlib `net/http`, `net/http/httptest`, `testing`, `os`, `path/filepath`

---

## File Structure

| File | Responsibility |
|---|---|
| `server/gateway/internal/geoip/geoip.go` | `DB` interface, `Result`, `Open(path)`, internal `mmdb` struct that wraps `maxminddb.Reader` |
| `server/gateway/internal/geoip/geoip_test.go` | Tests 1–5 from the spec — Open + Lookup edge cases |
| `server/gateway/internal/geoip/updater.go` | `Updater` struct, `Update(ctx)`, atomic replace helper |
| `server/gateway/internal/geoip/updater_test.go` | Tests 6–9 from the spec — Updater behaviour with mocked HTTP |
| `server/gateway/internal/geoip/testdata/README.md` | How to fetch the MMDB fixture |
| `server/gateway/internal/geoip/testdata/invalid.mmdb` | Literal text file used as the "corrupt MMDB" fixture |
| `server/gateway/internal/geoip/.gitignore` | Exclude the real `GeoIP2-City-Test.mmdb` (~75 KB binary fetched by README) |
| `server/gateway/go.mod` | Add `maxminddb-golang` dep |
| `server/gateway/go.sum` | Updated by `go mod tidy` |

The fixture file (`GeoIP2-City-Test.mmdb`) is NOT committed — engineers
fetch it via `make geoip-testdata` (added in Task 1). This keeps the
repo binary-clean.

---

## Pre-flight Check

Verify the working directory and tooling **before starting**:

```bash
cd UrsusSiem/server/gateway
go version       # expect: go1.21+ (Dockerfile uses 1.22, local can be 1.21+)
go env GOPATH    # any path, just confirm Go works
```

If `go` is not installed locally, all tasks must run inside the
project's Go container:
```bash
docker run --rm -v "$PWD:/app" -w /app golang:1.22-bookworm bash
```
The plan assumes one or the other works. Stop and tell the user if
neither does.

---

## Task 1: Package scaffolding + dependency

**Files:**
- Create: `server/gateway/internal/geoip/geoip.go`
- Create: `server/gateway/internal/geoip/testdata/README.md`
- Create: `server/gateway/internal/geoip/testdata/invalid.mmdb`
- Create: `server/gateway/internal/geoip/.gitignore`
- Modify: `server/gateway/go.mod`
- Create or modify: `server/gateway/Makefile` (add `geoip-testdata` target)

- [ ] **Step 1: Add dependency to go.mod**

```bash
cd UrsusSiem/server/gateway
go get github.com/oschwald/maxminddb-golang@v1.13.1
```

Expected output: lines like
```
go: added github.com/oschwald/maxminddb-golang v1.13.1
```
and `go.sum` updated.

- [ ] **Step 2: Create the package skeleton at `server/gateway/internal/geoip/geoip.go`**

```go
// Package geoip provides MMDB lookups (country + lat/lon) and a daily
// updater that fetches the latest GeoLite2-City database from the
// P3TERX/GeoLite.mmdb public mirror.
//
// The actual implementation is built test-first across the tasks in
// docs/superpowers/plans/2026-05-27-geoip-updater-plan.md.
package geoip

// Result is the minimal projection of a MaxMind City record we use
// (only what the impossible-travel detector needs).
type Result struct {
	CountryISO string  // e.g. "RU"; "" if unknown
	Latitude   float64
	Longitude  float64
}

// DB is the read-only handle to a loaded MMDB file. Open it with Open.
type DB interface {
	Lookup(ip string) (Result, error)
	Close() error
}
```

- [ ] **Step 3: Create the testdata README at `server/gateway/internal/geoip/testdata/README.md`**

````markdown
# GeoIP testdata

Tests that need a real MMDB use the official MaxMind test fixture
shipped at the canonical maxmind/MaxMind-DB GitHub repository
(Apache-2.0 licensed).

The binary is NOT committed to this repo. Fetch it before running
package tests:

```bash
make -C server/gateway geoip-testdata
```

Or manually:

```bash
curl -fsSL \
  https://raw.githubusercontent.com/maxmind/MaxMind-DB/main/test-data/GeoIP2-City-Test.mmdb \
  -o server/gateway/internal/geoip/testdata/GeoIP2-City-Test.mmdb
```

The file is ~75 KB and contains lookups for 8.8.8.8, 1.1.1.1 and
several private ranges.

`invalid.mmdb` (committed) is just a literal text file used by the
"corrupt file" test — no real MMDB content.
````

- [ ] **Step 4: Create the deliberately-corrupt fixture at `server/gateway/internal/geoip/testdata/invalid.mmdb`**

File content (exactly one line, no MMDB structure — guarantees parse failure):

```text
this is not a valid MMDB file
```

- [ ] **Step 5: Create `.gitignore` at `server/gateway/internal/geoip/.gitignore`**

```gitignore
testdata/GeoIP2-City-Test.mmdb
testdata/*.mmdb
!testdata/invalid.mmdb
```

- [ ] **Step 6: Add `geoip-testdata` Makefile target**

If `server/gateway/Makefile` does not exist, create it. Then add (or
replace) the target:

```makefile
.PHONY: geoip-testdata
geoip-testdata: ## Fetch the MaxMind test MMDB for go test
	@curl -fsSL \
	  https://raw.githubusercontent.com/maxmind/MaxMind-DB/main/test-data/GeoIP2-City-Test.mmdb \
	  -o internal/geoip/testdata/GeoIP2-City-Test.mmdb
	@echo "✓ fetched internal/geoip/testdata/GeoIP2-City-Test.mmdb"
```

- [ ] **Step 7: Verify the package compiles**

```bash
cd UrsusSiem/server/gateway
go build ./internal/geoip/...
```

Expected output: empty (zero exit). No errors. The package has only
type declarations so it must compile.

- [ ] **Step 8: Commit**

```bash
git add server/gateway/go.mod server/gateway/go.sum \
        server/gateway/internal/geoip/ \
        server/gateway/Makefile
git commit -m "feat(geoip): scaffold package with DB + Result types"
```

---

## Task 2: TestOpen — missing file returns error

**Files:**
- Create: `server/gateway/internal/geoip/geoip_test.go`
- Modify: `server/gateway/internal/geoip/geoip.go`

- [ ] **Step 1: Write the failing test at `server/gateway/internal/geoip/geoip_test.go`**

```go
package geoip

import (
	"errors"
	"os"
	"testing"
)

func TestOpen_missingFile_returnsError(t *testing.T) {
	_, err := Open("/this/path/definitely/does/not/exist.mmdb")
	if err == nil {
		t.Fatal("expected error for missing file, got nil")
	}
	if !errors.Is(err, os.ErrNotExist) {
		t.Errorf("expected error to wrap os.ErrNotExist, got %v", err)
	}
}
```

- [ ] **Step 2: Run the test — confirm RED**

```bash
cd UrsusSiem/server/gateway
go test ./internal/geoip/ -run TestOpen_missingFile -v
```

Expected output: compile error
```
./geoip_test.go:9:11: undefined: Open
FAIL
```

- [ ] **Step 3: Add minimal `Open` implementation to `server/gateway/internal/geoip/geoip.go`**

Append below the existing types:

```go
import (
	"fmt"
	"os"

	"github.com/oschwald/maxminddb-golang"
)

// mmdb wraps maxminddb.Reader so we can satisfy DB without leaking the
// concrete type.
type mmdb struct {
	r *maxminddb.Reader
}

func (m *mmdb) Close() error { return m.r.Close() }

// Lookup will be implemented in Task 4.
func (m *mmdb) Lookup(ip string) (Result, error) {
	return Result{}, fmt.Errorf("not implemented yet")
}

// Open loads an MMDB file from disk. Returns wrapped os.ErrNotExist if
// the file is missing.
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
```

- [ ] **Step 4: Run the test — confirm GREEN**

```bash
go test ./internal/geoip/ -run TestOpen_missingFile -v
```

Expected output:
```
=== RUN   TestOpen_missingFile_returnsError
--- PASS: TestOpen_missingFile_returnsError (0.00s)
PASS
ok      .../internal/geoip   0.0Xs
```

- [ ] **Step 5: Commit**

```bash
git add server/gateway/internal/geoip/
git commit -m "test(geoip): missing file returns wrapped os.ErrNotExist"
```

---

## Task 3: TestOpen — invalid MMDB returns parse error

**Files:**
- Modify: `server/gateway/internal/geoip/geoip_test.go` (append)
- No code changes needed in `geoip.go` (parser already runs in Task 2's Open)

- [ ] **Step 1: Add the failing test at the bottom of `geoip_test.go`**

```go
func TestOpen_invalidFile_returnsError(t *testing.T) {
	_, err := Open("testdata/invalid.mmdb")
	if err == nil {
		t.Fatal("expected parse error, got nil")
	}
	// The error message should mention the path so operators can debug.
	if got := err.Error(); !contains(got, "invalid.mmdb") {
		t.Errorf("error %q does not mention the file path", got)
	}
}

// contains is a tiny helper to avoid pulling in strings in every test.
func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
```

- [ ] **Step 2: Run the test — should already pass thanks to Task 2's parser call**

```bash
go test ./internal/geoip/ -run TestOpen_invalidFile -v
```

Expected output:
```
--- PASS: TestOpen_invalidFile_returnsError (0.00s)
PASS
```

If it FAILS — investigate before continuing. `maxminddb.Open` should
reject the literal-text file we created in Task 1.

- [ ] **Step 3: Commit**

```bash
git add server/gateway/internal/geoip/geoip_test.go
git commit -m "test(geoip): invalid MMDB returns parser error with path"
```

---

## Task 4: TestOpen + Lookup happy path (8.8.8.8 → US)

**Files:**
- Modify: `server/gateway/internal/geoip/geoip_test.go` (append)
- Modify: `server/gateway/internal/geoip/geoip.go` (implement Lookup)

- [ ] **Step 1: Fetch the test fixture**

```bash
cd UrsusSiem/server/gateway
make geoip-testdata
```

Expected output:
```
✓ fetched internal/geoip/testdata/GeoIP2-City-Test.mmdb
```

Verify the file exists and is non-trivial:
```bash
ls -lh internal/geoip/testdata/GeoIP2-City-Test.mmdb
# should show ~75K
```

- [ ] **Step 2: Add the failing test to `geoip_test.go`**

```go
import "net"  // add to existing import block if missing

func TestOpen_validFile_lookupKnownIP(t *testing.T) {
	db, err := Open("testdata/GeoIP2-City-Test.mmdb")
	if err != nil {
		t.Skipf("fixture not present, run `make geoip-testdata`: %v", err)
	}
	defer db.Close()

	res, err := db.Lookup("81.2.69.142") // address in the MaxMind test fixture
	if err != nil {
		t.Fatalf("Lookup failed: %v", err)
	}
	if res.CountryISO != "GB" {
		t.Errorf("CountryISO = %q, want GB", res.CountryISO)
	}
	if res.Latitude == 0 || res.Longitude == 0 {
		t.Errorf("expected non-zero coords, got lat=%v lon=%v", res.Latitude, res.Longitude)
	}
	// Sanity: parsed as IPv4
	if ip := net.ParseIP("81.2.69.142"); ip == nil {
		t.Fatal("test address itself failed to parse")
	}
}
```

> **Why 81.2.69.142 and not 8.8.8.8:** the upstream `GeoIP2-City-Test.mmdb`
> fixture includes 81.2.69.142 (a documented test record in the MaxMind
> test suite) but does NOT include 8.8.8.8. The spec mentioned 8.8.8.8
> as a familiar example — the actual test pins a record we know exists.

- [ ] **Step 3: Run the test — confirm RED**

```bash
go test ./internal/geoip/ -run TestOpen_validFile -v
```

Expected output: FAIL with
```
Lookup failed: not implemented yet
```

(Task 2 stubbed Lookup with that error.)

- [ ] **Step 4: Implement Lookup in `geoip.go` — replace the stub**

```go
import "net"  // add to existing import block

// Lookup resolves an IP (v4 or v6 string) to a Result. Returns an
// error if the IP is unparseable. An unknown-but-valid IP returns an
// empty Result with nil error (caller can treat as "no data").
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
```

- [ ] **Step 5: Run the test — confirm GREEN**

```bash
go test ./internal/geoip/ -run TestOpen_validFile -v
```

Expected output:
```
--- PASS: TestOpen_validFile_lookupKnownIP (0.0Xs)
PASS
```

- [ ] **Step 6: Commit**

```bash
git add server/gateway/internal/geoip/
git commit -m "feat(geoip): implement Lookup via maxminddb-golang"
```

---

## Task 5: Lookup edge cases — invalid IP and unknown IP

**Files:**
- Modify: `server/gateway/internal/geoip/geoip_test.go` (append)
- No code changes (the implementation in Task 4 already covers both)

- [ ] **Step 1: Add both tests to `geoip_test.go`**

```go
func TestLookup_invalidIP_returnsError(t *testing.T) {
	db, err := Open("testdata/GeoIP2-City-Test.mmdb")
	if err != nil {
		t.Skipf("fixture not present, run `make geoip-testdata`: %v", err)
	}
	defer db.Close()

	_, err = db.Lookup("not-an-ip")
	if err == nil {
		t.Fatal("expected error for invalid IP, got nil")
	}
	if !contains(err.Error(), "invalid ip") {
		t.Errorf("error %q should mention 'invalid ip'", err.Error())
	}
}

func TestLookup_unknownIP_returnsEmpty(t *testing.T) {
	db, err := Open("testdata/GeoIP2-City-Test.mmdb")
	if err != nil {
		t.Skipf("fixture not present, run `make geoip-testdata`: %v", err)
	}
	defer db.Close()

	// 240.0.0.1 is in 240/4 — reserved, never in any geo DB
	res, err := db.Lookup("240.0.0.1")
	if err != nil {
		t.Fatalf("expected nil error for unknown IP, got %v", err)
	}
	if res.CountryISO != "" {
		t.Errorf("CountryISO = %q, want empty for reserved IP", res.CountryISO)
	}
	if res.Latitude != 0 || res.Longitude != 0 {
		t.Errorf("expected zero coords, got lat=%v lon=%v", res.Latitude, res.Longitude)
	}
}
```

- [ ] **Step 2: Run both tests — confirm GREEN immediately**

```bash
go test ./internal/geoip/ -run 'TestLookup_(invalidIP|unknownIP)' -v
```

Expected output:
```
--- PASS: TestLookup_invalidIP_returnsError (0.00s)
--- PASS: TestLookup_unknownIP_returnsEmpty (0.0Xs)
PASS
```

If either FAILS — fix `Lookup` in Task 4's code before continuing.
The error wrapping must use the word "invalid ip" literally.

- [ ] **Step 3: Commit**

```bash
git add server/gateway/internal/geoip/geoip_test.go
git commit -m "test(geoip): Lookup handles invalid and unknown IPs"
```

---

## Task 6: Updater — no download when file is fresh

**Files:**
- Create: `server/gateway/internal/geoip/updater.go`
- Create: `server/gateway/internal/geoip/updater_test.go`

- [ ] **Step 1: Write the failing test at `server/gateway/internal/geoip/updater_test.go`**

```go
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

	// Write a non-empty placeholder and stamp its mtime as "1 hour ago"
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
		w.Write([]byte("UNEXPECTED"))
	}))
	defer srv.Close()

	u := &Updater{
		Mirror:   srv.URL + "/file",
		DestPath: dest,
		MaxAge:   24 * time.Hour, // file is 1h old, max is 24h → fresh
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
	// Old content must be preserved.
	data, _ := os.ReadFile(dest)
	if string(data) != "placeholder" {
		t.Errorf("file content changed: %q", string(data))
	}
}
```

- [ ] **Step 2: Run the test — confirm RED**

```bash
go test ./internal/geoip/ -run TestUpdater_freshFile -v
```

Expected output: compile error
```
./updater_test.go:XX: undefined: Updater
```

- [ ] **Step 3: Create `updater.go` with the minimal type and a freshness check**

```go
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
	MaxAge   time.Duration // re-download if older than this
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
```

- [ ] **Step 4: Run the test — confirm GREEN**

```bash
go test ./internal/geoip/ -run TestUpdater_freshFile -v
```

Expected output:
```
--- PASS: TestUpdater_freshFile_noDownload (0.0Xs)
PASS
```

- [ ] **Step 5: Commit**

```bash
git add server/gateway/internal/geoip/
git commit -m "feat(geoip): Updater skips download when file fresh"
```

---

## Task 7: Updater — downloads when file is stale

**Files:**
- Modify: `server/gateway/internal/geoip/updater_test.go` (append)
- Modify: `server/gateway/internal/geoip/updater.go` (implement download)

- [ ] **Step 1: Add the failing test**

```go
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
		w.Write([]byte("FRESH-MMDB-BYTES"))
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

	// mtime must have been refreshed (within last 5 seconds)
	info, _ := os.Stat(dest)
	if time.Since(info.ModTime()) > 5*time.Second {
		t.Errorf("mtime not refreshed: %v ago", time.Since(info.ModTime()))
	}
}
```

- [ ] **Step 2: Run — confirm RED**

```bash
go test ./internal/geoip/ -run TestUpdater_staleFile -v
```

Expected output:
```
FAIL with "download not yet implemented"
```

- [ ] **Step 3: Replace the stub in `updater.go` with a real download**

Replace the `return "", fmt.Errorf("geoip: download not yet implemented")`
line with this block:

```go
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

	// Write to a sibling temp file, then rename → atomic on POSIX.
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
```

Add `"io"` and `"net/http"` to the existing import block.

- [ ] **Step 4: Run — confirm GREEN**

```bash
go test ./internal/geoip/ -run TestUpdater_staleFile -v
```

Expected output:
```
--- PASS: TestUpdater_staleFile_downloadsAndReplaces (0.0Xs)
PASS
```

- [ ] **Step 5: Commit**

```bash
git add server/gateway/internal/geoip/updater.go server/gateway/internal/geoip/updater_test.go
git commit -m "feat(geoip): Updater downloads + atomic-renames stale file"
```

---

## Task 8: Updater — keep old file on download failure

**Files:**
- Modify: `server/gateway/internal/geoip/updater_test.go` (append)
- (No code change expected — the implementation in Task 7 already does this; the test pins the behaviour.)

- [ ] **Step 1: Add the failing test**

```go
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
```

- [ ] **Step 2: Run — should already PASS thanks to Task 7's error handling**

```bash
go test ./internal/geoip/ -run TestUpdater_downloadError -v
```

Expected output:
```
--- PASS: TestUpdater_downloadError_keepsOldFile (0.0Xs)
PASS
```

If the .tmp file leaks, fix `updater.go` — the `os.Remove(tmpPath)` on
the 500-status branch is missing. Add this line right after the
`if resp.StatusCode != http.StatusOK { ... return ... }` block? No —
that branch returns before the `tmpPath` was created. The leak can
only happen if the temp file got created. Re-read Task 7's code to
confirm. If the test fails — debug per the spec, do not just retry.

- [ ] **Step 3: Commit**

```bash
git add server/gateway/internal/geoip/updater_test.go
git commit -m "test(geoip): Updater keeps old file when mirror fails"
```

---

## Task 9: Updater — atomic replace under concurrent reads

**Files:**
- Modify: `server/gateway/internal/geoip/updater_test.go` (append)
- (No code change expected — `os.Rename` is atomic on POSIX. On Windows
   this test documents a known limitation; skip on `runtime.GOOS == "windows"`.)

- [ ] **Step 1: Add the test**

```go
import (
	"runtime"
	"sync"
)

func TestUpdater_atomicReplace_noHalfWrittenFile(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("os.Rename is not atomic under open file handles on Windows; tracked separately")
	}

	tmp := t.TempDir()
	dest := filepath.Join(tmp, "GeoLite2-City.mmdb")

	// Seed initial file.
	if err := os.WriteFile(dest, []byte("v1"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(dest, time.Now().Add(-48*time.Hour), time.Now().Add(-48*time.Hour)); err != nil {
		t.Fatal(err)
	}

	// Mirror serves a payload that takes 50ms to send — so the rename
	// window straddles concurrent reads.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("v2-"))
		flusher, _ := w.(http.Flusher)
		if flusher != nil {
			flusher.Flush()
		}
		time.Sleep(50 * time.Millisecond)
		w.Write([]byte("part2"))
	}))
	defer srv.Close()

	u := &Updater{
		Mirror:   srv.URL,
		DestPath: dest,
		MaxAge:   24 * time.Hour,
	}

	// Start the update.
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		if _, err := u.Update(context.Background()); err != nil {
			t.Errorf("Update failed: %v", err)
		}
	}()

	// During the 50ms window, read the file 20 times. Every read must
	// return either the full old content "v1" or the full new content
	// "v2-part2" — never a partial state.
	deadline := time.Now().Add(100 * time.Millisecond)
	reads := 0
	for time.Now().Before(deadline) {
		data, err := os.ReadFile(dest)
		if err != nil {
			continue // file briefly missing during rename is acceptable
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
```

- [ ] **Step 2: Run — should PASS without code changes**

```bash
go test ./internal/geoip/ -run TestUpdater_atomicReplace -v -race
```

Expected output:
```
--- PASS: TestUpdater_atomicReplace_noHalfWrittenFile (0.1Xs)
PASS
```

If it FAILS with partial reads — the `tmpPath` strategy from Task 7 is
not in place. Re-check.

- [ ] **Step 3: Commit**

```bash
git add server/gateway/internal/geoip/updater_test.go
git commit -m "test(geoip): concurrent reads never see half-written file"
```

---

## Task 10: Package README + final verification

**Files:**
- Create: `server/gateway/internal/geoip/README.md`

- [ ] **Step 1: Write `server/gateway/internal/geoip/README.md`**

````markdown
# geoip

In-process GeoIP lookups for URSUS gateway. Backed by MaxMind's
canonical MMDB format. Database is refreshed daily from the public
[P3TERX/GeoLite.mmdb](https://github.com/P3TERX/GeoLite.mmdb) mirror.

## Usage

```go
import "github.com/ursus-siem/logvault-go/internal/geoip"

// One-off lookup
db, err := geoip.Open("/var/lib/ursus/geoip/GeoLite2-City.mmdb")
if err != nil { /* … */ }
defer db.Close()

res, _ := db.Lookup("81.2.69.142")
fmt.Println(res.CountryISO, res.Latitude, res.Longitude)
// → "GB" 51.5142 -0.0931
```

## Updating the database

```go
u := &geoip.Updater{
    Mirror:   "https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-City.mmdb",
    DestPath: "/var/lib/ursus/geoip/GeoLite2-City.mmdb",
    MaxAge:   24 * time.Hour,
}
path, err := u.Update(ctx)
```

`Update` is a no-op when the local file is younger than `MaxAge`. On
download failure, the existing file is preserved.

## Testing

Tests use the official MaxMind test fixture (Apache-2.0).
Fetch it once:

```bash
make -C server/gateway geoip-testdata
go test ./internal/geoip/... -v
```

## Known limitations

- `os.Rename` is not atomic under open file handles on Windows.
  `TestUpdater_atomicReplace_noHalfWrittenFile` skips on Windows.
  Linux/macOS production hosts behave correctly.
- The reader keeps an mmap on the MMDB file. After `Updater.Update`
  swaps the file, existing `DB` handles still see the old data —
  reopen the DB to pick up the new file.
````

- [ ] **Step 2: Run the entire test suite — final verification**

```bash
cd UrsusSiem/server/gateway
go test ./internal/geoip/... -v -race
```

Expected output:
```
=== RUN   TestOpen_missingFile_returnsError
--- PASS: TestOpen_missingFile_returnsError ...
=== RUN   TestOpen_invalidFile_returnsError
--- PASS: TestOpen_invalidFile_returnsError ...
=== RUN   TestOpen_validFile_lookupKnownIP
--- PASS: TestOpen_validFile_lookupKnownIP ...
=== RUN   TestLookup_invalidIP_returnsError
--- PASS: TestLookup_invalidIP_returnsError ...
=== RUN   TestLookup_unknownIP_returnsEmpty
--- PASS: TestLookup_unknownIP_returnsEmpty ...
=== RUN   TestUpdater_freshFile_noDownload
--- PASS: TestUpdater_freshFile_noDownload ...
=== RUN   TestUpdater_staleFile_downloadsAndReplaces
--- PASS: TestUpdater_staleFile_downloadsAndReplaces ...
=== RUN   TestUpdater_downloadError_keepsOldFile
--- PASS: TestUpdater_downloadError_keepsOldFile ...
=== RUN   TestUpdater_atomicReplace_noHalfWrittenFile
--- PASS: TestUpdater_atomicReplace_noHalfWrittenFile ...
PASS
ok  	github.com/ursus-siem/logvault-go/internal/geoip	0.XXXs
```

9/9 PASS. **If any test fails — STOP. Do not commit. Investigate.**

- [ ] **Step 3: Run vet + tidy**

```bash
go vet ./internal/geoip/...
go mod tidy
```

Expected: zero output from both.

- [ ] **Step 4: Final commit**

```bash
git add server/gateway/internal/geoip/README.md server/gateway/go.sum
git commit -m "docs(geoip): package README + final tidy"
```

---

## Self-Review Checklist

**1. Spec coverage** — every test from spec §3.4 has a task:

| Spec test # | Task |
|---|---|
| 1 — missing file error | Task 2 |
| 2 — invalid file error | Task 3 |
| 3 — Lookup known IP | Task 4 |
| 4 — Lookup invalid IP | Task 5 |
| 5 — Lookup unknown IP | Task 5 |
| 6 — fresh file no download | Task 6 |
| 7 — stale file downloads | Task 7 |
| 8 — error keeps old file | Task 8 |
| 9 — atomic replace | Task 9 |

Coverage: 9/9. ✓

**2. Placeholder scan** — checked. No "TBD", no "implement later", no
"add error handling" without showing what. ✓

**3. Type consistency** — `Result`, `DB`, `Updater`, `Open`, `Update`,
`Lookup`, `Close` — all names used consistently across tasks. The
`mmdb` internal type is the only implementation, never leaks to the
caller. ✓

**4. Tooling assumption** — every task that runs `go test` is on the
same `cd UrsusSiem/server/gateway` working directory. Stated in
Pre-flight Check. ✓

**5. Honest verification** — if I (the runtime executor) don't have a
Go toolchain, tasks **2 onward must be marked "awaiting verification"
and stopped** until someone with Go can run the test suite. This is
the verification-before-completion skill in action. The plan does
NOT skip past failing tests, ever.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-27-geoip-updater-plan.md`.
Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task,
two-stage review between them, ideal if you trust the plan and want
fast iteration with checkpoints.

**2. Inline Execution** — I (this session) execute each task in order
with checkpoints, you see every diff before commit.

**Which approach?** Note: I currently don't have a working Go toolchain
on this machine (we discovered this in previous sessions). Tasks that
build or run tests will hit "awaiting verification" status unless we
run them from a host with `go` installed. The honest fix is for you
to clone the branch and run `go test` after each task, then I'll
proceed only on green.
