// Package notifications dispatches alerts to user channels.
// Channels supported in Sprint 2: Telegram, Email (SMTP), generic Webhook.
//
// Channels are configured per-tenant via SQLite (Sprint 5) or, for now,
// via env vars. Templates live in templates/*.tmpl and render on the fly.
package notifications

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/smtp"
	"os"
	"strings"
	"sync"
	"text/template"
	"time"
)

// Alert is the cross-channel payload. Source produces this, channels render
// it with their own template.
type Alert struct {
	ID          string         `json:"id"`
	Severity    string         `json:"severity"`     // critical|high|medium|low|info
	Kind        string         `json:"kind"`         // sigma|correlation|anomaly|canary|...
	Title       string         `json:"title"`
	Description string         `json:"description"`
	Host        string         `json:"host,omitempty"`
	User        string         `json:"user,omitempty"`
	Source      string         `json:"source,omitempty"`
	DetectedAt  time.Time      `json:"detected_at"`
	Tags        []string       `json:"tags,omitempty"`
	Extra       map[string]any `json:"extra,omitempty"`
}

// Channel is implemented by each notification backend.
type Channel interface {
	Name() string
	Send(ctx context.Context, alert Alert) error
}

// Manager fans out alerts to all configured channels in parallel.
// Failures in one channel never block others.
type Manager struct {
	mu       sync.RWMutex
	channels []Channel
	log      *slog.Logger
}

func NewManager(log *slog.Logger) *Manager {
	if log == nil {
		log = slog.Default()
	}
	return &Manager{log: log}
}

// AddChannel registers an additional channel. Safe to call after start.
func (m *Manager) AddChannel(ch Channel) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.channels = append(m.channels, ch)
}

// Notify dispatches an alert to all channels. Returns nil if zero channels
// configured (we don't want missing config to fail the calling job).
func (m *Manager) Notify(ctx context.Context, alert Alert) {
	m.mu.RLock()
	chs := append([]Channel(nil), m.channels...)
	m.mu.RUnlock()
	for _, ch := range chs {
		ch := ch
		go func() {
			ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
			defer cancel()
			if err := ch.Send(ctx, alert); err != nil {
				m.log.Warn("notification failed",
					"channel", ch.Name(), "error", err, "alert_id", alert.ID)
			}
		}()
	}
}

// FromEnv builds a Manager from environment variables. Returns the manager
// with whatever channels were configured (possibly none).
//
// Env knobs:
//
//	URSUS_TG_TOKEN       — Telegram bot token
//	URSUS_TG_CHAT_ID     — destination chat id
//
//	URSUS_SMTP_HOST      — smtp.example.com:465
//	URSUS_SMTP_USER, URSUS_SMTP_PASS, URSUS_SMTP_FROM, URSUS_SMTP_TO
//
//	URSUS_WEBHOOK_URL    — POST endpoint
//	URSUS_WEBHOOK_AUTH   — optional "Bearer xxx" Authorization header
func FromEnv(log *slog.Logger) *Manager {
	m := NewManager(log)
	if t, c := os.Getenv("URSUS_TG_TOKEN"), os.Getenv("URSUS_TG_CHAT_ID"); t != "" && c != "" {
		m.AddChannel(NewTelegram(t, c))
	}
	if h := os.Getenv("URSUS_SMTP_HOST"); h != "" {
		m.AddChannel(NewEmail(EmailConfig{
			Host:     h,
			Username: os.Getenv("URSUS_SMTP_USER"),
			Password: os.Getenv("URSUS_SMTP_PASS"),
			From:     os.Getenv("URSUS_SMTP_FROM"),
			To:       splitCSV(os.Getenv("URSUS_SMTP_TO")),
		}))
	}
	if u := os.Getenv("URSUS_WEBHOOK_URL"); u != "" {
		m.AddChannel(NewWebhook(u, os.Getenv("URSUS_WEBHOOK_AUTH")))
	}
	return m
}

// ─── Telegram ───────────────────────────────────────────────────────────────

type telegram struct {
	token  string
	chatID string
	http   *http.Client
	tpl    *template.Template
}

func NewTelegram(token, chatID string) Channel {
	return &telegram{
		token:  token,
		chatID: chatID,
		http:   &http.Client{Timeout: 10 * time.Second},
		tpl:    mustTpl(tgTemplate),
	}
}

func (t *telegram) Name() string { return "telegram" }

