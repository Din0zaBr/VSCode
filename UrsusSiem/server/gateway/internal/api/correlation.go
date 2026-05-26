package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// CorrelationAlerts returns active correlation alerts with optional status filter.
func (h *Handler) CorrelationAlerts(c *gin.Context) {
	status := c.Query("status")

	alerts, err := h.db.GetCorrelationAlerts(c.Request.Context(), status)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"alerts": alerts})
}

type UpdateAlertRequest struct {
	Status string `json:"status" binding:"required"`
	Note   string `json:"note"`
}

// UpdateAlertStatus sets the status (open/acknowledged/resolved) on a correlation alert.
func (h *Handler) UpdateAlertStatus(c *gin.Context) {
	id := c.Param("id")

	var req UpdateAlertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	username, _ := c.Get("username")

	if err := h.db.UpdateAlertStatus(c.Request.Context(), id, req.Status, req.Note, username.(string)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
