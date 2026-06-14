#!/usr/bin/env python3
"""Tests for shared browser-agent profile policy enforcement."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from browser_agent_profile_policy import apply_profile_policy_to_env, select_profile_policy


def _policy_file(tmp_path: Path) -> Path:
    path = tmp_path / "browser-agent-policy.json"
    path.write_text(
        json.dumps(
            {
                "policies": {
                    "default": {
                        "expected_account_email": "haogege1977@gmail.com",
                        "allowed_profiles": ["Default"],
                        "force_headed": True,
                        "allow_headless": False,
                        "profile_strategy": "persistent",
                        "user_data_dir": "/tmp/chrome-user-data",
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    return path


def test_policy_selects_profile_account_and_user_data_dir(tmp_path: Path):
    policy = _policy_file(tmp_path)
    selected = select_profile_policy(
        service="youtube",
        purpose="youtube-transcript",
        env={"BROWSER_AGENT_YOUTUBE_PROFILE_POLICY_FILE": str(policy)},
    )

    assert selected["enabled"] is True
    assert selected["selected_profile_directory"] == "Default"
    assert selected["selected_account_email"] == "haogege1977@gmail.com"
    assert selected["user_data_dir"] == "/tmp/chrome-user-data"
    assert selected["force_headed"] is True


def test_policy_rejects_profile_mismatch(tmp_path: Path):
    policy = _policy_file(tmp_path)
    with pytest.raises(RuntimeError, match="browser_agent_profile_policy_profile_mismatch"):
        select_profile_policy(
            service="notebooklm",
            env={
                "BROWSER_AGENT_NOTEBOOKLM_PROFILE_POLICY_FILE": str(policy),
                "BROWSER_AGENT_PROFILE_DIRECTORY": "Profile 7",
            },
        )


def test_policy_rejects_account_mismatch(tmp_path: Path):
    policy = _policy_file(tmp_path)
    with pytest.raises(RuntimeError, match="browser_agent_profile_policy_account_mismatch"):
        select_profile_policy(
            service="gemini",
            env={
                "BROWSER_AGENT_GEMINI_PROFILE_POLICY_FILE": str(policy),
                "BROWSER_AGENT_GEMINI_ACCOUNT_EMAIL": "wrong@example.com",
            },
        )


def test_apply_policy_sets_common_browser_env(tmp_path: Path):
    policy = _policy_file(tmp_path)
    env = {"BROWSER_AGENT_CHATGPT_PROFILE_POLICY_FILE": str(policy)}
    meta = apply_profile_policy_to_env(env, service="gemini", purpose="gpt-gemini-cleaner-gemini")

    assert meta["enabled"] is True
    assert env["BROWSER_AGENT_PROFILE_DIRECTORY"] == "Default"
    assert env["BROWSER_AGENT_USER_DATA_DIR"] == "/tmp/chrome-user-data"
    assert env["BROWSER_AGENT_GEMINI_ACCOUNT_EMAIL"] == "haogege1977@gmail.com"
    assert env["BROWSER_AGENT_TARGET_ACCOUNT_EMAIL"] == "haogege1977@gmail.com"
    assert env["BROWSER_AGENT_HEADLESS"] == "false"
