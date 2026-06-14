"""Chart dataset builders for GHPI P0 report surface.

Three core charts:
- breakout_quadrant: heat_score (x) vs potential_score (y), quadrant classification
- pain_heatmap: tech category vs pain intensity derived from user_pain_points
- action_matrix: urgency vs impact grid with recommended_action annotation

All builders return a dict embeddable as JSON in Markdown/HTML reports.
"""
from __future__ import annotations

import json
from typing import Any

# trend_type classification thresholds
_HEAT_HOT = 80.0
_HEAT_WARM = 60.0
_POTENTIAL_HIGH = 75.0
_POTENTIAL_MED = 55.0

# Quadrant labels
QUADRANT_LABELS = {
    "breakout": "🚀 Breakout",       # hot + high potential
    "hidden_gem": "💎 Hidden Gem",   # warm + high potential
    "momentum": "📈 Momentum",       # hot + moderate potential
    "watch": "👁 Watch",             # warm/normal + moderate potential
}

# Recommended actions per quadrant
QUADRANT_ACTIONS: dict[str, str] = {
    "breakout": "deep_dive_now",
    "hidden_gem": "schedule_research",
    "momentum": "monitor_weekly",
    "watch": "add_to_watchlist",
}

TREND_LABELS = ("real_trend", "weak_signal", "hype", "noise")

# Pain category keyword mapping (rough NLP-free heuristic)
_PAIN_KEYWORDS: dict[str, list[str]] = {
    "deployment": ["deploy", "hosting", "infra", "k8s", "docker", "scale"],
    "cost": ["cost", "price", "expensive", "budget", "token", "billing"],
    "latency": ["slow", "latency", "speed", "performance", "fast", "real-time"],
    "tooling": ["tool", "sdk", "api", "integration", "plugin", "library"],
    "data": ["data", "dataset", "training", "fine-tun", "rag", "retrieval"],
    "safety": ["safe", "align", "guardrail", "bias", "hallucin", "trust"],
    "ux": ["ui", "ux", "user", "interface", "adoption", "learning curve"],
    "multimodal": ["image", "video", "audio", "vision", "multimodal"],
}


def _classify_trend_type(heat: float, potential: float) -> str:
    """Return trend_type string based on heat + potential scores."""
    if heat >= _HEAT_HOT and potential >= _POTENTIAL_HIGH:
        return "breakout"
    if heat >= _HEAT_WARM and potential >= _POTENTIAL_HIGH:
        return "hidden_gem"
    if heat >= _HEAT_HOT:
        return "momentum"
    return "watch"


def _classify_pain_categories(pain_texts: list[str]) -> dict[str, int]:
    """Count pain category hits from pain point texts."""
    counts: dict[str, int] = {cat: 0 for cat in _PAIN_KEYWORDS}
    for text in pain_texts:
        low = text.lower()
        for cat, kws in _PAIN_KEYWORDS.items():
            if any(kw in low for kw in kws):
                counts[cat] += 1
    return counts


def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or isinstance(value, bool):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _repo(item: dict[str, Any]) -> str:
    return str(
        item.get("repo")
        or item.get("full_name")
        or item.get("repo_full_name")
        or item.get("repoFullName")
        or ""
    )


def classify_trend_label(item: dict[str, Any]) -> str:
    """Classify a repo/chart point as real_trend, weak_signal, hype, or noise."""
    heat = _num(item.get("heat_score") or item.get("heat"))
    potential = _num(item.get("potential_score") or item.get("potential"))
    acceleration = _num(item.get("star_acceleration"))
    delta_24h = _num(item.get("stars_delta_24h"))
    evidence_count = int(_num(item.get("evidence_count") or item.get("evidence_refs")))
    source_count = int(_num(item.get("source_count") or item.get("cross_source_count")))
    hype_score = _num(item.get("hype_score"))
    suspicion_score = _num(item.get("suspicion_score"))
    trend_type = str(item.get("trend_type") or "")

    if suspicion_score >= 70 or (heat < 20 and potential < 20 and evidence_count == 0):
        return "noise"
    if hype_score >= 70 or (heat >= 80 and potential < 45 and source_count <= 1):
        return "hype"
    if (
        trend_type == "breakout"
        or (heat >= 70 and potential >= 65 and (source_count >= 2 or evidence_count >= 3))
        or (delta_24h >= 100 and acceleration >= 2.0 and potential >= 55)
    ):
        return "real_trend"
    return "weak_signal"


