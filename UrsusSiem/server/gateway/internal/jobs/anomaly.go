// Package jobs runs periodic background tasks: anomaly baseline refresh
// (nightly) and detection sweep (hourly). Started from main.go via
// jobs.StartAnomaly(ctx, db, eng).
package jobs

import (
	"context"
	"log/slog"
	"time"

	"github.com/ursus-siem/logvault-go/internal/engine"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

// Knobs ─ kept here so deployments can tweak without recompiling main.go.
const (
	baselineHistory  = 14 * 24 * time.Hour // training window
	detectionWindow  = 1 * time.Hour       // events scored each pass
	baselineInterval = 24 * time.Hour
	detectInterval   = 30 * time.Minute
	zThreshold       = 3.0
	maxBaselineRows  = 200_000 // safety cap for ingestion bursts
	maxDetectRows    = 30_000
)

// StartAnomaly launches background goroutines for baseline + detection.
// They stop when ctx is cancelled.
func StartAnomaly(ctx context.Context, db *storage.DB, eng *engine.Client) {
	go runLoop(ctx, "baseline", baselineInterval, 30*time.Second, func(c context.Context) {
		if err := refreshBaseline(c, db, eng); err != nil {
			slog.Warn("anomaly baseline failed", "error", err)
		}
	})
	go runLoop(ctx, "detect", detectInterval, 90*time.Second, func(c context.Context) {
		if err := runDetection(c, db, eng); err != nil {
			slog.Warn("anomaly detection failed", "error", err)
		}
	})
}

func runLoop(ctx context.Context, name string, interval, initialDelay time.Duration, run func(context.Context)) {
	// Initial delay so the engine has time to come up after restart.
	select {
	case <-time.After(initialDelay):
	case <-ctx.Done():
		return
	}

	t := time.NewTicker(interval)
	defer t.Stop()
	slog.Info("anomaly job started", "name", name, "interval", interval)

	for {
		start := time.Now()
		run(ctx)
		slog.Info("anomaly job tick", "name", name, "elapsed_ms", time.Since(start).Milliseconds())
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// ── Baseline ────────────────────────────────────────────────────────────────

func refreshBaseline(ctx context.Context, db *storage.DB, eng *engine.Client) error {
	since := time.Now().Add(-baselineHistory)
	events, err := db.RecentEvents(ctx, since, maxBaselineRows)
	if err != nil {
		return err
	}
	if len(events) < 100 {
		slog.Info("baseline skipped: not enough history", "events", len(events))
		return nil
	}
	resp, err := eng.BuildBaseline(ctx, engine.BaselineRequest{
		Events: toEngineEvents(events),
	})
	if err != nil {
		return err
	}
	rows := make([]storage.BaselineRow, 0, len(resp.Entries))
	for _, e := range resp.Entries {
		rows = append(rows, storage.BaselineRow{
			ProfileKey: e.ProfileKey,
			Metric:     e.Metric,
			HourBucket: e.HourBucket,
			MeanValue:  e.MeanValue,
			Stddev:     e.Stddev,
			SampleSize: int(e.SampleSize),
		})
	}
	if err := db.ReplaceBaseline(ctx, rows); err != nil {
		return err
	}
	slog.Info("baseline refreshed",
		"profiles", resp.ProfilesBuilt,
		"rows", len(rows),
		"events", resp.EventsProcessed,
	)
	return nil
}

// ── Detection ───────────────────────────────────────────────────────────────

func runDetection(ctx context.Context, db *storage.DB, eng *engine.Client) error {
	baseline, err := db.LoadBaseline(ctx)
	if err != nil {
		return err
	}
	if len(baseline) == 0 {
		slog.Info("detection skipped: empty baseline (run baseline job first)")
		return nil
	}

	since := time.Now().Add(-detectionWindow)
	events, err := db.RecentEvents(ctx, since, maxDetectRows)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}

	resp, err := eng.Detect(ctx, engine.DetectRequest{
		Baseline:   toEngineBaseline(baseline),
		Events:     toEngineEvents(events),
		ZThreshold: zThreshold,
	})
	if err != nil {
		return err
	}

	inputs := make([]storage.AnomalyAlertInput, 0, len(resp.Alerts))
	for _, a := range resp.Alerts {
		inputs = append(inputs, storage.AnomalyAlertInput{
			ProfileKey:    a.ProfileKey,
			Metric:        a.Metric,
			Kind:          a.Kind,
			Severity:      a.Severity,
			CurrentValue:  a.CurrentValue,
			ExpectedValue: a.ExpectedValue,
			ZScore:        a.ZScore,
			Description:   a.Description,
			WindowStart:   a.WindowStart,
			WindowEnd:     a.WindowEnd,
			RelatedMeta:   a.RelatedMeta,
		})
	}
	n, err := db.InsertAnomalyAlerts(ctx, inputs)
	if err != nil {
		return err
	}
	if n > 0 {
		slog.Info("anomaly alerts persisted", "count", n)
	}
	return nil
}

// ── Conversions ─────────────────────────────────────────────────────────────

func toEngineEvents(events []storage.LogEvent) []engine.AnomalyEvent {
	out := make([]engine.AnomalyEvent, 0, len(events))
	for _, e := range events {
		out = append(out, engine.AnomalyEvent{
			EventID:   e.EventID,
			Timestamp: e.Timestamp,
			Host:      e.Host,
			AgentID:   e.AgentID,
			Source:    e.Source,
			Level:     e.Level,
			Message:   e.Message,
			Service:   e.Service,
			Meta:      e.Meta,
		})
	}
	return out
}

func toEngineBaseline(rows []storage.BaselineRow) []engine.BaselineEntry {
	out := make([]engine.BaselineEntry, 0, len(rows))
	for _, r := range rows {
		out = append(out, engine.BaselineEntry{
			ProfileKey: r.ProfileKey,
			Metric:     r.Metric,
			HourBucket: r.HourBucket,
			MeanValue:  r.MeanValue,
			Stddev:     r.Stddev,
			SampleSize: uint32(r.SampleSize),
		})
	}
	return out
}
