package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/ursus-siem/logvault-go/internal/middleware"
	"golang.org/x/crypto/bcrypt"
)

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type LoginResponse struct {
	Token string `json:"token"`
	Role  string `json:"role"`
}

// Health returns service health status including engine connectivity.
func (h *Handler) Health(c *gin.Context) {
	engineOK := true
	if err := h.engine.Health(c.Request.Context()); err != nil {
		engineOK = false
	}
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
		"engine": engineOK,
	})
}

// Login authenticates a user and returns a signed JWT.
// For the initial deployment, credentials are validated against the config.
func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	user, ok := h.cfg.Users[req.Username]
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	token, err := middleware.IssueToken(h.cfg.JWTSecret, req.Username, user.Role, h.cfg.TokenTTLHours)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
		return
	}

	c.JSON(http.StatusOK, LoginResponse{Token: token, Role: user.Role})
}
