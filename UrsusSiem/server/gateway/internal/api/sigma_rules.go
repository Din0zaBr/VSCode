package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/storage"
	"gopkg.in/yaml.v3"
)

func (h *Handler) ListSigmaRules(c *gin.Context) {
	rules, err := h.db.ListSigmaRules(c.Request.Context(),
		c.Query("category"), c.Query("severity"), c.Query("status"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if rules == nil {
		rules = []storage.SigmaRule{}
	}
	c.JSON(http.StatusOK, rules)
}

func (h *Handler) GetSigmaRule(c *gin.Context) {
	r, err := h.db.GetSigmaRule(c.Request.Context(), c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if r == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, r)
}

func (h *Handler) CreateSigmaRule(c *gin.Context) {
	var r storage.SigmaRule
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if r.RuleID == "" || r.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "rule_id and title required"})
		return
	}
	if r.Status == "" {
		r.Status = "enabled"
	}
	if r.Severity == "" {
		r.Severity = "medium"
	}
	out, err := h.db.UpsertSigmaRule(c.Request.Context(), r)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, out)
}

func (h *Handler) UpdateSigmaRule(c *gin.Context) {
	var r storage.SigmaRule
	if err := c.ShouldBindJSON(&r); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.db.UpdateSigmaRuleByID(c.Request.Context(), c.Param("id"), r); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) ToggleSigmaRule(c *gin.Context) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.db.ToggleSigmaRule(c.Request.Context(), c.Param("id"), req.Enabled); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) DeleteSigmaRule(c *gin.Context) {
	if err := h.db.DeleteSigmaRule(c.Request.Context(), c.Param("id")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (h *Handler) SigmaRuleStats(c *gin.Context) {
	stats, err := h.db.SigmaRuleStats(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, stats)
}

// ImportSigmaRule parses a SIGMA YAML body and inserts it as a rule.
func (h *Handler) ImportSigmaRule(c *gin.Context) {
	var req struct {
		RuleYAML string `json:"rule_yaml" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var parsed struct {
		ID          string `yaml:"id"`
		Title       string `yaml:"title"`
		Description string `yaml:"description"`
		Level       string `yaml:"level"`
		Logsource   struct {
			Category string `yaml:"category"`
			Product  string `yaml:"product"`
		} `yaml:"logsource"`
	}
	if err := yaml.Unmarshal([]byte(req.RuleYAML), &parsed); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid YAML: " + err.Error()})
		return
	}
	if parsed.ID == "" || parsed.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "YAML must contain id and title"})
		return
	}
	severity := parsed.Level
	if severity == "" {
		severity = "medium"
	}
	category := parsed.Logsource.Category
	if category == "" {
		category = parsed.Logsource.Product
	}
	imported := "user_upload"
	out, err := h.db.UpsertSigmaRule(c.Request.Context(), storage.SigmaRule{
		RuleID:       parsed.ID,
		Title:        parsed.Title,
		Description:  parsed.Description,
		RuleYAML:     req.RuleYAML,
		Category:     category,
		Severity:     severity,
		Status:       "enabled",
		ImportedFrom: &imported,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, out)
}
