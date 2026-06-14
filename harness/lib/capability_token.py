"""capability_token.py — Capability token validation for lease acquisition.

Validates token expiry and scopes before lease acquisition or task execution.
Enforces file, shell, network, and git allow-path/deny-path rules.
"""
from __future__ import annotations

import datetime
import fnmatch
import hashlib
import json
import os
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class PolicyDecision:
    """Structured result for a runtime policy check."""

    allowed: bool
    reason: str
    detail: str = ""
    rule: str = ""
    audit: Dict[str, Any] = field(default_factory=dict)


class CapabilityToken:
    """Token with expiry and scope validation."""

    _AUDIT_ALLOWLIST = {
        "path",
        "host",
        "port",
        "command",
        "argv_head",
        "op",
        "rule_id",
        "token_id_short",
        "actor_id",
        "task_id",
    }

    def __init__(
        self,
        token_id: str,
        scopes: List[str],
        expires_at: str,
        actor_id: str,
        allow_paths: Optional[List[str]] = None,
        deny_paths: Optional[List[str]] = None,
        file_scope: Optional[Dict[str, Any]] = None,
        shell_scope: Optional[Dict[str, Any]] = None,
        network: Optional[Dict[str, Any]] = None,
        git: Optional[Dict[str, Any]] = None,
        secrets: Optional[Dict[str, Any]] = None,
        task_id: str = "",
        schema_version: str = "1",
        revoked: bool = False,
    ):
        self.token_id = token_id
        self.scopes = set(scopes)
        self.expires_at = expires_at
        self.actor_id = actor_id
        self.task_id = task_id
        self.schema_version = str(schema_version or "1")
        self.revoked = bool(revoked)
        self.allow_paths = allow_paths or []
        self.deny_paths = deny_paths or []
        self.file_scope = dict(file_scope or {})
        self.shell_scope = dict(shell_scope or {})
        self.network = dict(network or {})
        self.git = dict(git or {})
        self.secrets = dict(secrets or {})

    def _hash_token_id(self) -> str:
        return hashlib.sha256(self.token_id.encode("utf-8")).hexdigest()[:12]

    def _policy_audit(self, **values: Any) -> Dict[str, Any]:
        audit = {
            "token_id_short": self._hash_token_id(),
            "actor_id": self.actor_id,
        }
        if self.task_id:
            audit["task_id"] = self.task_id
        for key, value in values.items():
            if key not in self._AUDIT_ALLOWLIST:
                continue
            if value in (None, ""):
                continue
            audit[key] = value
        return audit

    def _decision(
        self,
        allowed: bool,
        reason: str,
        *,
        detail: str = "",
        rule: str = "",
        **audit: Any,
    ) -> PolicyDecision:
        if rule and "rule_id" not in audit:
            audit["rule_id"] = rule
        return PolicyDecision(
            allowed=allowed,
            reason=reason,
            detail=detail,
            rule=rule,
            audit=self._policy_audit(**audit),
        )

    def _normalize_path(self, path: str) -> tuple[str, Optional[str]]:
        if ".." in str(path).split("/"):
            return "", "path_traversal"
        expanded = os.path.expanduser(str(path))
        return os.path.realpath(expanded).rstrip("/") or "/", None

    @staticmethod
    def _prefix_match(value: str, prefixes: List[str]) -> tuple[bool, int]:
        for idx, prefix in enumerate(prefixes):
            if value.startswith(str(prefix).rstrip("/") or "/"):
                return True, idx
        return False, -1

    @staticmethod
    def _command_matches(effective: str, patterns: List[str]) -> tuple[bool, int]:
        for idx, pattern in enumerate(patterns):
            text = str(pattern).strip()
            if text and effective.startswith(text):
                return True, idx
        return False, -1

    def is_expired(self) -> bool:
        now = datetime.datetime.now(datetime.timezone.utc)
        exp = datetime.datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
        return now > exp

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes

    def check_file(self, op: str, path: str) -> PolicyDecision:
        """Check file read/write/destructive access."""
        normalized, error = self._normalize_path(path)
        if error:
            return self._decision(False, error, op=op)

        deny_paths = [str(p) for p in self.file_scope.get("deny_paths", []) or []] + self.deny_paths
        matched, idx = self._prefix_match(normalized, deny_paths)
        if matched:
            return self._decision(
                False,
                "out_of_scope",
                rule=f"file_scope.deny_paths[{idx}]",
                op=op,
                path=normalized,
            )

        write_paths = [str(p) for p in self.file_scope.get("write_paths", []) or []] + self.allow_paths
        read_paths = (
            [str(p) for p in self.file_scope.get("read_paths", []) or []]
            + [str(p) for p in self.file_scope.get("read_only_paths", []) or []]
            + write_paths
        )
        destructive_paths = [str(p) for p in self.file_scope.get("allow_destructive_paths", []) or []]
        if not destructive_paths and self.file_scope.get("destructive_allowed"):
            destructive_paths = write_paths

        if op == "destructive":
            matched, idx = self._prefix_match(normalized, destructive_paths)
            if matched:
                return self._decision(True, "", rule=f"file_scope.allow_destructive_paths[{idx}]", op=op, path=normalized)
            return self._decision(False, "destructive_denied", op=op, path=normalized)

        allowed_paths = read_paths if op == "read" else write_paths
        if not allowed_paths:
            return self._decision(False, "deny_by_default", op=op, path=normalized)
        matched, idx = self._prefix_match(normalized, allowed_paths)
        if matched:
            return self._decision(True, "", rule=f"file_scope.{op}_paths[{idx}]", op=op, path=normalized)
        return self._decision(False, "out_of_scope", op=op, path=normalized)

    def check_shell(self, command: str, argv: List[str]) -> PolicyDecision:
        """Check shell command execution."""
        argv = list(argv or [])
        argv_head = argv[0] if argv else ""
        effective = " ".join([str(command), *[str(item) for item in argv[:1] if str(item)]]).strip()
        mode = str(self.shell_scope.get("mode") or "").strip()
        if not mode:
            if not self.shell_scope:
                return self._decision(False, "deny_by_default", command=str(command), argv_head=argv_head)
            elif not self.shell_scope.get("allowed", False):
                mode = "disabled"
            elif self.shell_scope.get("allowed_commands"):
                mode = "allowlist"
            else:
                mode = "denylist"

        denied = [str(item) for item in self.shell_scope.get("denied_commands", []) or []]
        matched, idx = self._command_matches(effective, denied)
        if matched:
            return self._decision(False, "denied_command", rule=f"shell_scope.denied_commands[{idx}]", command=str(command), argv_head=argv_head)
        if mode == "disabled":
            return self._decision(False, "shell_disabled", command=str(command), argv_head=argv_head)
        if mode == "denylist":
            return self._decision(True, "", command=str(command), argv_head=argv_head)
        allowed = [str(item) for item in self.shell_scope.get("allowed_commands", []) or []]
        matched, idx = self._command_matches(effective, allowed)
        if matched:
            return self._decision(True, "", rule=f"shell_scope.allowed_commands[{idx}]", command=str(command), argv_head=argv_head)
        return self._decision(False, "not_in_allowlist", command=str(command), argv_head=argv_head)

    def check_network(self, mode: str, host: str, port: Optional[int] = None) -> PolicyDecision:
        """Check network access."""
        if not self.network:
            return self._decision(False, "deny_by_default", host=host, port=port)
        if not self.network.get("allowed", False):
            return self._decision(False, "network_disabled", host=host, port=port)
        if self.network.get("unrestricted", False):
            return self._decision(True, "", host=host, port=port)

        allow_domains = [str(item) for item in self.network.get("allow_domains", []) or []]
        allow_domains.extend(str(item) for item in self.network.get("allowed_hosts", []) or [])
        for idx, pattern in enumerate(allow_domains):
            if fnmatch.fnmatchcase(str(host), pattern):
                return self._decision(True, "", rule=f"network.allow_domains[{idx}]", host=host, port=port)
        return self._decision(False, "deny_by_default", host=host, port=port)

    def check_git(self, op: str, remote: Optional[str] = None) -> PolicyDecision:
        """Check git operations."""
        if not self.git:
            return self._decision(False, "deny_by_default", op=op)
        if op == "commit":
            if self.git.get("commit_allowed", False):
                return self._decision(True, "", op=op)
            return self._decision(False, "commit_not_allowed", op=op)
        if op in {"push", "force_push"}:
            if op == "force_push" and not self.git.get("force_push_allowed", False):
                return self._decision(False, "force_push_not_allowed", op=op)
            allowed_remotes = [str(item) for item in self.git.get("allowed_remotes", []) or []]
            if not self.git.get("push_allowed", False):
                return self._decision(False, "push_not_allowed", op=op)
            if allowed_remotes and str(remote or "") not in allowed_remotes:
                return self._decision(False, "push_not_allowed", op=op)
            return self._decision(True, "", op=op)
        return self._decision(False, "deny_by_default", op=op)

    def check_secrets(self, ref: str) -> PolicyDecision:
        """Check secret reference access without echoing the secret ref into audit."""
        if not self.secrets:
            return self._decision(False, "deny_by_default")
        if not self.secrets.get("allowed", False):
            return self._decision(False, "secrets_disabled")
        for idx, pattern in enumerate(self.secrets.get("allowed_secret_refs", []) or []):
            if fnmatch.fnmatchcase(str(ref), str(pattern)):
                return self._decision(True, "", rule=f"secrets.allowed_secret_refs[{idx}]")
        return self._decision(False, "secret_not_listed")

    def audit_view(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "token_id_short": self._hash_token_id(),
            "actor_id": self.actor_id,
            "scopes": sorted(self.scopes),
            "scope_summary": {
                "file": bool(self.file_scope),
                "shell": bool(self.shell_scope),
                "network": bool(self.network),
                "git": bool(self.git),
                "secrets": bool(self.secrets),
            },
        }

    def check_path_access(self, path: str) -> Dict[str, Any]:
        """Check if path is allowed and not denied."""
        for deny in self.file_scope.get("deny_paths", []) or []:
            if path.startswith(str(deny)):
                return {"allowed": False, "reason": f"deny_path: {deny}"}
        for deny in self.deny_paths:
            if path.startswith(deny):
                return {"allowed": False, "reason": f"deny_path: {deny}"}
        file_allow_paths = self.file_scope.get("write_paths") or self.file_scope.get("read_paths") or []
        if file_allow_paths:
            allowed = any(path.startswith(str(a)) for a in file_allow_paths)
            if not allowed:
                return {"allowed": False, "reason": "not_in_file_scope_paths"}
        if self.allow_paths:
            allowed = any(path.startswith(a) for a in self.allow_paths)
            if not allowed:
                return {"allowed": False, "reason": "not_in_allow_paths"}
        return {"allowed": True, "reason": ""}

    def validate_for_lease(self) -> Dict[str, Any]:
        """Full validation before lease acquisition."""
        issues = []
        if self.is_expired():
            issues.append("token_expired")
        if self.revoked:
            issues.append("token_revoked")
        return {"valid": len(issues) == 0, "issues": issues}

    def to_dict(self) -> Dict[str, Any]:
        return {
            "token_id": self.token_id,
            "schema_version": self.schema_version,
            "scopes": sorted(self.scopes),
            "expires_at": self.expires_at,
            "actor_id": self.actor_id,
            "task_id": self.task_id,
            "allow_paths": self.allow_paths,
            "deny_paths": self.deny_paths,
            "file_scope": self.file_scope,
            "shell_scope": self.shell_scope,
            "network": self.network,
            "git": self.git,
            "secrets": self.secrets,
            "revoked": self.revoked,
        }

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CapabilityToken":
        return cls(
            token_id=d["token_id"],
            scopes=d.get("scopes", []),
            expires_at=d["expires_at"],
            actor_id=d.get("actor_id", ""),
            task_id=d.get("task_id", ""),
            schema_version=d.get("schema_version", "1"),
            allow_paths=d.get("allow_paths"),
            deny_paths=d.get("deny_paths"),
            file_scope=d.get("file_scope"),
            shell_scope=d.get("shell_scope"),
            network=d.get("network"),
            git=d.get("git"),
            secrets=d.get("secrets"),
            revoked=d.get("revoked", False),
        )
