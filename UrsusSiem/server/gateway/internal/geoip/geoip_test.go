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
