package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// ── /api/correlation/rules ────────────────────────────────────────────────────

func (h *Handler) ListCorrelationRules(c *gin.Context) {
	rules, err := h.db.ListCorrelationRules(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if rules == nil {
		rules = []storage.CorrelationRule{}
	}
	c.JSON(http.StatusOK, rules)
}

func (h *Handler) CreateCorrelationRule(c *gin.Context) {
	var rule storage.CorrelationRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if rule.Severity == "" {
		rule.Severity = "medium"
	}

	result, err := h.db.CreateCorrelationRule(c.Request.Context(), &rule)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) UpdateCorrelationRule(c *gin.Context) {
	id := c.Param("id")
	var rule storage.CorrelationRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	result, err := h.db.UpdateCorrelationRule(c.Request.Context(), id, &rule)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, result)
}

func (h *Handler) DeleteCorrelationRule(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.DeleteCorrelationRule(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
