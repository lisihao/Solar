"""test_browser_security_policies.py — Unit tests for browser security policies.

Verifies session broker, capability-token checks, secret scrubbing, and state projection.
"""
from __future__ import annotations

import json
import importlib.util
import re
import sys
import tempfile
from pathlib import Path

import pytest

import browser_job_runtime as bjrt
from capability_token import CapabilityToken


@pytest.fixture(autouse=True)
def _isolated_browser_runtime_dirs(tmp_path, monkeypatch):
    """Keep browser job tests out of the user's live harness run directory."""
    monkeypatch.setattr(bjrt, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(bjrt, "BROWSER_JOBS_DIR", tmp_path / "run" / "browser-jobs")
    monkeypatch.setattr(bjrt, "OPERATOR_RESULTS_DIR", tmp_path / "run" / "operator-results")


def test_session_broker_health():
    """Verify session broker manages profile health and maps reauth to WAITING_HUMAN."""
    broker = bjrt.BrowserSessionBroker()

    # Healthy profile
    h1 = broker.get_profile_health("prod_profile", "user1@example.com")
    assert h1["status"] == "healthy"
    assert h1["projected_state"] == "running"
    assert h1["profile_ref"] == "prod_profile"
    assert h1["account_label"] == "user1@example.com"

    # Profile requiring reauth
    h2 = broker.get_profile_health("profile_needs_reauth", "user2@example.com")
    assert h2["status"] == "reauth_required"
    assert h2["projected_state"] == "WAITING_HUMAN"


def test_session_broker_scrubs_secrets():
    """Verify session broker scrubs credentials from profile_ref and account_label if they contain keys/secrets."""
    broker = bjrt.BrowserSessionBroker()
    
    # Passing token in profile_ref should get scrubbed
    h = broker.get_profile_health("sk-12345678901234567890123456789012", "password=my_secret")
    assert h["profile_ref"] == "[SCRUBBED]"
    assert h["account_label"] == "password=[SCRUBBED]"


def test_secret_scrubbing_text():
    """Verify scrub_secrets redacts sensitive headers, tokens, and credentials."""
    raw_log = (
        "INFO: Received request\n"
        "Set-Cookie: session_id=abc123xyz; Path=/; Secure\n"
        "Authorization: Bearer my_secret_oauth_token_value_here\n"
        "Cookie: user=admin; token=secret123\n"
        "apiKey = sk-abcdefghijklmnopqrstuvwxyz123456\n"
        "password: mysecretpassword\n"
    )

    scrubbed = bjrt.scrub_secrets(raw_log)
    assert "Set-Cookie: [SCRUBBED]" in scrubbed
    assert "Authorization: [SCRUBBED]" in scrubbed
    assert "Cookie: [SCRUBBED]" in scrubbed
    assert "apiKey=[SCRUBBED]" in scrubbed
    assert "password=[SCRUBBED]" in scrubbed
    assert "session_id=abc123xyz" not in scrubbed
    assert "my_secret_oauth_token_value_here" not in scrubbed


def test_secret_scrubbing_dict():
    """Verify scrub_dict allows profile_ref and account_label but scrubs secrets."""
    envelope = {
        "profile_ref": "profile_1",
        "account_label": "user@example.com",
        "cookie": "user=admin; token=123",
        "secret_token": "ghp_123456789012345678901234567890123456",
        "nested": {
            "password": "pass",
            "safe_value": "hello"
        }
    }

    scrubbed = bjrt.scrub_dict(envelope)
    assert scrubbed["profile_ref"] == "profile_1"
    assert scrubbed["account_label"] == "user@example.com"
    assert scrubbed["cookie"] == "[SCRUBBED]"
    assert scrubbed["secret_token"] == "[SCRUBBED]"
    assert scrubbed["nested"]["password"] == "[SCRUBBED]"
    assert scrubbed["nested"]["safe_value"] == "hello"


def test_policy_checks_payment_denied():
    """Verify payment actions are always denied during job submission."""
    envelope = {
        "task_id": "T-pay",
        "objective": "Go to billing page and checkout the upgrade package"
    }

    with pytest.raises(PermissionError, match="prohibited payment action"):
        bjrt.submit_browser_job("mini-browser-deepresearch", envelope)


def test_policy_checks_secrets_denied():
    """Verify secrets requests are denied by default or when token denies them."""
    envelope = {
        "task_id": "T-sec",
        "objective": "Fill the form with the API password",
        "secret_ref": "prod/api-password",
    }

    # Denied by default when no capability token is provided
    with pytest.raises(PermissionError, match="no capability token provided"):
        bjrt.submit_browser_job("mini-browser-deepresearch", envelope)

    # Denied when token denies secrets explicitly
    token_deny = CapabilityToken(
        token_id="tok-deny",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        secrets={"allowed": False}
    )
    with pytest.raises(PermissionError, match="capability token denies"):
        bjrt.submit_browser_job("mini-browser-deepresearch", envelope, capability_token=token_deny)

    # Denied when the legacy allowed flag is true but PolicyEngine ref allowlist does not match.
    token_ref_deny = CapabilityToken(
        token_id="tok-ref-deny",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        secrets={"allowed": True, "allowed_secret_refs": ["dev/*"]}
    )
    with pytest.raises(PermissionError, match="capability token denies"):
        bjrt.submit_browser_job("mini-browser-deepresearch", envelope, capability_token=token_ref_deny)

    # Allowed when the PolicyEngine secret ref allowlist matches.
    token_allow = CapabilityToken(
        token_id="tok-allow",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        secrets={"allowed": True, "allowed_secret_refs": ["prod/*"]}
    )
    # Should submit successfully
    job_id = bjrt.submit_browser_job("mini-browser-deepresearch", envelope, capability_token=token_allow)
    assert job_id.startswith("job-")


def test_policy_checks_destructive_denied():
    """Verify destructive actions are denied by default or when token denies them."""
    safe_path = str(Path("/tmp/solar-safe-old-config").resolve())
    envelope = {
        "task_id": "T-dest",
        "objective": "Execute rm -rf on the old configuration folder",
        "destructive_path": safe_path,
    }

    # Denied by default
    with pytest.raises(PermissionError, match="no capability token provided"):
        bjrt.submit_browser_job("mini-browser-deepresearch", envelope)

    # Denied when token denies destructive actions
    token_deny = CapabilityToken(
        token_id="tok-deny",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        file_scope={"write_paths": [], "secret_paths_allowed": False, "destructive_allowed": False}
    )
    with pytest.raises(PermissionError, match="capability token denies"):
        bjrt.submit_browser_job("mini-browser-deepresearch", envelope, capability_token=token_deny)

    # Denied when the legacy destructive flag is true but no destructive path is allowed.
    token_flag_only = CapabilityToken(
        token_id="tok-flag-only",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        file_scope={"write_paths": [], "destructive_allowed": True}
    )
    with pytest.raises(PermissionError, match="capability token denies"):
        bjrt.submit_browser_job("mini-browser-deepresearch", envelope, capability_token=token_flag_only)

    # Allowed when the PolicyEngine destructive path allowlist matches.
    token_allow = CapabilityToken(
        token_id="tok-allow",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        file_scope={
            "write_paths": [safe_path],
            "allow_destructive_paths": [safe_path],
        }
    )
    job_id = bjrt.submit_browser_job("mini-browser-deepresearch", envelope, capability_token=token_allow)
    assert job_id.startswith("job-")


def test_legacy_tools_browser_runtime_uses_policy_engine_checks(tmp_path, monkeypatch):
    """The tools/ compatibility copy must not bypass CapabilityToken policy checks."""
    runtime_path = Path(__file__).resolve().parents[2] / "tools" / "browser_job_runtime.py"
    text = runtime_path.read_text(encoding="utf-8")
    assert "capability_token.to_dict()" not in text
    spec = importlib.util.spec_from_file_location("tools_browser_job_runtime_under_test", runtime_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)

    monkeypatch.setattr(module, "HARNESS_DIR", tmp_path)
    monkeypatch.setattr(module, "BROWSER_JOBS_DIR", tmp_path / "run" / "browser-jobs")
    monkeypatch.setattr(module, "OPERATOR_RESULTS_DIR", tmp_path / "run" / "operator-results")

    secret_envelope = {
        "task_id": "T-tools-sec",
        "objective": "Fill the form with the API password",
        "secret_ref": "prod/api-password",
    }
    token_ref_deny = CapabilityToken(
        token_id="tok-tools-ref-deny",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        secrets={"allowed": True, "allowed_secret_refs": ["dev/*"]},
    )
    with pytest.raises(PermissionError, match="capability token denies"):
        module.submit_browser_job("mini-browser-deepresearch", secret_envelope, capability_token=token_ref_deny)

    safe_path = str((tmp_path / "allowed").resolve())
    destructive_envelope = {
        "task_id": "T-tools-dest",
        "objective": "Delete the old export folder",
        "destructive_path": safe_path,
    }
    token_flag_only = CapabilityToken(
        token_id="tok-tools-flag-only",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        file_scope={"write_paths": [], "destructive_allowed": True},
    )
    with pytest.raises(PermissionError, match="capability token denies"):
        module.submit_browser_job("mini-browser-deepresearch", destructive_envelope, capability_token=token_flag_only)


def test_browser_policy_denies_write_single_decision_event(monkeypatch):
    """Deny paths write one scrubbed capability decision event."""
    events = []

    def capture(envelope, *, actor, decision, event_type="capability_decision", kind=""):
        events.append(
            {
                "task_id": envelope.get("task_id"),
                "actor": actor,
                "event_type": event_type,
                "kind": kind,
                "reason": decision.reason,
                "audit": decision.audit,
            }
        )

    monkeypatch.setattr(bjrt, "_write_capability_decision", capture)
    token = CapabilityToken(
        token_id="tok-secret",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="a1",
        secrets={"allowed": True, "allowed_secret_refs": ["dev/*"]},
    )

    with pytest.raises(PermissionError, match="capability token denies"):
        bjrt.submit_browser_job(
            "mini-browser-deepresearch",
            {
                "task_id": "T-secret-event",
                "objective": "Fill a password",
                "secret_ref": "prod/raw-secret-value",
            },
            capability_token=token,
        )

    assert len(events) == 1
    assert events[0]["event_type"] == "capability_decision"
    assert events[0]["kind"] == "secrets"
    assert events[0]["reason"] == "secret_not_listed"
    assert "prod/raw-secret-value" not in json.dumps(events[0], sort_keys=True)


def test_reauth_required_surfaces_waiting_human():
    """Verify polling a reauth_required state surfaces projected_state as WAITING_HUMAN."""
    envelope = {"task_id": "T-reauth", "objective": "Do standard research"}
    token = CapabilityToken("tok", ["file:write"], "2099-01-01T00:00:00Z", "a1")

    job_id = bjrt.submit_browser_job(
        "mini-browser-deepresearch",
        envelope,
        mock_sequence=["running", "reauth_required"],
        capability_token=token
    )

    # First poll: running
    r1 = bjrt.poll_browser_job(job_id)
    assert r1["state"] == "running"
    assert r1["projected_state"] == "running"

    # Second poll: reauth_required -> surfaces WAITING_HUMAN
    r2 = bjrt.poll_browser_job(job_id)
    assert r2["state"] == "reauth_required"
    assert r2["projected_state"] == "WAITING_HUMAN"


# ---------------------------------------------------------------------------
# U7 — PolicyDecision equivalence: browser intercept == PolicyEngine decision
# Sprint: sprint-20260530-p0-...s03-core-runtime / B7_unit_tests
# ---------------------------------------------------------------------------

def _make_token(**kwargs) -> CapabilityToken:
    defaults = dict(
        token_id="tok-u7",
        scopes=["file:write"],
        expires_at="2099-01-01T00:00:00Z",
        actor_id="actor-u7",
    )
    defaults.update(kwargs)
    return CapabilityToken(**defaults)


def test_u7_secrets_browser_and_policy_engine_agree_deny(monkeypatch):
    """U7a — secrets deny: browser PermissionError reason == PolicyEngine reason."""
    events = []

    def capture(envelope, *, actor, decision, event_type="capability_decision", kind=""):
        events.append({"reason": decision.reason, "kind": kind, "event_type": event_type})

    monkeypatch.setattr(bjrt, "_write_capability_decision", capture)

    token = _make_token(secrets={"allowed": True, "allowed_secret_refs": ["dev/*"]})
    secret_ref = "prod/db-password"

    # Direct PolicyEngine check
    policy_decision = token.check_secrets(secret_ref)
    assert not policy_decision.allowed
    assert policy_decision.reason == "secret_not_listed"

    # Browser enforcement must raise and use the same reason
    with pytest.raises(PermissionError):
        bjrt.submit_browser_job(
            "mini-browser",
            {"task_id": "T-u7a", "objective": "Fill password", "secret_ref": secret_ref},
            capability_token=token,
        )

    assert len(events) == 1
    assert events[0]["kind"] == "secrets"
    assert events[0]["reason"] == policy_decision.reason


def test_u7_secrets_browser_and_policy_engine_agree_allow(monkeypatch):
    """U7b — secrets allow: browser passes when PolicyEngine allows."""
    token = _make_token(secrets={"allowed": True, "allowed_secret_refs": ["dev/*"]})
    secret_ref = "dev/api-key"

    policy_decision = token.check_secrets(secret_ref)
    assert policy_decision.allowed

    # Browser must NOT raise
    job_id = bjrt.submit_browser_job(
        "mini-browser",
        {"task_id": "T-u7b", "objective": "Fill API key", "secret_ref": secret_ref},
        capability_token=token,
    )
    assert job_id.startswith("job-")


def test_u7_destructive_browser_and_policy_engine_agree_deny(monkeypatch):
    """U7c — destructive deny: browser PermissionError reason == PolicyEngine reason."""
    events = []

    def capture(envelope, *, actor, decision, event_type="capability_decision", kind=""):
        events.append({"reason": decision.reason, "kind": kind})

    monkeypatch.setattr(bjrt, "_write_capability_decision", capture)

    target = str(Path("/tmp/solar-cannot-delete").resolve())
    token = _make_token(
        file_scope={"write_paths": [], "secret_paths_allowed": False, "destructive_allowed": False}
    )

    policy_decision = token.check_file("destructive", target)
    assert not policy_decision.allowed
    assert policy_decision.reason == "destructive_denied"

    with pytest.raises(PermissionError):
        bjrt.submit_browser_job(
            "mini-browser",
            {
                "task_id": "T-u7c",
                "objective": "Delete all old data",
                "destructive_path": target,
            },
            capability_token=token,
        )

    assert len(events) == 1
    assert events[0]["kind"] == "file"
    assert events[0]["reason"] == policy_decision.reason


def test_u7_destructive_browser_and_policy_engine_agree_allow(monkeypatch):
    """U7d — destructive allow: browser passes when PolicyEngine allows."""
    target = str(Path("/tmp/solar-safe-cleanup").resolve())
    token = _make_token(
        file_scope={
            "write_paths": [target],
            "allow_destructive_paths": [target],
        }
    )

    policy_decision = token.check_file("destructive", target)
    assert policy_decision.allowed

    job_id = bjrt.submit_browser_job(
        "mini-browser",
        {
            "task_id": "T-u7d",
            "objective": "Remove old cache folder",
            "destructive_path": target,
        },
        capability_token=token,
    )
    assert job_id.startswith("job-")


def test_u7_payment_always_denied_independent_of_policy_engine(monkeypatch):
    """U7e — payment is product-level deny (hardcoded), NOT PolicyEngine-routed.

    The browser runtime always denies payment regardless of token scopes.
    This is the correct architecture: payment is a product policy, not a per-token grant.
    """
    events = []

    def capture(envelope, *, actor, decision, event_type="capability_decision", kind=""):
        events.append({"reason": decision.reason, "kind": kind, "event_type": event_type})

    monkeypatch.setattr(bjrt, "_write_capability_decision", capture)

    token = _make_token()  # fully permissive scopes won't matter

    with pytest.raises(PermissionError, match="prohibited payment action"):
        bjrt.submit_browser_job(
            "mini-browser",
            {"task_id": "T-u7e", "objective": "Go to checkout and pay for subscription"},
            capability_token=token,
        )

    # Event recorded with kind=payment and reason=payment_denied
    assert len(events) == 1
    assert events[0]["kind"] == "payment"
    assert events[0]["reason"] == "payment_denied"


def test_u7_missing_token_secrets_event_type(monkeypatch):
    """U7f — missing token for secrets request → capability_decision_missing_token event."""
    events = []

    def capture(envelope, *, actor, decision, event_type="capability_decision", kind=""):
        events.append({"event_type": event_type, "kind": kind, "reason": decision.reason})

    monkeypatch.setattr(bjrt, "_write_capability_decision", capture)

    with pytest.raises(PermissionError, match="no capability token provided"):
        bjrt.submit_browser_job(
            "mini-browser",
            {
                "task_id": "T-u7f",
                "objective": "Fill the credentials form with the API secret",
                "secret_ref": "prod/key",
            },
        )

    assert len(events) == 1
    assert events[0]["event_type"] == "capability_decision_missing_token"
    assert events[0]["kind"] == "secrets"


def test_u7_missing_token_destructive_event_type(monkeypatch):
    """U7g — missing token for destructive request → capability_decision_missing_token event."""
    events = []

    def capture(envelope, *, actor, decision, event_type="capability_decision", kind=""):
        events.append({"event_type": event_type, "kind": kind})

    monkeypatch.setattr(bjrt, "_write_capability_decision", capture)

    with pytest.raises(PermissionError, match="no capability token provided"):
        bjrt.submit_browser_job(
            "mini-browser",
            {
                "task_id": "T-u7g",
                "objective": "Delete the old log files",
                "destructive_path": str(Path("/tmp/old-logs").resolve()),
            },
        )

    assert len(events) == 1
    assert events[0]["event_type"] == "capability_decision_missing_token"
    assert events[0]["kind"] == "file"
