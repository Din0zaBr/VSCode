package api

import (
	"net/http"
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
)

// Sprint 5 — onboarding wizard endpoints.
//
// The wizard runs once per fresh install. It asks for: admin password
// confirmation, basic Telegram/Email setup, which bundled scenarios to
// enable. We expose minimal helpers here; the actual UI is React work.

type onboardingState struct {
	StepsCompleted []string  `json:"steps_completed"`
	IsFresh        bool      `json:"is_fresh"`
	Version        string    `json:"version"`
	GoVersion      string    `json:"go_version"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
}

// OnboardingStatus reports whether onboarding is done and which steps remain.
// Fresh = no users besides the bootstrap admin AND no scenarios toggled on.
func (h *Handler) OnboardingStatus(c *gin.Context) {
	users, _ := h.db.ListUsers(c.Request.Context())
	scenarioCount := 0
	if h.scenarios != nil {
		for _, s := range h.scenarios.List() {
			if s.Enabled {
				scenarioCount++
			}
		}
	}
	state := onboardingState{
		IsFresh:   len(users) <= 1 && scenarioCount == 0,
		Version:   "2.0.0-sprint5",
		GoVersion: runtime.Version(),
	}
	if !state.IsFresh {
		now := time.Now()
		state.CompletedAt = &now
		state.StepsCompleted = []string{"admin", "scenarios"}
	}
	c.JSON(http.StatusOK, state)
}

// OnboardingInjectDemo creates a handful of synthetic events so the
// dashboard isn't empty during the wizard.
func (h *Handler) OnboardingInjectDemo(c *gin.Context) {
	// Implementation lives in the agent CLI's demo command; here we just
	// confirm the request so the wizard can proceed.
	c.JSON(http.StatusAccepted, gin.H{
		"hint": "Run: ursus-cli demo --inject 200 — see docs/cli.md",
	})
}
