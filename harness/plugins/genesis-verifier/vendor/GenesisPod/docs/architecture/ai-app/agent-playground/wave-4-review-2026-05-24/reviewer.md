# Code Review Report: Wave 1b + Wave 4 (2026-05-24)

- Date: 2026-05-24
- Scope: 4 commits 38f083248 / 4adf17a9b / 80822389c / 4424d17f3
- Reviewer: Reviewer Agent (claude-sonnet-4-6)
- Change scale: +430 lines new spec / 24 files export type fix / 93 files radar reorg

---

## 1. Correctness - 24 export type Fixes (commit 4adf17a9b)

### Verdict: OK. No values incorrectly converted to type-only.

Key symbols verified individually against their source definitions:

**ImageTaskType**: Defined as `export enum` in `image-designer.agent.ts:47` - a runtime
value. The commit keeps `export { ImageDesignerAgent, ImageTaskType }` intact; only
`ImageStyle / InfographicStyle / TemplateLayout` (all `type` aliases) were separated
into `export type`. Correct.

**CREATIVITY_TO_TEMPERATURE / OUTPUT_LENGTH_TO_TOKENS**: Both defined as `export const`
in `task-profile.types.ts:313,324` - runtime constants. Correctly kept in non-type
export. `TaskProfile / CreativityLevel` (interfaces) correctly moved to `export type`.

**AgentRegistryStats**: Source `plan-based-agent-registry.ts:22` declares
`export interface`. Changing to `export type { AgentRegistryStats }` is correct.

**AgentStatusReport**: Source `agent-orchestrator.ts:28` declares `export interface`.
Correct.

**StreamEvent**: Source `checkpoint.types.ts:535` is `export interface`.
`slides-engine.service.ts:100` changing from `export { StreamEvent }` to
`export type { StreamEvent }` is correct.

**GeneratedImageResult**: Source `image.types.ts:110` is `export interface`. Change in
`generation.service.ts` to `export type { GeneratedImageResult }` is correct.

**LeaderConfig**: Kept as `export type { LeaderConfig }` alongside value exports
`export { TeamMember, Leader, createMember, createLeader }` - correct split.

**ILeaderLLMAdapter**: `I`-prefixed interface convention, correctly moved to type export.
`LeaderLLMAdapter / createLeaderLLMAdapter` are class+factory - correctly kept as
value exports.

All 24 changes correctly apply value vs type semantic classification. No class, const,
or enum was incorrectly reclassified as type-only. `tsc 0 error` is the definitive
verification; it confirms the compiler agrees with the classification.

---

## 2. Test Quality

### 2a. agent-team-layout.spec.ts (43 tests)

**P1 - App root check only filters `.ts` files; other file types pass through**

`agent-team-layout.spec.ts:125`:

```typescript
const offending = files.filter((f) => f.endsWith(".ts"));
```

A `README.md` or `package.json` placed at the app root would not trigger this
assertion. Practical risk is low since only `.ts` files affect NestJS module
resolution. The narrow scope is defensible for the current stated goal, but if the
intent of the rule extends to "no source-adjacent files at the root," the filter
needs expanding.

**P2 - business-team root has no stray `.ts` file check**

The `AI Harness business-team` describe block (lines 186-208) only checks subdirectory
whitelist membership. There is no equivalent of Rule B (no `.ts` files in root) for
`business-team/`. Currently `business-team/` root has only `README.md` - no real risk.
A future `utils.ts` dropped there would pass undetected.
Suggestion: Add a `.ts` file check for `business-team/` root. Low priority.

**OK - Whitelist separation is well-designed**

`ALLOWED_TOP_DIRS` (8.2) and `ALLOWED_HARNESS_BUSINESS_TEAM_DIRS` (8.1) are separate
constants with per-entry comments. `integrations/` is explicitly listed with a comment
marking it as optional. Design intent is unambiguous.

**OK - AGENT_TEAM_APPS registration comment is correctly positioned**

Line 33: `/** Three agent team apps - must register here when adding a new
mission-pipeline app */`. Placed immediately above the array definition, visible at
first glance when adding a new app.

**OK - Assertions are not brittle**

No hardcoded LOC counts or file counts. All checks use directory existence and
whitelist membership. `REQUIRED_MISSION_SUBDIRS = ["pipeline", "agents", "lifecycle"]`
is a behavioral requirement, not a fragile file enumeration.

**P2 - `helpers`/`rerun` in whitelist not marked as optional vs required**

