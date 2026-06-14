import { groundDimensionGrade } from "../../artifacts/grade-grounding.util";

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

describe("groundDimensionGrade (review-fix #3 — pure)", () => {
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
    groundDimensionGrade(g, 10); // supplyCeil=100 → sources_sufficiency stays 60
    expect(g.overall).toBe(60); // mean of all-60s, not 85
    expect(g.grade).toBe("fair"); // 50<=60<65
  });

  it("caps sources_sufficiency by uniqueSources (1 source → ceil 20)", () => {
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
    groundDimensionGrade(g, 1); // supplyCeil=20
    expect(g.axes.sources_sufficiency.score).toBe(20);
    expect(g.overall).toBe(70); // (80*5 + 20)/6
    expect(g.grade).toBe("good"); // 65<=70<80
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
    groundDimensionGrade(g, 1); // sources_sufficiency 95→20
    expect(g.overall).toBe(60); // (60+55+70+75+80+20)/6
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
    groundDimensionGrade(g, 4); // supplyCeil=80 → sources_sufficiency 85→80
    expect(g.overall).toBe(84); // round((85*5 + 80)/6)
    expect(g.grade).toBe("excellent"); // >=80
  });

  it("no axes → leaves overall untouched", () => {
    const g = makeGrade({}, 50, "fair");
    groundDimensionGrade(g, 3);
    expect(g.overall).toBe(50);
  });
});
