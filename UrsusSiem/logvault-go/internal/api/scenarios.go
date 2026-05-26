package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

func (h *Handler) ListScenarios(c *gin.Context) {
	scs, err := h.db.ListScenarios(c.Request.Context(), c.Query("criticality"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if scs == nil {
		scs = []storage.Scenario{}
	}
	c.JSON(http.StatusOK, scs)
}

func (h *Handler) GetScenario(c *gin.Context) {
	s, err := h.db.GetScenario(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if s == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, s)
}

func (h *Handler) CreateScenario(c *gin.Context) {
	var s storage.Scenario
	if err := c.ShouldBindJSON(&s); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if s.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name required"})
		return
	}
	if user, exists := c.Get("username"); exists {
		s.CreatedBy, _ = user.(string)
	}
	out, err := h.db.CreateScenario(c.Request.Context(), s)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) UpdateScenario(c *gin.Context) {
	var s storage.Scenario
	if err := c.ShouldBindJSON(&s); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.db.UpdateScenario(c.Request.Context(), c.Param("id"), s); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteScenario(c *gin.Context) {
	if err := h.db.DeleteScenario(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
