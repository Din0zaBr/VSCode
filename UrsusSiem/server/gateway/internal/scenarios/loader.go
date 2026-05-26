// Package scenarios loads bundled YAML scenarios (configs/scenarios/) and
// keeps an in-memory toggle registry. Per-tenant overrides are stored in
// the existing incident_scenarios table — this package only owns the
// defaults shipped with the binary.
package scenarios

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"gopkg.in/yaml.v3"
)

// Scenario is the in-memory representation of one YAML entry. It is a
// superset of fields used by the UI; unknown YAML keys are kept under Raw.
type Scenario struct {
	ID          string            `yaml:"id"            json:"id"`
	Name        string            `yaml:"name"          json:"name"`
	Category    string            `yaml:"category"      json:"category"`
	Severity    string            `yaml:"severity"      json:"severity"`
	Enabled     bool              `yaml:"enabled"       json:"enabled"`
	Description string            `yaml:"description"   json:"description"`
	Mitre       []string          `yaml:"mitre"         json:"mitre,omitempty"`
	SigmaRules  []string          `yaml:"sigma_rules"   json:"sigma_rules,omitempty"`
	Threshold   map[string]any    `yaml:"threshold"     json:"threshold,omitempty"`
	Actions     []string          `yaml:"actions"       json:"actions,omitempty"`
	Baseline    map[string]any    `yaml:"baseline"      json:"baseline,omitempty"`
	Remediation string            `yaml:"remediation"   json:"remediation,omitempty"`
	Source      string            `json:"source"` // "bundled" | "custom"
}

type bundleFile struct {
	Scenarios []Scenario `yaml:"scenarios"`
}

// Registry is the runtime store. Safe for concurrent reads.
type Registry struct {
	mu        sync.RWMutex
	scenarios map[string]*Scenario
}

func NewRegistry() *Registry {
	return &Registry{scenarios: make(map[string]*Scenario)}
}

// LoadDir reads every *.yaml file under dir and merges scenarios.
// Last-wins on duplicate IDs (logged at WARN by the caller).
func (r *Registry) LoadDir(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read scenarios dir: %w", err)
	}
	loaded := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".yaml") && !strings.HasSuffix(name, ".yml") {
			continue
		}
		path := filepath.Join(dir, name)
		body, err := os.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read %s: %w", path, err)
		}
		var f bundleFile
		if err := yaml.Unmarshal(body, &f); err != nil {
			return fmt.Errorf("parse %s: %w", path, err)
		}
		r.mu.Lock()
		for i := range f.Scenarios {
			s := f.Scenarios[i]
			if s.ID == "" {
				continue
			}
			s.Source = "bundled"
			r.scenarios[s.ID] = &s
			loaded++
		}
		r.mu.Unlock()
	}
	if loaded == 0 {
		return fmt.Errorf("no scenarios loaded from %s", dir)
	}
	return nil
}

// List returns a deterministic snapshot. Callers may freely modify the
// returned slice.
func (r *Registry) List() []Scenario {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]Scenario, 0, len(r.scenarios))
	for _, s := range r.scenarios {
		out = append(out, *s)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// Get returns a copy of the requested scenario or nil.
func (r *Registry) Get(id string) *Scenario {
	r.mu.RLock()
	defer r.mu.RUnlock()
	s, ok := r.scenarios[id]
	if !ok {
		return nil
	}
	c := *s
	return &c
}

// Toggle flips the in-memory enabled bit. Persistence (per-tenant) is
// handled by the storage layer separately.
func (r *Registry) Toggle(id string, enabled bool) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	s, ok := r.scenarios[id]
	if !ok {
		return false
	}
	s.Enabled = enabled
	return true
}

// Count returns the number of registered scenarios.
func (r *Registry) Count() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.scenarios)
}
