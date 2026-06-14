/**
 * playground-frontend-contract spec —— 后→前 byte-equal 契约守护（v5.1 §3.7 R1-D）
 *
 * 背景：
 *   v5.1 重构期间（R1 → R2-A 双轨 → R2-C 删旧实现）playground 业务事件 type
 *   字符串 / REST 端点路径必须保持完全等于现状。任何改动 = 前端 socket
 *   handler / API client 跑红 = 用户看不到结果。
 *
 * 守护范围：
 *   1. AGENT_PLAYGROUND_EVENTS 注册的全部 event type（list + 元素 byte-equal）
 *   2. AgentPlaygroundController 的 (HTTP method, path) 完整集合
 *
 * 守护方式：
 *   1. 事件：从 playground.events.ts 导入运行时 const，sorted 后与 baseline 数组比对
 *   2. 端点：源码文本正则提取 @Get / @Post / @Patch / @Delete 装饰器 + 路径，
 *      与 baseline 数组比对（避开 Nest reflection 走 DI 导入大依赖树）
 *
 * 改 baseline 时：
 *   - 同步前端 socket handler / API client 改动 PR
 *   - PR 描述写明哪个事件 / 端点变了
 *   - 不允许 sneak-in：本 spec 跑红 = 不能合并
 */
import * as fs from "fs";
import * as path from "path";
import { AGENT_PLAYGROUND_EVENTS } from "../../../modules/ai-app/playground/events/playground.events";

// PR-D god class split (2026-05-15): playground 路由从单一 controller 拆到
// playground.controller.ts + controllers/{base-mission,mission-read,mission-rerun}.controller.ts
const CONTROLLER_FILES: string[] = [
  path.resolve(
    __dirname,
    "../../../modules/ai-app/playground/api/controller/playground.controller.ts",
  ),
  path.resolve(
    __dirname,
    "../../../modules/ai-app/playground/api/controller/base-mission.controller.ts",
  ),
  path.resolve(
    __dirname,
    "../../../modules/ai-app/playground/api/controller/mission-read.controller.ts",
  ),
  path.resolve(
    __dirname,
    "../../../modules/ai-app/playground/api/controller/mission-rerun.controller.ts",
  ),
];

