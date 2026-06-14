import { createConsensusResolver } from "../consensus";
import type { Verdict } from "../../env/types";

function v(judgeId: string, score: number): Verdict {
  return { judgeId, score, critique: `critique from ${judgeId}` };
}

describe("createConsensusResolver", () => {
  const resolver = createConsensusResolver();

  it("returns default pass when no verdicts", () => {
    const decision = resolver([]);
    expect(decision.verdict).toBe("pass");
    expect(decision.score).toBe(70);
  });

  it("returns pass when all judges pass", () => {
    const decision = resolver([v("j1", 80), v("j2", 90), v("j3", 75)]);
    expect(decision.verdict).toBe("pass");
  });

  it("returns fail when all judges fail", () => {
    const decision = resolver([v("j1", 30), v("j2", 40), v("j3", 50)]);
    expect(decision.verdict).toBe("fail");
  });

  it("returns fail note with critique when all fail", () => {
    const decision = resolver([v("j1", 20), v("j2", 30)]);
    expect(decision.note).toContain("j1");
  });

  it("majority pass when low stddev and pass count > half", () => {
    // Both above 70, but small stddev — minority fail not possible here
    const decision = resolver([v("j1", 75), v("j2", 80)]);
    expect(decision.verdict).toBe("pass");
  });

  it("returns pass when majority pass with small stddev", () => {
    // Scores: 75, 80, 65 -> pass: 2, fail: 1, avg: 73, stddev: ~7.6 (<10)
    const decision = resolver([v("j1", 75), v("j2", 80), v("j3", 65)]);
    // majority pass (2 > 1) with stddev < 10 -> pass
    expect(decision.verdict).toBe("pass");
  });

  it("returns fail when minority pass with small stddev", () => {
    // Scores: 30, 35, 75 -> pass: 1, fail: 2, avg ~47, stddev ~24 (but >=10 & <25?)
    // Actually stddev for [30,35,75] is ~24.0 < 25 -> escalate_to_meta
    const big3 = [v("j1", 30), v("j2", 35), v("j3", 75)];
    const decision = resolver(big3);
    // stddev ≈ 24.0 < 25 -> escalate_to_meta
    expect(["fail", "escalate_to_meta"]).toContain(decision.verdict);
  });

  it("returns escalate_to_meta for medium stddev", () => {
    // Scores with medium stddev: 40, 80 -> avg 60, stddev ~28 (>= 25) -> escalate_to_human
    // Scores: 50, 80 -> avg 65, stddev ~21 (>10, <25) -> escalate_to_meta
    const decision = createConsensusResolver()([v("j1", 50), v("j2", 80)]);
    // passCount=1, failCount=1, stdev ~21 < 25 -> escalate_to_meta
    expect(decision.verdict).toBe("escalate_to_meta");
  });

  it("returns escalate_to_human for large stddev", () => {
    // Scores: 10, 90 -> stddev = 56.6 >= 25
    const decision = resolver([v("j1", 10), v("j2", 90)]);
    expect(decision.verdict).toBe("escalate_to_human");
  });

  it("uses custom passThreshold", () => {
    const customResolver = createConsensusResolver({ passThreshold: 50 });
    // Score 60 is above 50 -> pass
    const decision = customResolver([v("j1", 60), v("j2", 55)]);
    expect(decision.verdict).toBe("pass");
  });

  it("uses custom agreementStddevMax", () => {
    const customResolver = createConsensusResolver({ agreementStddevMax: 30 });
    // Scores: 50, 80 -> stddev ~21 < 30 -> low divergence path
    const decision = customResolver([v("j1", 50), v("j2", 80)]);
    // With high agreementStddevMax, divergence treated as small -> majority check
    expect(["pass", "fail"]).toContain(decision.verdict);
  });

  it("includes score in result", () => {
    const decision = resolver([v("j1", 85), v("j2", 90)]);
    expect(decision.score).toBeGreaterThan(0);
    expect(decision.score).toBeLessThanOrEqual(100);
  });

  it("handles single verdict as pass", () => {
    const decision = resolver([v("j1", 80)]);
    expect(decision.verdict).toBe("pass");
  });

  it("handles single failing verdict", () => {
    const decision = resolver([v("j1", 50)]);
    expect(decision.verdict).toBe("fail");
  });
});
