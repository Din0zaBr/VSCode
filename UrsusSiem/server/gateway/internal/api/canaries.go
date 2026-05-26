package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/notifications"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// Sprint 12 — honeypot canary endpoints.
//
// Workflow:
//   1. Operator deploys canaries through the UI (file path, AD account
//      name, DB table, web path).
//   2. The agent (or DB trigger / IIS log) reports access events
//      tagged with `canary_id` in meta.
//   3. We poll for those tags from the correlator/jobs side and call
//      RecordCanaryHit — auto-incident is created via notifications.

func (h *Handler) ListCanaries(c *gin.Context) {
	rows, err := h.db.ListCanaries(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"canaries": rows})
}

func (h *Handler) CreateCanary(c *gin.Context) {
	var in storage.Canary
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if in.Kind == "" || in.Name == "" || in.Location == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind, name, location required"})
		return
	}
	if user, ok := c.Get("username"); ok {
		in.DeployedBy, _ = user.(string)
	}
	out, err := h.db.CreateCanary(c.Request.Context(), in)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) DeleteCanary(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := h.db.DeleteCanary(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ListCanaryHits(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	rows, err := h.db.ListCanaryHits(c.Request.Context(), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"hits": rows})
}

// ReportCanaryHit is the endpoint called by agents / DB triggers / IIS
// monitor when a canary token is touched. Idempotent — the same event
// won't generate duplicate incidents because correlation rules dedupe
// on (canary_id, hour).
type CanaryHitInput struct {
	CanaryID    int    `json:"canary_id" binding:"required"`
	Actor       string `json:"actor"`
	Action      string `json:"action"`
	SourceEvent string `json:"source_event"`
	Notes       string `json:"notes"`
}

func (h *Handler) ReportCanaryHit(c *gin.Context) {
	var in CanaryHitInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	hit, err := h.db.RecordCanaryHit(c.Request.Context(), in.CanaryID,
		in.Actor, in.Action, in.SourceEvent, in.Notes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// Fire a critical notification immediately. Canary hits = zero-FP.
	if h.notif != nil {
		actor := in.Actor
		if actor == "" {
			actor = "unknown"
		}
		alert := notifications.Alert{
			ID:          "canary-" + strconv.FormatInt(hit.ID, 10),
			Severity:    "critical",
			Kind:        "canary",
			Title:       "Canary token triggered",
			Description: actor + " коснулся ловушки — высокая вероятность компрометации",
			DetectedAt:  time.Now().UTC(),
			Tags:        []string{"canary", "zero_fp"},
			Extra: map[string]any{
				"canary_id":    in.CanaryID,
				"actor":        actor,
				"action":       in.Action,
				"source_event": in.SourceEvent,
			},
		}
		go h.notif.Notify(c.Request.Context(), alert)
	}
	c.JSON(http.StatusCreated, hit)
}
