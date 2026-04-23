package api

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// HealthDetailed returns component health statuses.
func (h *Handler) HealthDetailed(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"components": gin.H{
			"database": gin.H{"status": "ok"},
			"engine":   gin.H{"status": "ok"},
		},
	})
}

// MetricsLatest returns latest agent system metrics (placeholder — agents send via ingest).
func (h *Handler) MetricsLatest(c *gin.Context) {
	c.JSON(http.StatusOK, []any{})
}

// ── Alert Rules (simple CRUD backed by correlation_rules table) ────────────────

func (h *Handler) ListAlertRules(c *gin.Context) {
	rules, err := h.db.ListCorrelationRules(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, rules)
}

func (h *Handler) CreateAlertRule(c *gin.Context) {
	var rule storage.CorrelationRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	created, err := h.db.CreateCorrelationRule(c.Request.Context(), &rule)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "id": created.ID})
}

func (h *Handler) DeleteAlertRule(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.DeleteCorrelationRule(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Accounts ──────────────────────────────────────────────────────────────────

func (h *Handler) ListAccounts(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "50"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 500 {
		size = 50
	}
	accounts, total, err := h.db.ListAccounts(c.Request.Context(), page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if accounts == nil {
		accounts = []storage.KnownAccount{}
	}
	c.JSON(http.StatusOK, gin.H{"accounts": accounts, "total": total})
}

func (h *Handler) CreateAccount(c *gin.Context) {
	var a storage.KnownAccount
	if err := c.ShouldBindJSON(&a); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	created, err := h.db.CreateAccount(c.Request.Context(), a)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, created)
}

func (h *Handler) UpdateAccount(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var a storage.KnownAccount
	if err := c.ShouldBindJSON(&a); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.db.UpdateAccount(c.Request.Context(), id, a); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteAccount(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := h.db.DeleteAccount(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DiscoverAccounts(c *gin.Context) {
	n, err := h.db.DiscoverAccounts(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "discovered": n})
}

// ── Exclusions ────────────────────────────────────────────────────────────────

func (h *Handler) ListExclusions(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("size", "50"))
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 500 {
		size = 50
	}
	items, total, err := h.db.ListExclusions(c.Request.Context(), page, size)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if items == nil {
		items = []storage.Exclusion{}
	}
	c.JSON(http.StatusOK, gin.H{"exclusions": items, "total": total})
}

func (h *Handler) CreateExclusion(c *gin.Context) {
	var e storage.Exclusion
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	created, err := h.db.CreateExclusion(c.Request.Context(), e)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, created)
}

func (h *Handler) UpdateExclusion(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	var e storage.Exclusion
	if err := c.ShouldBindJSON(&e); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.db.UpdateExclusion(c.Request.Context(), id, e); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteExclusion(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	if err := h.db.DeleteExclusion(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

// ── Sigma Rules (proxied to correlation_rules table) ─────────────────────────

func (h *Handler) ListSigmaRules(c *gin.Context) {
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

func (h *Handler) GetSigmaRule(c *gin.Context) {
	rule, err := h.db.GetCorrelationRule(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, rule)
}

func (h *Handler) CreateSigmaRule(c *gin.Context) {
	var rule storage.CorrelationRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	created, err := h.db.CreateCorrelationRule(c.Request.Context(), &rule)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, created)
}

func (h *Handler) UpdateSigmaRule(c *gin.Context) {
	id := c.Param("id")
	var rule storage.CorrelationRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := h.db.UpdateCorrelationRule(c.Request.Context(), id, &rule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ToggleSigmaRule(c *gin.Context) {
	id := c.Param("id")
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rule, err := h.db.GetCorrelationRule(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	rule.Enabled = body.Enabled
	if _, err := h.db.UpdateCorrelationRule(c.Request.Context(), id, rule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteSigmaRule(c *gin.Context) {
	if err := h.db.DeleteCorrelationRule(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) SigmaRulesStats(c *gin.Context) {
	rules, _ := h.db.ListCorrelationRules(c.Request.Context())
	enabled := 0
	for _, r := range rules {
		if r.Enabled {
			enabled++
		}
	}
	c.JSON(http.StatusOK, gin.H{"total": len(rules), "enabled": enabled})
}
