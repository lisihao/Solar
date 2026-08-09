"""replay_suite.py — Offline replay suite for the GEPA meta-optimiser.

Three execution modes
---------------------
offline:
    Fully local.  Loads samples from the evidence ledger, converts each
    entry to an ASI payload via :mod:`asi_adapter`, and returns a list of
    :data:`ReplayResult` dicts.  Empty sample list → ``[]`` without crash.

shadow:
    Contract stub (``NotImplementedError``).  Will shadow real dispatch
    traffic without affecting production routing.

bounded_online:
    Contract stub (``NotImplementedError``).  Will dispatch a bounded
    subset of tasks live for A/B comparison.

**Zero dependency on the ``gepa`` package.**

Public API
----------
``load_samples(ledger_dir, *, task_type, capsule_id, operator_id,
               repo_domain, since, until, max_samples) -> list[dict]``

``run_offline(samples, *, run_id) -> list[dict]``

``run_shadow(samples, **kwargs) -> NotImplementedError``

``run_bounded_online(samples, **kwargs) -> NotImplementedError``

ReplayResult schema
-------------------
Each dict returned by :func:`run_offline` contains::

    {
        "sample_index": int,    # 0-based position in the input samples list
        "raw_entry":   dict,    # original evidence ledger entry
        "asi_payload": dict,    # output of from_evidence_entry(entry)
        "completeness": float,  # evidence_completeness(asi_payload) in [0.0, 1.0]
        "run_id":      str,     # identifier shared across all results in one call
    }
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from integrations.gepa_optimizer.asi_adapter import (
    evidence_completeness,
    from_evidence_entry,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------

ReplaySample = Dict[str, Any]   # raw evidence ledger entry
ReplayResult = Dict[str, Any]   # result dict returned by run_offline


# ---------------------------------------------------------------------------
# load_samples
# ---------------------------------------------------------------------------

def load_samples(
    ledger_dir: Union[Path, str],
    *,
    task_type: Optional[str] = None,
    capsule_id: Optional[str] = None,
    operator_id: Optional[str] = None,
    repo_domain: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    max_samples: Optional[int] = None,
) -> List[ReplaySample]:
    """Load and filter evidence samples from a ledger directory.

    Scans *ledger_dir* for ``*.jsonl`` files, parses each non-empty line as a
    JSON object, and applies the requested filters.  Malformed lines and
    unreadable files are silently skipped.

    Parameters
    ----------
    ledger_dir:
        Directory containing ``*.jsonl`` evidence ledger files written by
        :class:`tools.evidence_ledger.EvidenceLedger`.  Non-existent
        directories return an empty list without raising.
    task_type:
        Filter by ``event_type`` field (e.g. ``"run_dispatched"``).
        ``None`` → no filter.
    capsule_id:
        Filter by ``capability_capsule_id`` field.
        ``None`` → no filter.
    operator_id:
        Filter by ``logical_operator`` **or** ``actor_id`` field.
        An entry is included when either field matches *operator_id*.
        ``None`` → no filter.
    repo_domain:
        Filter by ``repo_domain`` field.  Entries that lack this field
        never match a non-``None`` filter.
        ``None`` → no filter.
    since:
        ISO 8601 timestamp lower bound (inclusive) on the ``timestamp``
        field.  ``None`` → no lower bound.
    until:
        ISO 8601 timestamp upper bound (inclusive) on the ``timestamp``
        field.  ``None`` → no upper bound.
    max_samples:
        Maximum number of samples to return.  Scanning stops early once
        this limit is reached.  ``None`` → return all matches.

    Returns
    -------
    list[dict]
        Matching evidence entries.  Each dict is the raw JSON object
        parsed from the ledger file, suitable for passing to
        :func:`run_offline`.
    """
    ledger_dir = Path(ledger_dir)
    if not ledger_dir.is_dir():
        return []

    results: List[ReplaySample] = []

    for jsonl_path in sorted(ledger_dir.glob("*.jsonl")):
        try:
            text = jsonl_path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("replay_suite: cannot read %s: %s", jsonl_path, exc)
            continue

        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            try:
                entry = json.loads(line)
            except json.JSONDecodeError as exc:
                logger.debug("replay_suite: skipping malformed JSON line: %s", exc)
                continue

            if not isinstance(entry, dict):
                continue

            # --- task_type filter ---
            if task_type is not None and entry.get("event_type") != task_type:
                continue

            # --- capsule_id filter ---
            if capsule_id is not None and entry.get("capability_capsule_id") != capsule_id:
                continue

            # --- operator_id filter ---
            if operator_id is not None:
                logical_op = entry.get("logical_operator")
                actor = entry.get("actor_id")
                if logical_op != operator_id and actor != operator_id:
                    continue

            # --- repo_domain filter ---
            if repo_domain is not None and entry.get("repo_domain") != repo_domain:
                continue

            # --- since / until timestamp filters ---
            ts = entry.get("timestamp", "")
            if since is not None and ts < since:
                continue
            if until is not None and ts > until:
                continue

            results.append(entry)

            if max_samples is not None and len(results) >= max_samples:
                return results

    return results


# ---------------------------------------------------------------------------
# run_offline
# ---------------------------------------------------------------------------

def run_offline(
    samples: List[ReplaySample],
    *,
    run_id: Optional[str] = None,
) -> List[ReplayResult]:
    """Run an offline replay over a list of evidence samples.

    For each sample, converts the raw evidence entry to an ASI payload via
    :func:`~integrations.gepa_optimizer.asi_adapter.from_evidence_entry`
    and records the evidence completeness score.

    An empty *samples* list returns ``[]`` without raising.

    Parameters
    ----------
    samples:
        Raw evidence entries as returned by :func:`load_samples`.
    run_id:
        Stable identifier shared across all :data:`ReplayResult` dicts
        produced by this call.  Auto-generated (UUID4) when ``None``.

    Returns
    -------
    list[dict]
        One :data:`ReplayResult` per input sample, in the same order.
        Each result contains ``sample_index``, ``raw_entry``,
        ``asi_payload``, ``completeness``, and ``run_id``.
    """
    if not samples:
        return []

    effective_run_id: str = run_id if run_id is not None else str(uuid.uuid4())

    results: List[ReplayResult] = []
    for idx, entry in enumerate(samples):
        asi_payload = from_evidence_entry(entry)
        completeness = evidence_completeness(asi_payload)
        results.append(
            {
                "sample_index": idx,
                "raw_entry": entry,
                "asi_payload": asi_payload,
                "completeness": completeness,
                "run_id": effective_run_id,
            }
        )

    return results


# ---------------------------------------------------------------------------
# run_shadow — contract stub
# ---------------------------------------------------------------------------

def run_shadow(
    samples: List[ReplaySample],
    **kwargs: Any,
) -> List[ReplayResult]:
    """Shadow-mode replay — contract stub, not yet implemented.

    When implemented, this mode will mirror real dispatch traffic
    alongside production routing so that new selection policies can be
    evaluated without altering outcomes.

    Raises
    ------
    NotImplementedError
        Always.  Use :func:`run_offline` for local replay.
    """
    raise NotImplementedError(
        "run_shadow is a contract stub and has not been implemented. "
        "Use run_offline for fully local replay."
    )


# ---------------------------------------------------------------------------
# run_bounded_online — contract stub
# ---------------------------------------------------------------------------

def run_bounded_online(
    samples: List[ReplaySample],
    **kwargs: Any,
) -> List[ReplayResult]:
    """Bounded-online replay — contract stub, not yet implemented.

    When implemented, this mode will dispatch a capped subset of tasks
    live so that new policies can be A/B-tested against production traffic
    within defined safety budgets.

    Raises
    ------
    NotImplementedError
        Always.  Use :func:`run_offline` for local replay.
    """
    raise NotImplementedError(
        "run_bounded_online is a contract stub and has not been implemented. "
        "Use run_offline for fully local replay."
    )