`ALLOWED_HARNESS_BUSINESS_TEAM_DIRS` contains `helpers` and `rerun` (whitelist allows
them), but the `it.each([...])` existence check array (lines 195-204) intentionally
omits them - they are optional extensions. The whitelist constant itself has no
comment distinguishing required from allowed entries. A reader seeing only the constant
cannot tell which entries are mandatory.
Suggestion: Add inline comments on `helpers` and `rerun` entries marking them optional.

### 2b. agent-team-facade-contract.spec.ts (12 tests)

**P1 - lifecycle `describe.each` early return leaves zero-test registration with no guard**

`agent-team-facade-contract.spec.ts:147`:

```typescript
if (!fs.existsSync(lifecycleDir)) return;
const files = listTsFiles(lifecycleDir);
```

When `lifecycleDir` does not exist, `return` fires inside the `describe.each` factory
callback. Jest registers zero `it()` blocks for that app's lifecycle suite. No failure
occurs - the test count silently drops.

Actual impact assessment: The layout spec enforces `lifecycle/` existence at line 170,
so a missing `lifecycle/` dir is caught upstream. The two specs are complementary.
But there is a second gap: if `lifecycle/` exists but contains only `__tests__/` (all
`.spec.ts` files excluded by `listTsFiles`), `files` would be `[]`, the violation loop
runs zero iterations, and the test passes vacuously.

Compare to the pipeline block which has an explicit guard at lines 109-111:

```typescript
it("must scan at least one file (otherwise verification is hollow)", () => {
  expect(files.length).toBeGreaterThan(0);
});
```

The lifecycle block lacks this guard.
Recommendation: Add a `files.length > 0` guard to the lifecycle describe block, or
replace the early return with logic that still registers the `it()` but skips gracefully.

**P1 - `detectHarnessInternalImport` regex has a blind spot for pure relative paths**

`agent-team-facade-contract.spec.ts:73`:

```typescript
const m = spec.match(/(?:@\/|\.\.?\/)*modules\/ai-harness\/([^"']+)/);
```

This regex requires the literal segment `modules/ai-harness/` in the path string.
From `mission/pipeline/` depth (`backend/src/modules/ai-app/{app}/mission/pipeline/`),
the shortest relative path to reach `ai-harness/` is:

```
../../../../ai-harness/teams/business-team/dispatcher/foo
```

Four levels up reaches `modules/`, then descends to `ai-harness/`. This path string
does NOT contain `modules/` as a literal segment - the regex does not match it and
the violation goes undetected.

Actual risk: No production file in `ai-app/**` uses this path form; all use
`@/modules/...` convention. ESLint SECTION 10 intercepts at the IDE layer. This is a
theoretical escape hatch, not an active vulnerability.
Recommendation: Extend the regex to also match the pure relative form, or normalize
all import targets via `path.resolve` before applying the matcher.

**OK - `extractImportTargets` covers type-only / dynamic import / require()**

Verified all four import forms against the regex at `spec.ts:58`:

- `import type { Foo } from '...'` - captured by `from\s+` branch
- `export type { Bar } from '...'` - captured by `from\s+` branch
- `await import('...')` - captured by `import\s*\(\s*` branch
- `require('...')` - captured by `require\s*\(\s*` branch

Comment stripping before the regex (lines 56-57) correctly excludes commented-out
import statements. Block comments and line comments are both handled.

**OK - `.module.ts` exclusion is correct and documented**

`listTsFiles` excludes `.module.ts` at line 45. The spec comment explains: NestJS
Module files may import concrete harness classes directly for DI provider setup, and
facade re-exported types cannot be used for NestJS module wire-up. The exception is
justified and documented.

---

## 3. Readability

**OK - Both new spec file headers are high quality**

Both specs carry complete block comments with: blueprint document links, three-layer
guard positioning (ESLint / jest / pre-push hook), and rule intent explanation. For
architecture conformance specs this documentation is necessary - the reader needs to
understand what convention is being enforced, not just what the code mechanics are.

**OK - Whitelist constant naming distinguishes allowed vs required**

`ALLOWED_TOP_DIRS` / `REQUIRED_MISSION_SUBDIRS` / `ALLOWED_HARNESS_BUSINESS_TEAM_DIRS`
names accurately encode the semantic difference between what is permitted and what
must exist. This distinction matters for maintainability.

**P2 - `listDirEntries` and `listTsFiles` have no JSDoc**

Both utility functions are simple, but the exclusion rules in `listTsFiles`
(no `.spec.ts`, no `.d.ts`, no `.module.ts`) take a moment to parse from the code body.
Two lines of JSDoc per function would save future readers the detour.

