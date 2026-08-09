"""status_projection.py — Status UI / livework projection for orchestration traces.

Extends status UI to show epic, child sprint, graph node, capability usage,
operator, pane hygiene, blocked_reason, and evidence-based state determination.

Remains backward compatible when trace artifacts are absent.

Sprint: sprint-20260530-p0-修复单-把上下文主权收口到-context-store-压缩长寿-pane-记忆污染路径-s04-orchestration-ui
Node: N2_status_context_projection
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional

from .trace_model import (
    DispatchStatus,
    PaneHygieneState,
    VerifierDecision,
)
from .trace_writer import _resolve_harness_dir


_CONTEXT_EVIDENCE_FIELDS = {
    "context_packet_id",
    "context_packet_path",
    "context_packet_type",
    "context_packet_hash",
    "context_packet_expires_at",
    "context_policy_class",
}


class StatusProjection:
    """Projects orchestration trace data into a UI-friendly status view.

    Falls back to existing status fields when trace artifacts are absent.
    """

    def __init__(self, harness_dir: Path | None = None) -> None:
        self.harness_dir = _resolve_harness_dir(harness_dir)
        self.traces_dir = self.harness_dir / "traces" / "orchestration"

    def project_sprint(self, sprint_id: str) -> dict[str, Any]:
        """Build status projection for a sprint from its traces and status.json.

        Returns a dict with:
        - epic_id, child sprint status, node statuses
        - capability usage, operator assignments
        - pane hygiene states, blocked reasons
        - evidence-based status determination
        """
        sprints_dir = self.harness_dir / "sprints"
        status = self._load_status(sprints_dir, sprint_id)
        traces = self._load_traces_for_sprint(sprint_id)

        nodes = self._project_nodes(traces)
        epic_id = status.get("epic_id", "")
        pane_hygiene = self._aggregate_hygiene(traces)
        blocked_reason = self._find_blocked_reason(traces)
        capabilities = self._collect_capabilities(traces)
        operators = self._collect_operators(traces)
        contamination_signals = self._collect_contamination_signals(traces)
        context_packets = self._collect_context_packets(nodes)
        legacy_fallbacks = [
            n for n in nodes if self._extract_bool(n.get("legacy_memory_fallback"))
        ]

        evidence_status = self._determine_status_from_evidence(traces, status)
        blocked_nodes = [n for n in nodes if n.get("status") in {"blocked", "failed"}]

        # Legacy fallback if traces exist but fields are absent.
        status_context_warning = self._has_context_projection_gap(traces) or (not traces and status.get("status") == "passed")

        return {
            "sprint_id": sprint_id,
            "epic_id": epic_id,
            "status": evidence_status,
            "legacy_status": status.get("status", ""),
            "nodes": nodes,
            "node_count": len(nodes),
            "open_nodes": [n for n in nodes if n["status"] not in {"passed", "skipped"}],
            "blocked_nodes": blocked_nodes,
            "pane_hygiene": pane_hygiene,
            "blocked_reason": blocked_reason,
            "capabilities_used": capabilities,
            "capability_use": {k: v for k, v in self._collect_capability_counts(traces).items()},
            "operators": operators,
            "context_packets": context_packets,
            "legacy_memory_fallback": bool(legacy_fallbacks),
            "legacy_fallback_nodes": [
                {
                    "node_id": n.get("node_id", "N/A"),
                    "fallback_reason": n.get("fallback_reason", "N/A"),
                }
                for n in legacy_fallbacks
            ],
            "trace_count": len(traces),
            "has_verifier_evidence": any(
                t.get("verifier", {}).get("decision") in {"PASS", "FAIL", "WARNING"}
                for t in traces
            ),
            "status_context_warning": status_context_warning,
            "contamination_summary": sorted(contamination_signals),
        }

    def _load_status(self, sprints_dir: Path, sprint_id: str) -> dict[str, Any]:
        sf = sprints_dir / f"{sprint_id}.status.json"
        if sf.exists():
            try:
                return json.loads(sf.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    def _load_traces_for_sprint(self, sprint_id: str) -> list[dict[str, Any]]:
        traces: list[dict[str, Any]] = []
        if not self.traces_dir.exists():
            return traces
        for tf in self.traces_dir.glob("*.json"):
            try:
                data = json.loads(tf.read_text(encoding="utf-8"))
                if data.get("sprint_id") == sprint_id:
                    traces.append(data)
            except Exception:
                continue
        return traces

    def _project_nodes(self, traces: list[dict[str, Any]]) -> list[dict[str, Any]]:
        node_map: dict[str, dict[str, Any]] = {}
        for t in traces:
            node_id = t.get("node_id") or t.get("trace_id", "unknown")
            if node_id not in node_map:
                node_map[node_id] = {
                    "node_id": node_id,
                    "status": "pending",
                    "operator_id": "",
                    "capabilities": [],
                    "pane_hygiene": "",
                    "verifier_decision": "PENDING",
                }
            entry = node_map[node_id]
            dispatch = t.get("dispatch", {})
            dispatch_status = dispatch.get("dispatch_status", "")
            verifier = t.get("verifier", {})
            verifier_decision = verifier.get("decision", "PENDING")
            context_audit = self._extract_context_audit(t)
            contamination_signals = context_audit.pop("contamination_signals", [])
            projection_gap = bool(context_audit.pop("_projection_gap", False))
            if projection_gap:
                contamination_signals = self._normalize_contamination_signals(
                    contamination_signals,
                    "context_audit_missing",
                )
            entry["operator_id"] = t.get("operator_id", "") or entry["operator_id"]
            entry["capabilities"] = dispatch.get("required_capabilities", []) or entry["capabilities"]
            entry["pane_hygiene"] = t.get("pane_hygiene_state", "") or entry["pane_hygiene"]
            entry["verifier_decision"] = verifier_decision
            if dispatch.get("blocked_reason"):
                entry["blocked_reason"] = dispatch.get("blocked_reason")
            entry.update(context_audit)
            # Always set contamination_signals (empty list when clean) so all
            # A1 required fields are present on every node projection entry.
            entry["contamination_signals"] = contamination_signals

            blocking_context_signals = {
                "packet_missing",
                "ref_unresolved",
                "packet_expired",
                "undeclared_fallback",
                "screen_history_used",
            }
            if blocking_context_signals.intersection(contamination_signals):
                entry["status"] = "blocked"
                if not entry.get("blocked_reason"):
                    entry["blocked_reason"] = ",".join(
                        signal
                        for signal in contamination_signals
                        if signal in blocking_context_signals
                    )
            elif contamination_signals:
                entry["status"] = "warning"
                if not entry.get("blocked_reason"):
                    entry["blocked_reason"] = ",".join(contamination_signals)
            elif verifier_decision == "PASS":
                entry["status"] = "passed"
            elif verifier_decision == "FAIL":
                entry["status"] = "failed"
            elif verifier_decision == "WARNING":
                entry["status"] = "warning"
            elif dispatch_status in {"dispatched", "active"}:
                entry["status"] = "active"
            elif dispatch_status == "queued":
                entry["status"] = "blocked"
            elif contamination_signals:
                entry["status"] = "blocked"
            else:
                entry["status"] = dispatch_status or entry["status"]

        return list(node_map.values())

    def _aggregate_hygiene(self, traces: list[dict[str, Any]]) -> list[dict[str, str]]:
        result: list[dict[str, str]] = []
        for t in traces:
            state = t.get("pane_hygiene_state", "")
            if state:
                result.append({
                    "operator_id": t.get("operator_id", ""),
                    "node_id": t.get("node_id", ""),
                    "state": state,
                })
        return result

    def _find_blocked_reason(self, traces: list[dict[str, Any]]) -> str:
        for t in traces:
            reason = (t.get("dispatch", {}) or {}).get("blocked_reason", "")
            if reason:
                return reason
        return ""

    def _collect_capabilities(self, traces: list[dict[str, Any]]) -> list[str]:
        caps: set[str] = set()
        for t in traces:
            for cap in (t.get("dispatch", {}) or {}).get("required_capabilities", []):
                caps.add(cap)
        return sorted(caps)

    def _collect_capability_counts(self, traces: list[dict[str, Any]]) -> dict[str, int]:
        counts: dict[str, int] = {}
        for t in traces:
            for cap in (t.get("dispatch", {}) or {}).get("required_capabilities", []):
                cap = str(cap)
                counts[cap] = counts.get(cap, 0) + 1
        return counts

    def _collect_operators(self, traces: list[dict[str, Any]]) -> list[str]:
        ops: set[str] = set()
        for t in traces:
            op = t.get("operator_id", "")
            if op:
                ops.add(op)
        return sorted(ops)

    def _collect_contamination_signals(self, traces: list[dict[str, Any]]) -> set[str]:
        signals: set[str] = set()
        for t in traces:
            audit = self._extract_context_audit(t)
            for signal in audit.get("contamination_signals", []):
                if signal:
                    signals.add(str(signal))
        return signals

    def _collect_context_packets(self, nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        packets: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for node in nodes:
            packet_id = self._extract_str(node.get("context_packet_id"), default="N/A")
            packet_path = self._extract_str(node.get("context_packet_path"), default="N/A")
            key = (packet_id, packet_path)
            if key in seen:
                continue
            seen.add(key)
            packets.append({
                "node_id": self._extract_str(node.get("node_id"), default="N/A"),
                "context_packet_id": packet_id,
                "context_packet_path": packet_path,
                "context_packet_type": self._extract_str(node.get("context_packet_type"), default="N/A"),
                "context_packet_hash": self._extract_str(node.get("context_packet_hash"), default="N/A"),
                "context_packet_expires_at": self._extract_str(node.get("context_packet_expires_at"), default="N/A"),
                "expires_at": self._extract_str(node.get("expires_at", node.get("context_packet_expires_at")), default="N/A"),
                "context_packet_staleness_warning": self._extract_str(node.get("context_packet_staleness_warning"), default="false"),
                "staleness_warning": self._extract_str(node.get("staleness_warning", node.get("context_packet_staleness_warning")), default="false"),
                "context_policy_class": self._extract_str(node.get("context_policy_class"), default="N/A"),
                "legacy_memory_fallback": self._extract_bool(node.get("legacy_memory_fallback")),
                "fallback_reason": self._extract_str(node.get("fallback_reason"), default="N/A"),
                "contamination_signals": self._normalize_contamination_signals(node.get("contamination_signals", [])),
            })
        return packets

    def _has_context_projection_gap(self, traces: list[dict[str, Any]]) -> bool:
        for t in traces:
            audit = self._extract_context_audit(t)
            if audit.get("_projection_gap"):
                return True
        return False

    @staticmethod
    def _extract_str(value: Any, *, default: str = "N/A") -> str:
        if value is None:
            return default
        if isinstance(value, bool):
            return "true" if value else "false"
        text = str(value).strip()
        if not text:
            return default
        return text

    @staticmethod
    def _extract_bool(value: Any) -> bool:
        if value is None:
            return False
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.strip().lower() in {"1", "true", "yes", "on", "y", "t"}
        if isinstance(value, (int, float)):
            return value != 0
        return bool(value)

    @staticmethod
    def _normalize_contamination_signals(*buckets: Any) -> list[str]:
        signals: list[str] = []
        for bucket in buckets:
            if not bucket:
                continue
            if isinstance(bucket, list):
                for entry in bucket:
                    if isinstance(entry, str):
                        cleaned = entry.strip()
                        if cleaned:
                            signals.append(cleaned)
                    else:
                        text = str(entry).strip()
                        if text:
                            signals.append(text)
            elif isinstance(bucket, str):
                signals.extend(
                    [item.strip() for item in bucket.split(",") if item.strip()]
                )
            else:
                text = str(bucket).strip()
                if text:
                    signals.append(text)
        uniq: list[str] = []
        for signal in signals:
            if signal not in uniq:
                uniq.append(signal)
        return uniq

    @staticmethod
    def _extract_blocked_signal(text: str, *, explicit: str, fallback: str) -> Optional[str]:
        if not text:
            return None
        lowered = text.lower()
        if explicit and explicit in lowered:
            return explicit
        if fallback and fallback in lowered:
            return fallback
        return None

    def _derive_context_signals(self, trace: dict[str, Any], *, fields: dict[str, str]) -> list[str]:
        signals: list[str] = []
        class_name = str(fields.get("context_policy_class", "")).strip().lower()
        packet_id = fields.get("context_packet_id", "N/A")
        staleness = fields.get("context_packet_staleness_warning", "false").lower()
        legacy_fallback = self._extract_bool(fields.get("legacy_memory_fallback")) or self._extract_bool(trace.get("legacy_memory_fallback"))
        fallback_reason = fields.get("fallback_reason", "N/A")
        blocked_reason = str((trace.get("dispatch", {}) or {}).get("blocked_reason", "")).strip()

        if class_name in {"critical", "standard"} and packet_id in {"", "N/A", "n/a", "None", "null", "unknown"}:
            signals.append("packet_missing")
        if class_name in {"critical", "standard"} and "ref" in packet_id.lower() and blocked_reason:
            signals.append("ref_unresolved")
        if staleness in {"1", "true", "yes", "on"}:
            signals.append("packet_expired")
        if legacy_fallback:
            signals.append("legacy_memory_fallback")
            if fallback_reason in {"", "N/A", "n/a", "None", "null", "unknown"}:
                signals.append("undeclared_fallback")
        audit = trace.get("context_audit") if isinstance(trace.get("context_audit"), dict) else {}
        if self._extract_bool(trace.get("screen_history_used")) or self._extract_bool(audit.get("screen_history_used")):
            signals.append("screen_history_used")

        for keyword, explicit in (
            ("packet_missing", "packet_missing"),
            ("ref_unresolved", "ref_unresolved"),
            ("reference unresolved", "ref_unresolved"),
            ("unresolved ref", "ref_unresolved"),
            ("packet_expired", "packet_expired"),
            ("undeclared_fallback", "undeclared_fallback"),
            ("screen_history_used", "screen_history_used"),
            ("screen history", "screen_history_used"),
        ):
            signal = self._extract_blocked_signal(blocked_reason, explicit=explicit, fallback=keyword)
            if signal:
                signals.append(signal)

        return self._normalize_contamination_signals(signals)

    @staticmethod
    def _nested_dict(root: dict[str, Any], *path: str) -> dict[str, Any]:
        current: Any = root
        for key in path:
            if not isinstance(current, dict):
                return {}
            current = current.get(key)
        return current if isinstance(current, dict) else {}

    def _context_candidate_from_ref(self, ref: Any) -> dict[str, Any]:
        if not isinstance(ref, dict):
            return {}
        return {
            "context_packet_id": ref.get("packet_id") or ref.get("id"),
            "context_packet_path": ref.get("path"),
            "context_packet_type": ref.get("type") or ref.get("packet_type"),
            "context_packet_hash": ref.get("hash") or ref.get("sha256"),
            "context_packet_expires_at": ref.get("expires_at"),
            "expires_at": ref.get("expires_at"),
            "context_policy_class": ref.get("context_policy_class") or ref.get("policy_class"),
        }

    def _context_candidate_from_packet(self, packet: Any) -> dict[str, Any]:
        if not isinstance(packet, dict):
            return {}
        meta = packet.get("metadata") if isinstance(packet.get("metadata"), dict) else {}
        manifest = packet.get("manifest") if isinstance(packet.get("manifest"), dict) else {}
        return {
            "context_packet_id": packet.get("packet_id") or packet.get("id") or meta.get("packet_id") or meta.get("id"),
            "context_packet_path": packet.get("path") or meta.get("path"),
            "context_packet_type": packet.get("type") or packet.get("packet_type") or meta.get("type") or meta.get("packet_type"),
            "context_packet_hash": packet.get("hash") or packet.get("sha256") or meta.get("hash") or manifest.get("hash"),
            "context_packet_expires_at": packet.get("context_packet_expires_at") or packet.get("expires_at") or meta.get("expires_at") or manifest.get("expires_at"),
            "expires_at": packet.get("expires_at") or manifest.get("expires_at"),
            "context_packet_staleness_warning": packet.get("staleness_warning") or packet.get("context_packet_staleness_warning") or meta.get("staleness_warning"),
            "context_policy_class": packet.get("context_policy_class") or packet.get("policy_class") or meta.get("context_policy_class") or meta.get("policy_class"),
        }

    def _context_candidate_from_runtime_result(self, result: Any) -> dict[str, Any]:
        if not isinstance(result, dict):
            return {}
        dispatch_path = str(result.get("dispatch_path") or "").strip()
        fallback_reason = result.get("fallback_reason")
        candidate = {
            "context_packet_id": result.get("context_packet_id"),
            "context_packet_path": result.get("context_packet_path"),
            "context_packet_type": result.get("context_packet_type"),
            "context_packet_hash": result.get("context_packet_hash"),
            "context_packet_expires_at": result.get("context_packet_expires_at") or result.get("expires_at"),
            "expires_at": result.get("expires_at") or result.get("context_packet_expires_at"),
            "context_packet_staleness_warning": result.get("context_packet_staleness_warning"),
            "context_policy_class": result.get("context_policy_class"),
            "fallback_reason": fallback_reason,
            "legacy_memory_fallback": (
                dispatch_path == "compatibility_fallback"
                or self._extract_bool(result.get("legacy_memory_fallback"))
            ),
            "contamination_signals": result.get("contamination_signals"),
        }
        if dispatch_path == "compatibility_fallback" and not fallback_reason:
            candidate["contamination_signals"] = ["undeclared_fallback"]
        return candidate

    def _extract_context_audit(self, trace: dict[str, Any]) -> dict[str, Any]:
        explicit = {
            "context_packet_id": "N/A",
            "context_packet_path": "N/A",
            "context_packet_type": "N/A",
            "context_packet_hash": "N/A",
            "context_packet_expires_at": "N/A",
            "context_packet_staleness_warning": "false",
            "context_policy_class": "N/A",
            "legacy_memory_fallback": False,
            "fallback_reason": "N/A",
            "contamination_signals": [],
            "_projection_gap": False,
        }
        dispatch = trace.get("dispatch") if isinstance(trace.get("dispatch"), dict) else {}
        task_envelope = self._nested_dict(trace, "task_envelope") or self._nested_dict(trace, "data", "task_envelope")
        scheduler_decision = self._nested_dict(trace, "scheduler_decision") or self._nested_dict(trace, "data", "scheduler_decision")
        candidates: list[Any] = [
            self._context_candidate_from_ref(dispatch.get("context_packet_ref")),
            self._context_candidate_from_ref(task_envelope.get("context_packet_ref")),
            self._context_candidate_from_packet(task_envelope.get("context_packet")),
            self._context_candidate_from_runtime_result(trace.get("submit_result")),
            self._context_candidate_from_runtime_result(trace.get("actor_runtime_result")),
            self._context_candidate_from_runtime_result((trace.get("data") or {}).get("submit_result") if isinstance(trace.get("data"), dict) else {}),
            {"context_packet_id": scheduler_decision.get("context_packet_id")},
            trace.get("context_audit"),
            (trace.get("legacy") or {}).get("context_audit"),
            (trace.get("legacy") or {}).get("context"),
            (trace.get("data") or {}).get("context_audit"),
            trace.get("context"),
        ]
        audit: dict[str, Any] = {}
        for candidate in candidates:
            if isinstance(candidate, dict):
                for key in list(explicit.keys()):
                    if key.startswith("_projection_gap"):
                        continue
                    if key in candidate and candidate[key] not in [None, "", []]:
                        if key == "legacy_memory_fallback":
                            explicit[key] = self._extract_bool(explicit[key]) or self._extract_bool(candidate[key])
                        else:
                            explicit[key] = candidate[key]
            if not any(isinstance(candidate, dict) and candidate for candidate in candidates):
                explicit["_projection_gap"] = True

        # If required context evidence is absent or partial, treat it as a
        # projection gap. The UI must not render verifier PASS as passed when
        # context sovereignty evidence is incomplete.
        missing_evidence_fields = [
            field
            for field in _CONTEXT_EVIDENCE_FIELDS
            if self._extract_str(explicit.get(field), default="N/A")
            in {"N/A", "n/a", "None", "null", "unknown", ""}
        ]
        if missing_evidence_fields and not explicit["_projection_gap"]:
            explicit["_projection_gap"] = True

        if (
            explicit["context_packet_expires_at"] in ["N/A", "n/a", "None", "null", "unknown", ""]
            and isinstance(trace.get("context_audit"), dict)
            and isinstance(trace["context_audit"].get("expires_at"), str)
        ):
            explicit["context_packet_expires_at"] = self._extract_str(
                trace["context_audit"].get("expires_at"),
                default="N/A",
            )

        parsed = {
            "context_packet_id": self._extract_str(explicit["context_packet_id"], default="N/A"),
            "context_packet_path": self._extract_str(explicit["context_packet_path"], default="N/A"),
            "context_packet_type": self._extract_str(explicit["context_packet_type"], default="N/A"),
            "context_packet_hash": self._extract_str(explicit["context_packet_hash"], default="N/A"),
            "context_packet_expires_at": self._extract_str(explicit["context_packet_expires_at"], default="N/A"),
            "context_packet_staleness_warning": self._extract_str(explicit["context_packet_staleness_warning"], default="false"),
            "context_policy_class": self._extract_str(explicit["context_policy_class"], default="N/A"),
            "legacy_memory_fallback": self._extract_bool(explicit["legacy_memory_fallback"]),
            "fallback_reason": self._extract_str(explicit["fallback_reason"], default="N/A"),
            "_projection_gap": bool(explicit["_projection_gap"]),
        }
        parsed["expires_at"] = parsed["context_packet_expires_at"]
        parsed["staleness_warning"] = parsed["context_packet_staleness_warning"]
        parsed["contamination_signals"] = sorted(
            set(self._normalize_contamination_signals(
                explicit["contamination_signals"],
                self._derive_context_signals(trace, fields=parsed),
            ))
        )

        if explicit["_projection_gap"] and "context_audit_missing" not in parsed["contamination_signals"]:
            parsed["contamination_signals"].append("context_audit_missing")
        return parsed

    def _determine_status_from_evidence(
        self, traces: list[dict[str, Any]], status: dict[str, Any]
    ) -> str:
        """Determine status from evidence traces.

        Without verifier evidence, nodes show warn/blocked, NOT passed.
        """
        if not traces:
            status_val = status.get("status", "unknown")
            if status_val == "passed":
                return "warn"
            return status_val

        has_pass = any(
            t.get("verifier", {}).get("decision") == "PASS" for t in traces
        )
        has_fail = any(
            t.get("verifier", {}).get("decision") == "FAIL" for t in traces
        )
        has_active = any(
            (t.get("dispatch", {}) or {}).get("dispatch_status") in {"dispatched", "active"}
            for t in traces
        )
        has_blocked = any(
            (t.get("dispatch", {}) or {}).get("dispatch_status") == "queued"
            or (t.get("dispatch", {}) or {}).get("blocked_reason")
            for t in traces
        )
        has_projection_gap = self._has_context_projection_gap(traces)
        contamination_signals = self._collect_contamination_signals(traces)
        blocking_context_signals = {
            "packet_missing",
            "ref_unresolved",
            "packet_expired",
            "undeclared_fallback",
            "screen_history_used",
        }

        if has_fail:
            return "failed"
        if blocking_context_signals.intersection(contamination_signals):
            return "blocked"
        if has_blocked and not has_pass:
            return "blocked"
        if contamination_signals or has_projection_gap:
            return "warn"
        if has_pass:
            # Only show passed if there's actual verifier evidence
            return "passed"
        if has_active:
            return "in_progress"
        return "pending"
