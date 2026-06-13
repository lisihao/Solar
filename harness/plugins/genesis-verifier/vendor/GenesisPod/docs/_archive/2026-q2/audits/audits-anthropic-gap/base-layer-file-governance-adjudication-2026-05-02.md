# Base Layer File Governance Adjudication (2026-05-02)

## Purpose

This file is the human review layer on top of the machine audit.

Machine audit can only say:

- suspicious
- naming anomaly
- possible upward reference

This adjudication file must answer:

- keep / rename / move / split / delete
- why
- target directory contract

## Current Status

### Audit Entry Point

- Command: `backend/npm run verify:file-governance`
- Standard: `.claude/standards/18-base-layer-file-governance.md`
- Directory contracts: `docs/architecture/base-layer-directory-contracts-2026-05-02.md`

### First-Pass Result

Current machine audit is now a triage tool, not a source of truth.

It should be interpreted in two buckets:

1. `filename false positives due to incomplete rule vocabulary`
2. `real ownership/content review candidates`

## Priority Buckets

### P0: hard violations

- none currently after the `ai-harness -> ai-app` re-export fix

### P1: content review clusters

- `ai-infra/credits`
- `ai-infra/db-governance`
- `ai-infra/storage`
- `ai-engine/content/report-template`
- `ai-engine/skills/loader`
- `ai-harness/evaluation`
- `ai-harness/runner/prompt`

### P2: naming family normalization

These are now mostly vocabulary cleanup rather than architectural blockers:

- `*-registry.ts`
- `*-manager.ts`
- `*-tracker.ts`
- `*-parser.ts`
- `*-factory.ts`
- `*-calculator.ts`
- `*-filter.ts`

## Adjudication Method

For each flagged production file:

1. confirm filename family
2. confirm directory contract
3. inspect behavioral ownership
4. assign one action:
   - `keep`
   - `rename`
   - `move`
   - `split`
   - `delete`
   - `manual-review`

## Next Review Order

1. `ai-infra/credits`
2. `ai-infra/db-governance`
3. `ai-infra/storage`
4. `ai-engine/safety`
5. `ai-engine/content/report-template`
6. `ai-engine/skills/loader`
7. `ai-harness/evaluation`
8. `ai-harness/runner/prompt`

## First Adjudications

### `ai-infra/credits`

- `credits.service.ts`
  - ownership: `platform-core`
  - action: `keep`
  - why: ledger substrate and quota accounting belong to infra

- `policy/default-credit-rules.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: product pricing matrix is not pure core logic, but it is an infra-owned policy surface and is now isolated from ledger runtime

- `policy/credit-transaction-type.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: static module-to-transaction classification is policy/catalog content, not runtime behavior

- `billing-context.store.ts`
  - ownership: `platform-core`
  - action: `rename-completed`
  - why: AsyncLocalStorage-backed runtime context is a store primitive, not a generic loose file

### `ai-infra/secrets`

- `dto/secret-name-validation.pipe.ts`
  - ownership: `platform-core`
  - action: `rename-completed`
  - why: file implements a Nest validation pipe, not a DTO param object

- `secret-name.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `rename`
  - target: `secret-name.catalog.ts`
  - why: file is a static secret naming/classification catalog, not executable runtime behavior

### `ai-infra/db-governance`

- `catalogs/table-category.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: table families are governance metadata; product table names may appear, but only as catalog content

- `catalogs/table-display-name.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: display labels are governance metadata, not app runtime logic

- `policies/table-cleanup-policy.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: retention and cleanup matrices belong to infra governance policy

- `db-governance.service.ts`
  - ownership: `platform-core`
  - action: `keep-with-followup`
  - why: execution runtime is correctly infra-owned, and custom cleanup handlers have now been routed through explicit policy catalogs rather than embedded switch growth

- `policies/table-cleanup-exception.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: table-specific retention exceptions are infra policy data and must not stay as hardcoded branches inside runtime services

### `ai-infra/storage`

- `governance/catalogs/storage-size-estimate.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: static size estimation data belongs in governance catalogs even when category names reflect product data classes

- `governance/storage-governance.service.ts`
  - ownership: `manual-review`
  - action: `split`
  - why: file is infra-owned, but currently mixes governance runtime with a long list of app-facing data classes; next step is to isolate static category descriptors and cleanup rules into catalogs/policies so the service body shrinks to orchestration

- `governance/catalogs/vacuum-target.catalog.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: allowed vacuum targets and batch target sets are governance policy data, not runtime control flow

### `ai-infra/notifications`

- `presets/notification-presets.service.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: preset notification composition is allowed in infra as reusable message policy, provided app workflow ownership stays outside the preset service

### `ai-infra/email`

- `presets/email-notification-presets.service.ts`
  - ownership: `platform-domain-catalog`
  - action: `keep`
  - why: reusable email preset composition is infra-owned policy content; delivery runtime remains in `email.service.ts`


