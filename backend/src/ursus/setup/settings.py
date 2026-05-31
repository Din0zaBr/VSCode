from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Self


@dataclass(frozen=True, slots=True)
class AppSettings:
    environment: str
    debug: bool
    postgres_dsn: str

    @classmethod
    def from_env(cls) -> Self:
        return cls(
            environment=os.environ.get("URSUS_ENV", "local"),
            debug=os.environ.get("URSUS_DEBUG", "false").lower() == "true",
            postgres_dsn=os.environ.get(
                "URSUS_POSTGRES_DSN",
                "postgresql+psycopg://ursus:ursus@localhost:5432/ursus",
            ),
        )
