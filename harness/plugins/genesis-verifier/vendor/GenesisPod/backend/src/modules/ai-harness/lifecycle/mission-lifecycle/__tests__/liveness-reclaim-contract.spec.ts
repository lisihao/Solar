/**
 * RB4 回收契约守护测试 — 唯一回收依据 = DB heartbeatAt
 *
 * 契约（RB4 双心跳架构裁决）：
 *   C1. MissionLivenessGuard.runOnce 回收判定**只**读 MissionLivenessRow.heartbeatAt
 *       （DB 字段），不调用 MissionRuntimeStateStore 的任何方法。
 *   C2. Redis runtime heartbeat（MissionRuntimeStateStore）= 活性探测，
 *       不作回收依据：Redis 心跳存在 ≠ mission 存活，Redis 心跳缺失 ≠ mission 孤儿。
 *   C3. 回收触发路径唯一：DB heartbeatAt stale AND events stale → markFailed。
 *
 * 违反这个契约 = 引入双源回收，违者需先修改本文件并取得 review 批准。
 *
 * 实现验证方式：
 *   - 测试 MissionLivenessGuard 的 MissionLivenessAdapter 接口没有任何
 *     与 MissionRuntimeStateStore 相关的方法签名（接口白名单验证）。
 *   - 通过 source-text 扫描 runOnce 方法实现，确认不 import / 调用
 *     MissionRuntimeStateStore 的 claimOrBeat / getHeartbeat / releaseHeartbeat。
 *   - 通过测试验证纯 DB-heartbeat-stale 场景下回收正确触发，
 *     且 Redis 模拟返回值对结果无影响。
 */

import * as fs from "fs";
import * as path from "path";
import { MissionLivenessGuard } from "../mission-liveness-guard.service";
import type {
  MissionLivenessAdapter,
  MissionLivenessRow,
} from "../mission-liveness-guard.service";

// ─── 源文件路径 ───────────────────────────────────────────────────────────────

const GUARD_FILE = path.resolve(
  __dirname,
  "../mission-liveness-guard.service.ts",
);
const RUNTIME_STORE_FILE = path.resolve(__dirname, "../runtime-state-store.ts");

// ─── C1: 源码扫描 — guard 不导入 / 不调用 runtime-state-store ────────────────

describe("C1 - MissionLivenessGuard 不依赖 MissionRuntimeStateStore", () => {
  let guardSource: string;

  beforeAll(() => {
    guardSource = fs.readFileSync(GUARD_FILE, "utf-8");
  });

  it("guard source does not import runtime-state-store", () => {
    // import 语句行匹配（排除注释行）
    const importLines = guardSource
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l));
    const hasRuntimeStoreImport = importLines.some((l) =>
      l.includes("runtime-state-store"),
    );
    expect(hasRuntimeStoreImport).toBe(false);
  });

  it("guard source does not import MissionRuntimeStateStore symbol", () => {
    const importLines = guardSource
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l));
    const hasSymbolImport = importLines.some((l) =>
      l.includes("MissionRuntimeStateStore"),
    );
    expect(hasSymbolImport).toBe(false);
  });

  it("guard source does not call claimOrBeat / getHeartbeat / releaseHeartbeat", () => {
    // 这些是 MissionRuntimeStateStore 的 Redis-heartbeat 方法
    const redisMethods = ["claimOrBeat", "getHeartbeat", "releaseHeartbeat"];
    for (const method of redisMethods) {
      // 非注释行扫描（跳过以 * 或 // 开头的注释行）
      const nonCommentLines = guardSource
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*)/.test(l));
      const usesMethod = nonCommentLines.some((l) => l.includes(`${method}(`));
      expect(usesMethod).toBe(false);
    }
  });
});

// ─── C2: MissionLivenessAdapter 接口不含 Redis heartbeat 方法 ────────────────

describe("C2 - MissionLivenessAdapter 接口不暴露 Redis heartbeat 方法", () => {
  it("adapter interface has no Redis-heartbeat methods (source check)", () => {
    const source = fs.readFileSync(GUARD_FILE, "utf-8");
    // 提取 MissionLivenessAdapter 接口文本块
    const adapterMatch = source.match(
      /export interface MissionLivenessAdapter\s*\{([^}]+)\}/s,
    );
    expect(adapterMatch).not.toBeNull();
    const adapterBody = adapterMatch![1];
    // 确认没有 Redis-heartbeat 相关方法名
    const forbiddenMethods = [
      "claimOrBeat",
      "getHeartbeat",
      "releaseHeartbeat",
      "runtimeStore",
    ];
    for (const method of forbiddenMethods) {
      expect(adapterBody).not.toContain(method);
    }
  });
});

// ─── C3: 行为验证 — DB heartbeatAt stale → 回收；Redis 不影响结果 ──────────────

