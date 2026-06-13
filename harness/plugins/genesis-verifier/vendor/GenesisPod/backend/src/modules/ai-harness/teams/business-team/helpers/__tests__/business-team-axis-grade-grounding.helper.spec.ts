import { groundMultiAxisGrade } from "../business-team-axis-grade-grounding.helper";

function makeGrade(
  axes: Record<string, number>,
  overall = 99,
  grade = "excellent",
) {
  return {
    overall,
    grade,
    axes: Object.fromEntries(
      Object.entries(axes).map(([k, score]) => [k, { score, comment: "" }]),
    ) as Record<string, { score: number; comment: string }>,
    summary: "",
  };
}

describe("groundMultiAxisGrade — defaults match the original groundDimensionGrade", () => {
  it("recomputes overall as mean of axes, discarding LLM verbatim", () => {
    const g = makeGrade(
      {
        breadth: 60,
        depth: 60,
        evidence: 60,
        coherence: 60,
        freshness: 60,
        sources_sufficiency: 60,
      },
      85, // LLM verbatim — must be discarded
      "excellent",
    );
    groundMultiAxisGrade(g, 10); // supplyCeil = 200 → clamped to 100 → 60 unchanged
    expect(g.overall).toBe(60);
    expect(g.grade).toBe("fair");
  });

  it("caps sources_sufficiency by measuredSupply (1 source → ceil 20)", () => {
    const g = makeGrade(
      {
        breadth: 80,
        depth: 80,
        evidence: 80,
        coherence: 80,
        freshness: 80,
        sources_sufficiency: 90,
      },
      90,
    );
    groundMultiAxisGrade(g, 1);
    expect(g.axes.sources_sufficiency.score).toBe(20);
    expect(g.overall).toBe(70); // (80*5 + 20)/6
    expect(g.grade).toBe("good");
  });

  it("single-source shallow dim cannot fake a passing grade (anti-fake-success)", () => {
    const g = makeGrade(
      {
        breadth: 60,
        depth: 55,
        evidence: 70,
        coherence: 75,
        freshness: 80,
        sources_sufficiency: 95,
      },
      88,
    );
    groundMultiAxisGrade(g, 1);
    expect(g.overall).toBe(60);
    expect(g.grade).toBe("fair");
  });

  it("4 sources → ceil 80, does not over-penalize a healthy multi-source dim", () => {
    const g = makeGrade(
      {
        breadth: 85,
        depth: 85,
        evidence: 85,
        coherence: 85,
        freshness: 85,
        sources_sufficiency: 85,
      },
      85,
    );
    groundMultiAxisGrade(g, 4);
    expect(g.overall).toBe(84);
    expect(g.grade).toBe("excellent");
  });

  it("no axes → leaves overall untouched", () => {
    const g = makeGrade({}, 50, "fair");
    groundMultiAxisGrade(g, 3);
    expect(g.overall).toBe(50);
  });
});

describe("groundMultiAxisGrade — parameterized for other teams", () => {
  it("custom supplyAxisKey caps that axis only", () => {
    const g = makeGrade({
      readiness: 90,
      platform_reach: 95,
      polish: 80,
    });
    // Cap platform_reach by 1-platform supply, multiplier 10 → ceil 10
    groundMultiAxisGrade(g, 1, {
      supplyAxisKey: "platform_reach",
      supplyMultiplier: 10,
    });
    expect(g.axes.platform_reach.score).toBe(10);
    expect(g.axes.readiness.score).toBe(90); // untouched
    expect(g.overall).toBe(60); // (90 + 10 + 80) / 3
  });

  it("missing supply axis → no-op, overall still recomputed from mean", () => {
    const g = makeGrade({ a: 70, b: 50 });
    groundMultiAxisGrade(g, 99, { supplyAxisKey: "does_not_exist" });
    expect(g.overall).toBe(60);
  });

  it("custom gradeBuckets remap the label", () => {
    const g = makeGrade({ a: 75, b: 75 });
    groundMultiAxisGrade(g, 5, {
      gradeBuckets: [
        { minScore: 90, grade: "S" },
        { minScore: 70, grade: "A" },
        { minScore: 0, grade: "B" },
      ],
    });
    expect(g.overall).toBe(75);
    expect(g.grade).toBe("A");
  });

  it("negative measuredSupply is clamped to 0 (ceil = 0 — kills the axis)", () => {
    const g = makeGrade({ x: 80, sources_sufficiency: 80 });
    groundMultiAxisGrade(g, -5);
    expect(g.axes.sources_sufficiency.score).toBe(0);
    expect(g.overall).toBe(40);
  });

  it("supplyMultiplier 0 disables supply capping entirely", () => {
    const g = makeGrade({ supply: 95, other: 95 });
    groundMultiAxisGrade(g, 1, {
      supplyAxisKey: "supply",
      supplyMultiplier: 0,
    });
    expect(g.axes.supply.score).toBe(0); // 1 * 0 = 0
  });
});
