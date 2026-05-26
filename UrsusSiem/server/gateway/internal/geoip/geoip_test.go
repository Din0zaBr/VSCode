package geoip

import (
	"errors"
	"net"
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

func TestOpen_invalidFile_returnsError(t *testing.T) {
	_, err := Open("testdata/invalid.mmdb")
	if err == nil {
		t.Fatal("expected parse error, got nil")
	}
	// The error message should mention the path so operators can debug.
	if !contains(err.Error(), "invalid.mmdb") {
		t.Errorf("error %q does not mention the file path", err.Error())
	}
}

// contains is a tiny helper to avoid pulling strings into every test.
func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

func TestOpen_validFile_lookupKnownIP(t *testing.T) {
	db, err := Open("testdata/GeoIP2-City-Test.mmdb")
	if err != nil {
		t.Skipf("fixture not present, run `make geoip-testdata`: %v", err)
	}
	defer db.Close()

	// 81.2.69.142 is a documented record in the MaxMind test fixture.
	res, err := db.Lookup("81.2.69.142")
	if err != nil {
		t.Fatalf("Lookup failed: %v", err)
	}
	if res.CountryISO != "GB" {
		t.Errorf("CountryISO = %q, want GB", res.CountryISO)
	}
	if res.Latitude == 0 || res.Longitude == 0 {
		t.Errorf("expected non-zero coords, got lat=%v lon=%v", res.Latitude, res.Longitude)
	}
	// Sanity: the test address parses as IPv4.
	if ip := net.ParseIP("81.2.69.142"); ip == nil {
		t.Fatal("test address itself failed to parse")
	}
}

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

	// 240.0.0.1 is in 240/4 — reserved, never present in any geo DB.
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
