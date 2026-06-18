from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class FailReason:
    label: str
    details: dict = field(default_factory=dict)


@dataclass(frozen=True)
class Decision:
    approved: bool
    reasons: list = field(default_factory=list)
    tier_matched: Any = None
    signals: dict = field(default_factory=dict)

    @classmethod
    def approve(cls, *, tier_matched, signals=None):
        return cls(approved=True, reasons=[], tier_matched=tier_matched, signals=signals or {})

    @classmethod
    def queue(cls, reasons, *, signals=None):
        return cls(approved=False, reasons=list(reasons), tier_matched=None, signals=signals or {})

    def as_label_list(self):
        return [r.label for r in self.reasons]
