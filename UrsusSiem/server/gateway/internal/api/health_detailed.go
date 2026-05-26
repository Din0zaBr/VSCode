package api

import (
	"net/http"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
)

var processStart = time.Now()

// HealthDetailed returns counts across major tables plus runtime metrics.
func (h *Handler) HealthDetailed(c *gin.Context) {
	body, err := h.db.SystemHealth(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	engineOK := true
	if err := h.engine.Health(c.Request.Context()); err != nil {
		engineOK = false
	}

	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	body["engine"] = engineOK
	body["uptime_seconds"] = int(time.Since(processStart).Seconds())
	body["go_version"] = runtime.Version()
	body["goroutines"] = runtime.NumGoroutine()
	body["alloc_mb"] = memStats.Alloc / (1024 * 1024)

	c.JSON(http.StatusOK, body)
}
