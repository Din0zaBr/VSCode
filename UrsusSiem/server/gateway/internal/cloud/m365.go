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

// Microsoft 365 Unified Audit Log connector (Graph API).
//
// Endpoint:
//   GET https://graph.microsoft.com/beta/auditLogs/directoryAudits
//
// We pull AzureAD directory audits (sign-ins, user mgmt, app consents).
// SharePoint/Exchange Office 365 audit comes from the Office 365 Management
// Activity API — same token type, different host; the same connector can
// be extended later with a switch on cfg.Options["category"].

type M365 struct{}

func init() { Register(M365{}) }

func (M365) Name() string { return "m365_audit" }

func (M365) Pull(ctx context.Context, cfg Config) (*PullResult, error) {
	bearer := cfg.Credentials["bearer"]
	if bearer == "" {
		var err error
		bearer, err = graphAcquireToken(ctx, cfg)
		if err != nil {
			return nil, err
		}
	}

	since := time.Now().Add(-30 * time.Minute)
	if cfg.Cursor != "" {
		if t, err := time.Parse(time.RFC3339Nano, cfg.Cursor); err == nil {
			since = t
		}
	}

	q := url.Values{}
	q.Set("$filter", fmt.Sprintf("activityDateTime ge %s", since.Format(time.RFC3339)))
	q.Set("$top", "200")
	endpoint := "https://graph.microsoft.com/beta/auditLogs/directoryAudits?" + q.Encode()

	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	req.Header.Set("Authorization", "Bearer "+bearer)
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("m365 http %d: %s", resp.StatusCode, body)
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
		if s, _ := e["activityDateTime"].(string); s != "" {
			if t, err := time.Parse(time.RFC3339Nano, s); err == nil {
				ts = t
			}
		}
		if ts.After(maxTs) {
			maxTs = ts
		}
		activity, _ := e["activityDisplayName"].(string)
		category, _ := e["category"].(string)
		result, _ := e["result"].(string)
		initiator, _ := e["initiatedBy"].(map[string]any)
		userInfo, _ := initiator["user"].(map[string]any)
		user := stringFrom(userInfo, "userPrincipalName")

		out.Events = append(out.Events, Event{
			Timestamp: ts,
			Source:    "m365_audit",
			Level:     strings.ToLower(result),
			Service:   strings.ToLower(category),
			Message:   activity,
			Meta: map[string]any{
				"cloud.provider": "microsoft365",
				"category":       "cloud_audit",
				"user":           user,
				"event":          e,
			},
		})
	}
	out.NextCursor = maxTs.Format(time.RFC3339Nano)
	return out, nil
}

func graphAcquireToken(ctx context.Context, cfg Config) (string, error) {
	tenant := cfg.Credentials["tenant_id"]
	clientID := cfg.Credentials["client_id"]
	secret := cfg.Credentials["client_secret"]
	if tenant == "" || clientID == "" || secret == "" {
		return "", fmt.Errorf("m365: need bearer OR (tenant_id+client_id+client_secret)")
	}
	v := url.Values{}
	v.Set("client_id", clientID)
	v.Set("client_secret", secret)
	v.Set("grant_type", "client_credentials")
	v.Set("scope", "https://graph.microsoft.com/.default")

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
		return "", fmt.Errorf("graph token http %d: %s", resp.StatusCode, body)
	}
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tok); err != nil {
		return "", err
	}
	return tok.AccessToken, nil
}
