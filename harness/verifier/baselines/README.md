# Solar Verifier Baselines

This directory anchors the phase 1 baseline ratchet contract for GenesisPod
rule migration.

CI may check drift and emit `solar.verifier.result.v1`, but phase 1 must not
modify or bless a new baseline implicitly. Any ratchet must be an explicit
reviewed change.
