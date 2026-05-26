package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
)

// Sprint 10 — thin proxy to the logvault-llm service.
//
// Reasoning: we keep the HTTP boundary so the LLM container can run
// optionally (Pro tier only). If it isn't reachable, the proxy returns
// 503 with a clear hint. UI hides the related buttons when /health
// reports llm.degraded=true.

func llmURL() string {
	if u := os.Getenv("URSUS_LLM_URL"); u != "" {
		return u
	}
	return "http://logvault-llm:8000"
}

func llmHTTP() *http.Client {
	return &http.Client{Timeout: 60 * time.Second}
}

func (h *Handler) LLMProxy(target string) gin.HandlerFunc {
	return func(c *gin.Context) {
		body, _ := io.ReadAll(c.Request.Body)
		_ = c.Request.Body.Close()
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
			llmURL()+target, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		resp, err := llmHTTP().Do(req)
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": err.Error(),
				"hint":  "Pro tier feature — install the logvault-llm container",
			})
			return
		}
		defer resp.Body.Close()
		c.Status(resp.StatusCode)
		c.Header("Content-Type", resp.Header.Get("Content-Type"))
		_, _ = io.Copy(c.Writer, resp.Body)
	}
}

func (h *Handler) LLMHealth(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, llmURL()+"/health", nil)
	resp, err := llmHTTP().Do(req)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"status": "unreachable", "error": err.Error()})
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	out := map[string]any{}
	_ = json.Unmarshal(body, &out)
	out["upstream_status"] = resp.StatusCode
	c.JSON(http.StatusOK, out)
}

// Helper for tests that just probe whether the LLM endpoint is configured.
func llmConfigured() bool { return llmURL() != "" && llmURL() != "disabled" }

// Unused import-suppressor for fmt — kept for future error formatting.
var _ = fmt.Sprintf
