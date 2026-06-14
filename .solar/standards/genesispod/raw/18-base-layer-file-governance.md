# Base Layer File Governance

**Version:** 1.0  
**Updated:** 2026-05-02  
**Level:** MUST

---

## Purpose

This standard governs `platform` (L1, formerly ai-infra), `ai-engine`, and `ai-harness` at file level.

It answers three separate questions:

1. Is the filename correct?
2. Is the file in the correct subdirectory?
3. Is the file content appropriate for a base layer, or does it contain domain behavior?

These three checks are independent. A file can:

- have a valid filename but be in the wrong directory
- be in the right directory but still contain domain leakage
- be platform-owned but still use a weak or misleading filename

No cleanup wave is considered complete unless all three checks are applied.

---

## Required Review Model

Every production file under:

- `backend/src/modules/platform` (L1, formerly ai-infra)
- `backend/src/modules/ai-engine`
- `backend/src/modules/ai-harness`

must be classified on four axes:

1. `filename_status`
2. `directory_status`
3. `ownership_status`
4. `action`

Required ownership vocabulary:

- `platform-core`
- `platform-domain-catalog`
- `domain-leakage`
- `compatibility-debt`
- `hard-layering-violation`

Required action vocabulary:

- `keep`
- `rename`
- `move`
- `split`
- `delete`
- `manual-review`

---

## Filename Rules

### Allowed filename families

Production files should use one of these families when applicable.

Role-bearing filenames may use either `.` or `-` before the final role token.

Examples:

- `tool.registry.ts`
- `tool-registry.ts`
- `prompt-tier-adaptation.service.ts`
- `builtin-agent-catalog.ts`

Allowed role tokens:

- `*.module.ts`
- `*.service.ts`
- `*.controller.ts`
- `*.dto.ts`
- `*.pipe.ts`
- `*.types.ts`
- `*.interface.ts`
- `*.adapter.ts`
- `*.strategy.ts`
- `*.exception.ts`
- `*.provider.ts`
- `*.registry.ts`
- `*.guard.ts`
- `*.policy.ts`
- `*.catalog.ts`
- `*.checker.ts`
- `*.validator.ts`
- `*.tool.ts`
- `*.utils.ts`
- `*.factory.ts`
- `*.manager.ts`
- `*.coordinator.ts`
- `*.orchestrator.ts`
- `*.tracker.ts`
- `*.parser.ts`
- `*.sanitizer.ts`
- `*.wrapper.ts`
- `*.balancer.ts`
- `*.filter.ts`
- `*.calculator.ts`
- `*.replayer.ts`
- `*.listener.ts`
- `*.middleware.ts`
- `*.tokens.ts`
- `*.token.ts`
- `*.mapping.ts`
- `*.context.ts`
- `*.config.ts`
- `*.constants.ts`
- `*.error.ts`
- `*.errors.ts`
- `*.scheduler.ts`
- `*.store.ts`
- `*.exports.ts`
- `*.classifier.ts`
- `*.client.ts`
- `*.detector.ts`
- `*.logger.ts`
- `*.loader.ts`
- `*.activator.ts`
- `*.learner.ts`
- `*.scanner.ts`
- `*.judge.ts`
- `*.consensus.ts`
- `*.handle.ts`
- `*.classes.ts`
- `*.abstractions.ts`
- `*.monitor.ts`
- `*.runner.ts`
- `*.check.ts`
- `*.chunker.ts`
- `*.pipeline.ts`
- `*.agent.ts`
- `*.skill.ts`
- `*.member.ts`
- `*.role.ts`
- `*.team.ts`
- `*.workflow.ts`
- `*.template.ts`
- `*.prompt.ts`
- `*.engine.ts`
- `*.limiter.ts`
- `*.indexer.ts`
- `*.bus.ts`
- `*.accountant.ts`
- `*.pool.ts`
- `*.environment.ts`
- `*.isolation.ts`
- `*.spawner.ts`
- `*.compactor.ts`
- `*.pruner.ts`
- `*.estimator.ts`
- `*.invoker.ts`
- `*.breaker.ts`
- `*.fusion.ts`
- `*.tracer.ts`
- `*.exporter.ts`
- `*.conventions.ts`
- `index.ts`
- `README.md`
- `SKILL.md`
- `integration.md`
- `python-sandbox.py`

