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

The file is ~75 KB and contains lookups for 81.2.69.142 and several
private/documented test ranges.

`invalid.mmdb` (committed) is just a literal text file used by the
"corrupt file" test — no real MMDB content.
