import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
TOOL = REPO_ROOT / "harness" / "tools" / "genesis_verifier.py"


def load_module():
    spec = importlib.util.spec_from_file_location("genesis_verifier", TOOL)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_adapt_jest_json_maps_failures_to_rule_ids():
    module = load_module()
    raw = {
        "numFailedTests": 1,
        "testResults": [
            {
                "name": "src/__tests__/architecture/layer-4-vocabulary/vocab-purity.spec.ts",
                "assertionResults": [
                    {
                        "status": "failed",
                        "fullName": "vocab purity rejects impure terms",
                        "ancestorTitles": ["vocab purity"],
                        "failureMessages": ["bad vocab"],
                    }
                ],
            }
        ],
    }

    results = module.adapt_jest_json(raw)

    assert results[0]["rule_id"] == "genesis.vocab.purity"
    assert results[0]["status"] == "failed"
    assert results[0]["waiver_status"] == "unregistered"


def test_missing_vendor_generates_warn_report(tmp_path):
    env = os.environ.copy()
    env["GENESIS_VERIFIER_VENDOR_DIR"] = str(tmp_path / "missing-GenesisPod")
    out = tmp_path / "seed.json"

    proc = subprocess.run(
        [sys.executable, str(TOOL), "genesis-seed", "--json", "--out", str(out)],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )

    assert proc.returncode == 0
    data = json.loads(proc.stdout)
    assert data["schema_version"] == "solar.verifier.result.v1"
    assert data["status"] == "warn"
    assert data["rule_results"][0]["rule_id"] == "genesis.runtime.vendor_missing"
    assert out.exists()


def test_explain_known_rule_json():
    proc = subprocess.run(
        [sys.executable, str(TOOL), "explain", "genesis.arch.layer_boundaries", "--json"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert proc.returncode == 0
    data = json.loads(proc.stdout)
    assert data["status"] == "ok"
    assert data["gate_mode"] == "warn"


def test_exception_registry_detects_expired_waiver(tmp_path):
    module = load_module()
    waivers = tmp_path / "waivers.yaml"
    exceptions = tmp_path / "EXCEPTIONS.md"
    waivers.write_text(
        "\n".join(
            [
                "schema_version: solar.verifier.waivers.v1",
                "waivers:",
                "  - id: E999",
                "    rule_id: genesis.arch.layer_boundaries",
                "    path: '*'",
                "    expires: 2000-01-01",
            ]
        ),
        encoding="utf-8",
    )
    exceptions.write_text("### E999 Test Exception\n", encoding="utf-8")

    results = module.check_exception_registry(waivers, exceptions)

    assert any("expired" in result["message"] for result in results)
    assert any(result["rule_id"] == "genesis.waiver.exception_registry" for result in results)


def test_baseline_contract_detects_missing_baseline(tmp_path):
    module = load_module()

    results = module.check_baseline_contract(tmp_path / "missing-baseline")

    assert results[0]["rule_id"] == "genesis.contract.baseline_ratchet"
    assert results[0]["status"] == "failed"


def test_policy_blocker_can_block_unwaived_failure():
    module = load_module()
    policy = {
        "gate_mode": "policy",
        "blocker_rules": {
            "genesis.arch.layer_boundaries": {"rule_id": "genesis.arch.layer_boundaries", "mode": "blocker"}
        },
    }
    results = [
        {
            "rule_id": "genesis.arch.layer_boundaries",
            "status": "failed",
            "waiver_status": "unregistered",
        }
    ]

    gate = module.evaluate_gate(results, policy, "policy")

    assert gate["effective_status"] == "blocked"
    assert gate["blocked_rule_ids"] == ["genesis.arch.layer_boundaries"]


def test_baseline_contract_detects_fingerprint_drift(tmp_path):
    module = load_module()
    baseline_dir = tmp_path / "baselines"
    baseline_dir.mkdir()
    (baseline_dir / "README.md").write_text("baseline\n", encoding="utf-8")
    (baseline_dir / "genesis-ci-baseline.json").write_text(
        json.dumps({"schema_version": "solar.verifier.baseline.v1", "fingerprint": "old"}),
        encoding="utf-8",
    )
    current_results = [
        {
            "rule_id": "genesis.arch.layer_boundaries",
            "status": "passed",
            "severity": "warn",
            "waiver_status": "not_applicable",
        }
    ]

    results = module.check_baseline_contract(baseline_dir, current_results)

    assert results[0]["status"] == "failed"
    assert "drifted" in results[0]["message"]
