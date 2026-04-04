from __future__ import annotations

import os


class Settings:
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://logvault:logvault-secret@localhost:5432/logvault",
    )
    API_KEYS: list[str] = [
        k.strip() for k in os.getenv("API_KEYS", "changeme-agent-key").split(",") if k.strip()
    ]
    ALERT_WEBHOOK_URL: str = os.getenv("ALERT_WEBHOOK_URL", "")
    ALERT_TELEGRAM_TOKEN: str = os.getenv("ALERT_TELEGRAM_TOKEN", "")
    ALERT_TELEGRAM_CHAT_ID: str = os.getenv("ALERT_TELEGRAM_CHAT_ID", "")
    CORS_ORIGINS: list[str] = [
        o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",")
    ]
    MAX_BATCH_SIZE: int = int(os.getenv("MAX_BATCH_SIZE", "5000"))
    LIVE_BUFFER_SIZE: int = int(os.getenv("LIVE_BUFFER_SIZE", "500"))

    JWT_SECRET: str = os.getenv("JWT_SECRET", "logvault-jwt-secret-change-me")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))


settings = Settings()
