package engine

import (
	"context"
	"encoding/json"
	"time"
)

// Anomaly-engine bindings. The Rust engine implements detection in
// internal/anomaly/{baseline,detector,dga,beaconing}; we just shuttle JSON.

// ── Baseline ────────────────────────────────────────────────────────────────

type AnomalyEvent struct {
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

type BaselineRequest struct {
	Events  []AnomalyEvent `json:"events"`
	Metrics []string       `json:"metrics,omitempty"`
}

type BaselineEntry struct {
	ProfileKey string  `json:"profile_key"`
	Metric     string  `json:"metric"`
	HourBucket int16   `json:"hour_bucket"`
	MeanValue  float64 `json:"mean_value"`
	Stddev     float64 `json:"stddev"`
	SampleSize uint32  `json:"sample_size"`
}

type BaselineResponse struct {
	Entries         []BaselineEntry `json:"entries"`
	ProfilesBuilt   int             `json:"profiles_built"`
	EventsProcessed int             `json:"events_processed"`
}

func (c *Client) BuildBaseline(ctx context.Context, req BaselineRequest) (*BaselineResponse, error) {
	return post[BaselineResponse](ctx, c, "/anomaly/baseline", req)
}

// ── Detect ──────────────────────────────────────────────────────────────────

type DetectRequest struct {
	Baseline       []BaselineEntry `json:"baseline"`
	Events         []AnomalyEvent  `json:"events"`
	ZThreshold     float64         `json:"z_threshold,omitempty"`
	RareMinSamples uint32          `json:"rare_min_samples,omitempty"`
}

type AnomalyAlert struct {
	ProfileKey    string          `json:"profile_key"`
	Metric        string          `json:"metric"`
	Kind          string          `json:"kind"`
	Severity      string          `json:"severity"`
	CurrentValue  float64         `json:"current_value"`
	ExpectedValue float64         `json:"expected_value"`
	ZScore        float64         `json:"z_score"`
	Description   string          `json:"description"`
	WindowStart   *time.Time      `json:"window_start,omitempty"`
	WindowEnd     *time.Time      `json:"window_end,omitempty"`
	RelatedMeta   json.RawMessage `json:"related_meta"`
}

type DetectResponse struct {
	Alerts []AnomalyAlert `json:"alerts"`
}

func (c *Client) Detect(ctx context.Context, req DetectRequest) (*DetectResponse, error) {
	return post[DetectResponse](ctx, c, "/anomaly/detect", req)
}

// ── DGA ─────────────────────────────────────────────────────────────────────

type DgaRequest struct {
	Domains   []string `json:"domains"`
	Threshold float64  `json:"threshold,omitempty"`
}

type DgaFeatures struct {
	Length      uint    `json:"length"`
	Entropy     float64 `json:"entropy"`
	BigramScore float64 `json:"bigram_score"`
	DigitRatio  float64 `json:"digit_ratio"`
	VowelRatio  float64 `json:"vowel_ratio"`
}

type DgaScore struct {
	Domain      string      `json:"domain"`
	Probability float64     `json:"probability"`
	IsDga       bool        `json:"is_dga"`
	Features    DgaFeatures `json:"features"`
	Reason      string      `json:"reason"`
}

type DgaResponse struct {
	Results []DgaScore `json:"results"`
	Flagged int        `json:"flagged"`
}

func (c *Client) CheckDGA(ctx context.Context, req DgaRequest) (*DgaResponse, error) {
	return post[DgaResponse](ctx, c, "/anomaly/dga", req)
}

// ── Beaconing ───────────────────────────────────────────────────────────────

type ConnectionSample struct {
	Src        string      `json:"src"`
	Dst        string      `json:"dst"`
	Timestamps []time.Time `json:"timestamps"`
}

type BeaconingRequest struct {
	Samples      []ConnectionSample `json:"samples"`
	MinSamples   uint               `json:"min_samples,omitempty"`
	CVThreshold  float64            `json:"cv_threshold,omitempty"`
}

type BeaconingAlert struct {
	Src                     string  `json:"src"`
	Dst                     string  `json:"dst"`
	MeanIntervalSeconds     float64 `json:"mean_interval_seconds"`
	StddevSeconds           float64 `json:"stddev_seconds"`
	CoefficientOfVariation  float64 `json:"coefficient_of_variation"`
	Samples                 uint    `json:"samples"`
	Description             string  `json:"description"`
}

type BeaconingResponse struct {
	Alerts []BeaconingAlert `json:"alerts"`
}

func (c *Client) Beaconing(ctx context.Context, req BeaconingRequest) (*BeaconingResponse, error) {
	return post[BeaconingResponse](ctx, c, "/anomaly/beaconing", req)
}
