package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/ursus-siem/logvault-go/internal/api"
	"github.com/ursus-siem/logvault-go/internal/config"
	"github.com/ursus-siem/logvault-go/internal/engine"
	"github.com/ursus-siem/logvault-go/internal/jobs"
	"github.com/ursus-siem/logvault-go/internal/notifications"
	"github.com/ursus-siem/logvault-go/internal/scenarios"
	"github.com/ursus-siem/logvault-go/internal/storage"
	"github.com/ursus-siem/logvault-go/internal/syslog"
	"github.com/ursus-siem/logvault-go/internal/webui"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(log)

	cfg := config.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	db, err := storage.NewDB(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer db.Close()
	slog.Info("database connected")

	if err := bootstrapAdmin(ctx, db, cfg); err != nil {
		slog.Warn("admin bootstrap failed", "error", err)
	}

	eng := engine.NewClient(cfg.EngineURL)

	if err := eng.Health(ctx); err != nil {
		slog.Warn("rust engine not reachable at startup, will use fallback path", "url", cfg.EngineURL, "error", err)
	} else {
		slog.Info("rust engine reachable", "url", cfg.EngineURL)
	}

	// Background ML jobs: baseline refresh + anomaly detection
	jobsCtx, jobsCancel := context.WithCancel(context.Background())
	defer jobsCancel()
	jobs.StartAnomaly(jobsCtx, db, eng)
	jobs.StartThreatIntel(jobsCtx, db, cfg.EngineURL)
	jobs.StartCloudPulls(jobsCtx, db, 5*time.Minute)

	// Sprint 2: load bundled scenarios from disk, set up notifications.
	scnReg := scenarios.NewRegistry()
	scnDir := os.Getenv("URSUS_SCENARIOS_DIR")
	if scnDir == "" {
		scnDir = "/etc/ursus/scenarios"
	}
	if err := scnReg.LoadDir(scnDir); err != nil {
		slog.Warn("scenarios not loaded — falling back to empty registry",
			"dir", scnDir, "error", err)
	} else {
		slog.Info("scenarios loaded", "count", scnReg.Count(), "dir", scnDir)
	}
	notifMgr := notifications.FromEnv(slog.Default())

	apiRouter := api.NewRouter(cfg, db, eng, api.RouterDeps{
		Scenarios: scnReg,
		Notif:     notifMgr,
	})
	uiHandler := webui.Handler()

	// Compose: /api/*, /agent/*, /health → gin router (apiRouter);
	// anything else → embedded UI. Single-binary deployment for Micro tier.
	mux := http.NewServeMux()
	mux.Handle("/api/", apiRouter)
	mux.Handle("/agent/", apiRouter)
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) { apiRouter.ServeHTTP(w, r) })
	mux.Handle("/", uiHandler)

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Optional syslog listener. Activated via URSUS_SYSLOG_UDP / URSUS_SYSLOG_TCP.
	syslogCtx, syslogCancel := context.WithCancel(context.Background())
	defer syslogCancel()
	if udp, tcp := os.Getenv("URSUS_SYSLOG_UDP"), os.Getenv("URSUS_SYSLOG_TCP"); udp != "" || tcp != "" {
		listener := &syslog.Listener{
			UDPAddr: udp,
			TCPAddr: tcp,
			Sink: syslog.SinkFunc(func(ctx context.Context, events []storage.LogEvent) {
				inserted, errs := db.BulkIndex(ctx, events)
				slog.Debug("syslog batch", "inserted", inserted, "errors", errs)
			}),
		}
		go func() {
			if err := listener.Run(syslogCtx); err != nil {
				slog.Error("syslog listener stopped", "error", err)
			}
		}()
		slog.Info("syslog enabled", "udp", udp, "tcp", tcp)
	}

	go func() {
		slog.Info("logvault-go starting", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutdown signal received")
	shutCtx, shutCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutCancel()
	if err := srv.Shutdown(shutCtx); err != nil {
		slog.Error("graceful shutdown failed", "error", err)
	}
	slog.Info("server stopped")
}

// bootstrapAdmin inserts the static admin user from ADMIN_USERNAME +
// ADMIN_PASSWORD_HASH into the users table if it isn't there yet, so that the
// first login goes through the DB-backed code path and the static fallback
// becomes optional.
func bootstrapAdmin(ctx context.Context, db *storage.DB, cfg *config.Config) error {
	for username, u := range cfg.Users {
		if username == "" || u.PasswordHash == "" {
			continue
		}
		existing, err := db.GetUserByUsername(ctx, username)
		if err != nil {
			return err
		}
		if existing != nil {
			continue
		}
		if _, err := db.CreateUser(ctx, username, u.PasswordHash, u.Role); err != nil {
			return err
		}
		slog.Info("bootstrapped admin user", "username", username, "role", u.Role)
	}
	return nil
}