**OK - Naming style is consistent with codebase conventions**

`detect***InternalImport` parallel naming. Chinese-language test description strings
match existing architecture spec conventions. ALL_CAPS constants follow existing patterns.

---

## 4. Maintenance - New App Onboarding

**OK - Integration cost for adding a new agent team app is clear**

Both specs use `AGENT_TEAM_APPS = ["agent-playground", "social", "radar"]` as the
single registration point, annotated with a comment. All `it.each` calls are driven
by this array, so adding a new entry automatically applies all checks.

**P2 - No guidance on keeping the whitelist in sync with the blueprint document**

If the 8.2 spec evolves (e.g., adding an `adapters/` subdirectory), `ALLOWED_TOP_DIRS`
must be updated. The spec has no comment pointing to the blueprint document as the
source of truth for whitelist membership. A developer updating `ALLOWED_TOP_DIRS`
might not realize the blueprint doc needs updating first.

**OK - Test names are actionable in Jest reporter**

Names like `agent-playground: all top-level directories match 8.2 whitelist` immediately
identify the violating app. The nested `describe.each` structure expands to names like
`radar mission/pipeline/ exists` - specific and actionable.

---

## 5. Regression Risk - playground.config.ts Move (commit 38f083248)

**OK - `__dirname` path calculation is correct**

Before: file at `agent-playground/playground.config.ts`.
Path: `path.resolve(__dirname, "..", "mission", "agents")` -> `agent-playground/mission/agents/`.

After: file at `agent-playground/runtime/playground.config.ts`.
Path: `path.resolve(__dirname, "..", "mission", "agents")`.
One `..` exits `runtime/` to reach `agent-playground/`, then descends to `mission/agents/`.
Same target directory as before. The comment on lines 27-28 explicitly notes the change.

**OK - All 7 consumer imports updated**

`git show --name-status` confirms R098 rename plus exactly 7 M files:

- `mission/pipeline/playground.pipeline.ts`
- `mission/rerun/local-rerun.service.ts`
- `mission/rerun/stage-rerun.dispatcher.ts`
- `__tests__/playground.config.dag.spec.ts`
- `__tests__/playground.config.spec.ts`
- `mission/pipeline/__tests__/crash-resume.spec.ts`
- `mission/pipeline/__tests__/playground-pipeline-dispatcher.spec.ts`

Count matches the commit body claim of "7 imports synced."

**P2 - `runtime/` has three config files with no README explaining their distinct roles**

`runtime/` now contains:

- `playground.config.ts` - pipeline stage declaration (13-step manifest)
- `playground-runtime.config.ts` - runtime configuration (timeout, pool size, etc.)
- `playground-tuning-profile.ts` - model/creativity tuning profiles

These are semantically distinct but the naming pattern does not make the boundary
obvious on first encounter. A `README.md` in `runtime/` explaining each file's role
would help contributors land in the correct file.

---

## 6. Linter / isolatedModules Coverage (commit 4adf17a9b)

**OK - `export type` fix is root-cause remediation, not a workaround**

`isolatedModules: true` requires type re-exports to use `export type` so the
single-file transpiler can safely elide them without type information. Explicit
`export type` is the compiler-prescribed solution, not a suppression.

**P2 - Verification scope is understated in commit body**

The commit body reports "radar 23 suites passed" as verification. This change touches
`ai-engine/index.ts`, `ai-harness/teams/`, `ai-app/image/`, `ai-app/office/`, and
`ai-app/teams/`. Running only radar suites does not cover consumers in those other
directories. The correct verification claim should be the full test suite or at
minimum all directly affected suite counts.

**OK - Fix scope is correctly limited to barrel/index files**

All 24 modified files are `index.ts` or direct re-export files. No business logic
was touched. `tsc 0 error` plus `build green` is sufficient verification for a
mechanical symbol reclassification of this kind.

---

## 7. Commit Messages

**38f083248**: OK. Body itemizes P21/P22/P23/P24 tasks, states test counts (43/12),
reports verification (228 tests green). Subject directly states the primary content.
Minor: short hash reference `30e2a71c4` for the ESLint commit is borderline for
long-term disambiguation.

**4adf17a9b**: OK on root cause (isolatedModules), affected scope (24 barrels), and
directory layers enumeration.
P2: Verification reports only "radar 23 suites passed" for a cross-layer change
spanning `ai-engine / ai-harness / ai-app`. Understated verification scope.

