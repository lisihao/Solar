/**
 * dimension-grade.helper 单测 —— 从 god-class 抽出的逐维 grade 纯计算。
 * 锁定：overall 归一化、grade A/B/C/D/F 边界、summary 合成优先级、S3 失败路径(output=undefined)。
 */
import {
  computeDimensionGrades,
  type DimensionOutcomeLite,
} from "../dimension-grade.helper";

const outcome = (
  over: Partial<DimensionOutcomeLite> = {},
): DimensionOutcomeLite => ({
  dimensionName: "半导体供应链",
  dimensionId: "dim-1",
  state: "completed",
  findingsCount: 8,
  ...over,
});

describe("computeDimensionGrades", () => {
  it("completed+accept：overall=60+min(findings*5,40)，grade 随分落档", () => {
    const [g] = computeDimensionGrades([outcome({ findingsCount: 8 })], {
      perDimension: [{ dimensionId: "dim-1", action: "accept" }],
    });
    expect(g.overall).toBe(100); // 60 + min(40,40)
    expect(g.grade).toBe("A");
    expect(g.state).toBe("completed");
    expect(g.action).toBe("accept");
  });

  it("findings 少时 overall 落 C/B 档（边界）", () => {
    const [c] = computeDimensionGrades([outcome({ findingsCount: 0 })], {
      perDimension: [{ dimensionId: "dim-1", action: "accept" }],
    });
    expect(c.overall).toBe(60);
    expect(c.grade).toBe("C"); // >=60
    const [b] = computeDimensionGrades([outcome({ findingsCount: 3 })], {
      perDimension: [{ dimensionId: "dim-1", action: "accept" }],
    });
    expect(b.overall).toBe(75);
    expect(b.grade).toBe("B"); // >=75
  });

  it("degraded→overall=50/grade D；failed→overall=30/grade F，summary 各自合成", () => {
    const [d] = computeDimensionGrades([outcome({ state: "degraded" })], {});
    expect(d.overall).toBe(50);
    expect(d.grade).toBe("D");
    expect(d.summary).toContain("退化");
    const [f] = computeDimensionGrades([outcome({ state: "failed" })], {});
    expect(f.overall).toBe(30);
    expect(f.grade).toBe("F");
    expect(f.summary).toContain("失败");
  });

  it("leader 逐维 critique 优先于合成 summary（截断 200）", () => {
    const critique = "x".repeat(300);
    const [g] = computeDimensionGrades([outcome()], {
      perDimension: [{ dimensionId: "dim-1", action: "accept", critique }],
    });
    expect(g.summary).toHaveLength(200);
  });

  it("S3 失败路径 output=undefined 不抛，按状态合成（action 回退）", () => {
    const [g] = computeDimensionGrades(
      [outcome({ state: "failed", findingsCount: 0 })],
      undefined,
    );
    expect(g.action).toBe("retry-with-critique");
    expect(g.grade).toBe("F");
    expect(g.summary).toContain("失败");
  });

  it("空输入返回空数组", () => {
    expect(computeDimensionGrades([], {})).toEqual([]);
  });
});
