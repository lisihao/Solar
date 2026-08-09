import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts" / "cmux"
SAMPLE = ROOT / "config" / "cmux-workspace-sample.yaml"


def run_script(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python3", str(SCRIPTS / args[0]), *args[1:]],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )


def test_sample_defaults_to_status_cards_and_keeps_capture_fallback():
    result = run_script("render-cmux-workspace", str(SAMPLE), "--json")
    assert result.returncode == 0, result.stderr
    plan = json.loads(result.stdout)

    modes = [pane["mode"] for tab in plan["tabs"] for pane in tab["panes"]]
    commands = [pane["command"] for tab in plan["tabs"] for pane in tab["panes"]]

    assert plan["tabs"][0]["title"] == "Solar Status Cards"
    assert plan["tabs"][0]["layout"] == "single"
    assert modes[0] == "status-card"
    assert "tmux-status-card-view" in commands[0]
    assert "--targets solar-harness:0.0,solar-harness:0.1,solar-harness:0.2,solar-harness:0.3" in commands[0]
    assert any("tmux-pane-view" in command for command in commands[1:])
    assert any("tmux-pane-view solar-harness:0.2 160 3" in command for command in commands)
    assert any("tmux-pane-view solar-harness:0.3 160 3" in command for command in commands)
    assert any("tmux-pane-view solar-harness-lab:0.3 160 3" in command for command in commands)


def test_monitor_up_dry_run_lists_every_tab_as_workspace():
    result = run_script("cmux-monitor-up", str(SAMPLE), "--dry-run")
    assert result.returncode == 0, result.stderr
    output = result.stdout

    assert "Workspace: solar-runtime: Solar Status Cards" in output
    assert "Workspace: solar-runtime: Solar Builder Focus" in output
    assert "Workspace: solar-runtime: Solar Evaluator Focus" in output
    assert "Workspace: solar-runtime: Solar Lab Focus" in output
    assert "Workspace: solar-runtime: Solar Capture Fallback" in output
    assert "tmux-status-card-view" in output
    assert "tmux-pane-view solar-harness:0.2 160 3" in output


def test_monitor_up_without_config_uses_default_workspace():
    result = run_script("cmux-monitor-up", "--dry-run")
    assert result.returncode == 0, result.stderr
    output = result.stdout

    assert "Workspace: solar-runtime: Solar Status Cards" in output
    assert "Workspace: solar-runtime: Solar Capture Fallback" in output
    assert "tmux-status-card-view" in output
    assert "tmux-pane-view solar-harness:0.0 80 3" in output


def test_monitor_down_dry_run_lists_every_tab_workspace():
    result = run_script("cmux-monitor-down", str(SAMPLE), "--dry-run")
    assert result.returncode == 0, result.stderr
    output = result.stdout

    assert "would close workspace 'solar-runtime: Solar Status Cards'" in output
    assert "would close workspace 'solar-runtime: Solar Builder Focus'" in output
    assert "would close workspace 'solar-runtime: Solar Evaluator Focus'" in output
    assert "would close workspace 'solar-runtime: Solar Lab Focus'" in output
    assert "would close workspace 'solar-runtime: Solar Capture Fallback'" in output


def test_monitor_down_without_config_uses_default_workspace():
    result = run_script("cmux-monitor-down", "--dry-run")
    assert result.returncode == 0, result.stderr
    output = result.stdout

    assert "would close workspace 'solar-runtime: Solar Status Cards'" in output
    assert "would close workspace 'solar-runtime: Solar Capture Fallback'" in output


def test_doctor_checks_focus_tmux_targets():
    result = run_script("cmux-monitor-doctor", str(SAMPLE), "--compact")
    assert result.returncode in {0, 1}
    report = json.loads(result.stdout)
    check_names = {check["name"] for check in report["checks"]}

    assert "tmux_target_solar-harness_0_2" in check_names
    assert "tmux_target_solar-harness_0_3" in check_names
    assert "tmux_target_solar-harness-lab_0_3" in check_names


def test_render_and_doctor_without_config_use_default_workspace():
    render = run_script("render-cmux-workspace", "--json")
    assert render.returncode == 0, render.stderr
    plan = json.loads(render.stdout)
    assert plan["workspace_name"] == "solar-runtime"
    assert plan["tabs"][0]["title"] == "Solar Status Cards"

    doctor = run_script("cmux-monitor-doctor", "--compact")
    assert doctor.returncode in {0, 1}
    report = json.loads(doctor.stdout)
    assert report["workspace"] == "solar-runtime"


def test_status_card_once_renders_target():
    result = run_script(
        "tmux-status-card-view",
        "--targets",
        "solar-harness:0.0",
        "--once",
        "--no-color",
    )
    assert result.returncode in {0, 1}
    assert "Solar CMUX Status Cards" in result.stdout
    assert "solar-harness:0.0" in result.stdout
