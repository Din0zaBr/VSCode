package api

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/ursus-siem/logvault-go/internal/storage"
)

// vectorEvent matches the default Vector `http` sink payload (one JSON
// object per line). We accept any fields and pick the ones we know.
type vectorEvent struct {
	Timestamp  any            `json:"timestamp,omitempty"`
	Host       string         `json:"host,omitempty"`
	Hostname   string         `json:"hostname,omitempty"`
	Source     string         `json:"source,omitempty"`
	SourceType string         `json:"source_type,omitempty"`
	Level      string         `json:"level,omitempty"`
	Severity   string         `json:"severity,omitempty"`
	Message    string         `json:"message,omitempty"`
	Service    string         `json:"service,omitempty"`
	AppName    string         `json:"appname,omitempty"`
	EventID    string         `json:"event_id,omitempty"`
	Meta       map[string]any `json:"meta,omitempty"`
}

// HandleIngestVector accepts NDJSON (one JSON object per line) — the wire
// format Vector emits by default with the `http` sink and encoding=ndjson.
//
// Authentication: X-Api-Key (same as /api/ingest).
// Agent ID: taken from the X-Agent-Id header, falling back to the source IP.
//
// Example client side:
//   sinks:
//     ursus:
//       type: http
//       inputs: [...]
//       uri: https://ursus/api/ingest/vector
//       encoding:
//         codec: ndjson
//       request:
//         headers:
//           X-Api-Key: changeme-agent-key
//           X-Agent-Id: web-01
func (h *Handler) HandleIngestVector(c *gin.Context) {
	agentID := c.GetHeader("X-Agent-Id")
	if agentID == "" {
		agentID = "vector:" + clientIP(c)
	}

	events, parsed, err := readNDJSON(c.Request.Body, h.cfg.MaxBatchSize, agentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if parsed == 0 {
		c.JSON(http.StatusOK, IngestResponse{OK: true, Indexed: 0})
		return
	}

	inserted, errCount := h.db.BulkIndex(c.Request.Context(), events)
	for _, e := range events {
		h.hub.Broadcast(e)
	}
	c.JSON(http.StatusOK, IngestResponse{
		OK:      true,
		Indexed: inserted,
		Errors:  errCount,
	})
}

// readNDJSON decodes a stream of newline-separated JSON objects.
// Returns events ready for storage.BulkIndex and the count of lines parsed
// (including malformed ones, which are silently skipped — Vector's own
// retry logic handles transient errors at HTTP level).
func readNDJSON(body io.Reader, maxBatch int, agentID string) ([]storage.LogEvent, int, error) {
	if maxBatch <= 0 {
		maxBatch = 5000
	}
	scanner := bufio.NewScanner(body)
	// Allow up to 1 MB per line — log lines can be huge (TLS handshakes, stacktraces)
	scanner.Buffer(make([]byte, 64*1024), 1<<20)

	events := make([]storage.LogEvent, 0, 128)
	parsed := 0
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		parsed++
		if parsed > maxBatch {
			return nil, parsed, fmt.Errorf("batch too large (>%d events)", maxBatch)
		}
		var ve vectorEvent
		if err := json.Unmarshal([]byte(line), &ve); err != nil {
			continue // tolerate malformed lines
		}
		events = append(events, ve.toLogEvent(agentID))
	}
	if err := scanner.Err(); err != nil {
		return nil, parsed, fmt.Errorf("read: %w", err)
	}
	return events, parsed, nil
}

func (ve vectorEvent) toLogEvent(agentID string) storage.LogEvent {
	host := ve.Host
	if host == "" {
		host = ve.Hostname
	}
	src := ve.SourceType
	if src == "" {
		src = ve.Source
	}
	level := strings.ToLower(ve.Level)
	if level == "" {
		level = strings.ToLower(ve.Severity)
	}
	if level == "" {
		level = "info"
	}
	service := ve.Service
	if service == "" {
		service = ve.AppName
	}
	eventID := ve.EventID
	if eventID == "" {
		eventID = uuid.NewString()
	}

	ts := parseFlexibleTime(ve.Timestamp)
	meta := ve.Meta
	if meta == nil {
		meta = map[string]any{}
	}
	meta["ingest.source"] = "vector"

	return storage.LogEvent{
		EventID:   eventID,
		Timestamp: ts,
		Host:      host,
		AgentID:   agentID,
		Source:    src,
		Level:     level,
		Message:   ve.Message,
		Service:   service,
		Meta:      meta,
	}
}

// parseFlexibleTime accepts:
//   - RFC3339 string
//   - ISO8601 without offset (assumed UTC)
//   - numeric epoch in seconds, milliseconds, or nanoseconds
//   - nil / empty → time.Now()
func parseFlexibleTime(v any) time.Time {
	if v == nil {
		return time.Now().UTC()
	}
	switch t := v.(type) {
	case string:
		if t == "" {
			return time.Now().UTC()
		}
		for _, layout := range []string{
			time.RFC3339Nano, time.RFC3339,
			"2006-01-02T15:04:05.000Z", "2006-01-02T15:04:05Z",
			"2006-01-02 15:04:05",
		} {
			if parsed, err := time.Parse(layout, t); err == nil {
				return parsed.UTC()
			}
		}
	case float64:
		// Distinguish seconds, ms, μs, ns by magnitude
		switch {
		case t < 1e10: // seconds
			return time.Unix(int64(t), 0).UTC()
		case t < 1e13: // ms
			return time.Unix(0, int64(t)*1e6).UTC()
		case t < 1e16: // μs
			return time.Unix(0, int64(t)*1e3).UTC()
		default: // ns
			return time.Unix(0, int64(t)).UTC()
		}
	}
	return time.Now().UTC()
}

func clientIP(c *gin.Context) string {
	if h := c.GetHeader("X-Forwarded-For"); h != "" {
		// trust first IP in the list
		if comma := strings.IndexByte(h, ','); comma > 0 {
			return strings.TrimSpace(h[:comma])
		}
		return strings.TrimSpace(h)
	}
	return c.ClientIP()
}