def build_breakout_quadrant(cards: list[dict[str, Any]]) -> dict[str, Any]:
    """Build breakout quadrant chart dataset.

    Schema:
        {
          "chart_type": "scatter",
          "title": "Breakout Quadrant: Heat vs Potential",
          "axes": {"x": "heat_score", "y": "potential_score"},
          "quadrant_lines": {"x": 60, "y": 75},
          "points": [
            {
              "repo": str,
              "x": float,          # heat_score
              "y": float,          # potential_score
              "quadrant": str,     # breakout|hidden_gem|momentum|watch
              "trend_type": str,   # same value
              "recommended_action": str,
              "label": str         # short repo name
            }
          ],
          "summary": {"breakout": int, "hidden_gem": int, "momentum": int, "watch": int}
        }

    Args:
        cards: list of dicts with keys repo/heat_score/potential_score
               (as produced by daily_report.sudden_hot / tech_radar / top10_projects)
    """
    points: list[dict[str, Any]] = []
    summary: dict[str, int] = {"breakout": 0, "hidden_gem": 0, "momentum": 0, "watch": 0}

    for card in cards:
        repo = str(card.get("repo") or card.get("full_name") or card.get("repo_full_name") or "")
        heat = float(card.get("heat_score") or card.get("x") or 0.0)
        potential = float(card.get("potential_score") or card.get("y") or 0.0)
        trend = _classify_trend_type(heat, potential)
        action = QUADRANT_ACTIONS[trend]
        label = repo.split("/")[-1] if "/" in repo else repo
        points.append({
            "repo": repo,
            "x": round(heat, 2),
            "y": round(potential, 2),
            "quadrant": QUADRANT_LABELS[trend],
            "trend_type": trend,
            "recommended_action": action,
            "label": label,
        })
        summary[trend] = summary.get(trend, 0) + 1

    return {
        "chart_type": "scatter",
        "title": "Breakout Quadrant: Heat vs Potential",
        "axes": {"x": "heat_score", "y": "potential_score"},
        "quadrant_lines": {"x": _HEAT_WARM, "y": _POTENTIAL_HIGH},
        "points": points,
        "summary": summary,
    }


def build_pain_heatmap(briefs: list[dict[str, Any]]) -> dict[str, Any]:
    """Build tech pain heatmap dataset.

    Schema:
        {
          "chart_type": "heatmap",
          "title": "Tech Pain Heatmap",
          "axes": {"x": "pain_category", "y": "repo"},
          "cells": [
            {"repo": str, "category": str, "intensity": int, "repos_affected": [str]}
          ],
          "category_totals": {"deployment": int, ...}
        }

    Args:
        briefs: list of dicts with keys repo/full_name + user_pain_points (list[str])
    """
    # Per-category aggregation across all repos
    category_repo_map: dict[str, list[str]] = {cat: [] for cat in _PAIN_KEYWORDS}
    cells: list[dict[str, Any]] = []

    for brief in briefs:
        repo = str(brief.get("repo") or brief.get("full_name") or "")
        pain_points: list[str] = brief.get("user_pain_points") or []
        if isinstance(pain_points, str):
            try:
                pain_points = json.loads(pain_points)
            except Exception:
                pain_points = [pain_points]

        counts = _classify_pain_categories(pain_points)
        for cat, cnt in counts.items():
            if cnt > 0:
                cells.append({"repo": repo, "category": cat, "intensity": cnt})
                category_repo_map[cat].append(repo)

    category_totals = {cat: len(repos) for cat, repos in category_repo_map.items()}

    return {
        "chart_type": "heatmap",
        "title": "Tech Pain Heatmap",
        "axes": {"x": "pain_category", "y": "repo"},
        "cells": cells,
        "category_totals": category_totals,
    }


