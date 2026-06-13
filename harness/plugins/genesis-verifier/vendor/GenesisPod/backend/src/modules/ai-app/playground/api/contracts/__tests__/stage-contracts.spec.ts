/**
 * Stage→Agent 数值契约 —— 系统级强制测试（2026-05-22 ③ 专项）
 *
 * 遍历 STAGE_NUMBER_CONTRACTS 注册表，对每条边界机械断言"生产方范围 ⊆ 消费方 agent
 * inputSchema"。任一边漂移（管线 clamp 改了、或 agent schema 收紧了）此测试即红，
 * 漂移合不进主干 —— 这是"不允许违反契约、防腐朽"的单一执行点。
 */

import { assertNumberProducerWithinSchema } from "../../../../../ai-harness/agents/dev-tools";
import { STAGE_NUMBER_CONTRACTS } from "../stage-contracts.registry";

describe("stage→agent 数值契约（系统级强制）", () => {
  it("注册表非空（防止有人误删所有边界后测试空转通过）", () => {
    expect(STAGE_NUMBER_CONTRACTS.length).toBeGreaterThan(0);
  });

  it.each(STAGE_NUMBER_CONTRACTS.map((c) => [c.field, c] as const))(
    "%s: 生产方范围 ⊆ 消费方 agent schema",
    (_field, contract) => {
      const r = assertNumberProducerWithinSchema({
        agent: contract.agent,
        field: contract.field,
        producerMin: contract.producerMin,
        producerMax: contract.producerMax,
      });
      // 漂移时 r.reason 指明哪边超界 + 注册表 note 指明生产方位置
      expect(r.ok ? "" : `${r.reason} | producer: ${contract.note}`).toBe("");
      expect(r.ok).toBe(true);
    },
  );
});
