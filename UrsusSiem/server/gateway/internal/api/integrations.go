package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Integration sync endpoints. The actual integration pullers from the legacy
// Python service are not yet ported — this layer exposes sync log history and
// stats from the integration_sync_log table, plus a manual "kick" endpoint
// that records a synthetic run for now.

func (h *Handler) SyncLog(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
	logs, err := h.db.ListSyncLog(c.Request.Context(), c.Query("integration"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, logs)
}

func (h *Handler) SyncStats(c *gin.Context) {
	stats, err := h.db.SyncStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// TriggerSync schedules a sync run for the named integration. Without the
// upstream connector implementations this records an "ok" run with zero
// events; once integrations are ported they will be invoked from here.
func (h *Handler) TriggerSync(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "integration name required"})
		return
	}
	if err := h.db.RecordSyncRun(c.Request.Context(), name, "ok", 0, ""); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"integration": name,
		"status":      "queued",
		"note":        "connector implementation is being ported from Python; this run was a no-op",
	})
}
