# operatord Runtime Specification

Sprint: `sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s02-architecture`

Source of truth: `sprints/sprint-20260530-p0-修复单-去除-tmux-send-keys-作为主任务协议-收口到-operatord-mailbox-runti-s02-architecture.design.md` §6.

This document defines the runtime-plane contract for `operatord`: process isolation, state machine, event loop, pane invocation mode, heartbeat writes, and state writes. It is a design artifact only; it does not add runtime code.

## 1. Process Model

`operatord` uses strict actor-level process isolation:

- One actor maps to one and only one `operatord` process.
- One `operatord` process owns exactly one actor mailbox.
- A multi-actor daemon is out of scope for this architecture.
- The process is started as `operatord run --actor <actor_id>` and is supervised by the host bootstrap layer, such as launchd, systemd, or a tmux pane wrapper.
- The process consumes only its actor directory under the configured Solar actor mailbox root, for example `actors/<actor_id>/`.
- The process does not read DAG semantics and does not write `task_graph.json`; graph ownership stays in the scheduler/control plane.

This isolation keeps crash recovery local. Restarting the `operatord` process for actor A must not interrupt actor B, and actor A's `state.json`, `heartbeat.json`, `processing/`, `outbox/`, and logs remain scoped to actor A.

## 2. State Machine

The runtime state machine has exactly six primary states:

```text
STARTING -> IDLE -> DISPATCHING -> EXECUTING -> REPORTING -> IDLE
                              \-> ABORTING ----^
```

| State | Owner Action | Exit Condition | Persistent Evidence |
|---|---|---|---|
| `STARTING` | Load actor config, acquire actor process lock, ensure mailbox directories, recover stale `processing/` entries, open log/event sinks. | Startup checks succeed. | `state.json` records `STARTING` with `pid` and `actor_id`. |
| `IDLE` | Keep heartbeat fresh, poll the actor `inbox/`, and wait without consuming CPU aggressively. | A valid task envelope is available or shutdown is requested. | `heartbeat.json` updates every heartbeat interval; `state.json` records no current task. |
| `DISPATCHING` | Atomically claim one task by renaming from `inbox/` into `processing/`; validate envelope fields needed for execution. | Claim and validation succeed, or claim/validation fails. | `state.json` records `current_task_id` and `DISPATCHING`; logs include claim result. |
| `EXECUTING` | Invoke the pane through the approved bootstrap path and monitor child/pane completion, timeout, and abort signals. | Pane exits, timeout fires, or abort signal arrives. | `state.json` records `EXECUTING`; task log captures stdout/stderr or equivalent pane transcript reference. |
| `REPORTING` | Write result envelope to `outbox/`, flush task logs, clear finished `processing/` entry, and emit state transition event. | Result write and cleanup finish, or retry policy is exhausted. | `outbox/<task_id>.result.json`, task log, and `state.json` transition back to `IDLE` or degraded state. |
| `ABORTING` | Terminate or cancel the running pane task, classify abort reason, and prepare a failure/timeout result. | Cancellation is confirmed or kill escalation is exhausted. | `state.json` records `ABORTING`; `REPORTING` writes the final failure result. |

Transition rules:

1. `STARTING -> IDLE`: actor config, mailbox directories, process lock, state sink, and heartbeat sink are ready.
2. `IDLE -> DISPATCHING`: `inbox/` contains a claimable task envelope.
3. `DISPATCHING -> EXECUTING`: the envelope is moved to `processing/` and the pane bootstrap request is accepted.
4. `DISPATCHING -> REPORTING`: validation fails after claim; write a failed result instead of executing.
5. `EXECUTING -> REPORTING`: pane execution exits normally or with a non-zero exit code.
6. `EXECUTING -> ABORTING`: an abort file/signal, TTL expiry, or watchdog timeout is observed.
7. `ABORTING -> REPORTING`: abort handling has produced a deterministic final result.
8. `REPORTING -> IDLE`: result and cleanup are durable.

## 3. Event Loop

Each `operatord` process runs a single actor event loop. The loop is intentionally simple so the scheduler can reason about runtime liveness from mailbox files alone.

```text
load config
  -> write STARTING state
  -> recover processing/
  -> write IDLE state
  -> repeat:
       write heartbeat if due
       poll inbox/
       claim one envelope
       dispatch via file-path bootstrap
       monitor execution or abort
       report result
       write state transition events
```

Loop requirements:

