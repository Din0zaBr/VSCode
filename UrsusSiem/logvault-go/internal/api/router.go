package api

import (
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

	// Agent ingestion (API key auth)
	ingest := r.Group("/api")
	ingest.Use(middleware.APIKeyAuth(cfg.APIKeys))
	ingest.POST("/ingest", h.HandleIngest)

	// Authenticated user endpoints
	api := r.Group("/api")
	api.Use(middleware.JWTAuth(cfg.JWTSecret))
	{
		api.GET("/search", h.Search)
		api.GET("/search/pdql", h.SearchPDQL)
		api.GET("/stats", h.Stats)
		api.GET("/agents", h.Agents)
		api.GET("/hosts", h.Hosts)
		api.GET("/correlation/alerts", h.CorrelationAlerts)
		api.PATCH("/correlation/alerts/:id", h.UpdateAlertStatus)
		api.GET("/assets", h.ListAssets)
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
