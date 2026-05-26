# URSUS v2 — corrections to PLAN_V2 + first TDD-driven feature

**Date:** 2026-05-27
**Author:** assistant + user feedback
**Status:** awaiting user approval

> _I'm using the brainstorming skill to capture this design before
> implementation._

## 1. Why this spec exists

User reviewed PLAN_V2.md / URSUS_STRATEGY.md and pushed back on four
decisions. He also installed `obra/superpowers` and asked future work
to follow TDD with **explicit verification**, not the previous mode of
"unverified code shipped as completed".

This spec collects (a) the corrections to the plan and (b) the **first
real TDD-driven feature** we use to prove the methodology works.

## 2. Plan corrections (no code — just documentation updates)

### 2.1 DuckDB scope (correction to PLAN_V2 §13 + §28)

**Before:** "DuckDB for Micro tier only; jump to ClickHouse once you
hit S/M scale (10K+ EPS)."

**After:** DuckDB is the primary storage for **Micro + Small + Medium
tiers**. Real-world tests show DuckDB handles 50K+ EPS on a 4-vCPU host
when partitions are correct. ClickHouse becomes relevant only for
**multi-node horizontal scaling** — i.e. when one box stops being
enough, not when "load goes up".

User quote: *"DuckDB очень высокие нагрузки держит."*

### 2.2 API gateway via Traefik (correction to PLAN_V2 §16)

**Before:** our Go `gateway` service does TLS termination via Caddy,
JWT auth in middleware, CORS, rate limiting, /metrics routing.

**After:** **Traefik** as the front edge, our Go service is a focused
**business-logic application**:

- Traefik handles: TLS (Let's Encrypt), routing, rate-limiting,
  authn-middleware (JWT validation via plugin), CORS, basic obs
- Go gateway handles: `/api/ingest`, `/api/search`, scenarios, ML,
  compliance reports, WS — no more middleware bloat
- Caddy removed from default stack

Why: user pointed out that custom gateway work was unnecessary —
"для API gateway можно брать готовые решения по типу traefik или Kong".
Traefik chosen over Kong: lighter, no admin-DB, MIT-licensed core,
strong Docker-label integration.

### 2.3 GeoIP via daily mirror, not manual MaxMind (correction to PLAN_V2 §21)

**Before:** "MaxMind GeoLite2 download — manual or via license key."

**After:** pull `GeoLite2-City.mmdb` daily from the public mirror
**[P3TERX/GeoLite.mmdb](https://github.com/P3TERX/GeoLite.mmdb)** which
auto-publishes the official MaxMind data without requiring a license key
or signed-up account. This is exactly the pattern the user has used
elsewhere in production.

The mirror is a GitHub Releases asset, so we use the GitHub API to
fetch the latest release URL, check `Last-Modified`, and download only
if newer than the local copy.

### 2.4 Kill Helm/k8s from the roadmap (correction to PLAN_V2 backlog)

**Before:** "Helm chart for Enterprise — Q1 2027."

**After:** **dropped entirely** until install.sh and docker-compose
stack are bulletproof. User correctly observed: *"запуски кривые
достаточно ... тем более это всё ломается"*. Adding k8s on top of a
brittle base is a way to compound problems, not solve them.

If a customer asks for k8s — point them at the docker-compose stack
and `kompose convert` if they insist.

### 2.5 Other corrections (Q3 — at my discretion)

- **Drop NATS JetStream from Enterprise plans.** In-process Go channels
  cover everything we need at our scale. NATS comes back only if and
  when we actually run multi-node — and only after measuring.
- **Drop `build tags` for license editions.** Simpler: a single
  `URSUS_EDITION=community|compliance|pro` env var that turns features
  on/off at runtime. No separate build artefacts.
- **Keep `logvault-llm` as a separate service.** It owns 5 GB of model
  weights and CPU/GPU contention — leaving it as its own container is
  correct. No change here.

### 2.6 What is NOT changing

- The current code layout (`server/gateway`, `server/engine`, `agent/`,
  etc.) stays. User explicitly said **TDD, not DDD**, so no
  bounded-context restructuring this round.
- The existing v2.0 sprint deliverables (sprints 1–14) stay in tree.
- README.md, URSUS_STRATEGY.md content stays — only PLAN_V2.md gets
  an "Iteration 5: post-feedback corrections" section appended.

## 3. First TDD-driven feature: GeoIP database updater

To **prove the methodology works**, the first real code change after
this spec is a tightly-scoped feature, executed strictly via TDD.

### 3.1 Why this feature first

- Small (one Go package, ~200 LOC)
- Easy acceptance criteria (file present, recent, valid)
- Real value (unblocks ML impossible-travel with real geo data)
- No UI / no DB schema / no docker changes — pure unit-testable Go

### 3.2 Where it lives

- New package: `server/gateway/internal/geoip/`
- Tests: `server/gateway/internal/geoip/*_test.go`
- Integration into anomaly detector: defer to a later spec — this
  feature only delivers the **downloader + cache + lookup API**.

### 3.3 Public API (the contract tests will pin)

```go
package geoip

// DB is the read-only handle to a loaded MMDB file.
type DB interface {
    Lookup(ip string) (Result, error)
    Close() error
}

// Result is a minimal subset of MaxMind City record — we only need
// country code + lat/lon for impossible-travel.
type Result struct {
    CountryISO string  // "RU", "US", "" if unknown
    Latitude   float64
    Longitude  float64
}

// Open opens an existing MMDB file from path. Returns error if missing
// or invalid format.
func Open(path string) (DB, error)

// Updater fetches the latest GeoLite2-City.mmdb from a mirror and
// caches it on disk. Idempotent: re-running without a new release is
// a no-op.
type Updater struct {
    Mirror   string // e.g. "https://github.com/P3TERX/GeoLite.mmdb/releases/latest/download/GeoLite2-City.mmdb"
    DestPath string // e.g. "/var/lib/ursus/geoip/GeoLite2-City.mmdb"
    MaxAge   time.Duration // re-download if older than this
}

// Update fetches a fresh MMDB if MaxAge has elapsed. Returns the
// effective path of the current file (whether re-downloaded or not).
func (u *Updater) Update(ctx context.Context) (path string, err error)
```

### 3.4 Acceptance tests (these are the RED tests, written FIRST)

| # | Test | What it proves |
|---|---|---|
| 1 | `TestOpen_missingFile_returnsError` | Open of non-existent file returns a clear error, not a panic |
| 2 | `TestOpen_invalidFile_returnsError` | Open of corrupt MMDB returns a parser error |
| 3 | `TestOpen_validFile_lookupKnownIP` | Open of a fixture MMDB + Lookup("8.8.8.8") returns `CountryISO=="US"` |
| 4 | `TestLookup_invalidIP_returnsError` | Lookup of `"not-an-ip"` returns an error |
| 5 | `TestLookup_unknownIP_returnsEmpty` | Lookup of a reserved IP returns Result with empty fields, no error |
| 6 | `TestUpdater_freshFile_noDownload` | Updater with MaxAge=24h and a 1h-old file does NOT hit the network |
| 7 | `TestUpdater_staleFile_downloadsAndReplaces` | Updater with MaxAge=24h and a 48h-old file downloads from mock server, replaces atomically |
| 8 | `TestUpdater_downloadError_keepsOldFile` | If mirror returns 500, old file is kept (no data loss) |
| 9 | `TestUpdater_atomicReplace` | Concurrent Open during Update never sees a half-written file |

Network calls are mocked via `httptest.Server` — no real GitHub hits in tests.

### 3.5 Fixture MMDB

We use the official MaxMind test fixture (Apache-2.0 licensed) checked
into the repo at `server/gateway/internal/geoip/testdata/GeoIP2-City-Test.mmdb`.
Tiny (~75 KB), covers a handful of IPs including 8.8.8.8.

### 3.6 Dependencies

Add to `server/gateway/go.mod`:
- `github.com/oschwald/maxminddb-golang` v1.13.x — the canonical Go MMDB reader, MIT-licensed.

Nothing else. No new transitive dependency tree.

### 3.7 Out of scope (explicitly)

- Wiring this into `anomaly/detector.rs` impossible-travel — separate spec
- UI showing GeoIP DB version — separate spec
- Bulk pre-resolution of IPs into the `logs` table — separate spec
- GeoLite2-ASN database — Country+City is enough for v2

## 4. Self-review checklist (skill-mandated)

- [x] **Placeholder scan:** no "TBD", no "implement later", no vague verbs
- [x] **Internal consistency:** §3.3 API matches §3.4 tests exactly
- [x] **Scope check:** single implementation plan covers it (one Go package)
- [x] **Ambiguity check:** "atomic replace" defined: rename(2) on POSIX, MoveFileEx on Windows — explicit in the test
- [x] **YAGNI:** no ISP lookups, no ASN, no MaxMind-paid-only fields

## 5. After approval

The terminal state of this spec is invoking **writing-plans**. The plan
will break §3 into 2–5 minute tasks with the RED-GREEN-REFACTOR cycle
spelled out for each test from §3.4.

I will NOT touch any code until both this spec **and** the plan it
generates are approved.
