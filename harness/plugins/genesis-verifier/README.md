# Genesis Verifier Plugin

Phase 1 imports GenesisPod as an isolated verifier sidecar for Solar-Harness.

This plugin only migrates the rule mechanism:

- documented rules
- machine-readable rule/spec execution
- local verifier hook
- CI gate report
- exception register
- baseline ratchet contract

It intentionally does not migrate GenesisPod multi-agent execution, mission runtime,
UI discipline, tool categories, or product-domain documentation coverage.

## Runtime Boundary

GenesisPod stays under `harness/plugins/genesis-verifier/vendor/GenesisPod`.
Node, Jest, ESLint, lockfiles, and generated raw test output must stay in this
plugin boundary. Solar core invokes the sidecar through:

```bash
solar-harness verify genesis-seed --json
solar-harness verify changed --json
solar-harness verify ci --json --out reports/verifier/ci.json
solar-harness verify ratchet-baseline --json
solar-harness verify explain genesis.arch.layer_boundaries
```

The Solar adapter emits `solar.verifier.result.v1` and first-phase gates are
warn-only.

`harness/verifier/genesis-policy.yaml` exposes the phase-2 blocker switch. Keep
rules in `warn` until a reviewed baseline ratchet has passed and the team is
ready to block dispatch/CI on that rule.
