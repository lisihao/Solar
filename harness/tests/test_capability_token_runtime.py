"""Tests for capability_token.py — Token validation and path enforcement.

Sprint: sprint-20260530-p0-修复单-把-capability-token-从-helper-schema-提升为-runtime-权限执行边界-s03-core-runtime
Node: B7_unit_tests — U1–U7 (check_file, check_shell, check_network, check_git, check_secrets, v1 compat)
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))

from capability_token import CapabilityToken, PolicyDecision

TMP_SOLAR_ALLOWED = str(Path("/tmp/solar-allowed").resolve())
TMP_SOLAR_SAFE_OLD_CONFIG = str(Path("/tmp/solar-safe-old-config").resolve())
TMP_SOLAR_V1 = str(Path("/tmp/solar-v1").resolve())


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _policy_token(**overrides):
    data = {
        "token_id": "raw-token-secret-value",
        "scopes": ["file:write", "shell:run", "network:http", "git:push", "secrets:read"],
        "expires_at": "2099-01-01T00:00:00Z",
        "actor_id": "actor-b2",
        "task_id": "task-b2",
        "file_scope": {"write_paths": [TMP_SOLAR_ALLOWED]},
        "shell_scope": {"allowed": True, "mode": "denylist", "denied_commands": ["git push"]},
        "network": {"allowed": True, "allow_domains": ["*.solar.local"]},
        "git": {"commit_allowed": True, "push_allowed": False, "allowed_remotes": ["origin"]},
        "secrets": {"allowed": True, "allowed_secret_refs": ["PROD_*"]},
    }
    data.update(overrides)
    return CapabilityToken(**data)


def _assert_policy_decision(decision):
    assert isinstance(decision, PolicyDecision)
    assert "token_id_short" in decision.audit
    assert decision.audit["token_id_short"] != "raw-token-secret-value"
    assert decision.audit["actor_id"] == "actor-b2"
    assert decision.audit["task_id"] == "task-b2"


# ---------------------------------------------------------------------------
# Backward-compat tests (U1 — v1 token check_path_access still works)
# ---------------------------------------------------------------------------

def test_valid_token():
    """U1a — valid v1 token passes validate_for_lease and has_scope."""
    t = CapabilityToken("t1", ["file:write", "shell:run"], "2099-01-01T00:00:00Z", "a1")
    v = t.validate_for_lease()
    assert v["valid"]
    assert t.has_scope("file:write")
    assert not t.has_scope("network:full")


def test_expired_token():
    """U1b — expired v1 token fails validate_for_lease with token_expired."""
    t = CapabilityToken("t1", ["file:write"], "2020-01-01T00:00:00Z", "a1")
    v = t.validate_for_lease()
    assert not v["valid"]
    assert "token_expired" in v["issues"]


def test_allow_path():
    """U1c — v1 check_path_access allows matching prefix."""
    t = CapabilityToken("t1", ["file:write"], "2099-01-01T00:00:00Z", "a1",
                        allow_paths=["${HARNESS_DIR}"])
    r = t.check_path_access("${HARNESS_DIR}/lib/test.py")
    assert r["allowed"]
    r2 = t.check_path_access("/etc/passwd")
    assert not r2["allowed"]


def test_deny_path():
    """U1d — v1 check_path_access blocks deny_paths prefix."""
    t = CapabilityToken("t1", ["file:write"], "2099-01-01T00:00:00Z", "a1",
                        deny_paths=["/etc", "/var"])
    r = t.check_path_access("/etc/shadow")
    assert not r["allowed"]
    r2 = t.check_path_access("/home/user/file.txt")
    assert r2["allowed"]


# ---------------------------------------------------------------------------
# U1 — v1 token from_dict round-trip
# ---------------------------------------------------------------------------

def test_v1_token_from_dict_round_trip():
    """U1e — v1 token loads via from_dict and still passes check_path_access."""
    raw = {
        "token_id": "tok-v1",
        "scopes": ["file:write"],
        "expires_at": "2099-01-01T00:00:00Z",
        "actor_id": "actor-v1",
        "allow_paths": [TMP_SOLAR_ALLOWED],
        "deny_paths": ["/etc"],
    }
    t = CapabilityToken.from_dict(raw)
    assert t.schema_version == "1"
    assert t.check_path_access(f"{TMP_SOLAR_ALLOWED}/x.py")["allowed"]
    assert not t.check_path_access("/etc/passwd")["allowed"]


# ---------------------------------------------------------------------------
# U2 — check_file write out-of-scope
# ---------------------------------------------------------------------------

def test_check_file_write_out_of_scope():
    """U2 — check_file(write, path outside write_paths) → deny out_of_scope."""
    t = _policy_token()
    d = t.check_file("write", "/tmp/outside/file.txt")
    _assert_policy_decision(d)
    assert not d.allowed
    assert d.reason == "out_of_scope"


def test_check_file_write_allowed():
    """U2b — check_file(write, allowed path) → allow."""
    t = _policy_token()
    d = t.check_file("write", f"{TMP_SOLAR_ALLOWED}/output.json")
    _assert_policy_decision(d)
    assert d.allowed


def test_check_file_read_allowed_via_write_paths():
    """U2c — write_paths also cover reads."""
    t = _policy_token()
    d = t.check_file("read", f"{TMP_SOLAR_ALLOWED}/readme.md")
    _assert_policy_decision(d)
    assert d.allowed


def test_check_file_path_traversal():
    """U2d — paths with .. are denied with reason=path_traversal."""
    t = _policy_token()
    d = t.check_file("read", f"{TMP_SOLAR_ALLOWED}/../etc/passwd")
    assert not d.allowed
    assert d.reason == "path_traversal"


def test_check_file_deny_path_blocks_write():
    """U2e — deny_paths block even allowed write_paths when prefixed."""
    t = _policy_token(
        file_scope={
            "write_paths": [TMP_SOLAR_ALLOWED],
            "deny_paths": [f"{TMP_SOLAR_ALLOWED}/secret"],
        }
    )
    d = t.check_file("write", f"{TMP_SOLAR_ALLOWED}/secret/token.json")
    assert not d.allowed
    assert d.reason == "out_of_scope"
    assert "deny_paths" in d.rule


def test_check_file_destructive_denied():
    """U2f — destructive op without allow_destructive_paths → deny destructive_denied."""
    t = _policy_token(file_scope={"write_paths": [TMP_SOLAR_ALLOWED]})
    d = t.check_file("destructive", f"{TMP_SOLAR_ALLOWED}/file.txt")
    assert not d.allowed
    assert d.reason == "destructive_denied"


def test_check_file_destructive_allowed_via_explicit_path():
    """U2g — destructive op with allow_destructive_paths matching → allow."""
    target = TMP_SOLAR_SAFE_OLD_CONFIG
    t = _policy_token(
        file_scope={
            "write_paths": [target],
            "allow_destructive_paths": [target],
        }
    )
    d = t.check_file("destructive", target + "/sub")
    assert d.allowed


def test_check_file_destructive_allowed_via_v1_compat_flag():
    """U2h — v1 destructive_allowed=true + no allow_destructive_paths → v1 compat allow on write_paths."""
    target = TMP_SOLAR_V1
    t = _policy_token(
        file_scope={
            "write_paths": [target],
            "destructive_allowed": True,
        }
    )
    d = t.check_file("destructive", target + "/file.txt")
    assert d.allowed


# ---------------------------------------------------------------------------
# U3 — check_shell denylist / allowlist modes + reason codes
# ---------------------------------------------------------------------------

def test_check_shell_denied_command():
    """U3a — check_shell('git', ['push']) in denylist mode → deny denied_command."""
    t = _policy_token()
    d = t.check_shell("git", ["push", "origin", "main"])
    _assert_policy_decision(d)
    assert not d.allowed
    assert d.reason == "denied_command"
    assert "denied_commands" in d.rule
    assert d.audit["command"] == "git"
    assert d.audit["argv_head"] == "push"


def test_check_shell_denylist_allows_safe_command():
    """U3b — denylist mode allows commands not in denied_commands."""
    t = _policy_token()
    d = t.check_shell("python3", ["-m", "pytest"])
    _assert_policy_decision(d)
    assert d.allowed


def test_check_shell_disabled_mode():
    """U3c — shell_scope.mode=disabled → deny shell_disabled."""
    t = _policy_token(shell_scope={"allowed": False, "mode": "disabled"})
    d = t.check_shell("ls", ["-la"])
    assert not d.allowed
    assert d.reason == "shell_disabled"


def test_check_shell_allowlist_mode_match():
    """U3d — allowlist mode with matching command → allow."""
    t = _policy_token(
        shell_scope={
            "allowed": True,
            "mode": "allowlist",
            "allowed_commands": ["pytest", "python3 -m"],
        }
    )
    d = t.check_shell("pytest", ["tests/"])
    assert d.allowed


def test_check_shell_allowlist_mode_not_in_list():
    """U3e — allowlist mode with non-listed command → deny not_in_allowlist."""
    t = _policy_token(
        shell_scope={
            "allowed": True,
            "mode": "allowlist",
            "allowed_commands": ["pytest"],
        }
    )
    d = t.check_shell("curl", ["https://example.com"])
    assert not d.allowed
    assert d.reason == "not_in_allowlist"


def test_check_shell_denied_commands_override_allowlist():
    """U3f — denied_commands always win over allowed_commands."""
    t = _policy_token(
        shell_scope={
            "allowed": True,
            "mode": "allowlist",
            "allowed_commands": ["git"],
            "denied_commands": ["git push"],
        }
    )
    d = t.check_shell("git", ["push"])
    assert not d.allowed
    assert d.reason == "denied_command"


def test_check_shell_deny_by_default_no_scope():
    """U3g — empty shell_scope → deny deny_by_default."""
    t = _policy_token(shell_scope={})
    d = t.check_shell("ls", [])
    assert not d.allowed
    assert d.reason == "deny_by_default"


# ---------------------------------------------------------------------------
# U4 — check_network deny_by_default + allow_domains glob
# ---------------------------------------------------------------------------

def test_check_network_allow_domain_wildcard():
    """U4a — host matching allow_domains wildcard → allow."""
    t = _policy_token()
    d = t.check_network("http", "api.solar.local", 443)
    _assert_policy_decision(d)
    assert d.allowed
    assert "allow_domains" in d.rule


def test_check_network_deny_by_default():
    """U4b — host not matching any domain → deny deny_by_default."""
    t = _policy_token()
    d = t.check_network("http", "example.com", 443)
    _assert_policy_decision(d)
    assert not d.allowed
    assert d.reason == "deny_by_default"


def test_check_network_unrestricted():
    """U4c — unrestricted=True → allow any host."""
    t = _policy_token(network={"allowed": True, "unrestricted": True})
    d = t.check_network("http", "example.com", 80)
    assert d.allowed


def test_check_network_allowed_hosts_union():
    """U4d — allowed_hosts and allow_domains combined as union."""
    t = _policy_token(
        network={
            "allowed": True,
            "allow_domains": ["*.solar.local"],
            "allowed_hosts": ["api.github.com"],
        }
    )
    assert t.check_network("http", "api.solar.local").allowed
    assert t.check_network("http", "api.github.com").allowed
    assert not t.check_network("http", "evil.com").allowed


def test_check_network_disabled():
    """U4e — network.allowed=False → deny network_disabled."""
    t = _policy_token(network={"allowed": False})
    d = t.check_network("http", "api.solar.local")
    assert not d.allowed
    assert d.reason == "network_disabled"


def test_check_network_no_scope():
    """U4f — no network scope → deny deny_by_default."""
    t = _policy_token(network={})
    d = t.check_network("http", "api.solar.local")
    assert not d.allowed
    assert d.reason == "deny_by_default"


# ---------------------------------------------------------------------------
# U5 — check_git push_allowed=False → push_not_allowed
# ---------------------------------------------------------------------------

def test_check_git_push_denied():
    """U5a — push_allowed=false → deny push_not_allowed."""
    t = _policy_token()
    d = t.check_git("push", "origin")
    _assert_policy_decision(d)
    assert not d.allowed
    assert d.reason == "push_not_allowed"
    assert "remote" not in d.audit


def test_check_git_commit_allowed():
    """U5b — commit_allowed=True → allow."""
    t = _policy_token()
    d = t.check_git("commit")
    _assert_policy_decision(d)
    assert d.allowed


def test_check_git_commit_not_allowed():
    """U5c — commit_allowed=False → deny commit_not_allowed."""
    t = _policy_token(git={"commit_allowed": False, "push_allowed": False})
    d = t.check_git("commit")
    assert not d.allowed
    assert d.reason == "commit_not_allowed"


def test_check_git_push_allowed_with_remote():
    """U5d — push_allowed=True with matching remote → allow."""
    t = _policy_token(
        git={"commit_allowed": True, "push_allowed": True, "allowed_remotes": ["origin"]}
    )
    d = t.check_git("push", "origin")
    assert d.allowed


def test_check_git_push_allowed_wrong_remote():
    """U5e — push_allowed=True but remote not in allowed_remotes → deny."""
    t = _policy_token(
        git={"commit_allowed": True, "push_allowed": True, "allowed_remotes": ["origin"]}
    )
    d = t.check_git("push", "upstream")
    assert not d.allowed
    assert d.reason == "push_not_allowed"


def test_check_git_force_push_denied():
    """U5f — force_push with push_allowed=True but force_push_allowed=False → deny."""
    t = _policy_token(
        git={"commit_allowed": True, "push_allowed": True, "force_push_allowed": False}
    )
    d = t.check_git("force_push", "origin")
    assert not d.allowed
    assert d.reason == "force_push_not_allowed"


def test_check_git_no_scope():
    """U5g — empty git scope → deny deny_by_default."""
    t = _policy_token(git={})
    d = t.check_git("commit")
    assert not d.allowed
    assert d.reason == "deny_by_default"


# ---------------------------------------------------------------------------
# deny_by_default for all scopes when empty
# ---------------------------------------------------------------------------

def test_missing_runtime_scopes_deny_by_default():
    """All check_* return deny_by_default when scopes are empty."""
    t = _policy_token(
        file_scope={},
        shell_scope={},
        network={},
        git={},
        secrets={},
    )
    assert t.check_file("write", f"{TMP_SOLAR_ALLOWED}/file.txt").reason == "deny_by_default"
    assert t.check_shell("python3", ["-m", "pytest"]).reason == "deny_by_default"
    assert t.check_network("http", "api.solar.local", 443).reason == "deny_by_default"
    assert t.check_git("push", "origin").reason == "deny_by_default"
    assert t.check_secrets("PROD_SECRET_BODY").reason == "deny_by_default"


# ---------------------------------------------------------------------------
# check_secrets + audit redaction
# ---------------------------------------------------------------------------

def test_policy_secret_allowed_ref():
    """Allowed secret ref → allowed, ref never in audit."""
    t = _policy_token()
    d = t.check_secrets("PROD_SECRET_BODY")
    _assert_policy_decision(d)
    assert d.allowed
    assert "ref" not in d.audit
    assert "PROD_SECRET_BODY" not in str(d.audit)


def test_policy_secret_denied_ref():
    """Denied secret ref → deny secret_not_listed, ref never in audit."""
    t = _policy_token()
    d = t.check_secrets("DEV_SECRET_BODY")
    _assert_policy_decision(d)
    assert not d.allowed
    assert d.reason == "secret_not_listed"
    assert "ref" not in d.audit
    assert "DEV_SECRET_BODY" not in str(d.audit)


def test_policy_secrets_disabled():
    """secrets.allowed=False → deny secrets_disabled."""
    t = _policy_token(secrets={"allowed": False})
    d = t.check_secrets("PROD_KEY")
    assert not d.allowed
    assert d.reason == "secrets_disabled"


def test_secrets_glob_pattern():
    """allowed_secret_refs supports glob patterns."""
    t = _policy_token(
        secrets={"allowed": True, "allowed_secret_refs": ["dev/*"]}
    )
    assert t.check_secrets("dev/api-key").allowed
    assert not t.check_secrets("prod/api-key").allowed


# ---------------------------------------------------------------------------
# audit_view token redaction
# ---------------------------------------------------------------------------

def test_audit_view_redaction():
    """audit_view must not expose token_id, expires_at, or secret refs."""
    t = _policy_token()
    av = t.audit_view()
    assert av["token_id_short"] != "raw-token-secret-value"
    assert "token_id" not in av
    assert "expires_at" not in av
    assert "secrets" not in av
    assert av["scope_summary"]["secrets"] is True


# ---------------------------------------------------------------------------
# validate_for_lease — revoked + token_revoked reason
# ---------------------------------------------------------------------------

def test_validate_revoked_token():
    """Revoked token must include token_revoked in issues."""
    t = _policy_token(revoked=True)
    v = t.validate_for_lease()
    assert not v["valid"]
    assert "token_revoked" in v["issues"]


def test_validate_expired_and_revoked():
    """Both expired and revoked issues must appear together."""
    t = _policy_token(expires_at="2020-01-01T00:00:00Z", revoked=True)
    v = t.validate_for_lease()
    assert not v["valid"]
    issues = v["issues"]
    assert "token_expired" in issues
    assert "token_revoked" in issues


# ---------------------------------------------------------------------------
# Existing combined reason-code test (backward compat)
# ---------------------------------------------------------------------------

def test_policy_file_shell_network_git_reason_codes():
    """Combined reason-code check — backward compat."""
    t = _policy_token()

    out_of_scope = t.check_file("write", "/tmp/outside/file.txt")
    _assert_policy_decision(out_of_scope)
    assert not out_of_scope.allowed
    assert out_of_scope.reason == "out_of_scope"

    denied_shell = t.check_shell("git", ["push", "origin", "main"])
    _assert_policy_decision(denied_shell)
    assert not denied_shell.allowed
    assert denied_shell.reason == "denied_command"

    allowed_network = t.check_network("http", "api.solar.local", 443)
    _assert_policy_decision(allowed_network)
    assert allowed_network.allowed

    denied_network = t.check_network("http", "example.com", 443)
    _assert_policy_decision(denied_network)
    assert not denied_network.allowed
    assert denied_network.reason == "deny_by_default"

    denied_push = t.check_git("push", "origin")
    _assert_policy_decision(denied_push)
    assert not denied_push.allowed
    assert denied_push.reason == "push_not_allowed"
    assert "remote" not in denied_push.audit


if __name__ == "__main__":
    import sys

    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = failed = 0
    for fn in fns:
        try:
            fn()
            print(f"  PASS  {fn.__name__}")
            passed += 1
        except Exception as exc:
            print(f"  FAIL  {fn.__name__}: {exc}")
            failed += 1
    print(f"\n{passed} passed, {failed} failed")
    if failed:
        sys.exit(1)
