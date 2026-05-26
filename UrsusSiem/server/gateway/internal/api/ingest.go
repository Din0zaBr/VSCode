package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/ursus-siem/logvault-go/internal/engine"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

type IngestRequest struct {
	AgentID string              `json:"agent_id" binding:"required"`
	Logs    []storage.IngestLog `json:"logs"     binding:"required"`
}

type IngestResponse struct {
	OK      bool `json:"ok"`
	Indexed int  `json:"indexed"`
	Errors  int  `json:"errors"`
}

// HandleIngest processes a batch of log events from an agent.
// 1. Sends to Rust engine for parsing/enrichment.
// 2. Bulk-inserts enriched events into PostgreSQL.
// 3. Broadcasts to live WebSocket hub.
func (h *Handler) HandleIngest(c *gin.Context) {
	var req IngestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.Logs) > h.cfg.MaxBatchSize {
		c.JSON(http.StatusBadRequest, gin.H{"error": "batch too large"})
		return
	}

	// Build parse request for Rust engine
	parseReq := engine.ParseBatchRequest{
		Events: make([]engine.ParseEvent, 0, len(req.Logs)),
	}
	for _, log := range req.Logs {
		eventID := log.EventID
		if eventID == "" {
			eventID = uuid.New().String()
		}
		ts := log.Timestamp
		if ts == "" {
			ts = time.Now().UTC().Format(time.RFC3339Nano)
		}
		parseReq.Events = append(parseReq.Events, engine.ParseEvent{
			EventID:   eventID,
			Timestamp: ts,
			Host:      log.Host,
			AgentID:   req.AgentID,
			Source:    log.Source,
			Level:     log.Level,
			Message:   log.Message,
			Service:   log.Service,
		})
	}

	// Send to Rust engine for enrichment
	enriched, err := h.engine.ParseBatch(c.Request.Context(), parseReq)
	if err != nil {
		// Fallback: index raw events without enrichment
		h.ingestRaw(c, req)
		return
	}

	// Convert enriched events to storage format
	storageEvents := make([]storage.LogEvent, 0, len(enriched.Events))
	for _, e := range enriched.Events {
		storageEvents = append(storageEvents, storage.LogEvent{
			EventID:   e.EventID,
			Timestamp: e.Timestamp,
			Host:      e.Host,
			AgentID:   e.AgentID,
			Source:    e.Source,
			Level:     e.Level,
			Message:   e.Message,
			Service:   e.Service,
			Meta:      e.Meta,
		})
	}

	inserted, errors := h.db.BulkIndex(c.Request.Context(), storageEvents)

	// Broadcast to live WebSocket subscribers
	for _, e := range storageEvents {
		h.hub.Broadcast(e)
	}

	c.JSON(http.StatusOK, IngestResponse{
		OK:      true,
		Indexed: inserted,
		Errors:  errors + enriched.Errors,
	})
}

// ingestRaw is a fallback path when the Rust engine is unavailable.
func (h *Handler) ingestRaw(c *gin.Context, req IngestRequest) {
	events := make([]storage.LogEvent, 0, len(req.Logs))
	for _, log := range req.Logs {
		ts, err := time.Parse(time.RFC3339Nano, log.Timestamp)
		if err != nil {
			ts = time.Now().UTC()
		}
		eventID := log.EventID
		if eventID == "" {
			eventID = uuid.New().String()
		}
		events = append(events, storage.LogEvent{
			EventID:   eventID,
			Timestamp: ts,
			Host:      log.Host,
			AgentID:   req.AgentID,
			Source:    log.Source,
			Level:     log.Level,
			Message:   log.Message,
			Service:   log.Service,
			Meta:      log.Meta,
		})
	}

	inserted, errors := h.db.BulkIndex(c.Request.Context(), events)
	c.JSON(http.StatusOK, IngestResponse{
		OK:      true,
		Indexed: inserted,
		Errors:  errors,
	})
}
