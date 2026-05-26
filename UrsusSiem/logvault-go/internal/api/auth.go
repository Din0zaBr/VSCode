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
	Token  string   `json:"token"`
	Role   string   `json:"role"`
	Agents []string `json:"agents"`
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
// First tries the users table, falls back to static credentials in config.
func (h *Handler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 1. Try users table
	if dbUser, err := h.db.GetUserByUsername(c.Request.Context(), req.Username); err == nil && dbUser != nil {
		if bcrypt.CompareHashAndPassword([]byte(dbUser.PasswordHash), []byte(req.Password)) == nil {
			token, err := middleware.IssueToken(h.cfg.JWTSecret, dbUser.Username, dbUser.Role, h.cfg.TokenTTLHours)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to issue token"})
				return
			}
			c.JSON(http.StatusOK, LoginResponse{Token: token, Role: dbUser.Role, Agents: dbUser.Agents})
			return
		}
	}

	// 2. Fallback: static credentials from config (bootstrap admin)
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
	c.JSON(http.StatusOK, LoginResponse{Token: token, Role: user.Role, Agents: nil})
}
