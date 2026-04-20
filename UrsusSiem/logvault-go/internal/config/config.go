package config

import (
	"log/slog"
	"os"
	"strconv"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// UserConfig holds hashed credentials for a user in the config file.
type UserConfig struct {
	PasswordHash string
	Role         string
}

type Config struct {
	// Server
	Addr string

	// Database
	DatabaseURL string

	// Auth
	JWTSecret     string
	TokenTTLHours int
	APIKeys       []string

	// Static users (admin accounts defined via environment variables)
	Users map[string]UserConfig

	// Rust engine
	EngineURL string

	// CORS
	CORSOrigins []string

	// Ingest
	MaxBatchSize   int
	LiveBufferSize int
}

func Load() *Config {
	adminHash := getEnv("ADMIN_PASSWORD_HASH", "")
	if adminHash == "" {
		plainPwd := getEnv("ADMIN_PASSWORD", "admin")
		h, err := bcrypt.GenerateFromPassword([]byte(plainPwd), 10)
		if err != nil {
			slog.Error("failed to hash admin password", "error", err)
		} else {
			adminHash = string(h)
		}
	}
	return &Config{
		Addr:          getEnv("ADDR", ":8080"),
		DatabaseURL:   getEnv("DATABASE_URL", "postgres://logvault:logvault-secret@localhost:5432/logvault"),
		JWTSecret:     getEnv("JWT_SECRET", "logvault-jwt-secret-change-me"),
		TokenTTLHours: getEnvInt("TOKEN_TTL_HOURS", 8),
		APIKeys:       getEnvList("API_KEYS", "changeme-agent-key"),
		Users: map[string]UserConfig{
			getEnv("ADMIN_USERNAME", "admin"): {
				PasswordHash: adminHash,
				Role:         "admin",
			},
		},
		EngineURL:      getEnv("ENGINE_URL", "http://localhost:8001"),
		CORSOrigins:    getEnvList("CORS_ORIGINS", "*"),
		MaxBatchSize:   getEnvInt("MAX_BATCH_SIZE", 5000),
		LiveBufferSize: getEnvInt("LIVE_BUFFER_SIZE", 500),
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v, ok := os.LookupEnv(key); ok {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}

func getEnvList(key, fallback string) []string {
	v := getEnv(key, fallback)
	return strings.Split(v, ",")
}
