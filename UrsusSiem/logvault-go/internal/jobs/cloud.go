package jobs

import (
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"time"

	"github.com/ursus-siem/logvault-go/internal/cloud"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// StartCloudPulls launches the cloud-connector scheduler. Every
// `interval` we walk cloud_connectors WHERE enabled=true, invoke the
// matching cloud.Connector.Pull, ingest its events through BulkIndex,
// and persist the new cursor + last_count + last_error.
func StartCloudPulls(ctx context.Context, db *storage.DB, interval time.Duration) {
	if interval <= 0 {
		interval = 5 * time.Minute
	}
	go runLoop(ctx, "cloud-pulls", interval, 30*time.Second, func(c context.Context) {
		if err := pullAllClouds(c, db); err != nil {
			slog.Warn("cloud pulls failed", "error", err)
		}
	})
}

type connectorRow struct {
	id          int
	name        string
	provider    string
	credentials json.RawMessage
	options     json.RawMessage
	cursor      string
}

func pullAllClouds(ctx context.Context, db *storage.DB) error {
	pool := db.PoolForJobs()
	rows, err := pool.Query(ctx, `
		SELECT id, name, provider, credentials, options, cursor
		FROM cloud_connectors WHERE enabled = true`)
	if err != nil {
		return err
	}
	defer rows.Close()
	var connectors []connectorRow
	for rows.Next() {
		var r connectorRow
		if err := rows.Scan(&r.id, &r.name, &r.provider, &r.credentials, &r.options, &r.cursor); err == nil {
			connectors = append(connectors, r)
		}
	}

	for _, c := range connectors {
		conn, ok := cloud.Get(c.provider)
		if !ok {
			slog.Warn("cloud provider not registered", "provider", c.provider)
			continue
		}
		creds := map[string]string{}
		opts := map[string]string{}
		_ = json.Unmarshal(c.credentials, &creds)
		_ = json.Unmarshal(c.options, &opts)
		res, err := conn.Pull(ctx, cloud.Config{
			Name:        c.name,
			Credentials: creds,
			Options:     opts,
			Cursor:      c.cursor,
		})
		if err != nil {
			_, _ = pool.Exec(ctx,
				`UPDATE cloud_connectors SET last_pull_at=NOW(), last_error=$1 WHERE id=$2`,
				err.Error(), c.id)
			continue
		}

		// Convert cloud.Event → storage.LogEvent and BulkIndex.
		evts := make([]storage.LogEvent, 0, len(res.Events))
		for _, e := range res.Events {
			eventID := strings.Join([]string{c.name, e.Timestamp.Format(time.RFC3339Nano), e.Source, e.Message}, "|")
			evts = append(evts, storage.LogEvent{
				EventID:   eventID,
				Timestamp: e.Timestamp,
				Host:      e.Host,
				AgentID:   "cloud:" + c.name,
				Source:    e.Source,
				Level:     e.Level,
				Message:   e.Message,
				Service:   e.Service,
				Meta:      e.Meta,
			})
		}
		inserted, _ := db.BulkIndex(ctx, evts)

		_, _ = pool.Exec(ctx, `
			UPDATE cloud_connectors
			   SET last_pull_at = NOW(), last_count = $1, cursor = $2, last_error = NULL
			 WHERE id = $3`,
			inserted, res.NextCursor, c.id)
		slog.Info("cloud pull", "provider", c.provider, "name", c.name, "events", inserted)
	}
	return nil
}
