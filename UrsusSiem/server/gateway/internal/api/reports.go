package api

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// Reports generate point-in-time exports of alerts and events. The Python
// original supported the same two endpoints; this port keeps the same URL
// shape (/api/reports/{html,csv}/{type}) so the UI's download buttons keep
// working without changes.

func (h *Handler) ReportHTML(c *gin.Context) {
	reportType := c.Param("type")
	body, err := h.buildReport(c, reportType, "html")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Data(http.StatusOK, "text/html; charset=utf-8", []byte(body))
}

func (h *Handler) ReportCSV(c *gin.Context) {
	reportType := c.Param("type")
	body, err := h.buildReport(c, reportType, "csv")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.Header("Content-Disposition", "attachment; filename=\"report_"+reportType+".csv\"")
	c.Data(http.StatusOK, "text/csv; charset=utf-8", []byte(body))
}

func (h *Handler) buildReport(c *gin.Context, reportType, format string) (string, error) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "1000"))
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}

	switch reportType {
	case "alerts":
		alerts, err := h.db.GetCorrelationAlerts(c.Request.Context(), c.Query("status"))
		if err != nil {
			return "", err
		}
		if format == "csv" {
			return alertsCSV(alerts), nil
		}
		return alertsHTML(alerts), nil
	case "events":
		params := storage.SearchParams{
			Query: c.Query("q"),
			Size:  limit,
			Page:  0,
		}
		events, _, err := h.db.Search(c.Request.Context(), params)
		if err != nil {
			return "", err
		}
		if format == "csv" {
			return eventsCSV(events), nil
		}
		return eventsHTML(events), nil
	default:
		return "", fmt.Errorf("unknown report type: %s", reportType)
	}
}

func alertsCSV(alerts []storage.CorrelationAlert) string {
	var sb strings.Builder
	w := csv.NewWriter(&sb)
	_ = w.Write([]string{"id", "rule_name", "severity", "status", "host", "agent_id", "created_at", "note"})
	for _, a := range alerts {
		_ = w.Write([]string{a.ID, a.RuleName, a.Severity, a.Status, a.Host, a.AgentID,
			a.CreatedAt.Format(time.RFC3339), a.Note})
	}
	w.Flush()
	return sb.String()
}

func eventsCSV(events []storage.LogEvent) string {
	var sb strings.Builder
	w := csv.NewWriter(&sb)
	_ = w.Write([]string{"id", "timestamp", "host", "agent_id", "level", "service", "message"})
	for _, e := range events {
		_ = w.Write([]string{
			strconv.FormatInt(e.ID, 10),
			e.Timestamp.Format(time.RFC3339),
			e.Host, e.AgentID, e.Level, e.Service, e.Message,
		})
	}
	w.Flush()
	return sb.String()
}

func alertsHTML(alerts []storage.CorrelationAlert) string {
	var sb strings.Builder
	sb.WriteString(`<!doctype html><html><head><meta charset="utf-8"><title>Alerts report</title>
<style>body{font-family:system-ui;background:#0d0d1a;color:#d4d4e8;padding:24px}
table{border-collapse:collapse;width:100%}th,td{padding:6px 10px;border-bottom:1px solid #2a2a4a;text-align:left}
th{background:#1e1e36;color:#bf40bf;text-transform:uppercase;font-size:11px}</style></head><body>`)
	fmt.Fprintf(&sb, "<h1>Correlation alerts (%d)</h1><table><tr><th>ID</th><th>Rule</th><th>Severity</th><th>Status</th><th>Host</th><th>Created</th></tr>", len(alerts))
	for _, a := range alerts {
		fmt.Fprintf(&sb, "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>",
			a.ID, htmlEscape(a.RuleName), a.Severity, a.Status, htmlEscape(a.Host),
			a.CreatedAt.Format("2006-01-02 15:04:05"))
	}
	sb.WriteString("</table></body></html>")
	return sb.String()
}

func eventsHTML(events []storage.LogEvent) string {
	var sb strings.Builder
	sb.WriteString(`<!doctype html><html><head><meta charset="utf-8"><title>Events report</title>
<style>body{font-family:system-ui;background:#0d0d1a;color:#d4d4e8;padding:24px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:5px 8px;border-bottom:1px solid #2a2a4a;text-align:left;vertical-align:top}
th{background:#1e1e36;color:#bf40bf;text-transform:uppercase;font-size:10px}</style></head><body>`)
	fmt.Fprintf(&sb, "<h1>Events (%d)</h1><table><tr><th>Time</th><th>Host</th><th>Level</th><th>Service</th><th>Message</th></tr>", len(events))
	for _, e := range events {
		fmt.Fprintf(&sb, "<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>",
			e.Timestamp.Format("2006-01-02 15:04:05"), htmlEscape(e.Host), e.Level,
			htmlEscape(e.Service), htmlEscape(e.Message))
	}
	sb.WriteString("</table></body></html>")
	return sb.String()
}

func htmlEscape(s string) string {
	r := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&#39;")
	return r.Replace(s)
}