- Heartbeat is independent of task availability; an empty `inbox/` must still produce fresh `heartbeat.json`.
- Poll interval defaults to the mailbox protocol value, currently 1 second unless configured elsewhere.
- Claiming is single-task at a time per actor process; concurrency comes from multiple actors, not multiple workers inside one actor.
- All state transitions call the mailbox state writer before entering long-running work.
- On startup, `processing/` is scanned before new `inbox/` work. Existing `outbox/` results are treated as completed evidence and can be cleaned; unfinished `processing/` tasks are retried or reported according to TTL/abort policy.
- IO failures use bounded retry with backoff. Retry exhaustion moves the actor into a degraded reporting path rather than silently dropping the task.

## 4. Pane Invocation Mode

Pane invocation is bootstrap-only. A pane does not receive task text through `tmux send-keys`.

Allowed mode:

- `operatord` tells the pane to read a local file path, typically `payload.dispatch_md_path` from the task envelope or a generated bootstrap file path derived from it.
- The bootstrap command may be delivered through the host bootstrap layer, but the command content is short and path-oriented.
- The pane reads the task body from the referenced file and runs under normal tool/runtime controls.

Forbidden mode:

- Do not inject the full user request, PM dispatch body, DAG payload, diff, credentials, or arbitrary multiline prompt through `tmux send-keys`.
- Do not use `send-keys` as the main task protocol.
- Do not let scheduler/coordinator bypass the mailbox by writing directly into a pane.

Practical rule: `send-keys` may start `operatord`, wake a stuck pane, or pass a short "read this file" bootstrap path. It must not carry the task content itself.

## 5. Heartbeat Strategy

`heartbeat.json` is the liveness signal for watchdog/status consumers.

Default cadence:

- Write every 5 seconds while the process is alive.
- Continue writing during `IDLE`, `DISPATCHING`, `EXECUTING`, `REPORTING`, and `ABORTING`.
- Include enough fields for health checks without embedding business payloads.

Recommended fields:

```json
{
  "actor_id": "<actor_id>",
  "pid": 12345,
  "ts": "2026-06-05T00:00:00Z",
  "state": "EXECUTING",
  "current_task_id": "<task_id-or-null>",
  "uptime_sec": 42,
  "idle_sec": 0,
  "mem_mb": 256
}
```

Write policy:

- Write `heartbeat.json.tmp` in the same directory as `heartbeat.json`.
- Flush file content and directory metadata where the platform supports it.
- Rename `heartbeat.json.tmp` to `heartbeat.json`.
- Readers treat stale mtime or stale `ts` as actor-down evidence; they do not mutate the heartbeat file.

## 6. State Write Strategy

`state.json` is written on state transitions, not on every loop tick.

Recommended fields:

```json
{
  "actor_id": "<actor_id>",
  "pid": 12345,
  "state": "DISPATCHING",
  "started_at": "2026-06-05T00:00:00Z",
  "updated_at": "2026-06-05T00:00:10Z",
  "current_task_id": "<task_id-or-null>",
  "last_task_id": "<task_id-or-null>",
  "restart_count": 0,
  "last_error": null
}
```

Write policy:

- Write `state.json.tmp` beside `state.json`.
- Flush file content and directory metadata where available.
- Rename `state.json.tmp` to `state.json`.
- Never write partial JSON to the final file path.
- If the existing state file is corrupt, preserve a diagnostic log entry and reconstruct state from process inputs plus `processing/` and `outbox/` evidence.

State/result ordering:

- Enter `REPORTING` before writing `outbox/<task_id>.result.json`.
- Write the result envelope atomically.
- Clear or archive the matching `processing/` entry.
- Only then transition back to `IDLE`.

## 7. Runtime Boundaries

`operatord` belongs to the runtime plane and must stay inside its boundary.

It may:

- Consume actor mailbox files.
- Invoke the pane through approved bootstrap.
- Write result, state, heartbeat, and runtime logs for its actor.
- Emit append-only state transition events.

It must not:

- Choose DAG nodes or mutate graph scheduling state.
- Inject task text through `tmux send-keys`.
- Read or write another actor's mailbox.
- Hard-code actor IDs, mailbox roots, task IDs, model names, tokens, or feature flags.
- Replace mailbox protocol atomicity with ad hoc writes.

## 8. Acceptance Trace

| Requirement | Trace |
|---|---|
| `docs/operatord-runtime.md` exists | This file. |
| Six states listed | `STARTING`, `IDLE`, `DISPATCHING`, `EXECUTING`, `REPORTING`, `ABORTING` in §2. |
| Grep state names | State names appear in §2, §3, §5, and §6. |
| One actor one process isolation | §1 states one actor maps to one `operatord` process. |
| Pane does not use send-keys for task text | §4 forbids task-text injection and allows only file-path bootstrap. |