def build_action_matrix(cards: list[dict[str, Any]]) -> dict[str, Any]:
    """Build action matrix dataset (urgency × impact).

    urgency  = heat_score / 100  (how fast-moving)
    impact   = potential_score / 100  (how valuable)

    Schema:
        {
          "chart_type": "matrix",
          "title": "Action Matrix: Urgency vs Impact",
          "axes": {"x": "urgency", "y": "impact"},
          "zone_lines": {"x": 0.6, "y": 0.75},
          "zones": {
            "act_now":      {x ≥ 0.6, y ≥ 0.75},
            "plan_soon":    {x < 0.6, y ≥ 0.75},
            "quick_win":    {x ≥ 0.6, y < 0.75},
            "backlog":      {x < 0.6, y < 0.75}
          },
          "items": [
            {
              "repo": str,
              "urgency": float,
              "impact": float,
              "zone": str,
              "trend_type": str,
              "recommended_action": str
            }
          ],
          "zone_counts": {"act_now": int, ...}
        }
    """
    URGENCY_CUT = 0.6
    IMPACT_CUT = 0.75

    zone_actions: dict[str, str] = {
        "act_now": "deep_dive_now",
        "plan_soon": "schedule_research",
        "quick_win": "monitor_weekly",
        "backlog": "add_to_watchlist",
    }

    items: list[dict[str, Any]] = []
    zone_counts: dict[str, int] = {"act_now": 0, "plan_soon": 0, "quick_win": 0, "backlog": 0}

    for card in cards:
        repo = str(card.get("repo") or card.get("full_name") or card.get("repo_full_name") or "")
        heat = float(card.get("heat_score") or 0.0)
        potential = float(card.get("potential_score") or 0.0)
        urgency = round(heat / 100.0, 3)
        impact = round(potential / 100.0, 3)
        trend = _classify_trend_type(heat, potential)

        if urgency >= URGENCY_CUT and impact >= IMPACT_CUT:
            zone = "act_now"
        elif urgency < URGENCY_CUT and impact >= IMPACT_CUT:
            zone = "plan_soon"
        elif urgency >= URGENCY_CUT and impact < IMPACT_CUT:
            zone = "quick_win"
        else:
            zone = "backlog"

        zone_counts[zone] += 1
        items.append({
            "repo": repo,
            "urgency": urgency,
            "impact": impact,
            "zone": zone,
            "trend_type": trend,
            "recommended_action": zone_actions[zone],
        })

    return {
        "chart_type": "matrix",
        "title": "Action Matrix: Urgency vs Impact",
        "axes": {"x": "urgency", "y": "impact"},
        "zone_lines": {"x": URGENCY_CUT, "y": IMPACT_CUT},
        "zones": {
            "act_now": "urgency ≥ 0.6 and impact ≥ 0.75",
            "plan_soon": "urgency < 0.6 and impact ≥ 0.75",
            "quick_win": "urgency ≥ 0.6 and impact < 0.75",
            "backlog": "urgency < 0.6 and impact < 0.75",
        },
        "items": items,
        "zone_counts": zone_counts,
    }


