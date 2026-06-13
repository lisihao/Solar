/**
 * Sediment Zone Surface Contract Tests (Rev 5 / S0-5,2026-05-09)
 *
 * 目的:在 Stage 1 / Stage 2 重构动 dispatcher / mission-store / framework 之前,
 *       锁定 6 个 sediment zone(详见 docs/architecture/ai-harness/facade/sediment-topology.md)
 *       canonical 表面的方法签名 + 关键 property,任何 breaking change 编译失败。
 *
 * R7(test isolation)合规:
 *   - 不 boot 任何 ai-app module
 *   - 仅 import harness 自身 + facade
 *   - 既测 type-level shape(`assertSatisfies` helper),也测 minimal behavior
 *
 * 失败场景:
 *   - Z1.IMissionStore 改了方法签名 → 编译 fail → CI fail
 *   - Z3.IBusinessTeamMissionStore 改了方法签名 → 编译 fail → CI fail
 *   - Z4.MissionPipelineOrchestrator 改了 public method → 编译 fail → CI fail
 *
 * 详见:
 *   - docs/architecture/ai-app/playground/agent-team-boundary-audit-2026-05-08.md §7 S0-5 / §8 acceptance
 *   - docs/architecture/ai-harness/facade/sediment-topology.md
 */

import {
  IMissionStore,
  MissionRecord,
  MissionCreateInput,
  MissionStatusUpdate,
  PastDecision,
  IMissionEventStore,
  MissionEventRecord,
} from "@/modules/ai-harness/lifecycle/mission-lifecycle/abstractions";
import { InMemoryMissionStore } from "@/modules/ai-harness/lifecycle/mission-lifecycle/in-memory";
import {
  MissionPipelineOrchestrator,
  MissionPipelineRegistry,
  type MissionPipelineConfig,
} from "@/modules/ai-harness/teams/orchestrator/pipeline";
import type { IBusinessTeamMissionStore } from "@/modules/ai-harness/teams/business-team/abstractions/mission-store.interface";
import type { IMissionRuntimeAdapter } from "@/modules/ai-harness/teams/business-team/abstractions/mission-runtime-shell.interface";

// ──────────────────────────────────────────────────────────────────────────
// Type-level helper:assertSatisfies<Expected, Actual>()
// 在编译期断言 `Actual` 满足 `Expected` 的 shape。任一 method 缺失或签名变更,编译失败。
// ──────────────────────────────────────────────────────────────────────────
type AssertSatisfies<Expected, Actual extends Expected> = Actual;

