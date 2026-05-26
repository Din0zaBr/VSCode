package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

func (h *Handler) ListCustomFields(c *gin.Context) {
	fs, err := h.db.ListCustomFields(c.Request.Context(), c.Query("entity_type"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if fs == nil {
		fs = []storage.CustomField{}
	}
	c.JSON(http.StatusOK, fs)
}

func (h *Handler) CreateCustomField(c *gin.Context) {
	var cf storage.CustomField
	if err := c.ShouldBindJSON(&cf); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if cf.FieldName == "" || cf.FieldLabel == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "field_name and field_label required"})
		return
	}
	out, err := h.db.CreateCustomField(c.Request.Context(), cf)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) UpdateCustomField(c *gin.Context) {
	var cf storage.CustomField
	if err := c.ShouldBindJSON(&cf); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.db.UpdateCustomField(c.Request.Context(), c.Param("id"), cf); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteCustomField(c *gin.Context) {
	if err := h.db.DeleteCustomField(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}
