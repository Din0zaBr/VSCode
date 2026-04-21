package api

import (
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/config"
	"github.com/ursus-siem/logvault-go/internal/engine"
	"github.com/ursus-siem/logvault-go/internal/middleware"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// Handler holds shared dependencies for all HTTP handlers.
type Handler struct {
	cfg    *config.Config
	db     *storage.DB
	engine *engine.Client
	hub    *WSHub
}

// WSHub manages WebSocket connections for live log streaming.
type WSHub struct {
	mu      sync.RWMutex
	clients map[chan storage.LogEvent]struct{}
}

func NewWSHub() *WSHub {
	return &WSHub{clients: make(map[chan storage.LogEvent]struct{})}
}

func (h *WSHub) Subscribe() chan storage.LogEvent {
	ch := make(chan storage.LogEvent, 50)
	h.mu.Lock()
	h.clients[ch] = struct{}{}
	h.mu.Unlock()
	return ch
}

func (h *WSHub) Unsubscribe(ch chan storage.LogEvent) {
	h.mu.Lock()
	delete(h.clients, ch)
	h.mu.Unlock()
	close(ch)
}

func (h *WSHub) Broadcast(event storage.LogEvent) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for ch := range h.clients {
		select {
		case ch <- event:
		default: // drop if subscriber is slow
		}
	}
}

// NewRouter sets up all routes and returns the configured gin.Engine.
func NewRouter(cfg *config.Config, db *storage.DB, eng *engine.Client) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware(cfg.CORSOrigins))

	h := &Handler{
		cfg:    cfg,
		db:     db,
		engine: eng,
		hub:    NewWSHub(),
	}

	// Public
	r.GET("/health", h.Health)
	r.POST("/api/login", h.Login)

	// Agent ingestion: check static config keys first, then DB keys
	ingest := r.Group("/api")
	ingest.Use(func(c *gin.Context) {
		key := c.GetHeader("X-Api-Key")
		if key == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing X-Api-Key header"})
			return
		}
		// Check static keys from config (fast)
		for _, k := range cfg.APIKeys {
			if k == key {
				c.Next()
				return
			}
		}
		// Check DB keys (SHA256 lookup)
		if db.ValidateApiKey(c.Request.Context(), key) {
			c.Next()
			return
		}
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid API key"})
	})
	ingest.POST("/ingest", h.HandleIngest)

	// Authenticated user endpoints
	api := r.Group("/api")
	api.Use(middleware.JWTAuth(cfg.JWTSecret))
	{
		// Auth
		api.GET("/auth/me", h.Me)

		// Search & stats
		api.GET("/search", h.Search)
		api.GET("/search/pdql", h.SearchPDQL)
		api.GET("/stats", h.Stats)

		// Agents & hosts
		api.GET("/agents", h.Agents)
		api.GET("/hosts", h.Hosts)

		// Correlation alerts
		api.GET("/correlation/alerts", h.CorrelationAlerts)
		api.PATCH("/correlation/alerts/:id", h.UpdateAlertStatus)

		// Correlation rules (new)
		api.GET("/correlation/rules", h.ListCorrelationRules)
		api.POST("/correlation/rules", h.CreateCorrelationRule)
		api.PUT("/correlation/rules/:id", h.UpdateCorrelationRule)
		api.DELETE("/correlation/rules/:id", h.DeleteCorrelationRule)

		// Health (detailed)
		api.GET("/health/detailed", h.HealthDetailed)

		// Metrics
		api.GET("/metrics/latest", h.MetricsLatest)

		// Alert rules (simple CRUD)
		api.GET("/alerts/", h.ListAlertRules)
		api.POST("/alerts/", h.CreateAlertRule)
		api.DELETE("/alerts/:id", h.DeleteAlertRule)

		// Known accounts
		api.GET("/accounts", h.ListAccounts)
		api.POST("/accounts", h.CreateAccount)
		api.PUT("/accounts/:id", h.UpdateAccount)
		api.DELETE("/accounts/:id", h.DeleteAccount)
		api.POST("/accounts/discover", h.DiscoverAccounts)

		// Exclusions
		api.GET("/exclusions", h.ListExclusions)
		api.POST("/exclusions", h.CreateExclusion)
		api.PUT("/exclusions/:id", h.UpdateExclusion)
		api.DELETE("/exclusions/:id", h.DeleteExclusion)

		// SIGMA rules (backed by correlation_rules)
		api.GET("/sigma-rules", h.ListSigmaRules)
		api.GET("/sigma-rules/stats", h.SigmaRulesStats)
		api.GET("/sigma-rules/:id", h.GetSigmaRule)
		api.POST("/sigma-rules", h.CreateSigmaRule)
		api.PUT("/sigma-rules/:id", h.UpdateSigmaRule)
		api.POST("/sigma-rules/:id/toggle", h.ToggleSigmaRule)
		api.DELETE("/sigma-rules/:id", h.DeleteSigmaRule)

		// Assets
		api.GET("/assets", h.ListAssets)

		// User management
		api.GET("/users/", h.ListUsers)
		api.POST("/users/", h.CreateUser)
		api.DELETE("/users/:id", h.DeleteUser)
		api.PUT("/users/:id/role", h.UpdateUserRole)
		api.PUT("/users/:id/agents", h.SetUserAgents)

		// API key management
		api.GET("/admin/api-keys", h.ListApiKeys)
		api.POST("/admin/api-keys", h.CreateApiKey)
		api.DELETE("/admin/api-keys/:id", h.DeleteApiKey)
		api.PATCH("/admin/api-keys/:id", h.ToggleApiKey)
	}

	// WebSocket live stream
	r.GET("/api/logs/live", h.LiveLogs)

	return r
}

func corsMiddleware(origins []string) gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		allowed := false
		for _, o := range origins {
			if o == "*" || o == origin {
				allowed = true
				break
			}
		}
		if allowed || len(origins) == 0 {
			ao := origin
			if len(origins) == 1 && origins[0] == "*" {
				ao = "*"
			}
			c.Header("Access-Control-Allow-Origin", ao)
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization, X-Api-Key")
		c.Header("Access-Control-Allow-Credentials", "true")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
