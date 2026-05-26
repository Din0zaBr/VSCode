package jobs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/ursus-siem/logvault-go/internal/storage"
)

const tiFetchInterval = 1 * time.Hour

// StartThreatIntel launches the IOC puller goroutine.
//
// It walks ti_feeds where enabled = true, pulls each, sends the body to
// Rust /threat-intel/parse, persists indicators into ti_indicators, and
// records last_pull_at/last_count in ti_feeds.
func StartThreatIntel(ctx context.Context, db *storage.DB, engineURL string) {
	go runLoop(ctx, "threat-intel", tiFetchInterval, 60*time.Second, func(c context.Context) {
		if err := pullAllFeeds(c, db, engineURL); err != nil {
			slog.Warn("threat-intel pull failed", "error", err)
		}
	})
}

func pullAllFeeds(ctx context.Context, db *storage.DB, engineURL string) error {
	pool := db.PoolForJobs()
	if pool == nil {
		return fmt.Errorf("db pool unavailable")
	}
	rows, err := pool.Query(ctx, `
		SELECT id, name, kind, url FROM ti_feeds WHERE enabled = true`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type feed struct {
		id   int
		name string
		kind string
		url  string
	}
	var feeds []feed
	for rows.Next() {
		var f feed
		if err := rows.Scan(&f.id, &f.name, &f.kind, &f.url); err == nil {
			feeds = append(feeds, f)
		}
	}

	httpc := &http.Client{Timeout: 60 * time.Second}
	for _, f := range feeds {
		body, err := fetch(ctx, httpc, f.url)
		if err != nil {
			markFeedFailed(ctx, pool, f.id, err.Error())
			continue
		}
		parsed, err := parseViaEngine(ctx, httpc, engineURL, f.kind, f.name, body)
		if err != nil {
			markFeedFailed(ctx, pool, f.id, err.Error())
			continue
		}
		count := persistBatch(ctx, pool, f.id, parsed)
		_, _ = pool.Exec(ctx,
			`UPDATE ti_feeds SET last_pull_at = NOW(), last_count = $1, last_error = NULL WHERE id = $2`,
			count, f.id)
		slog.Info("threat-intel feed pulled", "name", f.name, "indicators", count)
	}
	return nil
}

func fetch(ctx context.Context, c *http.Client, url string) (string, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	req.Header.Set("User-Agent", "URSUS-SIEM/2.0 (+https://github.com/Din0zaBr/VSCode)")
	resp, err := c.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("feed http %d", resp.StatusCode)
	}
	b, err := io.ReadAll(io.LimitReader(resp.Body, 50<<20)) // 50 MB cap
	if err != nil {
		return "", err
	}
	return string(b), nil
}

type tiBatch struct {
	Batch struct {
		IpIndicators     []string `json:"ip_indicators"`
		UrlIndicators    []string `json:"url_indicators"`
		DomainIndicators []string `json:"domain_indicators"`
		HashIndicators   []string `json:"hash_indicators"`
	} `json:"batch"`
	Parsed int `json:"parsed"`
}

func parseViaEngine(ctx context.Context, c *http.Client, engineURL, kind, label, body string) (*tiBatch, error) {
	feedKind := "AbuseChPlain"
	switch kind {
	case "abusech_csv":
		feedKind = "AbuseChCsv"
	case "otx_pulse":
		feedKind = "OtxPulse"
	}
	payload, _ := json.Marshal(map[string]any{
		"feed": feedKind, "body": body, "label": label,
	})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
		engineURL+"/threat-intel/parse", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("engine %d", resp.StatusCode)
	}
	var out tiBatch
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	return &out, nil
}

func persistBatch(ctx context.Context, pool *pgxpool.Pool, feedID int, b *tiBatch) int {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return 0
	}
	defer tx.Rollback(ctx)

	count := 0
	insert := func(kind string, values []string) {
		batch := &pgx.Batch{}
		for _, v := range values {
			batch.Queue(
				`INSERT INTO ti_indicators (feed_id, kind, value) VALUES ($1, $2, $3)
				 ON CONFLICT (kind, value) DO NOTHING`,
				feedID, kind, v)
		}
		br := tx.SendBatch(ctx, batch)
		for range values {
			if _, err := br.Exec(); err == nil {
				count++
			}
		}
		_ = br.Close()
	}
	insert("ip", b.Batch.IpIndicators)
	insert("url", b.Batch.UrlIndicators)
	insert("domain", b.Batch.DomainIndicators)
	insert("hash", b.Batch.HashIndicators)

	if err := tx.Commit(ctx); err != nil {
		return 0
	}
	return count
}

func markFeedFailed(ctx context.Context, pool *pgxpool.Pool, id int, msg string) {
	_, _ = pool.Exec(ctx,
		`UPDATE ti_feeds SET last_pull_at = NOW(), last_error = $1 WHERE id = $2`,
		msg, id)
}
