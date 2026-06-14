/**
 * playground.config spec
 *
 * 验证：
 *   1. PLAYGROUND_PIPELINE 14 step 顺序 + primitive id 与 v5.1 §5 映射对齐
 *   2. 8 role + 每 role.skillSpec 从 SKILL.md 加载（systemPrompt 非空 / id 正确）
 *   3. registry.register 不抛错（所有 primitive id 解析得到）
 *
 * R2-C 单轨化 (2026-05-04) 后：删除 PlaygroundRuntimeFlagService 相关 spec，
 * pipeline-v1 是唯一路径。
 */
import { MissionPipelineRegistry } from "@/modules/ai-harness/facade";
import { PLAYGROUND_PIPELINE } from "../runtime/playground.config";

describe("PLAYGROUND_PIPELINE (v5.1 R2-A.0)", () => {
  it("pipeline id == playground", () => {
    expect(PLAYGROUND_PIPELINE.id).toBe("playground");
  });

  // ★ 2026-05-06 (A-7): S12 self-evolution 从 pipeline.steps 移出，改 fire-and-forget
  //   by dispatcher 在 mission terminal 后单独触发，emit mission:postlude:* 事件流。
  //   原因：S12 是 best-effort 后置任务（postmortem + memory 索引），不该挂在
  //   stage:lifecycle 上让前端误以为是 mission 一部分进度。
  it("13 个 step（A-7 后 S12 移出走 fire-and-forget）", () => {
    expect(PLAYGROUND_PIPELINE.steps).toHaveLength(13);
    expect(PLAYGROUND_PIPELINE.steps.map((s) => s.id)).toEqual([
      "s1-budget",
      "s2-leader-plan",
      "s3-researcher-collect",
      "s4-leader-assess",
      "s5-reconciler",
      "s6-analyst",
      "s7-writer-outline",
      "s8-writer",
      "s8b-quality-enhancement",
      "s9-critic",
      "s9b-objective-eval",
      "s10-leader-foreword-signoff",
      "s11-persist",
    ]);
  });

  it("step → primitive 映射正确", () => {
    const map = Object.fromEntries(
      PLAYGROUND_PIPELINE.steps.map((s) => [s.id, s.primitive]),
    );
    expect(map["s1-budget"]).toBe("persist");
    expect(map["s2-leader-plan"]).toBe("plan");
    expect(map["s3-researcher-collect"]).toBe("research");
    expect(map["s4-leader-assess"]).toBe("assess");
    expect(map["s5-reconciler"]).toBe("synthesize");
    expect(map["s6-analyst"]).toBe("synthesize");
    expect(map["s7-writer-outline"]).toBe("draft");
    expect(map["s8-writer"]).toBe("draft");
    expect(map["s8b-quality-enhancement"]).toBe("review");
    expect(map["s9-critic"]).toBe("review");
    expect(map["s9b-objective-eval"]).toBe("review");
    expect(map["s10-leader-foreword-signoff"]).toBe("signoff");
    expect(map["s11-persist"]).toBe("persist");
    // s12-self-evolution 已 A-7 移出 pipeline.steps，dispatcher fire-and-forget
  });

  it("8 role 全部声明 + skillSpec 从 SKILL.md 加载", () => {
    expect(PLAYGROUND_PIPELINE.roles).toHaveLength(8);
    const roleIds = PLAYGROUND_PIPELINE.roles.map((r) => r.id).sort();
    expect(roleIds).toEqual([
      "analyst",
      "leader",
      "reconciler",
      "researcher",
      "reviewer",
      "steward",
      "verifier",
      "writer",
    ]);
    for (const role of PLAYGROUND_PIPELINE.roles) {
      expect(role.skillSpec.id).toBe(`playground.${role.id}`);
      expect(role.skillSpec.systemPrompt.length).toBeGreaterThan(100);
      expect(role.skillSpec.allowedModels.length).toBeGreaterThan(0);
    }
  });

  it("leader 是 stateful（plan/assess/foreword/signoff 4 milestone 跨 stage 累计 decisions）", () => {
    const leader = PLAYGROUND_PIPELINE.roles.find((r) => r.id === "leader");
    expect(leader?.stateful).toBe(true);
  });

  it("registry.register 不抛错（primitive id + role id 全可解析）", () => {
    const registry = new MissionPipelineRegistry();
    expect(() => registry.register(PLAYGROUND_PIPELINE)).not.toThrow();
    expect(registry.has("playground")).toBe(true);
  });

  it("meta 含 eventPrefix + runtimeVersion 元数据", () => {
    expect(PLAYGROUND_PIPELINE.meta?.eventPrefix).toBe("playground");
    expect(PLAYGROUND_PIPELINE.meta?.runtimeVersion).toBe("pipeline-v1");
  });
});

// ★ R2-C 单轨化 (2026-05-04)：删除 PlaygroundRuntimeFlagService describe 块。
//   pipeline-v1 是唯一 mission 路径，无 flag 可控。
