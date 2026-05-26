package api

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// ListAssets returns persistent asset records (the `assets` table), with
// optional search/criticality/status filters and pagination.
func (h *Handler) ListAssets(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
	if offset < 0 {
		offset = 0
	}
	res, err := h.db.ListAssetsFiltered(c.Request.Context(),
		c.Query("search"), c.Query("criticality"), c.Query("status"), limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

func (h *Handler) GetAsset(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	a, err := h.db.GetAsset(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if a == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, a)
}

func (h *Handler) CreateAsset(c *gin.Context) {
	var a storage.Asset
	if err := c.ShouldBindJSON(&a); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if a.Hostname == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "hostname required"})
		return
	}
	out, err := h.db.CreateAsset(c.Request.Context(), a)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) UpdateAsset(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var a storage.Asset
	if err := c.ShouldBindJSON(&a); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.db.UpdateAsset(c.Request.Context(), id, a); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteAsset(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := h.db.DeleteAsset(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// DiscoverAssets auto-creates asset records from distinct hosts seen in logs.
func (h *Handler) DiscoverAssets(c *gin.Context) {
	hosts, err := h.db.QueryHostsFromLogs(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	created := 0
	for _, host := range hosts {
		if host.Host == "" {
			continue
		}
		ip := host.IP
		if _, err := h.db.CreateAsset(c.Request.Context(), storage.Asset{
			Hostname:    host.Host,
			IP:          &ip,
			Criticality: "medium",
			Status:      "active",
			Tags:        json.RawMessage("[]"),
		}); err == nil {
			created++
		}
	}
	c.JSON(http.StatusOK, gin.H{"discovered": len(hosts), "created": created})
}
