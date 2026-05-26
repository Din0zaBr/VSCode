package api

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Stats returns aggregated time-series, level, and host statistics.
func (h *Handler) Stats(c *gin.Context) {
	interval := c.DefaultQuery("interval", "1h")

	from := time.Now().UTC().Add(-24 * time.Hour)
	to := time.Now().UTC()

	if fromStr := c.Query("from"); fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			from = t
		}
	}
	if toStr := c.Query("to"); toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			to = t
		}
	}

	result, err := h.db.GetStats(c.Request.Context(), interval, from, to)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
