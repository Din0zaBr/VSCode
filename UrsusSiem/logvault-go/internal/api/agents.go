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

	// Normalize to a format the frontend expects (agent_id, host, active, timestamp, etc.)
	type AgentOut struct {
		AgentID    string `json:"agent_id"`
		Host       string `json:"host"`
		Status     string `json:"status"`
		Active     bool   `json:"active"`
		Timestamp  string `json:"timestamp"`
		EventCount int64  `json:"event_count"`
	}
	out := make([]AgentOut, 0, len(agents))
	for _, a := range agents {
		out = append(out, AgentOut{
			AgentID:    a.AgentID,
			Host:       a.Host,
			Status:     a.Status,
			Active:     a.Status == "online",
			Timestamp:  a.LastSeen.UTC().Format("2006-01-02T15:04:05Z"),
			EventCount: a.EventCount,
		})
	}
	c.JSON(http.StatusOK, gin.H{"agents": out})
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
