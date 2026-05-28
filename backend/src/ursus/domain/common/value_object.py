from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ValueObject:
    """Marker base for value objects. Subclasses must be frozen dataclasses."""
