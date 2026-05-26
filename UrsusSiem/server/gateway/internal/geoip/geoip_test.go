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
