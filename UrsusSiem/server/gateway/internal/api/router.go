package api

import (
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/config"
	"github.com/ursus-siem/logvault-go/internal/engine"
	"github.com/ursus-siem/logvault-go/internal/middleware"
	"github.com/ursus-siem/logvault-go/internal/notifications"
	"github.com/ursus-siem/logvault-go/internal/scenarios"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// Handler holds shared dependencies for all HTTP handlers.
type Handler struct {
	cfg       *config.Config
	db        *storage.DB
	engine    *engine.Client
	hub       *WSHub
	scenarios *scenarios.Registry
	notif     *notifications.Manager
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

// RouterDeps groups optional dependencies. Backwards-compatible: passing
// nil for an optional dep disables related routes.
type RouterDeps struct {
	Scenarios *scenarios.Registry
	Notif     *notifications.Manager
}

// NewRouter sets up all routes and returns the configured gin.Engine.
func NewRouter(cfg *config.Config, db *storage.DB, eng *engine.Client, deps ...RouterDeps) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery())
	r.Use(corsMiddleware(cfg.CORSOrigins))

	h := &Handler{
		cfg:    cfg,
		db:     db,
		engine: eng,
		hub:    NewWSHub(),
	}
	if len(deps) > 0 {
		h.scenarios = deps[0].Scenarios
		h.notif = deps[0].Notif
	}

	// Public
	r.GET("/health", h.Health)
	r.GET("/metrics", h.Metrics) // Sprint 6 — Prometheus exposition
	r.POST("/api/login", h.Login)      // legacy
	r.POST("/api/auth/login", h.Login) // matches UI client

	// Agent self-install bootstrap (open; the API key gates ingestion later)
	r.GET("/agent/install", h.AgentInstall)
	r.GET("/agent/config", h.AgentConfig)
	r.GET("/agent/compose", h.AgentCompose)
	// Same routes under /api for proxying through Caddy front
	r.GET("/api/agent/install", h.AgentInstall)
	r.GET("/api/agent/config", h.AgentConfig)
	r.GET("/api/agent/compose", h.AgentCompose)

	// Agent ingestion (API key auth)
	ingest := r.Group("/api")
	ingest.Use(middleware.APIKeyAuth(cfg.APIKeys))
	ingest.POST("/ingest", h.HandleIngest)
	// Vector-compatible NDJSON endpoint (one JSON object per line).
	// Use from Vector with codec=ndjson and X-Api-Key header.
	ingest.POST("/ingest/vector", h.HandleIngestVector)

	// Authenticated user endpoints
	api := r.Group("/api")
	api.Use(middleware.JWTAuth(cfg.JWTSecret))
	{
		// Search / stats / logs
		api.GET("/search", h.Search)
		api.GET("/search/pdql", h.SearchPDQL)
		api.GET("/stats", h.Stats)

		// Agents / hosts inventory derived from logs
		api.GET("/agents", h.Agents)
		api.GET("/hosts", h.Hosts)

		// Health
		api.GET("/health/detailed", h.HealthDetailed)

		// Correlation alerts (triggered) and rules (definitions)
		api.GET("/correlation/alerts", h.CorrelationAlerts)
		api.PATCH("/correlation/alerts/:id", h.UpdateAlertStatus)
		api.DELETE("/alerts/:id", h.DeleteCorrelationAlert)
		api.GET("/correlation/rules", h.ListCorrelationRules)
		api.POST("/correlation/rules", h.CreateCorrelationRule)
		api.PUT("/correlation/rules/:id", h.UpdateCorrelationRule)
		api.DELETE("/correlation/rules/:id", h.DeleteCorrelationRule)

		// Assets / accounts / exclusions
		api.GET("/assets", h.ListAssets)
		api.GET("/assets/:id", h.GetAsset)
		api.POST("/assets", h.CreateAsset)
		api.PUT("/assets/:id", h.UpdateAsset)
		api.DELETE("/assets/:id", h.DeleteAsset)
		api.POST("/assets/discover", h.DiscoverAssets)

		api.GET("/accounts", h.ListAccounts)
		api.POST("/accounts", h.CreateAccount)
		api.PUT("/accounts/:id", h.UpdateAccount)
		api.DELETE("/accounts/:id", h.DeleteAccount)

		api.GET("/exclusions", h.ListExclusions)
		api.POST("/exclusions", h.CreateExclusion)
		api.PUT("/exclusions/:id", h.UpdateExclusion)
		api.DELETE("/exclusions/:id", h.DeleteExclusion)

		// SIGMA rules
		api.GET("/sigma-rules", h.ListSigmaRules)
		api.GET("/sigma-rules/stats", h.SigmaRuleStats)
		api.GET("/sigma-rules/:id", h.GetSigmaRule)
		api.POST("/sigma-rules", h.CreateSigmaRule)
		api.PUT("/sigma-rules/:id", h.UpdateSigmaRule)
		api.POST("/sigma-rules/:id/toggle", h.ToggleSigmaRule)
		api.DELETE("/sigma-rules/:id", h.DeleteSigmaRule)
		api.POST("/sigma-rules/import", h.ImportSigmaRule)

		// Custom fields / scenarios
		api.GET("/custom-fields", h.ListCustomFields)
		api.POST("/custom-fields", h.CreateCustomField)
		api.PUT("/custom-fields/:id", h.UpdateCustomField)
		api.DELETE("/custom-fields/:id", h.DeleteCustomField)

		api.GET("/scenarios", h.ListScenarios)
		api.GET("/scenarios/:id", h.GetScenario)
		api.POST("/scenarios", h.CreateScenario)
		api.PUT("/scenarios/:id", h.UpdateScenario)
		api.DELETE("/scenarios/:id", h.DeleteScenario)

		// Reports
		api.GET("/reports/html/:type", h.ReportHTML)
		api.GET("/reports/csv/:type", h.ReportCSV)

		// Integrations
		api.GET("/integrations/sync/log", h.SyncLog)
		api.GET("/integrations/sync/stats", h.SyncStats)
		api.POST("/integrations/:name/sync", h.TriggerSync)

		// Admin: users + API keys (admin role enforced inside handlers if needed)
		api.GET("/users", h.ListUsers)
		api.POST("/users", h.CreateUser)
		api.DELETE("/users/:id", h.DeleteUser)
		api.PATCH("/users/:id/role", h.UpdateUserRole)
		api.PATCH("/users/:id/agents", h.UpdateUserAgents)

		api.GET("/admin/api-keys", h.ListAPIKeys)
		api.POST("/admin/api-keys", h.CreateAPIKey)
		api.PATCH("/admin/api-keys/:id", h.ToggleAPIKey)
		api.DELETE("/admin/api-keys/:id", h.DeleteAPIKey)

		// Anomaly / classical ML
		api.GET("/anomaly/alerts", h.ListAnomalyAlerts)
		api.PATCH("/anomaly/alerts/:id", h.UpdateAnomalyStatus)
		api.GET("/anomaly/baseline", h.ListBaseline)
		api.POST("/anomaly/baseline/rebuild", h.RebuildBaseline)
		api.POST("/anomaly/detect-now", h.DetectNow)
		api.POST("/anomaly/check-domain", h.CheckDomain)

		// Sprint 2: bundled scenarios from configs/scenarios/*.yaml
		api.GET("/scenarios/bundled", h.ListBundledScenarios)
		api.GET("/scenarios/bundled/:id", h.GetBundledScenario)
		api.PATCH("/scenarios/bundled/:id/toggle", h.ToggleBundledScenario)

		// Sprint 3: audit log + MITRE ATT&CK coverage
		api.GET("/audit", h.ListAuditLog)
		api.GET("/mitre/coverage", h.MitreCoverage)
		api.POST("/mitre/coverage/refresh", h.RefreshMitreCoverage)

		// Sprint 5: onboarding wizard
		api.GET("/onboarding/status", h.OnboardingStatus)
		api.POST("/onboarding/demo", h.OnboardingInjectDemo)

		// Sprint 9: compliance reports
		api.GET("/compliance/profiles", h.ListComplianceProfiles)
		api.GET("/compliance/:name/preview", h.PreviewCompliance)
		api.GET("/compliance/:name/pdf", h.ComplianceReportPDF)

		// Sprint 10: LLM proxy (Pro tier — optional logvault-llm container)
		api.GET("/llm/health", h.LLMHealth)
		api.POST("/llm/nl-to-pdql", h.LLMProxy("/nl-to-pdql"))
		api.POST("/llm/explain", h.LLMProxy("/explain"))
		api.POST("/llm/narrative", h.LLMProxy("/narrative"))
		api.POST("/llm/parse-format", h.LLMProxy("/parse-format"))

		// Sprint 12: honeypot / canary tokens
		api.GET("/canaries", h.ListCanaries)
		api.POST("/canaries", h.CreateCanary)
		api.DELETE("/canaries/:id", h.DeleteCanary)
		api.GET("/canaries/hits", h.ListCanaryHits)
		api.POST("/canaries/hits", h.ReportCanaryHit)
	}

	// WebSocket live stream (JWT auth via query param token=...)
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
		if allowed {
			c.Header("Access-Control-Allow-Origin", origin)
		}
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Api-Key")
		c.Header("Access-Control-Allow-Credentials", "true")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	}
}
