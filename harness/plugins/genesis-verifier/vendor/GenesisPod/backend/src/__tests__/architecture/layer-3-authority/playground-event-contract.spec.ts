/**
 * playground-event-contract.spec.ts
 *
 * **第五层防护网**：架构级 contract drift spec，强制扫前后端事件契约一致性。
 *
 * 历史教训：2026-05-06 mission detail 不更新真因 = 0996e8672 单轨化删了 backend
 * stage:started/completed emit 但 derive.ts 还在监听。typecheck/spec/fixture 都
 * 没拦下来，因为 dead listener 不破坏类型。本 spec 用静态分析机械检测：
 *
 *   1. frontend listened events ⊆ backend AGENT_PLAYGROUND_EVENTS (防 typo / dead listener)
 *   2. backend AGENT_PLAYGROUND_EVENTS each 至少有一处 emit (防 dead registration)
 *   3. backend 实际 emit 的 type ⊆ AGENT_PLAYGROUND_EVENTS (防 unregistered emit 被 bus drop)
 *
 * 触发条件：单轨化删事件 / 重命名事件 / 引入新 event handler 时必须跑过这个 spec
 * 才能 push（pre-push hook 会跑全栈 spec）。
 */

import * as fs from "fs";
import * as path from "path";

// __dirname = backend/src/__tests__/architecture → 4 层到 repo root
const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const BACKEND_SRC = path.join(REPO_ROOT, "backend/src");
const FRONTEND = path.join(REPO_ROOT, "frontend");
const PLAYGROUND_PREFIX = "playground.";

// ----- 数据采集（静态分析）-----

function readBackendRegisteredEvents(): Set<string> {
  const eventsFile = path.join(
    BACKEND_SRC,
    "modules/ai-app/playground/events/playground.events.ts",
  );
  const src = fs.readFileSync(eventsFile, "utf8");
  // T("xxx:yyy") or S("xxx:yyy", schema) → "playground.xxx:yyy"
  const re = /\b[ST]\("([^"]+)"/g;
  const out = new Set<string>();
  let m;
  while ((m = re.exec(src)) !== null) {
    out.add(`${PLAYGROUND_PREFIX}${m[1]}`);
  }
  return out;
}

/** 递归读所有 ts 文件 */
function walkTsFiles(dir: string, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir)) {
    if (
      entry === "node_modules" ||
      entry === ".next" ||
      entry === "dist" ||
      entry === "__fixtures__" ||
      entry === "__tests__"
    )
      continue;
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walkTsFiles(full, files);
    } else if (
      entry.endsWith(".ts") ||
      entry.endsWith(".tsx") ||
      entry.endsWith(".js")
    ) {
      // skip generated
      if (entry.endsWith(".d.ts")) continue;
      files.push(full);
    }
  }
  return files;
}