func (t *telegram) Send(ctx context.Context, a Alert) error {
	var body bytes.Buffer
	if err := t.tpl.Execute(&body, a); err != nil {
		return fmt.Errorf("tg template: %w", err)
	}
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", t.token)
	payload, _ := json.Marshal(map[string]any{
		"chat_id":    t.chatID,
		"text":       body.String(),
		"parse_mode": "HTML",
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := t.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		b, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("telegram api %d: %s", resp.StatusCode, b)
	}
	return nil
}

// ─── Email (SMTP) ───────────────────────────────────────────────────────────

type EmailConfig struct {
	Host     string // "smtp.example.com:587"
	Username string
	Password string
	From     string
	To       []string
}

type email struct {
	cfg EmailConfig
	tpl *template.Template
}

func NewEmail(cfg EmailConfig) Channel {
	return &email{cfg: cfg, tpl: mustTpl(emailTemplate)}
}

func (e *email) Name() string { return "email" }

func (e *email) Send(_ context.Context, a Alert) error {
	var body bytes.Buffer
	if err := e.tpl.Execute(&body, a); err != nil {
		return err
	}
	subject := fmt.Sprintf("[URSUS %s] %s", strings.ToUpper(a.Severity), a.Title)
	msg := []byte("From: " + e.cfg.From + "\r\n" +
		"To: " + strings.Join(e.cfg.To, ", ") + "\r\n" +
		"Subject: " + mimeEncodeHeader(subject) + "\r\n" +
		"MIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n" +
		body.String())

	host := strings.Split(e.cfg.Host, ":")[0]
	auth := smtp.PlainAuth("", e.cfg.Username, e.cfg.Password, host)

	// Default to STARTTLS or implicit TLS depending on port (465 = TLS).
	if strings.HasSuffix(e.cfg.Host, ":465") {
		return sendMailTLS(e.cfg.Host, auth, e.cfg.From, e.cfg.To, msg)
	}
	return smtp.SendMail(e.cfg.Host, auth, e.cfg.From, e.cfg.To, msg)
}

func sendMailTLS(addr string, auth smtp.Auth, from string, to []string, msg []byte) error {
	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: strings.Split(addr, ":")[0]})
	if err != nil {
		return err
	}
	c, err := smtp.NewClient(conn, strings.Split(addr, ":")[0])
	if err != nil {
		return err
	}
	defer c.Quit()
	if auth != nil {
		if ok, _ := c.Extension("AUTH"); ok {
			if err := c.Auth(auth); err != nil {
				return err
			}
		}
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	for _, r := range to {
		if err := c.Rcpt(r); err != nil {
			return err
		}
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	return w.Close()
}

func mimeEncodeHeader(s string) string {
	if isASCII(s) {
		return s
	}
	return "=?UTF-8?B?" + base64.StdEncoding.EncodeToString([]byte(s)) + "?="
}

func isASCII(s string) bool {
	for _, r := range s {
		if r > 127 {
			return false
		}
	}
	return true
}

// ─── Webhook ────────────────────────────────────────────────────────────────

type webhook struct {
	url  string
	auth string
	http *http.Client
}

func NewWebhook(url, auth string) Channel {
	return &webhook{url: url, auth: auth, http: &http.Client{Timeout: 10 * time.Second}}
}

func (w *webhook) Name() string { return "webhook" }

func (w *webhook) Send(ctx context.Context, a Alert) error {
	body, _ := json.Marshal(a)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, w.url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if w.auth != "" {
		req.Header.Set("Authorization", w.auth)
	}
	resp, err := w.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("webhook %d", resp.StatusCode)
	}
	return nil
}

// ─── Templates ──────────────────────────────────────────────────────────────

// Telegram supports HTML parse_mode — we use bold + emoji for severity.
const tgTemplate = `{{severityEmoji .Severity}} <b>{{.Title}}</b>
<i>{{.DetectedAt.Format "02.01.2006 15:04:05"}}</i>

{{.Description}}

{{if .Host}}🖥 Хост: <code>{{.Host}}</code>{{"\n"}}{{end -}}
{{if .User}}👤 Пользователь: <code>{{.User}}</code>{{"\n"}}{{end -}}
{{if .Source}}📥 Источник: <code>{{.Source}}</code>{{"\n"}}{{end -}}
{{if .Tags}}🏷 {{range .Tags}}#{{.}} {{end}}{{end}}`

const emailTemplate = `URSUS SIEM — оповещение

Уровень: {{.Severity}}
Тип:     {{.Kind}}
Время:   {{.DetectedAt.Format "02.01.2006 15:04:05 MST"}}

{{.Title}}

{{.Description}}

{{if .Host}}Хост:          {{.Host}}{{end}}
{{if .User}}Пользователь:  {{.User}}{{end}}
{{if .Source}}Источник:      {{.Source}}{{end}}

ID: {{.ID}}
`

var tplFuncs = template.FuncMap{
	"severityEmoji": func(s string) string {
		switch strings.ToLower(s) {
		case "critical":
			return "🔴"
		case "high":
			return "🟠"
		case "medium":
			return "🟡"
		case "low":
			return "🔵"
		default:
			return "⚪"
		}
	},
}

func mustTpl(s string) *template.Template {
	return template.Must(template.New("notif").Funcs(tplFuncs).Parse(s))
}

func splitCSV(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	for i := range parts {
		parts[i] = strings.TrimSpace(parts[i])
	}
	return parts
}
