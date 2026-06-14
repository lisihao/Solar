/**
 * PlaygroundCrossStageState unit spec(Stage 1 / S1-2,2026-05-09)
 *
 * 验证:
 *   1. 14 个 typed getter/setter delegate 到 Z5 CrossStageState 等价于原 SessionEntry
 *      ad-hoc fields 的 reference semantics(idempotent 关键)
 *   2. JSON 序列化往返 — 为 Stage 2 follow-up(IMissionStore.saveCrossStageState
 *      持久化 / crashed-mission resume)预留契约
 *   3. 同 PlaygroundCrossStageState 实例的不同 key 互不干扰
 *
 * 详见:
 *   - audit Rev 5 §7 S1-2 + §2.5 T3
 *   - sediment-topology.md §5 T3
 */

import { PlaygroundCrossStageState } from "../playground-cross-stage-state";

describe("PlaygroundCrossStageState (Stage 1 / S1-2)", () => {
  describe("getter/setter reference semantics(idempotent 关键)", () => {
    it("set/get 单值往返一致(reference semantics 等价于 ad-hoc field)", () => {
      const state = new PlaygroundCrossStageState();
      const plan = {
        themeSummary: "T",
        dimensions: [{ name: "d1" } as never],
        goals: [],
        initialRisks: [],
      };
      state.lastPlan = plan as never;
      // reference equality:get 返回的是 set 时同一对象引用,后续 mutate 仍可见
      expect(state.lastPlan).toBe(plan);
    });

    it("未 set 的 key 返回 undefined", () => {
      const state = new PlaygroundCrossStageState();
      expect(state.lastPlan).toBeUndefined();
      expect(state.lastResearcherResults).toBeUndefined();
      expect(state.s4PatchFailures).toBeUndefined();
      expect(state.inheritedResearchResults).toBeUndefined();
    });

    it("set undefined 后 get 返回 undefined(覆盖语义)", () => {
      const state = new PlaygroundCrossStageState();
      state.lastReport = { title: "t" } as never;
      expect(state.lastReport).toBeDefined();
      state.lastReport = undefined;
      expect(state.lastReport).toBeUndefined();
    });

    it("不同 keys 互不干扰", () => {
      const state = new PlaygroundCrossStageState();
      const p = { themeSummary: "p" } as never;
      const r = [{ dimension: "d", findings: [], summary: "s" }] as never;
      state.lastPlan = p;
      state.lastResearcherResults = r;
      expect(state.lastPlan).toBe(p);
      expect(state.lastResearcherResults).toBe(r);
      // 写一个不影响另一个
      state.lastPlan = undefined;
      expect(state.lastResearcherResults).toBe(r);
    });
  });

  describe("14 keys 全覆盖(对齐原 SessionEntry fields)", () => {
    it("11 stage 中间产物 + s4PatchFailures + 2 inherited cache 共 14 keys 全 readable/writable", () => {
      const state = new PlaygroundCrossStageState();
      const dummy = { _: 1 } as never;
      // 11 stage 缓存
      state.lastPlan = dummy;
      state.lastResearcherResults = dummy;
      state.lastReconciliationReport = dummy;
      state.lastAnalystOutput = dummy;
      state.lastOutlinePlan = dummy;
      state.lastReport = dummy;
      state.lastReportArtifact = dummy;
      state.lastReviewScore = dummy;
      state.lastVerifierVerdicts = [dummy];
      state.lastLeaderForeword = dummy;
      state.lastLeaderSignOff = dummy;
      // 跨 stage 共享
      state.s4PatchFailures = dummy;
      // trajectory rerun cache
      state.inheritedResearchResults = [
        { dimension: "d", findings: [], summary: "s" },
      ];
      state.inheritedChapters = [
        {
          dimension: "d",
          chapterIndex: 0,
          heading: "h",
          content: "c",
          attempts: 0,
        },
      ];
      // 全部 readable
      expect(state.lastPlan).toBe(dummy);
      expect(state.lastResearcherResults).toBe(dummy);
      expect(state.lastReconciliationReport).toBe(dummy);
      expect(state.lastAnalystOutput).toBe(dummy);
      expect(state.lastOutlinePlan).toBe(dummy);
      expect(state.lastReport).toBe(dummy);
      expect(state.lastReportArtifact).toBe(dummy);
      expect(state.lastReviewScore).toBe(dummy);
      expect(state.lastVerifierVerdicts).toEqual([dummy]);
      expect(state.lastLeaderForeword).toBe(dummy);
      expect(state.lastLeaderSignOff).toBe(dummy);
      expect(state.s4PatchFailures).toBe(dummy);
      expect(state.inheritedResearchResults).toHaveLength(1);
      expect(state.inheritedChapters).toHaveLength(1);
    });
  });

  describe("toJSON / fromJSON 往返(Stage 2 follow-up Z1 持久化预留)", () => {
    it("toJSON 暴露 plain object,fromJSON 重建后 getter 等价", () => {
      const original = new PlaygroundCrossStageState();
      original.lastPlan = {
        themeSummary: "T",
        dimensions: [{ name: "d1" } as never],
        goals: [],
        initialRisks: [],
      } as never;
      original.s4PatchFailures = [{ dim: "d", reason: "r" } as never] as never;

      const json = original.toJSON();
      expect(json).toMatchObject({
        lastPlan: { themeSummary: "T" },
        s4PatchFailures: expect.any(Array),
      });

      const restored = PlaygroundCrossStageState.fromJSON(json);
      // 重建后值等价(structurally equal,但 reference 不同 — JSON roundtrip 已序列化)
      expect(restored.lastPlan).toMatchObject({ themeSummary: "T" });
      expect(restored.s4PatchFailures).toMatchObject([{ dim: "d" }]);
    });

    it("空 state 的 toJSON 返回空 object", () => {
      const state = new PlaygroundCrossStageState();
      expect(state.toJSON()).toEqual({});
    });

    it("fromJSON({}) 创建空 state", () => {
      const state = PlaygroundCrossStageState.fromJSON({});
      expect(state.lastPlan).toBeUndefined();
      expect(state.toJSON()).toEqual({});
    });
  });

  describe("idempotent 行为契约(锁 Stage 1 → Stage 2 重构边界)", () => {
    it("同 PlaygroundCrossStageState 实例的多次 set 等价于 last-write-wins", () => {
      const state = new PlaygroundCrossStageState();
      const a = { v: "a" } as never;
      const b = { v: "b" } as never;
      state.lastPlan = a;
      state.lastPlan = b;
      expect(state.lastPlan).toBe(b);
    });

    it("getter/setter 是 sync(无 Promise / async I/O)— 关键 idempotent 保证", () => {
      const state = new PlaygroundCrossStageState();
      // setter 不返回 Promise(语法上类型已强制,这里 runtime 验证一下)
      const setResult = (state.lastPlan = { themeSummary: "x" } as never);
      // 赋值表达式返回 RHS,不是 Promise
      expect(setResult).not.toBeInstanceOf(Promise);
      // getter 直接返回值,不是 Promise
      expect(state.lastPlan).not.toBeInstanceOf(Promise);
    });
  });
});