function readFrontendListenedEvents(): {
  events: Set<string>;
  source: Record<string, string[]>;
} {
  const events = new Set<string>();
  const source: Record<string, string[]> = {};
  const dirs = [
    // 前端功能目录保留 agent-playground 命名（仅后端 dir / WS namespace /
    // event prefix / billing moduleType 统一为 playground；前端 route + 目录不动）
    path.join(FRONTEND, "lib/features/agent-playground"),
    path.join(FRONTEND, "components/agent-playground"),
    path.join(FRONTEND, "app/agent-playground"),
    path.join(FRONTEND, "hooks"),
  ];
  // 2026-05-19: derive.ts/todo-ledger.ts 用 namespace-agnostic 比较（剥离前缀后
  //   用 'mission:started' 这种 suffix-only 字符串），让 social/ai-radar 等
  //   domain 复用。spec 扫两种格式：
  //     1) 'playground.X:Y' — 完整明确监听 playground namespace
  //     2) 'X:Y' — 监听所有 namespace（含 playground），视为也监听了 playground.X:Y
  const reFullyQualified =
    /['"`]playground\.([a-zA-Z][a-zA-Z0-9_-]*(?::[a-zA-Z][a-zA-Z0-9_-]*)+)['"`]/g;
  // suffix-only：只允许合法事件 type 前缀（mission/stage/agent/budget/cost/tools/
  //   iteration/publish/chapter/dimension/leader/critic/verifier/reconciliation），
  //   排除 todo-ledger 内部 ID 如 'system:s3-researchers'
  const ALLOWED_EVENT_PREFIXES =
    "mission|stage|agent|budget|cost|tools|iteration|publish|chapter|dimension|leader|critic|verifier|reconciliation|dimensions|writer|topic";
  const reSuffix = new RegExp(
    `[=!]==?\\s*['"\`]((?:${ALLOWED_EVENT_PREFIXES}):[a-zA-Z][a-zA-Z0-9_-]*(?::[a-zA-Z][a-zA-Z0-9_-]*)*)['"\`]`,
    "g",
  );
  for (const d of dirs) {
    for (const file of walkTsFiles(d)) {
      const src = fs.readFileSync(file, "utf8");
      let m;
      while ((m = reFullyQualified.exec(src)) !== null) {
        const ev = `${PLAYGROUND_PREFIX}${m[1]}`;
        events.add(ev);
        if (!source[ev]) source[ev] = [];
        if (!source[ev].includes(file)) source[ev].push(file);
      }
      while ((m = reSuffix.exec(src)) !== null) {
        const ev = `${PLAYGROUND_PREFIX}${m[1]}`;
        events.add(ev);
        if (!source[ev]) source[ev] = [];
        if (!source[ev].includes(file)) source[ev].push(file);
      }
    }
  }
  return { events, source };
}

function readBackendEmittedEvents(): Set<string> {
  const events = new Set<string>();
  const dirs = [
    path.join(BACKEND_SRC, "modules/ai-app/playground"),
    path.join(BACKEND_SRC, "modules/ai-harness"),
  ];
  // 只匹配事件 type（含至少 1 个冒号），排除 adapter id / namespace 字符串
  const re =
    /['"`]playground\.([a-zA-Z][a-zA-Z0-9_-]*(?::[a-zA-Z][a-zA-Z0-9_-]*)+)['"`]/g;
  for (const d of dirs) {
    for (const file of walkTsFiles(d)) {
      // skip events.ts itself（注册不算 emit）+ event-schemas.ts
      if (
        file.endsWith("playground.events.ts") ||
        file.endsWith("playground.event-schemas.ts")
      )
        continue;
      const src = fs.readFileSync(file, "utf8");
      let m;
      while ((m = re.exec(src)) !== null) {
        events.add(`${PLAYGROUND_PREFIX}${m[1]}`);
      }
    }
  }
  return events;
}

// ----- 已知豁免（合法的 dead handler / dead registration / 内部事件）-----

/** 这些事件是合法保留的（向后兼容 fixture / 内部 socket 降级 / 故意未实现） */
const FRONTEND_LEGACY_LISTENERS_OK = new Set<string>([
  // 单轨化前 fixture 兼容
  "playground.stage:started",
  "playground.stage:completed",
]);

/** 这些 backend 注册但暂未 emit（为未来预留 / 测试用 / 兼容历史 fixture） */
const BACKEND_DEAD_REGISTRATION_OK = new Set<string>([
  // PR-E1 (2026-05-08): EventRelayFramework.relayAgentEvents() / emitLifecycle() / tickCost()
  // 通过 `${this.eventNamespace}.xxx` 动态模板 emit；AgentPlaygroundEventRelay extends
  // EventRelayFramework("playground") → 这些事件确实被 emit，静态扫描因模板化无法检测。
  "playground.agent:lifecycle",
  "playground.agent:thought",
  "playground.agent:action",
  "playground.agent:observation",
  "playground.agent:reflection",
  "playground.agent:error",
  "playground.cost:tick",
  "playground.tools:recalled",
  "playground.agent:validation-rejected",
  "playground.iteration:progress",
  // SocketBroadcastAdapter 内部降级用，不是业务 emit
  "playground.event:dropped",
  "playground.event:oversized",
  // 暂未 emit 但 frontend 监听（保留事件位等业务实现）
  "playground.chapter:rewritten",
  "playground.dimension:integrating:failed",
  "playground.leader:rejected-revision-recommended",
  // budget 警告事件已用 mission:budget-warning-{soft,hard}（在 mission lifecycle
  // 上）替代，独立的 budget:warning-{soft,hard} 命名暂保留位但未 emit
  "playground.budget:warning-soft",
  "playground.budget:warning-hard",
  // 单轨化前的旧事件 — backend 0996e8672 删 emit，但 frontend derive.ts 保留
  // 兼容 listener 让旧 fixture mission 仍能 deriveView。新 mission 走 stage:lifecycle。
  "playground.stage:started",
  "playground.stage:completed",
  "playground.stage:failed",
  "playground.stage:metrics",
  // ★ #16b Fix C10（2026-06-09）：S12 postlude 现在经 domain 事件桥
  // （self-evolution.postlude.ts emitPostludeEvent → CapabilityRunEvent "domain" →
  // playground.pipeline.ts bridgeCapabilityEvent → playground.mission:postlude:*）
  // 发出这 3 个事件。静态扫描无法跟踪 domain 桥的模板拼接，故留在豁免名单。
  // 实际 emit 路径：emitPostludeEvent 发 domain payload.event="mission:postlude:{...}"
  // → dispatcher 拼为 "playground.mission:postlude:{...}"。
  "playground.mission:postlude:started",
  "playground.mission:postlude:completed",
  "playground.mission:postlude:failed",
]);

// ----- specs -----

describe("Playground Event Contract — Frontend ↔ Backend", () => {
  const registered = readBackendRegisteredEvents();
  const { events: listened, source: listenedSource } =
    readFrontendListenedEvents();
  const emitted = readBackendEmittedEvents();

  it("frontend 监听的每个事件都在 backend AGENT_PLAYGROUND_EVENTS 注册（防 typo / dead listener）", () => {
    const orphaned: { event: string; files: string[] }[] = [];
    for (const ev of listened) {
      if (FRONTEND_LEGACY_LISTENERS_OK.has(ev)) continue;
      if (!registered.has(ev)) {
        orphaned.push({ event: ev, files: listenedSource[ev] ?? [] });
      }
    }
    if (orphaned.length > 0) {
      const msg = orphaned
        .map(
          (o) =>
            `  ✗ ${o.event}\n      listened in:\n${o.files.map((f) => `        ${path.relative(REPO_ROOT, f)}`).join("\n")}`,
        )
        .join("\n");
      throw new Error(
        `Frontend 监听的下列事件 backend 未注册（orphaned listener / typo）:\n${msg}\n\n` +
          `修法：要么在 backend playground.events.ts 加 T(/S(...))，` +
          `要么删掉 frontend 的死 handler。`,
      );
    }
  });

  it("backend 注册的每个事件至少有一处 emit（防 dead registration）", () => {
    const dead: string[] = [];
    for (const ev of registered) {
      if (BACKEND_DEAD_REGISTRATION_OK.has(ev)) continue;
      if (!emitted.has(ev)) {
        dead.push(ev);
      }
    }
    if (dead.length > 0) {
      throw new Error(
        `Backend 注册了下列事件但代码里找不到 emit 调用（dead registration）:\n` +
          dead.map((e) => `  ✗ ${e}`).join("\n") +
          `\n\n修法：在 backend 加 emit 调用，或从 events.ts 删除注册（需同时删 frontend listener），` +
          `或加入 BACKEND_DEAD_REGISTRATION_OK 豁免名单（注释说明保留原因）。`,
      );
    }
  });

  it("backend 实际 emit 的每个事件类型都在 AGENT_PLAYGROUND_EVENTS 注册（防 EventBus drop）", () => {
    const unregistered: string[] = [];
    for (const ev of emitted) {
      if (!registered.has(ev)) {
        unregistered.push(ev);
      }
    }
    if (unregistered.length > 0) {
      throw new Error(
        `Backend 代码 emit 下列事件但 events.ts 未注册（EventBus 会 drop + warn）:\n` +
          unregistered.map((e) => `  ✗ ${e}`).join("\n") +
          `\n\n修法：在 backend playground.events.ts 用 T(...) 或 S(..., schema) 注册。`,
      );
    }
  });

  it("【prevention】backend 仍 emit + 注册 stage:lifecycle（frontend listener W7 cutover 后下移）", () => {
    // W7 cutover (2026-05-26): derive.ts 已删除；stage:lifecycle 的 frontend
    // 处理路径下移到 backend canonical view —— 前端通过 useMissionDetailView refetch
    // 间接消费（refresh hints driven），不再直接监听 event suffix。
    // 仍保留 registered + emitted 断言：防止 backend 单边删除事件。
    expect(registered.has("playground.stage:lifecycle")).toBe(true);
    expect(emitted.has("playground.stage:lifecycle")).toBe(true);
  });
});
