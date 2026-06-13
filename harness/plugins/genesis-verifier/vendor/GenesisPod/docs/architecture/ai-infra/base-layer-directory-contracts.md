# Base Layer Directory Contracts (2026-05-02)

## Purpose

This document defines directory-level contracts for `ai-infra`, `ai-engine`, and `ai-harness`.

It exists to answer:

1. What kind of files are allowed in a directory?
2. What kind of files are not allowed in a directory?
3. When should a file be split, moved, or marked as domain leakage?

This is the directory-level companion to:

- `.claude/standards/18-base-layer-file-governance.md`

## ai-infra

### Top-Level MECE Map

`ai-infra` current top-level directories should be interpreted as four non-overlapping groups:

- `access/identity substrate`
  - `auth/`
  - `credentials/`
  - `secrets/`
- `economic/governance substrate`
  - `credits/`
  - `db-governance/`
  - `settings/`
  - `release/`
- `delivery/runtime substrate`
  - `storage/`
  - `email/`
  - `notifications/`
  - `encryption/`
- `module shell`
  - `abstractions/`
  - `facade/`
  - `monitoring/`

This means:

- `auth` handles user/application identity and session access.
- `credentials` handles BYOK, key assignment, key request, key resolver, and user model configuration.
- `secrets` handles secret inventory and secret lifecycle APIs.
- `credits` handles wallet/ledger/rule execution, not product pricing orchestration.
- `db-governance` handles retention, cleanup, and table governance, not schema runtime.
- `storage` handles object/blob storage runtime and storage governance.
- `email` and `notifications` are parallel delivery channels, not one another's subdirectories.
- `monitoring` is observability only, not data governance overflow.

Files that do not fit one of these groups should be treated as misplacements.

### `credits/`

Allowed:

- account substrate
- ledger operations
- transaction typing
- pricing policy catalogs

Not allowed:

- app-only purchase flow orchestration
- product UI workflow code

Split rule:

- substrate stays in services/modules
- product pricing matrices belong in `policy/`
- static mappings belong in `policy/` or `catalogs/`

Required subdirectory shape:

- `dto/`
- `policy/`
- `rewards/`
- `exceptions/`
- root runtime files only for module/controller/service/store

### `db-governance/`

Allowed:

- table introspection
- cleanup execution
- retention framework
- governance catalogs and policy data

Not allowed:

- ad hoc business cleanup scripts disguised as governance runtime

Split rule:

- runtime execution stays in `*.service.ts`
- table maps and retention matrices belong in `catalogs/` and `policies/`
- custom cleanup exceptions must be expressed as explicit policy catalogs, not service-local switch branches

Required subdirectory shape:

- `catalogs/`
- `policies/`
- `dto/`
- root runtime files only for module/controller/service/index

### `storage/`

Allowed:

- object storage runtime
- inventory and offload framework
- governance substrate

Not allowed:

- product-specific retention semantics embedded directly in runtime service bodies without policy separation

Split rule:

- runtime in `runtime/`
- governance execution in `governance/`
- static estimates or policy tables in `governance/catalogs/`
- vacuum target allowlists and batch target sets belong in `governance/catalogs/`

Required subdirectory shape:

- `runtime/`
- `governance/`
- `governance/catalogs/`
- root runtime files only for module shell

### `secrets/`

Allowed:

- secret lifecycle APIs
- secret-name catalogs
- validation pipes
- provider-neutral classification metadata

Not allowed:

- provider-specific credential runtime that belongs in `credentials/`
- ad hoc app feature wiring

Split rule:

- APIs and mutation/query flows stay in services/controllers/modules
- static secret-name mappings and metadata belong in `*.catalog.ts`
- Nest validation behavior belongs in `dto/*.pipe.ts`

Required subdirectory shape:

- `dto/`
- root runtime files only for module/controller/service/catalog

### `email/`

Allowed:

- delivery runtime
- provider connectivity
- preset notification composition

Not allowed:

- app workflow ownership
- app service orchestration

Split rule:

- provider runtime stays in `email.service.ts`
- reusable preset message composition belongs in `presets/`

Required subdirectory shape:

- `presets/`
- root runtime files only for module/service

### `notifications/`

Allowed:

- notification delivery runtime
- transport-neutral notification creation
- preset notification composition

