package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// ListAssets returns known network assets derived from log metadata.
func (h *Handler) ListAssets(c *gin.Context) {
	assets, err := h.db.QueryAssets(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"assets": assets, "total": len(assets)})
}
