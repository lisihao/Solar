# Base Layer File Governance Audit (2026-05-02)

## Scope

Audit target:

- `backend/src/modules/ai-infra`
- `backend/src/modules/ai-engine`
- `backend/src/modules/ai-harness`

Production files only:

- Excludes `__tests__/`
- Includes `.ts`, `.md`, and other non-test production assets

Machine-readable inventory:

- `docs/audits/base-layer-production-files-2026-05-02.csv`

## Inventory

Production file counts:

- `ai-infra`: 116
- `ai-engine`: 357
- `ai-harness`: 379
- Total: 852

Extension counts:

- `.ts`: 781
- `.md`: 70
- `.py`: 1

## Review Criteria

Each production file is reviewed against four dimensions:

1. Filename compliance
2. Directory fit
3. Platform vs domain ownership
4. Layering direction

Classification vocabulary:

- `platform-core`: reusable core primitive, contract, registry, runtime, or adapter
- `platform-domain-catalog`: platform-owned built-in catalog or preset, but not pure abstraction
- `domain-leakage`: file sits in base layer but contains app-specific product/domain behavior
- `compatibility-debt`: bridge, legacy, transitional, or overloaded compatibility construct
- `hard-layering-violation`: imports or re-exports upward into a higher layer

## Current Findings

### Completed In This Wave

Completed structural cleanup:

- `ai-infra/db-governance` large embedded catalogs were split into dedicated `catalogs/` and `policies/` files.
- `ai-infra/db-governance/data-retention.service.ts` now reads retention rules from a dedicated policy catalog.
- `ai-infra/credits` now separates default pricing rules and module-to-transaction-type mapping into dedicated policy files.
- `ai-infra/storage/governance` now separates record size estimates into a dedicated catalog file.
- `ai-engine/skills/runtime` naming cluster was normalized:
  - `engine-skill-provider.ts` -> `engine-skill-provider.adapter.ts`
  - `input-binding-resolver.ts` -> `skill-input-binding-resolver.service.ts`
  - `prompt-skill-adapter.ts` -> `prompt-skill.adapter.ts`
- `ai-engine` utility filenames were largely normalized from `*.util.ts` to `*.utils.ts`.
- `ai-engine/safety/security/url-sanitizer.utils.ts` was moved to `ai-engine/safety/utils/figure-url-sanitizer.utils.ts` because it is a shared safety utility, not a standalone security subdomain module.
- `ai-harness/facade/index.ts` no longer re-exports `FigureExtractorService` from `ai-app`; it now points at `ai-engine/facade`.
- `ai-harness` utility filenames were partially normalized:
  - `quality-score.util.ts` -> `quality-score.utils.ts`
  - `stage-emit.util.ts` -> `stage-emit.utils.ts`
  - `failure-extraction.util.ts` -> `failure-extraction.utils.ts`
  - `token-spend.util.ts` -> `token-spend.utils.ts`

Verification:

- `npx tsc --noEmit -p backend/tsconfig.json`
- `backend/npm run verify:arch`

Both passed after the above changes.

### ai-infra Top-Level Directory Disposition

- `abstractions`: keep
- `auth`: keep
- `credentials`: keep
- `credits`: keep, but continue splitting ledger substrate from product pricing policy
- `db-governance`: keep, but reduce embedded product taxonomy in core services
- `email`: keep, with runtime vs presets split already in place
- `encryption`: keep
- `facade`: keep and keep closed
- `monitoring`: keep
- `notifications`: keep, with runtime vs presets split already in place
- `release`: keep
- `secrets`: keep
- `settings`: keep
- `storage`: keep, but continue splitting runtime from policy/governance payloads

Summary:

- `ai-infra` top-level directory names are now largely acceptable.
- The remaining `ai-infra` problem is not top-level naming; it is domain policy sediment inside `credits`, `db-governance`, and `storage`.

### P0 Hard Layering Violations

1. `ai-harness` re-export from `ai-app` was present and has now been removed

File:

- `backend/src/modules/ai-harness/facade/index.ts`

Assessment:

- This was a direct upward dependency from `ai-harness` to `ai-app`.
- It violated the required direction `ai-infra -> ai-engine -> ai-harness -> ai-app`.
- Status: fixed in current working tree by routing through `ai-engine/facade`.

### P1 Naming Clusters Not Yet Normalized

#### `ai-engine/skills/runtime`

Current files:

- `engine-skill-provider.adapter.ts`
- `skill-input-binding-resolver.service.ts`
- `prompt-skill.adapter.ts`
- `prompt-skill-registration.service.ts`

Assessment:

- This directory was not normalized as a coherent runtime cluster.
- Status: naming cluster is now normalized in current working tree.

Required direction:

- Keep this runtime cluster on one naming scheme and one ownership model.
- Distinguish:
  - registration
  - adapter
  - provider
  - input binding resolution

### P1 Infra Domain Leakage

