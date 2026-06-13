# Solar-Harness Exception Register

Every verifier waiver must be recorded here and in
`harness/verifier/waivers.yaml`. Phase 1 gates are warn-only, but unregistered,
expired, or mismatched waivers are still reported.

### E014 GenesisPod Sidecar Dependency Bootstrap

- rule_id: `genesis.runtime.dependency_missing`
- scope: `harness/plugins/genesis-verifier/vendor/GenesisPod/backend`
- owner: `solar-harness`
- expires: `2026-09-30`
- reason: GenesisPod source is vendored first as an isolated TS/Jest sidecar.
  Node/Jest dependencies must not be installed at Solar root and may be installed
  only inside the plugin vendor backend.