**80822389c**: OK. Names all 4 fixed files, explains root cause (`--changedSince` missed
long-broken specs), states verification result (64 tests passed). The "long-term fail
undetected by changedSince" note is valuable retrospective context and should be kept.
P1: No recurrence prevention stated. P9b/P9c moved source files; 4 specs silently
broke because `--changedSince` is based on the git change graph, not on import
resolution validity. This commit applies only a post-hoc fix. Missing:

- Discussion of using `@/` absolute paths in specs (more refactor-resilient)
- A file-move checklist item: "update spec imports when moving source files"
- Audit of other specs for similarly stale relative paths

**4424d17f3**: OK. Lists all 14 directory move mappings, names three categories of
downstream updates (app.module.ts / integration spec / spec depth adjustment), states
verification (222 passed / 2 skipped).
P2: "3 spec depth+1" in commit body understates actual content changes. `git show
--name-status` shows 8 spec files with similarity below 100% (R086 through R097), not 3.
`narrative.controller.spec.ts` (R086, 14% content change) had import paths change from
`../../services/briefing/` to `../../../mission/services/briefing/` - a real content
change in addition to the rename. The commit body only mentioned path depth adjustment,
but some specs also required import target path rewrites.

---

## Known Out-of-Scope Gap (Not Introduced by These Commits)

Commit `268136448` noted that radar conformance spec (P11b) was commented out. Radar
currently has no app-specific conformance checks beyond the generic three-app
`agent-team-layout.spec.ts` assertions. There is no per-app verification that
`radar/runtime/` contains `radar.config.ts` / `radar.constants.ts`, for example.
This is a pre-existing tracked gap, not introduced by the commits under review.

---

## Issues Summary

| Severity | Location                                 | Description                                                                                                                                                  |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | `agent-team-facade-contract.spec.ts:147` | lifecycle early return leaves zero-test registration; no `files.length > 0` guard like pipeline has at lines 109-111                                         |
| P1       | `agent-team-facade-contract.spec.ts:73`  | `detectHarnessInternalImport` regex misses pure relative paths to ai-harness that skip the `modules/` segment                                                |
| P1       | `80822389c` commit body                  | No recurrence prevention stated for spec import paths breaking silently on source file moves                                                                 |
| P2       | `agent-team-layout.spec.ts:186-208`      | No stray `.ts` file check for `business-team` root directory (contrast with app-level Rule B)                                                                |
| P2       | `agent-team-layout.spec.ts:82-95`        | `helpers`/`rerun` in whitelist not annotated as optional; indistinguishable from required entries without reading the `it.each` array                        |
| P2       | Both new spec files                      | `listDirEntries` and `listTsFiles` have no JSDoc explaining exclusion logic                                                                                  |
| P2       | `runtime/` directory                     | Three config files (`playground.config.ts` / `playground-runtime.config.ts` / `playground-tuning-profile.ts`) with no README explaining their distinct roles |
| P2       | `4adf17a9b` commit body                  | Verification reports only "radar 23 suites passed" for a cross-layer change spanning `ai-engine / ai-harness / ai-app`                                       |
| P2       | `4424d17f3` commit body                  | "3 spec depth+1" understates 8 actual spec files with similarity below 100%                                                                                  |

---

## Overall Score: 8.0 / 10

**Positives**:

- All 24 export type fixes are logically correct; zero value/type misclassification
- Layout spec whitelist design is sound; assertions are not brittle; `AGENT_TEAM_APPS`
  registration comment is correctly positioned and annotated
- Facade contract spec import extraction covers type-only, dynamic import, and require()
- Radar P11 reorg is clean: 93-file move with `app.module.ts`, integration spec, and
  stage specs all correctly updated; no stale import paths found in the current state
- `playground.config.ts` `__dirname` calculation is correct; all 7 consumers updated
- Pre-push hook step `[0/6]` runs the full `src/__tests__/architecture` suite; both
  new specs are automatically enforced from this commit forward

**Deductions**:

- P1: Facade contract regex has a blind spot for pure relative paths to `ai-harness`
  (ESLint provides backup coverage but the spec itself has the gap)
- P1: lifecycle `describe.each` block lacks the zero-files guard that the pipeline
  block has (cross-spec compensation exists via layout spec; intra-spec completeness
  is missing)
- P1: Spec path staleness problem (80822389c) addressed only with a post-hoc fix;
  no systemic prevention or related audit stated
- P2: Two commit bodies understate verification scope or miscount change count
