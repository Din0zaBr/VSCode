package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Bundled-scenarios endpoints. The legacy /api/scenarios (DB-backed) handler
// stays for per-tenant overrides; these new routes expose the YAML defaults
// shipped with the binary (Sprint 2).

func (h *Handler) ListBundledScenarios(c *gin.Context) {
	if h.scenarios == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "scenarios registry not initialised"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"scenarios": h.scenarios.List(),
		"count":     h.scenarios.Count(),
	})
}

func (h *Handler) GetBundledScenario(c *gin.Context) {
	s := h.scenarios.Get(c.Param("id"))
	if s == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "scenario not found"})
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) ToggleBundledScenario(c *gin.Context) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !h.scenarios.Toggle(c.Param("id"), req.Enabled) {
		c.JSON(http.StatusNotFound, gin.H{"error": "scenario not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "enabled": req.Enabled})
}