// ── Baseline 1: 事件 type（v5.1 R1-D 锁定基线）──────────────────────────────
//
// 70 events from playground.events.ts (2026-05-04)。改本数组前先确认
// 前端 socket handler 已同步（grep frontend `playground.${suffix}`）。
const EVENT_BASELINE: ReadonlyArray<string> = [
  "playground.agent:action",
  "playground.agent:error",
  "playground.agent:lifecycle",
  "playground.agent:narrative",
  "playground.agent:observation",
  "playground.agent:reflection",
  "playground.agent:thought",
  "playground.agent:validation-rejected",
  "playground.budget:exhausted",
  "playground.budget:warning-hard",
  "playground.budget:warning-soft",
  "playground.chapter:done",
  "playground.chapter:review:completed",
  "playground.chapter:review:started",
  "playground.chapter:revision",
  "playground.chapter:rewritten",
  "playground.chapter:writing:completed",
  "playground.chapter:writing:started",
  "playground.cost:tick",
  "playground.critic:verdict",
  "playground.dimension:degraded",
  "playground.dimension:graded",
  "playground.dimension:integrating:completed",
  "playground.dimension:integrating:failed",
  "playground.dimension:integrating:started",
  "playground.dimension:outline:planned",
  "playground.dimension:research:completed",
  "playground.dimension:research:started",
  "playground.dimension:retry-failed",
  "playground.dimension:retry-phase:completed",
  "playground.dimension:retry-phase:started",
  "playground.dimension:retrying",
  "playground.dimensions:appended",
  "playground.draft:completed",
  "playground.event:dropped",
  "playground.event:oversized",
  "playground.failure-pattern:pre-applied",
  "playground.iteration:progress",
  "playground.leader:decision",
  "playground.leader:foreword",
  "playground.leader:goals-set",
  "playground.leader:rejected-revision-recommended",
  "playground.leader:signed",
  "playground.memory:indexed",
  // 2026-06-12: liveness 停滞击杀自动恢复审计（终生 1 次上限计数源）。前端无需
  // 监听（恢复的用户可见信号是既有 mission:reopened），仅 journal 审计用。
  "playground.mission:auto-recovered",
  "playground.mission:budget-warning-hard",
  "playground.mission:budget-warning-soft",
  "playground.mission:cancelled",
  "playground.mission:completed",
  "playground.mission:degraded",
  "playground.mission:evolved",
  "playground.mission:execution-aborted",
  "playground.mission:failed",
  "playground.mission:manual-rerun-from-todo",
  "playground.mission:persist-failed",
  "playground.mission:postlude:completed",
  "playground.mission:preflight-warning",
  "playground.mission:postlude:failed",
  "playground.mission:postlude:started",
  "playground.mission:rejected",
  "playground.mission:reopened",
  "playground.mission:rerun-completed",
  "playground.mission:rerun-failed",
  "playground.mission:rerun-started",
  "playground.mission:started",
  "playground.mission:warning",
  "playground.mission:zombie-cleanup",
  "playground.reconciliation:completed",
  "playground.reconciliation:skipped",
  "playground.reconciliation:warnings-orphaned",
  // ★ Foresight L2 (2026-05-29)：forecast 红队事前验尸 verdict（前端经 artifact.quickView.foresight 消费，事件供实时 trace）
  "playground.red-team:verdict",
  "playground.report:assembled",
  "playground.report:draft",
  "playground.researcher:completed",
  "playground.rerun:cascade-aborted",
  "playground.rerun:stage-started",
  "playground.section:remediation:summary",
  "playground.stage:completed",
  "playground.stage:degraded",
  "playground.stage:failed",
  "playground.stage:lifecycle",
  "playground.stage:metrics",
  "playground.stage:stalled",
  "playground.stage:started",
  "playground.tools:recalled",
  "playground.verifier:verdict",
];

// ── Baseline 2: REST 端点（v5.1 R1-D 锁定基线）─────────────────────────────
//
// 15 endpoints from playground.controller.ts (2026-05-04)。前缀 controller
// 路径 "playground" 是 NestJS @Controller("playground") 注册的；
// 真实 URL = `/api/v1/playground/${path}`（其中 /api/v1 是 Nest global prefix）。
//
// 元组 = [HTTP_METHOD, route_path（不含 controller prefix）]
type EndpointSpec = readonly [string, string];
const ENDPOINT_BASELINE: ReadonlyArray<EndpointSpec> = [
  ["DELETE", "missions/:id"],
  // ★ 2026-05-22 ③J/K：tier 配置单一源端点，前端 useBudgetTiers fetch（已同步 FE client）
  ["GET", "budget-tiers"],
  ["GET", "missions"],
  ["GET", "missions/:id"],
  // ★ PG-04 (2026-05-31 platform-review wave1): per-mission 成本台账只读端点
  //   （chargeback/showback/审计）。后端新增，前端成本面板后续接入。
  ["GET", "missions/:id/cost"],
  // ★ B2-3 (2026-05-26 thinning plan): canonical mission detail view
  //   sibling-route of /missions/:id per §6.9 disposition table.
  ["GET", "missions/:id/view"],
  ["GET", "missions/:id/export"],
  ["GET", "missions/:id/leader-chat"],
  ["GET", "missions/:id/report-versions"],
  ["GET", "missions/:id/report-versions/:version"],
  ["GET", "missions/resumable"],
  ["GET", "replay/:missionId"],
  ["PATCH", "missions/:id"],
  ["PATCH", "missions/:id/visibility"],
  ["POST", "dev/trigger-mission"],
  ["POST", "error-report"],
  ["POST", "missions/:id/cancel"],
  ["POST", "missions/:id/leader-chat"],
  ["POST", "missions/:id/rerun"],
  ["POST", "missions/:id/todos/:todoId/local-rerun"],
  ["POST", "missions/:id/todos/:todoId/rerun"],
  // ★ 2026-06-11：一键清理已结束 mission（failed/quality-failed/cancelled 批删）。
  ["POST", "missions/cleanup"],
  ["POST", "team/run"],
];