def build_repo_heat_bubble(cards: list[dict[str, Any]]) -> dict[str, Any]:
    """Build repo heat bubble data: heat x potential, bubble radius by evidence/source mass."""
    points: list[dict[str, Any]] = []
    summary = {label: 0 for label in TREND_LABELS}
    for card in cards:
        repo = _repo(card)
        heat = _num(card.get("heat_score") or card.get("x"))
        potential = _num(card.get("potential_score") or card.get("y"))
        evidence_count = int(_num(card.get("evidence_count") or len(card.get("evidence_ids") or [])))
        source_count = int(_num(card.get("source_count")))
        radius = max(4.0, min(36.0, 4.0 + evidence_count * 2.0 + source_count * 3.0))
        label = classify_trend_label({
            **card,
            "heat_score": heat,
            "potential_score": potential,
            "evidence_count": evidence_count,
            "source_count": source_count,
        })
        summary[label] += 1
        points.append({
            "repo": repo,
            "x": round(heat, 2),
            "y": round(potential, 2),
            "r": round(radius, 2),
            "heat_score": round(heat, 2),
            "potential_score": round(potential, 2),
            "evidence_count": evidence_count,
            "source_count": source_count,
            "trend_label": label,
            "recommended_action": QUADRANT_ACTIONS[_classify_trend_type(heat, potential)],
        })
    return {
        "chart_type": "bubble",
        "title": "Repo Heat Bubble",
        "axes": {"x": "heat_score", "y": "potential_score", "r": "evidence_source_mass"},
        "points": points,
        "trend_labels": list(TREND_LABELS),
        "summary": summary,
    }


def build_star_velocity_timeline(snapshots: list[dict[str, Any]]) -> dict[str, Any]:
    """Build repo star velocity timeline from snapshot rows."""
    by_repo: dict[str, list[dict[str, Any]]] = {}
    for snap in snapshots:
        repo = _repo(snap)
        if not repo:
            continue
        by_repo.setdefault(repo, []).append(snap)

    series: list[dict[str, Any]] = []
    for repo, rows in sorted(by_repo.items()):
        points: list[dict[str, Any]] = []
        for row in sorted(rows, key=lambda r: str(r.get("snapshot_at") or r.get("date") or "")):
            item = {
                "repo": repo,
                "snapshot_at": row.get("snapshot_at") or row.get("date"),
                "stars": int(_num(row.get("stars"))),
                "stars_delta_24h": int(_num(row.get("stars_delta_24h"))),
                "stars_delta_7d": int(_num(row.get("stars_delta_7d"))),
                "star_acceleration": round(_num(row.get("star_acceleration")), 3),
            }
            item["trend_label"] = classify_trend_label(item)
            points.append(item)
        series.append({"repo": repo, "points": points})

    return {
        "chart_type": "line",
        "title": "Star Velocity Timeline",
        "axes": {"x": "snapshot_at", "y": "stars_delta_24h"},
        "series": series,
    }


