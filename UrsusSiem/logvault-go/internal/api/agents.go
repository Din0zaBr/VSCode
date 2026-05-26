package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// Agents returns a list of all known agents with last-seen time and event counts.
func (h *Handler) Agents(c *gin.Context) {
	agents, err := h.db.QueryAgents(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"agents": agents})
}

// Hosts returns distinct host values seen in log events.
func (h *Handler) Hosts(c *gin.Context) {
	hosts, err := h.db.QueryDistinct(c.Request.Context(), "host")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"hosts": hosts})
}
