from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class RuleAtom:
    id: str
    source: str
    source_anchor: str
    level: str
    rule_text: str
    line_start: int
    line_end: int
    scope: dict[str, list[str]] = field(default_factory=dict)
    checker: dict[str, str] = field(default_factory=dict)
    gate: list[str] = field(default_factory=list)
    autofix: dict[str, Any] = field(default_factory=dict)
    solar_status: str = "needs_manual_mapping"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "source": self.source,
            "source_anchor": self.source_anchor,
            "level": self.level,
            "rule_text": self.rule_text,
            "line_start": self.line_start,
            "line_end": self.line_end,
            "scope": self.scope or {"include": ["**/*"], "exclude": []},
            "checker": self.checker or {"type": "coverage", "name": "needs_manual_mapping"},
            "gate": self.gate or ["ci"],
            "autofix": self.autofix or {"available": False},
            "solar_status": self.solar_status,
        }
