# geoip

In-process GeoIP lookups for the URSUS gateway. Backed by MaxMind's
canonical MMDB format. The database is refreshed daily from the public
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
download failure the existing file is preserved (no data loss). The
write is staged to a sibling `.tmp` file and `rename`d into place.

## Testing

Tests use the official MaxMind test fixture (Apache-2.0). Fetch it once:

```bash
make -C server/gateway geoip-testdata     # or the curl command in testdata/README.md
go test ./internal/geoip/... -v -race
```

## Known limitations

- `os.Rename` is not atomic under open file handles on **Windows**.
  `TestUpdater_atomicReplace_noHalfWrittenFile` skips on Windows.
  Linux/macOS production hosts (the only supported deployment targets)
  behave correctly.
- The reader keeps an mmap on the MMDB file. After `Updater.Update`
  swaps the file, existing `DB` handles still see the old data —
  reopen the DB to pick up the new file. Wiring a periodic reopen into
  the gateway is a separate task (not part of this package's scope).

## Scope

This package delivers the **downloader + cache + lookup API** only.
Integration into the anomaly detector's impossible-travel check, the UI
"GeoIP DB version" display, and bulk pre-resolution of IPs into the
`logs` table are tracked as separate specs.
