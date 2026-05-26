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

// Azure Activity Logs connector.
//
// Uses the management REST API:
//   GET https://management.azure.com/subscriptions/{sub}/providers/microsoft.insights/eventtypes/management/values
//
// Auth: bearer token from Azure AD (client_credentials flow against
//        https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token).
//
// We accept either a pre-minted bearer token (cfg.Credentials["bearer"])
// or the tenant+client_id+client_secret triple — in the latter case we
// fetch a token on-the-fly.

type Azure struct{}

func init() { Register(Azure{}) }

func (Azure) Name() string { return "azure_activity" }

func (Azure) Pull(ctx context.Context, cfg Config) (*PullResult, error) {
	bearer := cfg.Credentials["bearer"]
	if bearer == "" {
		var err error
		bearer, err = azureAcquireToken(ctx, cfg)
		if err != nil {
			return nil, err
		}
	}
	sub := cfg.Options["subscription_id"]
	if sub == "" {
		return nil, fmt.Errorf("azure: missing subscription_id option")
	}

	since := time.Now().Add(-30 * time.Minute)
	if cfg.Cursor != "" {
		if t, err := time.Parse(time.RFC3339, cfg.Cursor); err == nil {
			since = t
		}
	}

	q := url.Values{}
	q.Set("api-version", "2017-03-01-preview")
	q.Set("$filter", fmt.Sprintf("eventTimestamp ge '%s'", since.Format(time.RFC3339)))
	endpoint := fmt.Sprintf(
		"https://management.azure.com/subscriptions/%s/providers/microsoft.insights/eventtypes/management/values?%s",
		url.PathEscape(sub), q.Encode(),
	)

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("azure http %d: %s", resp.StatusCode, body)
	}

	var page struct {
		Value []map[string]any `json:"value"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&page); err != nil {
		return nil, err
	}

	maxTs := since
	out := &PullResult{}
	for _, e := range page.Value {
		ts := time.Now().UTC()
		if s, _ := e["eventTimestamp"].(string); s != "" {
			if t, err := time.Parse(time.RFC3339, s); err == nil {
				ts = t
			}
		}
		if ts.After(maxTs) {
			maxTs = ts
		}
		op, _ := e["operationName"].(map[string]any)
		opName := stringFrom(op, "value")
		msg, _ := e["status"].(map[string]any)
		out.Events = append(out.Events, Event{
			Timestamp: ts,
			Source:    "azure_activity",
			Level:     strings.ToLower(stringFrom(msg, "value")),
			Service:   opName,
			Message:   opName,
			Meta: map[string]any{
				"cloud.provider": "azure",
				"category":       "cloud_audit",
				"event":          e,
			},
		})
	}
	out.NextCursor = maxTs.Format(time.RFC3339)
	return out, nil
}

func azureAcquireToken(ctx context.Context, cfg Config) (string, error) {
	tenant := cfg.Credentials["tenant_id"]
	clientID := cfg.Credentials["client_id"]
	secret := cfg.Credentials["client_secret"]
	if tenant == "" || clientID == "" || secret == "" {
		return "", fmt.Errorf("azure: need bearer OR (tenant_id+client_id+client_secret)")
	}
	v := url.Values{}
	v.Set("client_id", clientID)
	v.Set("client_secret", secret)
	v.Set("grant_type", "client_credentials")
	v.Set("scope", "https://management.azure.com/.default")

	endpoint := fmt.Sprintf("https://login.microsoftonline.com/%s/oauth2/v2.0/token", tenant)
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, endpoint,
		strings.NewReader(v.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("azure token http %d: %s", resp.StatusCode, body)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	return tok.AccessToken, nil
}