Not allowed:

- app-owned campaign logic
- feature-specific notification workflow orchestration

Split rule:

- delivery runtime stays in `notification.service.ts`
- transport endpoints stay in controller/module
- preset notification composition belongs in `presets/`
- DTOs belong in `dto/`

Required subdirectory shape:

- `dto/`
- `presets/`
- root runtime files only for module/controller/service

### `credentials/`

Allowed:

- user API key lifecycle
- distributable key pool management
- key assignment and approval workflow substrate
- key resolution and scheduling
- user model configuration

Not allowed:

- provider-specific LLM runtime logic that belongs in `ai-engine/llm`
- app-specific BYOK onboarding UI behavior

Split rule:

- each bounded subdomain gets its own folder
- cross-subdomain maintenance tasks belong in `scheduling/`
- DTOs stay inside the owning bounded subdomain

Required subdirectory shape:

- `user-api-keys/`
- `distributable-keys/`
- `key-assignments/`
- `key-requests/`
- `key-resolver/`
- `user-model-configs/`
- `scheduling/`

### `auth/`

Allowed:

- authentication runtime
- identity DTOs
- auth strategies

Not allowed:

- general credential management that belongs in `credentials/`
- generic secret inventory that belongs in `secrets/`

Required subdirectory shape:

- `dto/`
- `strategies/`
- root runtime files only for module/controller/service/strategy

### `monitoring/`

Allowed:

- health checks
- metrics collection
- error tracking

Not allowed:

- retention governance
- cleanup execution
- schema/table ownership logic

Split rule:

- health runtime belongs in `health/`
- metrics runtime belongs in `metrics/`
- error aggregation/tracking belongs in `tracking/`
- root keeps only module shell and re-export surface

Required subdirectory shape:

- `health/`
- `metrics/`
- `tracking/`
- root runtime files only for module/index

## ai-engine

### `safety/`

Allowed:

- constraints
- guardrails
- resilience
- security subdomains
- shared safety utilities

Placement rule:

- coherent subdomain modules stay under dedicated folders such as `security/llm-injection/`
- cross-subdomain pure helpers belong in `safety/utils/`

### `skills/runtime/`

Allowed:

- runtime adapter
- runtime registration
- runtime provider exposure
- runtime input binding resolution

Naming rule:

- adapters use `*.adapter.ts`
- DI services use `*.service.ts`
- registration uses `*.service.ts`
- no bare `resolver.ts` or `provider.ts` without scope prefix

### `content/report-template/`

Allowed only if:

- the formatting, pipeline, and constants are shared engine capabilities across multiple apps

Manual review required if:

- implementation remains effectively topic-insights-specific

Naming rule:

- static standards belong in `*.constants.ts` or `*.catalog.ts`
- pipeline entrypoints use `*.service.ts` only if they are DI services; pure processing modules may use stable noun files but must be adjudicated explicitly

### `tools/categories/processing/`

Allowed:

- data transformation tools
- document parsing and diff tools
- template rendering tools

Not allowed:

- a flat catch-all bucket of unrelated processing tools

Split rule:

- data-oriented tools belong in `data/`
- document-oriented tools belong in `documents/`
- template rendering belongs in `templates/`
- root keeps only `index.ts` and category-level documentation

## ai-harness

### `agents/abstractions/`

Allowed:

- interfaces
- abstract types
- agent contracts

Not allowed:

- built-in agent ids
- built-in app-specific preset catalogs

### `agents/domain/`

Allowed:

- built-in catalogs
- harness-owned preset maps
- concept registries

Rule:

- this area may contain platform-owned domain catalogs, but must not pretend to be abstractions

### `evaluation/`

Allowed only if:

- the evaluator is genuinely reusable across apps

Manual review required if:

- the implementation still encodes topic-insights-specific report semantics

### `runner/prompt/`

Allowed:

- harness-owned prompt templating primitives
- prompt registries

Manual review required if:

- file names or API shape still reflect temporary topic-insights sediment rather than stable runner concepts

## Execution Rule

When a flagged file is reviewed, the adjudication must answer:

1. Why is this file platform-owned?
2. Why does it belong in this directory rather than a sibling?
3. Does the file contain executable domain behavior or only shared platform policy/preset content?
