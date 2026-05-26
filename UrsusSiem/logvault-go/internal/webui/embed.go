// Package webui ships the React UI bundle inside the Go binary so the
// Micro tier deploys as a single executable. The bundle lives in
// `dist/` and is built by `cd logvault-server/ui && npm run build`.
//
// If the bundle is missing at compile time (clean checkout, fresh dev
// machine) the embed declares an empty FS and Handler returns a friendly
// "UI not built" page — Go won't refuse to compile.
package webui

import (
	"embed"
	"errors"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// Handler returns an http.Handler that serves the embedded React build.
// SPA fallback: any unknown path returns /index.html so client-side
// routing (react-router) works.
//
// If the dist subtree is empty (UI not built) the returned handler
// renders a small built-in placeholder.
func Handler() http.Handler {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return placeholder("UI bundle not embedded: rebuild with `npm run build` in logvault-server/ui first.")
	}
	// Probe for index.html — if missing, treat the bundle as absent.
	if _, err := fs.Stat(sub, "index.html"); err != nil {
		return placeholder("UI bundle not embedded: run `npm run build` in logvault-server/ui then rebuild logvault-go.")
	}

	fileServer := http.FileServer(http.FS(sub))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Don't intercept API or websocket paths
		p := r.URL.Path
		if strings.HasPrefix(p, "/api/") || strings.HasPrefix(p, "/agent/") || p == "/health" {
			http.NotFound(w, r)
			return
		}
		// If the requested file exists, serve it as-is.
		// Otherwise (SPA route, e.g. /events/123) → /index.html.
		clean := strings.TrimPrefix(p, "/")
		if clean == "" {
			clean = "index.html"
		}
		if _, err := fs.Stat(sub, clean); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				r.URL.Path = "/"
			}
		}
		fileServer.ServeHTTP(w, r)
	})
}

// placeholder is used when the dist tree is empty — gives a clear,
// actionable hint instead of a 404.
func placeholder(msg string) http.Handler {
	html := `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>URSUS — UI not built</title>
<style>
  body { background:#0D0D1A; color:#D4D4E8; font-family:system-ui;
         display:flex; align-items:center; justify-content:center;
         min-height:100vh; margin:0; }
  .card { max-width:560px; padding:28px; border:1px solid #2A2A4A;
          border-radius:8px; background:#16162A;
          box-shadow:0 0 40px rgba(106,13,173,0.25); }
  h1 { font-size:18px; color:#BF40BF; text-transform:uppercase;
       letter-spacing:3px; margin-top:0; }
  code { background:#1E1E36; padding:2px 6px; border-radius:3px;
         font-family:'Share Tech Mono',monospace; }
  a { color:#BF40BF; }
</style>
</head>
<body>
  <div class="card">
    <h1>🐻 URSUS Insight</h1>
    <p>` + msg + `</p>
    <p>API is up: try <a href="/health">/health</a> or
    <a href="/api/auth/login">/api/auth/login</a>.</p>
    <p>To build the UI:</p>
    <pre><code>cd logvault-server/ui
npm install
npm run build
cd ../../logvault-go
go build ./cmd/logvault-go</code></pre>
  </div>
</body>
</html>`
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") ||
			strings.HasPrefix(r.URL.Path, "/agent/") || r.URL.Path == "/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(html))
	})
}