def build_topic_heatmap(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Build topic heatmap from cards/evidence topic tags."""
    cells: list[dict[str, Any]] = []
    topic_totals: dict[str, float] = {}
    for item in items:
        repo = _repo(item)
        tags = item.get("topic_tags") or item.get("topics") or item.get("tags") or []
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except Exception:
                tags = [tags]
        if not tags:
            text = " ".join(str(item.get(k) or "") for k in ("positioning", "core_idea", "why_hot", "what_it_does"))
            tags = [cat for cat, kws in _PAIN_KEYWORDS.items() if any(kw in text.lower() for kw in kws)]
        for topic in sorted({str(t).strip().lower() for t in tags if str(t).strip()}):
            intensity = max(_num(item.get("heat_score")), _num(item.get("importance_score")), 1.0)
            cells.append({
                "repo": repo,
                "topic": topic,
                "intensity": round(intensity, 2),
                "trend_label": classify_trend_label(item),
            })
            topic_totals[topic] = round(topic_totals.get(topic, 0.0) + intensity, 2)
    return {
        "chart_type": "heatmap",
        "title": "Topic Heatmap",
        "axes": {"x": "topic", "y": "repo"},
        "cells": cells,
        "topic_totals": topic_totals,
    }


def build_resonance_graph(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Build cross-source resonance graph from evidence/alert rows."""
    nodes: dict[str, dict[str, Any]] = {}
    edges: dict[tuple[str, str, str], dict[str, Any]] = {}

    def add_node(node_id: str, node_type: str, label: str) -> None:
        nodes.setdefault(node_id, {"id": node_id, "type": node_type, "label": label})

    for item in items:
        repo = _repo(item)
        source = str(item.get("source") or item.get("detector_name") or item.get("detector") or "unknown")
        if not repo:
            continue
        repo_id = f"repo:{repo}"
        source_id = f"source:{source}"
        add_node(repo_id, "repo", repo)
        add_node(source_id, "source", source)
        key = (source_id, repo_id, "mentions")
        edge = edges.setdefault(key, {
            "source": source_id,
            "target": repo_id,
            "relation": "mentions",
            "weight": 0,
            "evidence_ids": [],
        })
        edge["weight"] += 1
        ev_id = item.get("evidence_id") or item.get("alert_id")
        if ev_id:
            edge["evidence_ids"].append(str(ev_id))

        tags = item.get("topic_tags") or []
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except Exception:
                tags = []
        for tag in tags:
            topic = str(tag).strip().lower()
            if not topic:
                continue
            topic_id = f"topic:{topic}"
            add_node(topic_id, "topic", topic)
            tkey = (repo_id, topic_id, "has_topic")
            edges.setdefault(tkey, {
                "source": repo_id,
                "target": topic_id,
                "relation": "has_topic",
                "weight": 0,
                "evidence_ids": [],
            })["weight"] += 1

    return {
        "chart_type": "graph",
        "title": "Cross-Source Resonance Graph",
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
    }


def build_contribution_matrix(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Build contribution matrix from snapshot/community fields."""
    metric_keys = ("commit_count_7d", "active_contributors_30d", "forks", "open_issues")
    cells: list[dict[str, Any]] = []
    for item in items:
        repo = _repo(item)
        if not repo:
            continue
        for key in metric_keys:
            value = _num(item.get(key))
            cells.append({
                "repo": repo,
                "metric": key,
                "value": round(value, 2),
                "trend_label": classify_trend_label(item),
            })
    return {
        "chart_type": "matrix",
        "title": "Contribution Matrix",
        "axes": {"x": "metric", "y": "repo"},
        "cells": cells,
        "metrics": list(metric_keys),
    }


def build_chart_datasets(
    cards: list[dict[str, Any]],
    briefs: list[dict[str, Any]] | None = None,
    snapshots: list[dict[str, Any]] | None = None,
    evidence: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Build all chart datasets in one call.

    Returns:
        {
          "breakout_quadrant": {...},
          "pain_heatmap": {...},
          "action_matrix": {...}
        }
    """
    return {
        "breakout_quadrant": build_breakout_quadrant(cards),
        "pain_heatmap": build_pain_heatmap(briefs or []),
        "action_matrix": build_action_matrix(cards),
        "repo_heat_bubble": build_repo_heat_bubble(cards),
        "star_velocity_timeline": build_star_velocity_timeline(snapshots or []),
        "topic_heatmap": build_topic_heatmap(list(cards) + list(evidence or [])),
        "resonance_graph": build_resonance_graph(evidence or []),
        "contribution_matrix": build_contribution_matrix(snapshots or cards),
    }


def render_chart_json_block(chart_data: dict[str, Any], chart_key: str) -> str:
    """Render a chart dataset as a fenced JSON block embeddable in Markdown."""
    block = json.dumps(chart_data[chart_key], ensure_ascii=False, indent=2)
    return f"```json chart:{chart_key}\n{block}\n```"


__all__ = [
    "build_breakout_quadrant",
    "build_pain_heatmap",
    "build_action_matrix",
    "build_repo_heat_bubble",
    "build_star_velocity_timeline",
    "build_topic_heatmap",
    "build_resonance_graph",
    "build_contribution_matrix",
    "build_chart_datasets",
    "render_chart_json_block",
    "classify_trend_label",
    "TREND_LABELS",
    "QUADRANT_LABELS",
    "QUADRANT_ACTIONS",
]