### Disallowed filename patterns

These patterns are forbidden in production base-layer files unless explicitly approved by ADR:

- `*.util.ts`
- `*.interfaces.ts`
- `*supplemental*`
- `*legacy*`
- `*additional*`
- `*compat*`
- `*temp*`
- `*custom*`
- `*bridge*`

Exception:

- `adapter` is allowed only as `*.adapter.ts`
- `bridge` is allowed only when it is a documented compatibility construct and the owning ADR explains why `adapter` is not the correct term

### Weak generic names

These names are too vague unless scoped by a descriptive stem:

- `config.ts`
- `service.ts`
- `manager.ts`
- `registry.ts`

For example:

- `config.ts` must become `tier-suffix-defaults.config.ts`
- `service.ts` must become `prompt-tier-adaptation.service.ts`

---

## Directory Fit Rules

Directory placement must follow semantic ownership, not just topical similarity.

### Rule A: subdomain folders must represent a real bounded capability

Examples:

- `safety/security/llm-injection/*` is valid because it is a coherent security subdomain
- `safety/utils/*` is the right place for shared pure safety utilities
- a single free-floating utility must not sit in a subdomain root unless that file itself is the subdomain anchor

### Rule B: pure tools go to `utils`, not pseudo-domains

If a file:

- has no DI
- is pure or near-pure
- does not define the subdomain contract

then it belongs in a `utils/` or equivalent helper area, not under a domain root as if it were the domain itself.

### Rule C: built-in catalogs must not live in abstraction folders

Examples:

- built-in agent or skill catalogs belong in `domain/`, `catalog/`, or equivalent preset areas
- they do not belong in `abstractions/`

### Rule D: platform presets must not pretend to be core abstractions

If a file embeds product-flavored presets, rule tables, template sets, or built-in role/agent catalogs, it must be labeled and placed as a catalog or policy, not as a generic abstraction or runtime primitive.

### Rule E: “domain terms present” is not enough by itself

A base-layer file is not automatically invalid just because it contains product terms in one of these forms:

- provenance comments
- compatibility shims
- registry entries for built-in platform presets
- typed identifiers that are intentionally shared across apps

It becomes suspicious only when those terms drive behavior, retention policy, pricing policy, orchestration logic, or hardcoded business workflow.

---

## Content Rules

### Hard prohibition

Files in base layers must not:

- import upward into `ai-app`
- re-export from `ai-app`
- embed app-only orchestration logic while claiming to be platform primitives

### Domain leakage indicators

A file must be marked `domain-leakage` or `manual-review` if it contains:

- product-specific flow names
- app-specific mission semantics
- product-specific storage or pricing rules
- one-off business templates
- product-only role or stage handling

Historical provenance comments are allowed.
Functional domain ownership is not.

---

## Execution Procedure

Every cleanup wave must follow this order:

1. Run the machine audit script.
2. Export the file inventory and anomaly list.
3. Review each flagged file and assign ownership plus action.
4. Apply changes in dependency order:
   - `platform` (L1, formerly ai-infra)
   - `ai-engine`
   - `ai-harness`
5. Re-run:
   - type-check
   - architecture verification
   - governance audit
6. Update the audit document with:
   - what was fixed
   - what remains
   - why remaining exceptions are acceptable or deferred

---

## Automation Requirement

Base-layer governance is not optional review work.

The repository must maintain a machine audit entrypoint that:

- inventories production files
- flags filename violations
- flags suspicious domain terms in base layers
- flags direct or indirect upward dependency markers
- outputs a reviewable report

Human review still decides final ownership, but machine audit must always run first.
