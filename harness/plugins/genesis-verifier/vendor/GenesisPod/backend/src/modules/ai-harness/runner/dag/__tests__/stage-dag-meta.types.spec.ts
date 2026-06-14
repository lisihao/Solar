/**
 * stage-dag-meta.types spec —— PR-R1 自洽校验
 *
 * 上游：docs/architecture/ai-harness/runner/per-task-rerun-with-cascade.md v1.2 §3.1 §8.1
 *
 * 反向证据（PR-R1）：
 *   - validateStageDag: successors 都是合法 step / rerunableReason 必填 / 无环
 *   - computeCascadeChain: 含起点 + successors + 终态空链
 *   - collectResetFieldsForCascade: 整链 union 不重复
 */

import {
  validateStageDag,
  computeCascadeChain,
  collectResetFieldsForCascade,
  type StageDagMeta,
} from "../stage-dag-meta.types";

const buildStep = (id: string, dag?: StageDagMeta) => ({ id, dag });

describe("validateStageDag", () => {
  it("happy path: 合法 DAG 无 issues", () => {
    const steps = [
      buildStep("a", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: ["b"],
        rerunable: true,
      }),
      buildStep("b", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: [],
        rerunable: true,
      }),
    ];
    expect(validateStageDag(steps)).toEqual([]);
  });

  it("successors 引用不存在的 step → 返回 issue", () => {
    const steps = [
      buildStep("a", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: ["does-not-exist"],
        rerunable: true,
      }),
    ];
    const issues = validateStageDag(steps);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("does-not-exist");
  });

  it("rerunable=false 但缺 rerunableReason → 返回 issue", () => {
    const steps = [
      buildStep("a", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: [],
        rerunable: false,
      }),
    ];
    const issues = validateStageDag(steps);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues[0]).toContain("rerunableReason");
  });

  it("successor 引用更早 step → 检测出 cycle/back-edge", () => {
    // 数组顺序：a(idx 0), b(idx 1)；b 的 successor 是 a → succIdx(0) <= myIdx(1) → back-edge
    const steps = [
      buildStep("a", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: [],
        rerunable: true,
      }),
      buildStep("b", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: ["a"], // back-edge: a 在 b 之前
        rerunable: true,
      }),
    ];
    const issues = validateStageDag(steps);
    expect(issues.some((i) => i.includes("cycle"))).toBe(true);
  });

  it("successor 自指（self-loop）也是 cycle", () => {
    const steps = [
      buildStep("a", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: ["a"], // 自指
        rerunable: true,
      }),
    ];
    const issues = validateStageDag(steps);
    expect(issues.some((i) => i.includes("cycle"))).toBe(true);
  });

  it("无 dag 字段的 step 不参与校验", () => {
    const steps = [
      buildStep("a"), // 无 dag
      buildStep("b", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: [],
        rerunable: true,
      }),
    ];
    expect(validateStageDag(steps)).toEqual([]);
  });
});

describe("computeCascadeChain", () => {
  const steps = [
    buildStep("a", {
      ctxReads: [],
      ctxWrites: [],
      dbWrites: [],
      successors: ["b", "c"],
      rerunable: true,
    }),
    buildStep("b", {
      ctxReads: [],
      ctxWrites: [],
      dbWrites: [],
      successors: ["c"],
      rerunable: true,
    }),
    buildStep("c", {
      ctxReads: [],
      ctxWrites: [],
      dbWrites: [],
      successors: [],
      rerunable: true,
    }),
  ];

  it("含起点 + 所有 successors", () => {
    expect(computeCascadeChain(steps, "a")).toEqual(["a", "b", "c"]);
  });

  it("终态 stage 链只含起点", () => {
    expect(computeCascadeChain(steps, "c")).toEqual(["c"]);
  });

  it("不存在的 stepId 返回空数组", () => {
    expect(computeCascadeChain(steps, "z")).toEqual([]);
  });

  it("无 dag 字段返回空数组", () => {
    const stepsNoDag = [buildStep("x")];
    expect(computeCascadeChain(stepsNoDag, "x")).toEqual([]);
  });
});

describe("collectResetFieldsForCascade", () => {
  it("整链 resetFields 并集（去重）", () => {
    const steps = [
      buildStep("a", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: ["b"],
        rerunable: true,
        resetFields: ["error_message", "completed_at"],
      }),
      buildStep("b", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: [],
        rerunable: true,
        resetFields: ["completed_at", "final_score"], // completed_at 与 a 重复
      }),
    ];
    const fields = collectResetFieldsForCascade(steps, ["a", "b"]);
    expect(new Set(fields)).toEqual(
      new Set(["error_message", "completed_at", "final_score"]),
    );
    expect(fields.length).toBe(3); // 去重后 3 个
  });

  it("无 resetFields 的 stage 不影响结果", () => {
    const steps = [
      buildStep("a", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: [],
        rerunable: true,
      }),
    ];
    expect(collectResetFieldsForCascade(steps, ["a"])).toEqual([]);
  });
});

describe("stateless / Promise.all 并发", () => {
  it("validateStageDag + computeCascadeChain 并发互不污染", async () => {
    const steps = [
      buildStep("a", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: ["b"],
        rerunable: true,
      }),
      buildStep("b", {
        ctxReads: [],
        ctxWrites: [],
        dbWrites: [],
        successors: [],
        rerunable: true,
      }),
    ];
    const [r1, r2, r3] = await Promise.all([
      Promise.resolve(validateStageDag(steps)),
      Promise.resolve(computeCascadeChain(steps, "a")),
      Promise.resolve(computeCascadeChain(steps, "b")),
    ]);
    expect(r1).toEqual([]);
    expect(r2).toEqual(["a", "b"]);
    expect(r3).toEqual(["b"]);
  });
});
