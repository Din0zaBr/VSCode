from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Self


@dataclass(frozen=True, slots=True)
class AppSettings:
    environment: str
    debug: bool

    @classmethod
    def from_env(cls) -> Self:
        return cls(
            environment=os.environ.get("URSUS_ENV", "local"),
            debug=os.environ.get("URSUS_DEBUG", "false").lower() == "true",
        )