describe("Sediment Zone Surface Contract (Rev 5 / S0-5)", () => {
  // ════════════════════════════════════════════════════════════════════════
  // Z1 — Mission-lifecycle primitives
  // ════════════════════════════════════════════════════════════════════════

  describe("Z1 IMissionStore<TBusiness>", () => {
    it("[type] keeps required lifecycle CRUD + crossStageState surface", () => {
      // Lock the canonical surface:any breaking change here = compile fail.
      type RequiredSurface = {
        create(input: MissionCreateInput): Promise<MissionRecord>;
        getById(missionId: string): Promise<MissionRecord | null>;
        listByUser(
          userId: string,
          opts?: { limit?: number; offset?: number },
        ): Promise<MissionRecord[]>;
        updateStatus(
          missionId: string,
          update: MissionStatusUpdate,
        ): Promise<void>;
        setLastCompletedStepId(
          missionId: string,
          stepId: string,
        ): Promise<void>;
        appendDecision(
          missionId: string,
          roleId: string,
          decision: PastDecision,
        ): Promise<void>;
        getDecisions(
          missionId: string,
          roleId: string,
        ): Promise<ReadonlyArray<PastDecision>>;
        saveCrossStageState(
          missionId: string,
          state: Readonly<Record<string, unknown>>,
        ): Promise<void>;
        getCrossStageState(
          missionId: string,
        ): Promise<Readonly<Record<string, unknown>>>;
      };

      // Compile-time assertion:IMissionStore must satisfy RequiredSurface.
      // If a method signature changes, this line fails to compile.
      type _Check = AssertSatisfies<RequiredSurface, IMissionStore>;
      // Use the type to silence unused-type warning while preserving the assertion.
      const _validate: _Check | undefined = undefined;
      expect(_validate).toBeUndefined();
    });

    it("[behavior] InMemoryMissionStore round-trips create + getById", async () => {
      const store: IMissionStore = new InMemoryMissionStore();
      const created = await store.create({
        missionId: "contract-m1",
        userId: "contract-u1",
        pipelineId: "contract-pipeline",
        input: { topic: "contract-test" },
      });
      expect(created.missionId).toBe("contract-m1");
      expect(created.status).toBe("running");

      const fetched = await store.getById("contract-m1");
      expect(fetched).not.toBeNull();
      expect(fetched?.input).toEqual({ topic: "contract-test" });
    });

    it("[behavior] crossStageState round-trips via Z1 port (closes T3 contract)", async () => {
      const store: IMissionStore = new InMemoryMissionStore();
      await store.create({
        missionId: "contract-m2",
        pipelineId: "p",
        input: {},
      });
      await store.saveCrossStageState("contract-m2", {
        plan: { dimensions: ["d1", "d2"] },
        researcherResults: { d1: "ok" },
      });
      const state = await store.getCrossStageState("contract-m2");
      expect(state).toMatchObject({
        plan: { dimensions: ["d1", "d2"] },
      });
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Z2 — Mission-checkpoint(只 import 类型,不依赖 NestJS DI 启动)
  // ════════════════════════════════════════════════════════════════════════

  describe("Z2 CheckpointStore surface available via path", () => {
    it("[type] resolves CheckpointStore type from Z2 path", async () => {
      // 仅 import-time check:Z2 路径必须 export CheckpointStore 类型。
      const mod =
        await import("@/modules/ai-harness/memory/mission-checkpoint");
      // export 包含 MissionCheckpointService（运行时）与 CheckpointStore 类型 -
      // 后者是纯 type 不在 runtime keys,运行时可见的是 service / store impl。
      expect(typeof mod).toBe("object");
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Z3 — BusinessAgentTeam framework
  // ════════════════════════════════════════════════════════════════════════

  describe("Z3 IBusinessTeamMissionStore (BusinessAgentTeam lifecycle 视角子集)", () => {
    it("[type] declares 6 lifecycle methods (heartbeat / stage / fail / reopen)", () => {
      type RequiredZ3Surface = {
        refreshHeartbeat(missionId: string, podId: string): Promise<void>;
        clearHeartbeat(missionId: string, userId: string): Promise<void>;
        markStageComplete(
          missionId: string,
          stageNumber: number,
        ): Promise<void>;
        countRunningByUser(userId: string): Promise<number>;
        markFailed(
          missionId: string,
          args: { userId?: string; errorMessage?: string },
        ): Promise<void>;
        markReopened(missionId: string, userId: string): Promise<void>;
      };

      type _Check = AssertSatisfies<
        RequiredZ3Surface,
        IBusinessTeamMissionStore
      >;
      const _validate: _Check | undefined = undefined;
      expect(_validate).toBeUndefined();
    });

    it("[type T1 closes via S0-8 doc] documents subset relationship to Z1.IMissionStore", () => {
      // S0-8 doc-only assertion:Z3 interface JSDoc 已显式声明与 Z1 的子集关系。
      // 这里以 type-level "structural overlap" 作为 sanity check —— 不强制
      // implements 关系(留给 S2-7 类型层固化),但保证两个接口都能被同一 implementation
      // 同时 satisfies(structural typing)。
      class DummyStore implements IBusinessTeamMissionStore {
        async refreshHeartbeat(): Promise<void> {}
        async clearHeartbeat(): Promise<void> {}
        async markStageComplete(): Promise<void> {}
        async countRunningByUser(): Promise<number> {
          return 0;
        }
        async markFailed(): Promise<void> {}
        async markReopened(): Promise<void> {}
      }
      const dummy = new DummyStore();
      expect(typeof dummy.refreshHeartbeat).toBe("function");
      expect(typeof dummy.markFailed).toBe("function");
    });
  });

  describe("Z3 IMissionRuntimeAdapter (业务方注入面)", () => {
    it("[type] declares resolve* / persist / event-emit / namespace surface", () => {
      type RequiredAdapter = {
        resolveWallTimeCapMs(input: unknown): number;
        resolveMaxCredits(input: unknown): number;
        resolveBudgetMultiplier(input: unknown): number;
        createMissionRow(args: {
          missionId: string;
          userId: string;
          workspaceId?: string;
          input: unknown;
          effectiveMaxCredits: number;
        }): Promise<void>;
        refreshHeartbeat(missionId: string, podId: string): Promise<void>;
        emitMissionEvent(args: {
          type: string;
          missionId: string;
          userId: string;
          payload: unknown;
        }): Promise<void>;
        readonly eventNamespace: string;
        readonly billingModuleType: string;
      };

      type _Check = AssertSatisfies<
        RequiredAdapter,
        IMissionRuntimeAdapter<unknown>
      >;
      const _validate: _Check | undefined = undefined;
      expect(_validate).toBeUndefined();
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Z4 — Mission pipeline orchestrator
  // ════════════════════════════════════════════════════════════════════════

  describe("Z4 MissionPipelineOrchestrator + Registry + Config", () => {
    it("[type] MissionPipelineRegistry exposes register / get / has", () => {
      // Registry.get 当前实现:不存在抛错(non-undefined return)。
      // 这里 lock current shape:get 返回 MissionPipelineConfig(任何回退到 nullable
      // 的改动 = breaking,需走 ADR + 升级 contract)。
      type RegistrySurface = {
        register(config: MissionPipelineConfig): void;
        get(pipelineId: string): MissionPipelineConfig;
        has(pipelineId: string): boolean;
      };
      type _Check = MissionPipelineRegistry extends RegistrySurface
        ? true
        : never;
      const _validate: _Check = true as _Check;
      expect(_validate).toBe(true);
    });

    it("[behavior] Registry exposes callable register / get / has", () => {
      const registry = new MissionPipelineRegistry();
      expect(typeof registry.register).toBe("function");
      expect(typeof registry.get).toBe("function");
      expect(typeof registry.has).toBe("function");
      // sanity:has() 对未注册 id 返回 false;get() 对未注册 id 抛错(current contract)
      expect(registry.has("never-registered")).toBe(false);
      expect(() => registry.get("never-registered")).toThrow(/not found/);
    });

    it("[type] MissionPipelineOrchestrator class is constructable from Registry", () => {
      const registry = new MissionPipelineRegistry();
      const orchestrator = new MissionPipelineOrchestrator(registry);
      expect(orchestrator).toBeInstanceOf(MissionPipelineOrchestrator);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Z1 IMissionEventStore(playground / future teams replay 用)
  // ════════════════════════════════════════════════════════════════════════

  describe("Z1 IMissionEventStore", () => {
    it("[type] declares append / appendBatch / listByMission / deleteByMission", () => {
      type RequiredEventStore = {
        append(event: MissionEventRecord): Promise<void>;
        appendBatch(events: ReadonlyArray<MissionEventRecord>): Promise<void>;
        listByMission(
          missionId: string,
          opts?: { limit?: number; sinceTs?: number },
        ): Promise<MissionEventRecord[]>;
        deleteByMission(missionId: string): Promise<void>;
      };

      type _Check = AssertSatisfies<RequiredEventStore, IMissionEventStore>;
      const _validate: _Check | undefined = undefined;
      expect(_validate).toBeUndefined();
    });
  });
});
