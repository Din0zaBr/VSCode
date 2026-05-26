package api

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/engine"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// Search handles full-text + field filter queries over the logs table.
func (h *Handler) Search(c *gin.Context) {
	p := storage.SearchParams{
		Query:   c.Query("q"),
		Level:   c.Query("level"),
		AgentID: c.Query("agent_id"),
		Service: c.Query("service"),
		Host:    c.Query("host"),
		Source:  c.Query("source"),
	}

	if fromStr := c.Query("from"); fromStr != "" {
		if t, err := time.Parse(time.RFC3339, fromStr); err == nil {
			p.From = t
		}
	}
	if toStr := c.Query("to"); toStr != "" {
		if t, err := time.Parse(time.RFC3339, toStr); err == nil {
			p.To = t
		}
	}
	if pageStr := c.Query("page"); pageStr != "" {
		if v, err := strconv.Atoi(pageStr); err == nil {
			p.Page = v
		}
	}
	if sizeStr := c.Query("size"); sizeStr != "" {
		if v, err := strconv.Atoi(sizeStr); err == nil {
			p.Size = v
		}
	}

	results, total, err := h.db.Search(c.Request.Context(), p)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"hits":  results,
		"total": total,
		"page":  p.Page,
		"size":  p.Size,
	})
}

// SearchPDQL translates and executes a PDQL query via the Rust engine.
func (h *Handler) SearchPDQL(c *gin.Context) {
	query := c.Query("q")
	if query == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "q parameter required"})
		return
	}

	username, _ := c.Get("username")
	role, _ := c.Get("role")

	var allowedAgents []string
	if role != "admin" {
		// Non-admin users are restricted to their own agent data.
		// In production, populate this from a user-agent mapping table.
		allowedAgents = []string{}
	}

	maxLimit := 500
	pdqlReq := engine.PdqlRequest{
		Query:         query,
		AllowedAgents: allowedAgents,
		MaxLimit:      &maxLimit,
	}

	translated, err := h.engine.TranslatePDQL(c.Request.Context(), pdqlReq)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "user": username})
		return
	}

	results, err := h.db.ExecPDQL(c.Request.Context(), translated.SQL, translated.Params)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"hits":  results,
		"total": len(results),
		"sql":   translated.SQL,
	})
}
