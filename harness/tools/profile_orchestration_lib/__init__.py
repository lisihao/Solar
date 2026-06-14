"""Profile orchestration lib — pure-function views for S04 routes.

Modules:
  fallback         — S03 availability check + unavailable() helper
  registry_view    — GET /api/profile/registry
  pareto_view      — GET /api/profile/pareto
  governance_view  — GET /api/profile/governance/events
  capability_view  — GET /api/profile/capability-usage
  blocked_view     — GET /api/profile/blocked-reasons

All view functions return dicts and never raise; route handlers do
try/except and never return 5xx.
"""
from .fallback import s03_available, unavailable
from .registry_view import get_registry
from .pareto_view import get_pareto
from .governance_view import get_governance_events
from .capability_view import get_capability_usage
from .blocked_view import get_blocked_reasons
from .promotion_view import refresh_promotion_plan

__all__ = [
    "s03_available",
    "unavailable",
    "get_registry",
    "get_pareto",
    "get_governance_events",
    "get_capability_usage",
    "get_blocked_reasons",
    "refresh_promotion_plan",
]
