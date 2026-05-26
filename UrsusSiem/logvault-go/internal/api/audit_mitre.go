package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// Sprint 3 endpoints: audit-log read API + MITRE coverage heatmap.

func (h *Handler) ListAuditLog(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	rows, err := h.db.ListAudit(c.Request.Context(),
		c.Query("actor"), c.Query("action"), c.Query("target_type"), limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"entries": rows})
}

func (h *Handler) MitreCoverage(c *gin.Context) {
	rows, err := h.db.MitreCoverage(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"coverage":   rows,
		"techniques": len(rows),
	})
}

func (h *Handler) RefreshMitreCoverage(c *gin.Context) {
	if err := h.db.RefreshMitreCoverage(c.Request.Context()); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