#### `ai-infra/storage/governance`

File:

- `backend/src/modules/ai-infra/storage/governance/storage-governance.service.ts`

Assessment:

- This file still embeds product/domain-specific storage governance such as `officeDocuments`, `slidesSessions`, `askSessions`, and similar categories.
- Infra can own storage runtime and governance primitives.
- Infra should not indefinitely hardcode app-domain cleanup semantics inside a generic governance service.

Required direction:

- Separate generic retention/governance primitives from app-specific storage policies.

#### `ai-infra/db-governance`

Files:

- `backend/src/modules/ai-infra/db-governance/db-governance.service.ts`
- `backend/src/modules/ai-infra/db-governance/data-retention.service.ts`

Assessment:

- These files are infra-owned in intent, but the current implementation contains a very large amount of app/product table taxonomy.
- This is not a naming issue; it is a boundary issue.
- The current service behaves like a monolithic database policy catalog for the whole product suite.

Required direction:

- Keep the infra-owned substrate.
- Extract product-specific retention matrices and domain taxonomies out of the core service contract.

### P1 Engine/App Coupling for Skill Loading

File:

- `backend/src/modules/ai-engine/skills/loader/skill-loader.service.ts`

Current behavior:

- Resolves skill content from `../../../ai-app`
- Reads:
  - `writing/skills`
  - `topic-insights/skills`
  - `shared/skills`
  - `office/slides/skills`
  - `research/skills`

Assessment:

- This is not a simple filename issue.
- It is a structural coupling between `ai-engine` runtime and `ai-app` filesystem layout.
- It may be acceptable only if `ai-engine` explicitly declares that app-owned skill content is a supported external content source.
- If not, this should be inverted via a content source interface or moved outward.

### P1 Harness Platform/Domain Mixing

#### Built-in agent catalog

Files:

- `backend/src/modules/ai-harness/agents/domain/builtin-agent-catalog.ts`

Assessment:

- This is better than keeping built-in agent ids in `agents/abstractions`.
- It is still not a pure abstraction; it is a harness-owned built-in catalog.
- That is acceptable if `agents/domain` is explicitly treated as a platform-owned preset/catalog area.

#### Evaluation sediment

Directories:

- `backend/src/modules/ai-harness/evaluation/critique`
- `backend/src/modules/ai-harness/evaluation/figure`

Assessment:

- These areas need file-by-file review to confirm whether they are truly cross-app reusable evaluation capabilities or topic-insights sediment moved upward too early.
- This is a placement decision, not just a naming decision.

## Naming Risk List

The following production filenames still need explicit disposition review:

### ai-engine

- `backend/src/modules/ai-engine/content/citation/citation-verifier.util.ts`
- `backend/src/modules/ai-engine/llm/output-parsing/sanitize-output.util.ts`
- `backend/src/modules/ai-engine/llm/output-parsing/strip-chart-json.util.ts`
- `backend/src/modules/ai-engine/llm/prompts/prompt-template.service.ts`
- `backend/src/modules/ai-engine/safety/security/url-sanitizer.util.ts`
- `backend/src/modules/ai-engine/safety/security/llm-injection/external-content-wrapper.util.ts`
- `backend/src/modules/ai-engine/safety/utils/error-detection.util.ts`
- `backend/src/modules/ai-engine/tools/categories/processing/template-render.tool.ts`
- `backend/src/modules/ai-engine/tools/search-fusion/quality-gate.util.ts`
- `backend/src/modules/ai-engine/tools/search-fusion/result-fusion.util.ts`

### ai-harness

- `backend/src/modules/ai-harness/evaluation/critique/report-artifact/figure-filter.util.ts`
- `backend/src/modules/ai-harness/runner/prompt/prompt-template.ts`

## Direction For Remediation

Execution order:

1. `ai-infra`
2. `ai-engine`
3. `ai-harness`

Remediation rules:

1. Fix hard upward dependencies first.
2. Normalize cluster names, not isolated filenames.
3. Separate platform runtime from domain presets/policies.
4. Keep built-in catalogs out of pure abstraction directories.
5. Do not move app-owned assets into base layers just to make the tree look neat.

## Immediate Backlog

### Infra

1. Split storage governance primitives from app-domain storage policy payloads.
2. Reduce `db-governance` product taxonomy load in core infra services.
3. Review `credits` for platform ledger vs product pricing policy separation.

### Engine

1. Normalize `skills/runtime` naming and ownership as a single cluster.
2. Decide whether `skill-loader.service.ts` may legally source app-owned skill content.
3. Review `content/report-template`, `content/citation`, and `tools/search-fusion` for genuine engine ownership.

### Harness

1. Remove the `ai-app` re-export from `facade/index.ts`.
2. Continue file-by-file review of `evaluation/*` and `runner/*` naming/ownership.
3. Keep `agents/abstractions` pure and confine built-in catalogs to `agents/domain`.
