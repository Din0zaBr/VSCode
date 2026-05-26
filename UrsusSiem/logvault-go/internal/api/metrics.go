package api

import (
	"fmt"
	"net/http"
	"runtime"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
)

// Sprint 6 — Prometheus-compatible /metrics endpoint.
//
// We expose a hand-rolled exposition (no client_golang dep) — kept simple
// because URSUS itself shouldn't need a heavy metrics library. Counters
// are atomic int64 + helpers below.

var (
	IngestEvents    atomic.Int64
	IngestErrors    atomic.Int64
	SearchRequests  atomic.Int64
	NotifSent       atomic.Int64
	NotifFailed     atomic.Int64
	SyslogReceived  atomic.Int64
	AnomalyAlerts   atomic.Int64
	processStarted  = time.Now()
)

// IncIngest is called from the ingest handlers / syslog batcher.
func IncIngest(inserted, errors int) {
	IngestEvents.Add(int64(inserted))
	IngestErrors.Add(int64(errors))
}

// Metrics handler — text exposition format.
//
//   # HELP / # TYPE comments precede each metric so Prometheus accepts it.
//   Values are integers (counters monotonically increasing) or gauges.
func (h *Handler) Metrics(c *gin.Context) {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	w := c.Writer
	w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")

	write(w, "# HELP ursus_uptime_seconds Process uptime in seconds.")
	write(w, "# TYPE ursus_uptime_seconds gauge")
	write(w, fmt.Sprintf("ursus_uptime_seconds %d", int(time.Since(processStarted).Seconds())))

	write(w, "# HELP ursus_ingest_events_total Successfully indexed events.")
	write(w, "# TYPE ursus_ingest_events_total counter")
	write(w, fmt.Sprintf("ursus_ingest_events_total %d", IngestEvents.Load()))

	write(w, "# HELP ursus_ingest_errors_total Events that failed to index.")
	write(w, "# TYPE ursus_ingest_errors_total counter")
	write(w, fmt.Sprintf("ursus_ingest_errors_total %d", IngestErrors.Load()))

	write(w, "# HELP ursus_search_requests_total /api/search hits.")
	write(w, "# TYPE ursus_search_requests_total counter")
	write(w, fmt.Sprintf("ursus_search_requests_total %d", SearchRequests.Load()))

	write(w, "# HELP ursus_syslog_received_total Syslog datagrams parsed.")
	write(w, "# TYPE ursus_syslog_received_total counter")
	write(w, fmt.Sprintf("ursus_syslog_received_total %d", SyslogReceived.Load()))

	write(w, "# HELP ursus_notifications_sent_total Notifications dispatched.")
	write(w, "# TYPE ursus_notifications_sent_total counter")
	write(w, fmt.Sprintf("ursus_notifications_sent_total %d", NotifSent.Load()))

	write(w, "# HELP ursus_notifications_failed_total Notifications failed.")
	write(w, "# TYPE ursus_notifications_failed_total counter")
	write(w, fmt.Sprintf("ursus_notifications_failed_total %d", NotifFailed.Load()))

	write(w, "# HELP ursus_anomaly_alerts_total Anomaly alerts persisted.")
	write(w, "# TYPE ursus_anomaly_alerts_total counter")
	write(w, fmt.Sprintf("ursus_anomaly_alerts_total %d", AnomalyAlerts.Load()))

	write(w, "# HELP ursus_goroutines Number of active goroutines.")
	write(w, "# TYPE ursus_goroutines gauge")
	write(w, fmt.Sprintf("ursus_goroutines %d", runtime.NumGoroutine()))

	write(w, "# HELP ursus_memory_alloc_bytes Bytes of allocated heap.")
	write(w, "# TYPE ursus_memory_alloc_bytes gauge")
	write(w, fmt.Sprintf("ursus_memory_alloc_bytes %d", mem.Alloc))

	c.Status(http.StatusOK)
}

func write(w http.ResponseWriter, s string) {
	_, _ = w.Write([]byte(s + "\n"))
}
