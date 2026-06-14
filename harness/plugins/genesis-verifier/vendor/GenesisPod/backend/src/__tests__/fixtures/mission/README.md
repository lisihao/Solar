# Mission fixture catalog

This directory hosts the canonical fixture catalog for `agent-playground` mission
detail view replay tests. Fixtures are the equivalence oracle for
`MissionViewProjectorService` (B2) and `ArtifactComposerService` (B3) —
**not the legacy `frontend/derive.ts`**.

Authoritative spec: `docs/architecture/ai-app/agent-playground/agent-team-thinning-plan-2026-05-26.md` §6.8 / §6.8.1.b / §6.8.4.b.

## Directory layout

```
mission/
├─ README.md                       (this file)
├─ types.ts                        FixtureBundle TS type + loader
├─ playground-completed/           (single-point: §6.8.1)
├─ playground-failed/
├─ playground-quality-failed/
├─ playground-cancelled/
├─ playground-reopened/
├─ playground-resumable/
├─ playground-partial-failure-mid-run/      (combined-state: §6.8.1.b)
├─ playground-multi-stage-rerun-in-flight/
└─ playground-multi-agent-retry/
```

Each fixture directory contains four files:

| File | Required | Purpose |
|---|---|---|
| `mission-row.json`     | always | anonymized `AgentPlaygroundMission` row + linked rows |
| `events.json`          | always | anonymized replay event stream (≤50 events default per §6.8.4.b) |
| `checkpoint.json`      | when `mission.configSnapshot` exists | `configSnapshot` blob; legacy null rows must commit `{ kind: "legacy-null" }` |
| `expected-view.json`   | always | the canonical `PlaygroundDomainView` the projector must produce |
| `meta.json`            | always | `{ kind: "real-anonymized" \| "synthetic", source?, capturedAt? }` (§6.8.4.b rule 3) |

## Fixture admission rules

1. Every fixture must declare `kind` in `meta.json`. No silent admission.
2. Anonymization runs **before** commit (§6.8.4.b mandatory):
   - mask `mission.topic`, `title`, all free-text fields (`reportFull`, `leaderJournal`, agent narration, critique text), person/org/email/phone/token/account-id/internal-url
   - rewrite citation URLs to hostname-only (no query strings, no signed URLs)
   - mask identifiers inside `dimensions / references / todos / event payloads`
   - preserve: enum values, stage ids, structural keys, relative counts, hostname-only sources, relative timestamp ordering
3. `events.json` shape must mirror the persisted replay payload returned by `GET /agent-playground/replay/:missionId` (single source). Schema drift between fixture and replay endpoint is a CI failure.
4. `expected-view.json` is hand-authored from §6 semantic rules. It is the **oracle**, not derived from `derive.ts`.
5. Combined-state fixtures (§6.8.1.b) must exercise non-trivial cross-stage state. A `multi-stage-rerun-in-flight` fixture that only contains a single stage is not admissible.
6. Larger-than-50-event fixtures are allowed **only** if `meta.json.kind` includes `benchmark` or `stress` and the rationale is recorded in `meta.json.note`.

## Extractor / anonymizer

§6.8.4.b required deliverable. Baseline: `scripts/dev/dump-playground-fixtures.js`.

Target script: `scripts/dev/extract-mission-fixture.ts` (B1-2 follow-up PR). Until that script lands, fixtures may be authored manually with `meta.kind = "synthetic"`.

CI validation step (§6.8.4.b rule 3): the fixture-replay CI job must reject any committed fixture containing raw URLs with query strings, email-like patterns, or bearer-style tokens.

## Adding a new fixture class

1. Add the directory.
2. Update `types.ts` `KNOWN_FIXTURE_IDS` if loader exhaustiveness is enforced.
3. Add `meta.json` with admission `kind`.
4. Cross-link in this README's directory layout table.
5. Get CODEOWNERS sign-off (per plan §29 / §19.3 — these files are semantic contract inputs).

## Why fixtures are protected assets

Fixtures are not disposable test data. They are the **mechanism** by which §6 contract semantics get encoded into executable form. A drift in fixtures = a silent contract drift. Reviewer approval is mandatory for any fixture change.