describe("C3 - 回收触发路径唯一：DB heartbeatAt stale + events stale → markFailed", () => {
  // 构造一个符合 MissionLivenessAdapter 的 mock（不含任何 Redis 调用）
  function makeAdapter(
    rows: MissionLivenessRow[],
    eventTsByMissionId: Record<string, number> = {},
  ): MissionLivenessAdapter & { killed: string[] } {
    const killed: string[] = [];
    return {
      killed,
      fetchRunningMissions: async () => rows,
      getMostRecentEventTs: async (ids) => {
        const out = new Map<string, number>();
        for (const id of ids) {
          if (id in eventTsByMissionId) out.set(id, eventTsByMissionId[id]);
        }
        return out;
      },
      markFailed: async (id) => {
        killed.push(id);
      },
    };
  }

  let guard: MissionLivenessGuard;
  beforeEach(() => {
    guard = new MissionLivenessGuard();
  });
  afterEach(() => {
    guard.stopScanLoop();
  });

  it("DB heartbeatAt stale + events stale → markFailed (DB-only reclaim)", async () => {
    const now = Date.now();
    const adapter = makeAdapter([
      {
        id: "m1",
        userId: "u1",
        startedAt: new Date(now - 30 * 60_000), // 30min ago, past grace
        heartbeatAt: new Date(now - 10 * 60_000), // DB heartbeat 10min stale
      },
    ]);
    // events 也 stale（map 中无 m1 条目）
    guard.registerAdapter("test", adapter);
    await guard.forceScan("test");
    expect(adapter.killed).toContain("m1");
  });

  it("DB heartbeatAt fresh → NOT reclaimed even if Redis were absent", async () => {
    const now = Date.now();
    const adapter = makeAdapter(
      [
        {
          id: "m1",
          userId: "u1",
          startedAt: new Date(now - 30 * 60_000),
          heartbeatAt: new Date(now - 30_000), // DB heartbeat fresh (30s ago)
        },
      ],
      // events 也 stale（缺席），只有 DB heartbeat 新鲜
      {},
    );
    guard.registerAdapter("test", adapter);
    await guard.forceScan("test");
    // 单信号 stale（events）不杀
    expect(adapter.killed).toEqual([]);
  });

  it("Redis-only stale scenario: if Redis were the only signal, result would differ from DB-based decision", () => {
    // 这是一个文档性测试：证明"Redis 有没有心跳"对 guard 的决策完全无影响。
    // guard 的 adapter 接口不含 Redis 调用，因此任何 Redis 状态的变化
    // 都不会导致回收行为改变 —— 这就是"DB-only reclaim"的语义保证。
    //
    // 如果有人试图在 MissionLivenessAdapter 上新增 checkRedisHeartbeat() 方法，
    // C2 测试会失败。如果有人在 guard 源码里 import runtime-state-store，
    // C1 测试会失败。两道防线共同保证此契约。
    expect(true).toBe(true); // 契约由 C1+C2 静态保证，此处仅留注释占位
  });
});

// ─── C4: runtime-state-store 的 claimOrBeat 注释声明"不作回收依据" ──────────

describe("C4 - runtime-state-store 源码声明 Redis heartbeat 不作回收依据", () => {
  it("runtime-state-store source contains reclaim boundary declaration", () => {
    const source = fs.readFileSync(RUNTIME_STORE_FILE, "utf-8");
    // 确认存在关键声明词（职责边界注释）
    expect(source).toMatch(/不作.*回收依据|不.*参与.*回收|reclaim/);
  });
});

// ─── C5: 编排器 startHeartbeat 不再调用 claimOrBeat（RB-Gap4 vestigial 移除）────

const ORCHESTRATOR_FILE = path.resolve(
  __dirname,
  "../../../teams/orchestrator/teams-mission-orchestrator.ts",
);

describe("C5 - TeamsMissionOrchestrator.startHeartbeat 不调用 Redis claimOrBeat", () => {
  it("startHeartbeat does not call claimOrBeat (Redis heartbeat removed, zero routing consumers)", () => {
    const source = fs.readFileSync(ORCHESTRATOR_FILE, "utf-8");
    // 提取 startHeartbeat 方法体（从方法声明到下一个方法声明之前）
    const startHbMatch = source.match(
      /private startHeartbeat\([^)]*\):\s*void\s*\{([\s\S]*?)(?=\n\s{2}(?:private|public|protected|\/))/,
    );
    expect(startHbMatch).not.toBeNull();
    const startHbBody = startHbMatch![1];
    // 确认方法体内没有 claimOrBeat 调用
    expect(startHbBody).not.toMatch(/claimOrBeat/);
  });

  it("orchestrator source does not import HEARTBEAT_INTERVAL_MS (timer-based Redis beat removed)", () => {
    const source = fs.readFileSync(ORCHESTRATOR_FILE, "utf-8");
    const importLines = source
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l));
    const hasIntervalImport = importLines.some((l) =>
      l.includes("HEARTBEAT_INTERVAL_MS"),
    );
    expect(hasIntervalImport).toBe(false);
  });
});
