#!/usr/bin/env python3
"""Antigravity desktop bridge adapter for Solar-Harness.

Scans ~/.solar/antigravity-bridge/from-antigravity for desktop app exports
and feeds them into the existing RawIntent -> intent_consumer chain.

See design doc section 4.1-4.3 for the full contract.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

HARNESS_DIR = Path(os.environ.get(
    "SOLAR_HARNESS_DIR",
    Path(__file__).resolve().parents[1],
))

SUPPORTED_PREFIXES = ("req-", "conv-", "artifact-", "review-", "ctx-")
EVIDENCE_DIR_NAME = ".evidence"
PROCESSED_DIR_NAME = ".processed"


def _home() -> Path:
    return Path(os.environ.get("HOME", Path.home()))


def bridge_root() -> Path:
    return Path(os.environ.get(
        "SOLAR_ANTIGRAVITY_BRIDGE_ROOT",
        _home() / ".solar" / "antigravity-bridge",
    ))


def inbox_dir() -> Path:
    return bridge_root() / "from-antigravity"


def processed_dir() -> Path:
    return inbox_dir() / PROCESSED_DIR_NAME


def evidence_dir() -> Path:
    return inbox_dir() / EVIDENCE_DIR_NAME


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def classify_file(name: str) -> str | None:
    """Return the prefix type or None for unsupported prefixes."""
    for prefix in SUPPORTED_PREFIXES:
        if name.startswith(prefix):
            return prefix.rstrip("-")
    return None


def validate_json_content(raw: str) -> tuple[dict[str, Any] | None, str | None]:
    """Validate JSON content. Returns (parsed, error)."""
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError as exc:
        return None, f"invalid JSON: {exc}"
    if not isinstance(obj, dict):
        return None, "JSON root must be an object"
    return obj, None


def extract_lineage_metadata(obj: dict[str, Any]) -> dict[str, Any]:
    """Extract lineage metadata from a parsed JSON fixture.

    Looks for conversation_id, project_id, and the first artifact_refs entry.
    Returned values are passed to intent_gateway as research artifact flags so the
    compiled Requirement IR contains lineage metadata.
    """
    meta: dict[str, Any] = {}
    if isinstance(obj.get("conversation_id"), str) and obj["conversation_id"].strip():
        meta["conversation_id"] = obj["conversation_id"].strip()
    if isinstance(obj.get("project_id"), str) and obj["project_id"].strip():
        meta["project_id"] = obj["project_id"].strip()
    refs = obj.get("artifact_refs")
    if not isinstance(refs, list):
        refs = obj.get("attachments")
    if isinstance(refs, list):
        for ref in refs:
            if isinstance(ref, str) and ref.strip():
                meta["artifact_ref"] = ref.strip()
                break
    return meta


def check_attachment_paths(obj: dict[str, Any]) -> list[str]:
    """Check for path traversal and absolute paths in attachment refs.

    Returns a list of violation descriptions (empty = ok).
    """
    violations: list[str] = []
    refs = obj.get("artifact_refs")
    if not isinstance(refs, list):
        refs = obj.get("attachments")
    if not isinstance(refs, list):
        return violations
    for ref in refs:
        if not isinstance(ref, str):
            continue
        if os.path.isabs(ref):
            violations.append(f"absolute path in attachment: {ref}")
        normalized = os.path.normpath(ref)
        if normalized.startswith(".."):
            violations.append(f"path traversal in attachment: {ref}")
    return violations


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def content_hash_str(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def write_failure_evidence(
    file_path: Path,
    reason: str,
    details: str = "",
    stage: str = "",
) -> Path:
    """Write failure evidence to .evidence dir without deleting the input.

    stage indicates where in the pipeline the failure occurred:
    'validation', 'capture', or 'consume'.
    """
    edir = evidence_dir()
    edir.mkdir(parents=True, exist_ok=True)
    ts = now_iso().replace(":", "-").replace("T", "_")
    ev_name = f"{file_path.stem}.fail.{ts}.json"
    ev_path = edir / ev_name
    payload: dict[str, Any] = {
        "schema_version": "solar.antigravity_bridge.fail_evidence.v2",
        "file": file_path.name,
        "source_path": str(file_path),
        "reason": reason,
        "details": details,
        "stage": stage,
        "timestamp": now_iso(),
        "file_size": file_path.stat().st_size if file_path.exists() else 0,
    }
    try:
        raw = file_path.read_text(encoding="utf-8", errors="replace")
        payload["original_content_hash"] = content_hash_str(raw)
    except Exception:
        payload["original_content_hash"] = "unreadable"
    write_json(ev_path, payload)
    return ev_path


def write_success_evidence(
    file_path: Path,
    intent_id: str,
    stage: str,
    extra: dict[str, Any] | None = None,
) -> Path:
    """Write success evidence to .evidence dir.

    stage is 'capture' or 'consume'.
    """
    edir = evidence_dir()
    edir.mkdir(parents=True, exist_ok=True)
    ts = now_iso().replace(":", "-").replace("T", "_")
    ev_name = f"{file_path.stem}.{stage}.ok.{ts}.json"
    ev_path = edir / ev_name
    payload: dict[str, Any] = {
        "schema_version": "solar.antigravity_bridge.success_evidence.v1",
        "file": file_path.name,
        "intent_id": intent_id,
        "stage": stage,
        "timestamp": now_iso(),
    }
    if extra:
        payload.update(extra)
    write_json(ev_path, payload)
    return ev_path


class ScanResult:
    """Accumulator for a single scan pass."""

    __slots__ = (
        "processed", "failed_validation", "failed_capture",
        "failed_consume", "skipped_already_processed", "errors",
    )

    def __init__(self) -> None:
        self.processed: list[str] = []
        self.failed_validation: list[str] = []
        self.failed_capture: list[str] = []
        self.failed_consume: list[str] = []
        self.skipped_already_processed: list[str] = []
        self.errors: list[dict[str, str]] = []

    def summary(self) -> dict[str, Any]:
        return {
            "processed": len(self.processed),
            "failed_validation": len(self.failed_validation),
            "failed_capture": len(self.failed_capture),
            "failed_consume": len(self.failed_consume),
            "skipped_already_processed": len(self.skipped_already_processed),
            "errors": self.errors,
        }


def idempotency_key(file_path: Path) -> str:
    """Compute idempotency key from filename + content hash."""
    try:
        h = content_hash_str(file_path.read_text(encoding="utf-8", errors="replace"))
    except Exception:
        h = "unreadable"
    return f"{file_path.name}:{h}"


def check_idempotency(file_path: Path, ledger_path: Path | None = None) -> bool:
    """Return True if file was already processed (idempotent skip)."""
    if ledger_path is None:
        ledger_path = processed_dir() / "idempotency-ledger.jsonl"
    if not ledger_path.exists():
        return False
    key = idempotency_key(file_path)
    try:
        for line in ledger_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            entry = json.loads(line)
            if entry.get("key") == key:
                return True
    except Exception:
        pass
    return False


def record_idempotency(file_path: Path, intent_id: str, ledger_path: Path | None = None) -> None:
    """Record successful processing in the idempotency ledger."""
    if ledger_path is None:
        ledger_path = processed_dir() / "idempotency-ledger.jsonl"
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    entry = {
        "key": idempotency_key(file_path),
        "file": file_path.name,
        "intent_id": intent_id,
        "timestamp": now_iso(),
    }
    with open(ledger_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def process_file(
    file_path: Path,
    harness_dir: Path | None = None,
    sprints_dir: Path | None = None,
    dry_run: bool = False,
) -> tuple[bool, str]:
    """Process a single inbox file.

    Returns (success, message).
    On success, the file is moved to .processed/.
    On failure, failure evidence is written and the file stays in inbox.
    """
    if harness_dir is None:
        harness_dir = HARNESS_DIR
    if sprints_dir is None:
        sprints_dir = harness_dir / "sprints"

    name = file_path.name

    # Skip already processed
    proc_dir = processed_dir()
    if (proc_dir / name).exists():
        return True, f"already processed: {name}"

    # Check prefix
    file_type = classify_file(name)
    if file_type is None:
        ev = write_failure_evidence(file_path, "invalid_prefix", f"file '{name}' does not match any supported prefix: {SUPPORTED_PREFIXES}", stage="validation")
        return False, f"invalid prefix: {name} (evidence: {ev.name})"

    # Read content
    try:
        raw = file_path.read_text(encoding="utf-8", errors="replace")
    except Exception as exc:
        ev = write_failure_evidence(file_path, "unreadable", str(exc), stage="validation")
        return False, f"unreadable: {name} ({ev.name})"

    # JSON files must be valid; also extract lineage metadata for research artifact tracking
    lineage: dict[str, Any] = {}
    if name.endswith(".json"):
        parsed, json_err = validate_json_content(raw)
        if json_err is not None:
            ev = write_failure_evidence(file_path, "invalid_json", json_err, stage="validation")
            return False, f"invalid JSON: {name} ({ev.name})"

        # Check attachment path traversal
        path_violations = check_attachment_paths(parsed)
        if path_violations:
            ev = write_failure_evidence(
                file_path,
                "unsafe_attachment_path",
                "; ".join(path_violations),
                stage="validation",
            )
            return False, f"unsafe attachments: {name} ({ev.name})"

        lineage = extract_lineage_metadata(parsed)

    # Idempotency check
    if check_idempotency(file_path):
        return True, f"idempotent skip: {name}"

    if dry_run:
        return True, f"dry-run ok: {name} (type={file_type})"

    # Capture through intent_gateway
    intent_gateway = harness_dir / "lib" / "intent_gateway.py"
    if not intent_gateway.exists():
        ev = write_failure_evidence(file_path, "missing_gateway", str(intent_gateway))
        return False, f"intent_gateway not found: {ev.name}"

    import subprocess
    env = dict(os.environ)
    env["SOLAR_HARNESS_DIR"] = str(harness_dir)
    env["SOLAR_HARNESS_SPRINTS_DIR"] = str(sprints_dir)

    mode = "delivery"
    if file_type == "review":
        mode = "review"
    elif file_type == "conv":
        mode = "research"

    capture_cmd = [
        sys.executable, str(intent_gateway), "capture",
        "--source-channel", "antigravity_app",
        "--actor", "antigravity-user",
        "--device", "desktop",
        "--repo", str(harness_dir),
        "--source-trust", "antigravity_app_file",
        "--mode", mode,
        "--file", str(file_path),
        "--json",
    ]
    if lineage.get("conversation_id"):
        capture_cmd += ["--research-conversation-id", lineage["conversation_id"]]
    if lineage.get("project_id"):
        capture_cmd += ["--research-project-name", lineage["project_id"]]
    if lineage.get("artifact_ref"):
        capture_cmd += ["--research-artifact", lineage["artifact_ref"]]

    try:
        proc = subprocess.run(
            capture_cmd,
            capture_output=True,
            text=True,
            timeout=60,
            env=env,
        )
    except subprocess.TimeoutExpired:
        ev = write_failure_evidence(file_path, "capture_timeout", "gateway timed out after 60s", stage="capture")
        return False, f"capture timeout: {name} ({ev.name})"
    except Exception as exc:
        ev = write_failure_evidence(file_path, "capture_error", str(exc), stage="capture")
        return False, f"capture error: {name} ({ev.name})"

    if proc.returncode != 0:
        stderr_tail = (proc.stderr or "")[-500:]
        ev = write_failure_evidence(file_path, "capture_failed", stderr_tail, stage="capture")
        return False, f"capture failed: {name} rc={proc.returncode} ({ev.name})"

    # Parse intent_id from gateway output
    intent_id = ""
    try:
        gw_result = json.loads(proc.stdout)
        intent_id = gw_result.get("intent_id", "")
    except Exception:
        pass

    if not intent_id:
        ev = write_failure_evidence(file_path, "no_intent_id", proc.stdout[-500:] if proc.stdout else "", stage="capture")
        return False, f"no intent_id: {name} ({ev.name})"

    # Write capture success evidence
    write_success_evidence(file_path, intent_id, "capture")

    # Consume through intent_consumer
    intent_consumer = harness_dir / "lib" / "intent_consumer.py"
    if intent_consumer.exists():
        try:
            consume_proc = subprocess.run(
                [
                    sys.executable, str(intent_consumer), "consume",
                    "--intent-id", intent_id,
                    "--json",
                ],
                capture_output=True,
                text=True,
                timeout=60,
                env=env,
            )
            if consume_proc.returncode != 0:
                stderr_tail = (consume_proc.stderr or "")[-500:]
                ev = write_failure_evidence(file_path, "consume_failed", stderr_tail, stage="consume")
                return False, f"consume failed: {name} intent={intent_id} ({ev.name})"
        except subprocess.TimeoutExpired:
            ev = write_failure_evidence(file_path, "consume_timeout", f"intent_id={intent_id}", stage="consume")
            return False, f"consume timeout: {name} ({ev.name})"
        except Exception as exc:
            ev = write_failure_evidence(file_path, "consume_error", str(exc), stage="consume")
            return False, f"consume error: {name} ({ev.name})"

        # Write consume success evidence
        write_success_evidence(file_path, intent_id, "consume")

    # Record idempotency
    record_idempotency(file_path, intent_id)

    # Move to processed
    proc_dir.mkdir(parents=True, exist_ok=True)
    shutil.move(str(file_path), str(proc_dir / name))

    return True, f"processed: {name} -> intent={intent_id}"


def scan_once(
    harness_dir: Path | None = None,
    sprints_dir: Path | None = None,
    dry_run: bool = False,
) -> ScanResult:
    """Scan the from-antigravity inbox once and process all files."""
    result = ScanResult()
    inbox = inbox_dir()

    if not inbox.exists():
        return result

    proc_dir = processed_dir()

    # Collect files, excluding .processed and .evidence dirs and dotfiles
    try:
        entries = sorted(inbox.iterdir())
    except Exception:
        return result

    for entry in entries:
        if not entry.is_file():
            continue
        if entry.name.startswith("."):
            continue

        name = entry.name

        # Check if already processed
        if (proc_dir / name).exists():
            result.skipped_already_processed.append(name)
            continue

        # Check idempotency ledger
        if check_idempotency(entry):
            result.skipped_already_processed.append(name)
            continue

        ok, msg = process_file(entry, harness_dir, sprints_dir, dry_run)

        if ok:
            result.processed.append(name)
        else:
            if "invalid prefix" in msg:
                result.failed_validation.append(name)
            elif "capture" in msg:
                result.failed_capture.append(name)
            elif "consume" in msg:
                result.failed_consume.append(name)
            else:
                result.failed_validation.append(name)
            result.errors.append({"file": name, "message": msg})

    return result


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(
        prog="antigravity_bridge.py",
        description="Antigravity desktop bridge adapter",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    scan_p = sub.add_parser("scan", help="Scan inbox once")
    scan_p.add_argument("--dry-run", action="store_true")
    scan_p.add_argument("--json", action="store_true")

    classify_p = sub.add_parser("classify", help="Classify a filename")
    classify_p.add_argument("filename")

    validate_p = sub.add_parser("validate", help="Validate a single file")
    validate_p.add_argument("filepath")

    health_p = sub.add_parser("health", help="Bridge health summary")

    args = parser.parse_args(argv)

    if args.cmd == "scan":
        result = scan_once(dry_run=args.dry_run)
        summary = result.summary()
        if args.json:
            print(json.dumps(summary, ensure_ascii=False, indent=2))
        else:
            print(f"[antigravity-bridge] scan: processed={summary['processed']} "
                  f"failed_validation={summary['failed_validation']} "
                  f"failed_capture={summary['failed_capture']} "
                  f"skipped={summary['skipped_already_processed']}")
            for err in summary["errors"]:
                print(f"  ERROR: {err['file']}: {err['message']}")
        return 0

    if args.cmd == "classify":
        ftype = classify_file(args.filename)
        if ftype:
            print(ftype)
            return 0
        else:
            print(f"unsupported prefix: {args.filename}", file=sys.stderr)
            return 1

    if args.cmd == "validate":
        fp = Path(args.filepath)
        if not fp.exists():
            print(f"file not found: {fp}", file=sys.stderr)
            return 1
        name = fp.name
        ftype = classify_file(name)
        if ftype is None:
            print(f"FAIL: invalid prefix: {name}")
            return 1
        if name.endswith(".json"):
            raw = fp.read_text(encoding="utf-8")
            parsed, err = validate_json_content(raw)
            if err:
                print(f"FAIL: {err}")
                return 1
            violations = check_attachment_paths(parsed)
            if violations:
                for v in violations:
                    print(f"FAIL: {v}")
                return 1
        print(f"OK: {name} type={ftype}")
        return 0

    if args.cmd == "health":
        inbox = inbox_dir()
        proc = processed_dir()
        ev_dir = evidence_dir()

        inbox_count = 0
        proc_count = 0
        fail_count = 0
        last_ts = ""

        if inbox.exists():
            for f in inbox.iterdir():
                if f.is_file() and not f.name.startswith("."):
                    inbox_count += 1
        if proc.exists():
            for f in proc.iterdir():
                if f.is_file() and not f.name.startswith("."):
                    proc_count += 1
        if ev_dir.exists():
            for f in ev_dir.iterdir():
                if f.is_file() and f.suffix == ".json":
                    if ".fail." in f.name:
                        fail_count += 1

        # Read last processed timestamp from ledger
        ledger = proc / "idempotency-ledger.jsonl"
        if ledger.exists():
            try:
                last_line = None
                for line in ledger.read_text(encoding="utf-8").splitlines():
                    if line.strip():
                        last_line = line
                if last_line:
                    entry = json.loads(last_line)
                    last_ts = entry.get("timestamp", "")
            except Exception:
                pass

        status = "healthy" if inbox.exists() else "pending"
        if not inbox.exists():
            status = "pending (inbox dir not found)"

        health_data = {
            "status": status,
            "inbox_count": inbox_count,
            "processed_count": proc_count,
            "failed_count": fail_count,
            "last_capture_timestamp": last_ts,
            "inbox_path": str(inbox),
        }
        print(json.dumps(health_data, ensure_ascii=False, indent=2))
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
