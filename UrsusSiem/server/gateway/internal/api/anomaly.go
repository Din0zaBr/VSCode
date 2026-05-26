package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/engine"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// ListAnomalyAlerts returns persisted anomaly_alerts rows.
func (h *Handler) ListAnomalyAlerts(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	alerts, err := h.db.ListAnomalyAlerts(c.Request.Context(),
		c.Query("status"), c.Query("kind"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"alerts": alerts})
}

// UpdateAnomalyStatus PATCH /api/anomaly/alerts/:id  { "status": "..." }
func (h *Handler) UpdateAnomalyStatus(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var req struct {
		Status string `json:"status" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	switch req.Status {
	case "open", "acknowledged", "resolved", "false_positive":
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
		return
	}
	if err := h.db.UpdateAnomalyStatus(c.Request.Context(), id, req.Status); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ListBaseline returns the current behavioural baseline (for inspection / UI).
func (h *Handler) ListBaseline(c *gin.Context) {
	rows, err := h.db.LoadBaseline(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"baseline": rows, "rows": len(rows)})
}

// CheckDomain POST /api/anomaly/check-domain  { "domains": [...], "threshold": 0.7 }
// Wraps the Rust /anomaly/dga endpoint for on-demand scoring.
func (h *Handler) CheckDomain(c *gin.Context) {
	var req engine.DgaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.Domains) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "domains list required"})
		return
	}
	if req.Threshold == 0 {
		req.Threshold = 0.7
	}
	resp, err := h.engine.CheckDGA(c.Request.Context(), req)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}

// DetectNow runs a one-shot detection on the last N minutes (admin tool).
func (h *Handler) DetectNow(c *gin.Context) {
	minutes, _ := strconv.Atoi(c.DefaultQuery("minutes", "60"))
	if minutes <= 0 || minutes > 24*60 {
		minutes = 60
	}

	baseline, err := h.db.LoadBaseline(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(baseline) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"alerts":  []any{},
			"warning": "baseline пуст — вызовите POST /api/anomaly/baseline/rebuild или дождитесь ночного прохода",
		})
		return
	}

	since := time.Now().Add(-time.Duration(minutes) * time.Minute)
	events, err := h.db.RecentEvents(c.Request.Context(), since, 30000)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	resp, err := h.engine.Detect(c.Request.Context(), engine.DetectRequest{
		Baseline:   baselineToEngine(baseline),
		Events:     eventsToEngine(events),
		ZThreshold: 3.0,
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"alerts":         resp.Alerts,
		"window_minutes": minutes,
		"events_scored":  len(events),
	})
}

// RebuildBaseline triggers a baseline rebuild on demand (admin tool).
func (h *Handler) RebuildBaseline(c *gin.Context) {
	since := time.Now().Add(-14 * 24 * time.Hour)
	events, err := h.db.RecentEvents(c.Request.Context(), since, 200000)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(events) < 100 {
		c.JSON(http.StatusOK, gin.H{
			"warning": "недостаточно истории событий (нужно минимум 100)",
			"events":  len(events),
		})
		return
	}

	resp, err := h.engine.BuildBaseline(c.Request.Context(), engine.BaselineRequest{
		Events: eventsToEngine(events),
	})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	rows := make([]storage.BaselineRow, 0, len(resp.Entries))
	for _, e := range resp.Entries {
		rows = append(rows, storage.BaselineRow{
			ProfileKey: e.ProfileKey,
			Metric:     e.Metric,
			HourBucket: e.HourBucket,
			MeanValue:  e.MeanValue,
			Stddev:     e.Stddev,
			SampleSize: int(e.SampleSize),
		})
	}
	if err := h.db.ReplaceBaseline(c.Request.Context(), rows); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"profiles_built": resp.ProfilesBuilt,
		"rows_persisted": len(rows),
		"events":         resp.EventsProcessed,
	})
}

// ── Local helpers ───────────────────────────────────────────────────────────

func baselineToEngine(rows []storage.BaselineRow) []engine.BaselineEntry {
	out := make([]engine.BaselineEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, engine.BaselineEntry{
			ProfileKey: r.ProfileKey,
			Metric:     r.Metric,
			HourBucket: r.HourBucket,
			MeanValue:  r.MeanValue,
			Stddev:     r.Stddev,
			SampleSize: uint32(r.SampleSize),
		})
	}
	return out
}

func eventsToEngine(events []storage.LogEvent) []engine.AnomalyEvent {
	out := make([]engine.AnomalyEvent, 0, len(events))
	for _, e := range events {
		out = append(out, engine.AnomalyEvent{
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
	return out
}
