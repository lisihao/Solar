"""
Utility functions to load report template configurations (shared JSON files).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "configs" / "templates"


@dataclass
class TemplateConfig:
  id: str
  name: str
  category: str
  version: int
  description: Optional[str]
  schema: dict
  promptConfig: dict


class TemplateRepository:
  def __init__(self, templates_dir: Path = TEMPLATES_DIR):
    self.templates_dir = templates_dir
    self._templates: Dict[str, TemplateConfig] = {}
    self.reload()

  def reload(self):
    self._templates.clear()
    if not self.templates_dir.exists():
      return

    for file in self.templates_dir.glob("*.json"):
      with file.open("r", encoding="utf-8") as f:
        data = json.load(f)
        config = TemplateConfig(
          id=data["id"],
          name=data["name"],
          category=data["category"],
          version=data.get("version", 1),
          description=data.get("description"),
          schema=data["schema"],
          promptConfig=data["promptConfig"],
        )
        self._templates[config.id] = config

  def list(self) -> List[TemplateConfig]:
    return list(self._templates.values())

  def get(self, template_id: str) -> Optional[TemplateConfig]:
    return self._templates.get(template_id)


# Singleton repository
template_repository = TemplateRepository()
