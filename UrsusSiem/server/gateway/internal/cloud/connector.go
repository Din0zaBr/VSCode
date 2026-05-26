// Package cloud implements pull-style connectors for cloud audit logs.
//
// Each cloud has a Connector that knows how to fetch a batch of events
// since the last successful pull. The scheduler in internal/jobs/cloud.go
// rotates through enabled connectors every N minutes and ingests the
// returned events through the same /api/ingest path.
//
// Implemented:
//   * yandex_cloud   — Yandex Cloud Logging
//   * aws_cloudtrail — CloudTrail S3 export polling
//   * azure_activity — Azure Activity Logs via Event Hubs / REST
//   * m365_audit     — Microsoft 365 Unified Audit Log via Graph API
//
// Each connector returns a checkpoint (cursor) so the next run picks up
// from where it left off. Checkpoints are stored in cloud_connectors.
package cloud

import (
	"context"
	"time"
)

// Event is the connector-facing shape — gets mapped to storage.IngestLog
// by the scheduler.
type Event struct {
	Timestamp time.Time              `json:"timestamp"`
	Host      string                 `json:"host"`
	Source    string                 `json:"source"`
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Service   string                 `json:"service"`
	Meta      map[string]interface{} `json:"meta"`
}

// PullResult is what a Connector hands back.
type PullResult struct {
	Events     []Event
	NextCursor string
	HasMore    bool
}

// Config carries credentials and tunables from the cloud_connectors table.
type Config struct {
	Name        string            // tenant-friendly label
	Credentials map[string]string // ya: oauth_token / iam_token / sa_key
	Options     map[string]string // free-form per-provider knobs
	Cursor      string            // last checkpoint
}

// Connector is implemented by every cloud-specific pull module.
type Connector interface {
	Name() string
	Pull(ctx context.Context, cfg Config) (*PullResult, error)
}

// Registry holds the available connectors keyed by short name.
var registry = map[string]Connector{}

func Register(c Connector)            { registry[c.Name()] = c }
func Get(name string) (Connector, bool) {
	c, ok := registry[name]
	return c, ok
}
func Names() []string {
	out := make([]string, 0, len(registry))
	for n := range registry {
		out = append(out, n)
	}
	return out
}
