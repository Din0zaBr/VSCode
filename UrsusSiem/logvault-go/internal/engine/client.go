package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Client communicates with the Rust logvault-engine microservice.
type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		http: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ParseBatchRequest mirrors the Rust ParseBatchRequest model.
type ParseBatchRequest struct {
	Events []ParseEvent `json:"events"`
}

type ParseEvent struct {
	EventID   string                 `json:"event_id"`
	Timestamp string                 `json:"timestamp"`
	Host      string                 `json:"host"`
	AgentID   string                 `json:"agent_id"`
	Source    string                 `json:"source"`
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Service   string                 `json:"service"`
}

type ParseBatchResponse struct {
	Events  []EnrichedEvent `json:"events"`
	Parsed  int             `json:"parsed"`
	Errors  int             `json:"errors"`
}

type EnrichedEvent struct {
	EventID   string                 `json:"event_id"`
	Timestamp time.Time              `json:"timestamp"`
	Host      string                 `json:"host"`
	AgentID   string                 `json:"agent_id"`
	Source    string                 `json:"source"`
	Level     string                 `json:"level"`
	Message   string                 `json:"message"`
	Service   string                 `json:"service"`
	Meta      map[string]interface{} `json:"meta"`
}

// PdqlRequest mirrors the Rust PdqlRequest model.
type PdqlRequest struct {
	Query         string   `json:"query"`
	AllowedAgents []string `json:"allowed_agents,omitempty"`
	MaxLimit      *int     `json:"max_limit,omitempty"`
}

type PdqlResponse struct {
	SQL    string        `json:"sql"`
	Params []interface{} `json:"params"`
	Limit  int           `json:"limit"`
}

// ParseBatch sends raw events to the Rust engine for parsing and enrichment.
func (c *Client) ParseBatch(ctx context.Context, req ParseBatchRequest) (*ParseBatchResponse, error) {
	return post[ParseBatchResponse](ctx, c, "/parse", req)
}

// TranslatePDQL sends a PDQL query to the Rust engine and returns SQL.
func (c *Client) TranslatePDQL(ctx context.Context, req PdqlRequest) (*PdqlResponse, error) {
	return post[PdqlResponse](ctx, c, "/pdql", req)
}

// Health checks if the Rust engine is reachable.
func (c *Client) Health(ctx context.Context) error {
	resp, err := c.http.Get(c.baseURL + "/health")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("engine unhealthy: %d", resp.StatusCode)
	}
	return nil
}

func post[T any](ctx context.Context, c *Client, path string, body interface{}) (*T, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("engine %s: %w", path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		var errBody map[string]string
		json.NewDecoder(resp.Body).Decode(&errBody)
		return nil, fmt.Errorf("engine %s returned %d: %v", path, resp.StatusCode, errBody["error"])
	}

	var result T
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode engine response: %w", err)
	}
	return &result, nil
}