// ── 实现 ────────────────────────────────────────────────────────────────

function loadEventTypes(): string[] {
  return [...AGENT_PLAYGROUND_EVENTS.map((e) => e.type)].sort();
}

/**
 * 解析 controller 源码提取 (HTTP_METHOD, path) 列表。
 *
 * 支持的装饰器形式：
 *   @Get("path")
 *   @Post("path")
 *   @Patch("path")
 *   @Delete("path")
 *   @Put("path")
 *   @Get()  → path = ""
 *
 * 仅识别紧贴方法定义的 HTTP method 装饰器；忽略 @UseGuards / @RateLimit / @Public 等
 * 元装饰器（它们不映射到独立路由）。
 */
function loadEndpointsFromSource(): EndpointSpec[] {
  const out: EndpointSpec[] = [];
  for (const file of CONTROLLER_FILES) {
    const src = fs.readFileSync(file, "utf-8");
    const re = /@(Get|Post|Patch|Delete|Put)\(\s*"([^"]*)"\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src)) !== null) {
      out.push([m[1].toUpperCase(), m[2]]);
    }
    const reEmpty = /@(Get|Post|Patch|Delete|Put)\(\s*\)/g;
    while ((m = reEmpty.exec(src)) !== null) {
      out.push([m[1].toUpperCase(), ""]);
    }
  }
  // sort by [method, path]
  out.sort((a, b) => (a[0] + " " + a[1]).localeCompare(b[0] + " " + b[1]));
  return out;
}

// ── Specs ───────────────────────────────────────────────────────────────

describe("playground frontend contract (v5.1 R1-D)", () => {
  describe("event types byte-equal", () => {
    const observed = loadEventTypes();
    const baseline = [...EVENT_BASELINE].sort();

    it("baseline 数量等于实际注册数", () => {
      expect(observed.length).toBe(baseline.length);
    });

    it("每个 event type 都在 baseline 中（防新增 sneak-in）", () => {
      const baseSet = new Set(baseline);
      const novel = observed.filter((t) => !baseSet.has(t));
      // 不允许 sneak-in：novel = [] 表示无新增 event 未声明在 baseline
      expect(novel).toEqual([]);
    });

    it("每个 baseline 都仍被注册（防误删）", () => {
      const observedSet = new Set(observed);
      const missing = baseline.filter((t) => !observedSet.has(t));
      expect(missing).toEqual([]);
    });

    it("byte-equal 字符串数组完全相等（最严守护）", () => {
      expect(observed).toEqual(baseline);
    });
  });

  describe("REST endpoints byte-equal", () => {
    const observed = loadEndpointsFromSource();
    const baseline = [...ENDPOINT_BASELINE].sort((a, b) =>
      (a[0] + " " + a[1]).localeCompare(b[0] + " " + b[1]),
    );

    it("baseline 数量等于实际定义数", () => {
      expect(observed.length).toBe(baseline.length);
    });

    it("每个 (method, path) 都在 baseline 中（防新增 sneak-in）", () => {
      const baseSet = new Set(baseline.map((b) => b.join(" ")));
      const novel = observed
        .map((o) => o.join(" "))
        .filter((s) => !baseSet.has(s));
      expect(novel).toEqual([]);
    });

    it("每个 baseline 都仍存在（防误删）", () => {
      const observedSet = new Set(observed.map((o) => o.join(" ")));
      const missing = baseline
        .map((b) => b.join(" "))
        .filter((s) => !observedSet.has(s));
      expect(missing).toEqual([]);
    });

    it("byte-equal 元组数组完全相等（最严守护）", () => {
      expect(observed).toEqual(baseline);
    });
  });
});
