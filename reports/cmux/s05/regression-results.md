# cmux S05 Regression Matrix

status: blocked
node: V2_regression_matrix
sprint: sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s05-verification-release
updated_at: 2026-06-02T16:00:00Z

## Scope

This regression node validates the repo-mirrored cmux release surface without touching live user tmux sessions.

## Path Resolution

- Graph command path: `scripts/cmux/render-cmux-workspace config/cmux-workspace-sample.yaml --validate-only`
- Repo mirror path used for tests: `harness/scripts/cmux/render-cmux-workspace harness/config/cmux-workspace-sample.yaml --validate-only`
- Graph command path: `tools/cmux_orch.py ...`
- Repo mirror path used for tests: `harness/tools/cmux_orch.py ...`

The repo layout keeps cmux implementation under `harness/`; tests execute from `harness/` as the effective harness root.

## Commands

- `python3 -m pytest harness/tests/cmux/ -q`
- `python3 harness/scripts/cmux/render-cmux-workspace harness/config/cmux-workspace-sample.yaml --validate-only`
- `HARNESS_DIR=/Users/lisihao/Solar/harness CMUX_WORKSPACES_STATE=/tmp/cmux-s05-workspaces.json CMUX_EVIDENCE_DIR=/tmp/cmux-s05-evidence CMUX_TELEMETRY_DIR=/tmp/cmux-s05-telemetry python3 harness/tools/cmux_orch.py --sprint-id sprint-20260531-cmux-多标签四分屏-tmux-状态监控工作台-s05-verification-release --node-id V2_regression_matrix start --config harness/config/cmux-workspace-sample.yaml --dry-run`

## Evidence Expectations

- Render validation exits `0` and reports `OK`.
- JSON render contains at least two tabs, each with one to four panes.
- Dry-run orchestration writes only temp state/evidence paths and records `stdout=dry-run`.
- No production tmux session is created, stopped, or mutated by this regression node.

## Result

blocked: V2 regression test and report were added, but pytest, render validate, and cmux_orch dry-run were each interrupted by hard SSH-side timeouts while the Mac mini load was high. No passed claim is made. Next action is to rerun the same commands after reducing load or to isolate why render-cmux-workspace/cmux_orch do not return under a 30-80s cap.

## Attempted Evidence - 2026-06-02T16:00Z

- `python3 -m pytest harness/tests/cmux/ -q`: interrupted by hard timeout, no stdout/stderr returned.
- `python3 harness/scripts/cmux/render-cmux-workspace harness/config/cmux-workspace-sample.yaml --validate-only`: interrupted by hard timeout, no stdout/stderr returned.
- `HARNESS_DIR=/Users/lisihao/Solar/harness ... python3 harness/tools/cmux_orch.py ... start --dry-run`: interrupted by hard timeout, no stdout/stderr returned.
- Remote load observed before work: load average around 9-12 with 101 tracked dirty files.

## Blocker Detail - uninterruptible I/O

After `kill` and `kill -9`, the following validation/probe processes stayed in macOS `U` state, so V2 cannot be honestly marked passed in this run:

```text
54929 U find /Users/lisihao/.solar/harness ... cmux ...
63893 U rg render-cmux-workspace ... harness -g *
63922 U python3 harness/scripts/cmux/render-cmux-workspace ... --json
63953 U ls -la /Users/lisihao/.solar/harness/scripts/cmux ...
64076 Us python3 -m pytest harness/tests/cmux/ -q
64079 U python3 harness/scripts/cmux/render-cmux-workspace ... --validate-only
64081 U python3 harness/tools/cmux_orch.py ... start --dry-run
```

Interpretation: this is a remote runtime/filesystem I/O blocker. The test file and report exist, but release evidence is blocked until these processes clear or the Mac mini is restarted / affected mount is repaired.
