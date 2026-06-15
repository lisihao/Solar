import { CriticVerdictSchema } from "../playground.event-schemas";

/**
 * 回归锁：critic:verdict.warnings 是结构化条目（{ kind, message, severity }），
 * 不是 string[]。生产方 s9-reviewer-critic-l4.stage + deep-insight-stage-bindings
 * 均 emit 对象数组；旧 schema z.array(z.string()) 会让 EventBus safeParse 失败 →
 * 整个 critic:verdict 事件被丢 → 前端 critic 盲点 todos 缺失。
 */
describe("CriticVerdictSchema — warnings 结构化条目", () => {
  // 镜像 s9-reviewer-critic-l4.stage.ts:161-177 / deep-insight-stage-bindings.ts:1245-1261
  const realProducerPayload = {
    verdict: "concerns",
    overall: "concerns",
    blindspotCount: 2,
    biasCount: 1,
    suggestionCount: 1,
    rationale: "样本理由",
    warnings: [
      { kind: "l4-blindspot", message: "漏掉了竞品视角", severity: "warning" },
      { kind: "l4-bias", message: "措辞偏乐观", severity: "warning" },
      { kind: "l4-suggestion", message: "补充时间线", severity: "info" },
    ],
  };

  it("接受生产方真实对象数组 warnings（含 verdict/overall 等透传字段）", () => {
    const parsed = CriticVerdictSchema.safeParse(realProducerPayload);
    expect(parsed.success).toBe(true);
  });

  it("空 warnings 与缺省 warnings 都合法", () => {
    expect(CriticVerdictSchema.safeParse({ warnings: [] }).success).toBe(true);
    expect(CriticVerdictSchema.safeParse({}).success).toBe(true);
  });
});
