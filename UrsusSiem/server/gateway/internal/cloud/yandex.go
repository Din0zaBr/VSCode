package cloud

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Yandex Cloud Logging connector.
//
// Uses the public REST API:
//   https://logging.api.cloud.yandex.net/logging/v1/read
//
// Auth: IAM token (short-lived, refreshed by us from the service-account
// key in cfg.Credentials["sa_key_json"]). For simplicity in v2.0 we accept
// an already-minted IAM token in cfg.Credentials["iam_token"] — the
// scheduler can call iam-token refresh separately.

type Yandex struct{}

func init() { Register(Yandex{}) }

func (Yandex) Name() string { return "yandex_cloud" }

func (Yandex) Pull(ctx context.Context, cfg Config) (*PullResult, error) {
	iam := cfg.Credentials["iam_token"]
	if iam == "" {
		return nil, fmt.Errorf("yandex: missing iam_token credential")
	}
	logGroup := cfg.Options["log_group_id"]
	if logGroup == "" {
		return nil, fmt.Errorf("yandex: missing log_group_id option")
	}

	since := time.Now().Add(-15 * time.Minute)
	if cfg.Cursor != "" {
		if t, err := time.Parse(time.RFC3339Nano, cfg.Cursor); err == nil {
			since = t
		}
	}

	q := url.Values{}
	q.Set("logGroupId", logGroup)
	q.Set("criteria.since", since.Format(time.RFC3339Nano))
	q.Set("criteria.pageSize", "200")
	endpoint := "https://logging.api.cloud.yandex.net/logging/v1/read?" + q.Encode()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+iam)

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("yandex http %d: %s", resp.StatusCode, body)
	}

	var page struct {
		Entries []struct {
			Timestamp     string                 `json:"timestamp"`
			Level         string                 `json:"level"`
			Message       string                 `json:"message"`
			Resource      map[string]interface{} `json:"resource"`
			JSONPayload   map[string]interface{} `json:"jsonPayload,omitempty"`
		} `json:"entries"`
		NextPageToken string `json:"nextPageToken"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return nil, err
	}

	out := &PullResult{HasMore: page.NextPageToken != ""}
	maxTs := since
	for _, e := range page.Entries {
		ts, _ := time.Parse(time.RFC3339Nano, e.Timestamp)
		if ts.After(maxTs) {
			maxTs = ts
		}
		meta := map[string]interface{}{
			"cloud.provider":  "yandex",
			"cloud.log_group": logGroup,
			"category":        guessCategory(e.JSONPayload),
		}
		for k, v := range e.Resource {
			meta["resource."+k] = v
		}
		for k, v := range e.JSONPayload {
			meta[k] = v
		}
		out.Events = append(out.Events, Event{
			Timestamp: ts,
			Source:    "yandex_cloud_logging",
			Host:      stringFrom(e.Resource, "id"),
			Level:     strings.ToLower(e.Level),
			Message:   e.Message,
			Service:   stringFrom(e.Resource, "type"),
			Meta:      meta,
		})
	}
	out.NextCursor = maxTs.Format(time.RFC3339Nano)
	return out, nil
}

func stringFrom(m map[string]interface{}, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func guessCategory(payload map[string]interface{}) string {
	if payload == nil {
		return ""
	}
	if t, ok := payload["event_type"].(string); ok {
		return strings.ToLower(t)
	}
	if a, ok := payload["action"].(string); ok {
		return strings.ToLower(a)
	}
	return ""
}
