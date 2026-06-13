/**
 * Agent Team App Layout Conformance — §8.2 / §8.1 强制规范看护
 *
 * 2026-05-24 night (P21/Wave 4): blueprint §8.2 agent team app 目录 + §8.1
 * ai-harness/teams/business-team 子目录 在 P9b/P10/P11 集中重组完成后，必须有
 * 自动看护防回归。本 spec 锁定三类规则：
 *
 *   (A) ai-app/{playground,social,radar} 顶层目录必须命中 §8.2 白名单
 *   (B) 同上根目录不允许直接放 *.ts 文件（必须落到 module/api/runtime/mission/events）
 *   (C) ai-harness/teams/business-team/ 子目录必须命中 §8.1 白名单
 *
 * 设计参考：
 *   - docs/architecture/ai-app/playground/
 *       playground-target-boundary-and-directory-blueprint-2026-05-24.md §8.2
 *   - docs/architecture/ai-app/agent-app-mass-migration-roadmap-2026-05-24.md
 *
 * 三层看护对位：
 *   1. ESLint no-restricted-imports（IDE 实时）—— layer-boundaries / SECTION 10
 *      已覆盖"ai-app 必须走 facade"，不在本 spec 重复
 *   2. jest spec（本文件）—— 目录结构 + 文件归位 + harness 子聚合命名
 *   3. pre-push hook（Wave 4 P24）—— jest changedSince 自然覆盖本 spec
 */

import * as fs from "fs";
import * as path from "path";

const APP_ROOT = path.resolve(__dirname, "../../../modules/ai-app");
const HARNESS_BUSINESS_TEAM_ROOT = path.resolve(
  __dirname,
  "../../../modules/ai-harness/teams/business-team",
);

/** 三个 agent team app —— 每加一个 mission-pipeline 型 app 必须登记到此 */
const AGENT_TEAM_APPS = ["playground", "social", "radar"];

/**
 * §8.2 顶层目录白名单（每个 agent team app 都必须遵守）。
 *
 *   - module/    NestJS Module + onModuleInit 装配
 *   - api/       Controllers + DTO
 *   - runtime/   *.config.ts / gateway / constants / tuning profile
 *   - mission/   pipeline + agents + lifecycle + services + roles + ...
 *   - events/    EventRegistry 注册 schema
 *   - __tests__/ test fixtures（per-team 单测，contract 测试归 src/__tests__/）
 *
 * Per-app 可选：
 *   - integrations/  外部平台适配（social/wechat、playground/sources 等）
 */
const ALLOWED_TOP_DIRS = new Set([
  "module",
  "api",
  "runtime",
  "mission",
  "events",
  "__tests__",
  "integrations",
]);

/**
 * §8.2 mission/ 子目录白名单（每个 team 至少要有 pipeline/agents/lifecycle）。
 *
 * 不强制 services/roles/context/skills/artifacts/types/chat/export/rerun
 * —— 这些是 per-team 选项（playground 全有，radar 极简）。
 */
const REQUIRED_MISSION_SUBDIRS = ["pipeline", "agents", "lifecycle"];

/**
 * §8.1 ai-harness/teams/business-team/ 子目录白名单。
 *
 *   - abstractions/  framework 对外接口契约
 *   - invocation/    BusinessTeamAgentInvoker.framework
 *   - dispatcher/    BusinessTeamMissionDispatcher.framework
 *   - bindings/      BusinessTeamStageBindings.framework
 *   - lifecycle/     MissionRuntimeShellFramework 等
 *   - orchestrator/  BusinessTeamOrchestrator.framework
 *   - state/         cross-stage-state
 *   - span/          mission-span tracking
 *   - events/        event-relay-base 等
 *   - helpers/       framework 内部 helpers
 *   - rerun/         rerun 支持
 */
const ALLOWED_HARNESS_BUSINESS_TEAM_DIRS = new Set([
  "abstractions",
  "invocation",
  "dispatcher",
  "bindings",
  "lifecycle",
  "orchestrator",
  "state",
  "span",
  "events",
  "helpers",
  "rerun",
  // projectors/ added 2026-05-27 by projector-framework-lift-plan Phase A
  "projectors",
  "__tests__",
]);

function listDirEntries(dir: string): { dirs: string[]; files: string[] } {
  if (!fs.existsSync(dir)) return { dirs: [], files: [] };
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const dirs: string[] = [];
  const files: string[] = [];
  for (const e of entries) {
    if (e.isDirectory()) dirs.push(e.name);
    else if (e.isFile()) files.push(e.name);
  }
  return { dirs, files };
}

describe("Agent Team App Layout — §8.2 强制规范", () => {
  // P32 P2-2: 锁白名单大小，防止有人"悄悄往 ALLOWED_TOP_DIRS 加一个新目录"
  // 绕过审批扩大白名单。改白名单 = 改 §8.2 规范 = 必须同步 blueprint + 本断言。
  it("ALLOWED_TOP_DIRS 白名单大小锁定（改动需同步 blueprint §8.2）", () => {
    expect(ALLOWED_TOP_DIRS.size).toBe(7);
  });

  it("ALLOWED_HARNESS_BUSINESS_TEAM_DIRS 白名单大小锁定（改动需同步 §8.1）", () => {
    expect(ALLOWED_HARNESS_BUSINESS_TEAM_DIRS.size).toBe(13);
  });

  it.each(AGENT_TEAM_APPS)(
    "%s 顶层目录全部命中 §8.2 白名单（module/api/runtime/mission/events）",
    (app) => {
      const appDir = path.join(APP_ROOT, app);
      const { dirs } = listDirEntries(appDir);
      const offending = dirs.filter((d) => !ALLOWED_TOP_DIRS.has(d));
      expect(offending).toEqual([]);
    },
  );

  it.each(AGENT_TEAM_APPS)(
    "%s 根目录不允许直接放 *.ts 文件（必须落到 module/api/runtime/mission/events）",
    (app) => {
      const appDir = path.join(APP_ROOT, app);
      const { files } = listDirEntries(appDir);
      const offending = files.filter((f) => f.endsWith(".ts"));
      expect(offending).toEqual([]);
    },
  );

  it.each(AGENT_TEAM_APPS)(
    "%s 必须包含 module/ 顶层目录（NestJS Module 装配）",
    (app) => {
      const dir = path.join(APP_ROOT, app, "module");
      expect(fs.existsSync(dir) && fs.statSync(dir).isDirectory()).toBe(true);
    },
  );

  it.each(AGENT_TEAM_APPS)(
    "%s 必须包含 api/ 顶层目录（Controllers + DTO）",
    (app) => {
      const dir = path.join(APP_ROOT, app, "api");
      expect(fs.existsSync(dir) && fs.statSync(dir).isDirectory()).toBe(true);
    },
  );

  it.each(AGENT_TEAM_APPS)(
    "%s 必须包含 runtime/ 顶层目录（*.config.ts / gateway / constants）",
    (app) => {
      const dir = path.join(APP_ROOT, app, "runtime");
      expect(fs.existsSync(dir) && fs.statSync(dir).isDirectory()).toBe(true);
    },
  );

  it.each(AGENT_TEAM_APPS)("%s 必须包含 mission/ 顶层目录", (app) => {
    const dir = path.join(APP_ROOT, app, "mission");
    expect(fs.existsSync(dir) && fs.statSync(dir).isDirectory()).toBe(true);
  });

  it.each(AGENT_TEAM_APPS)(
    "%s 必须包含 events/ 顶层目录（EventRegistry schema）",
    (app) => {
      const dir = path.join(APP_ROOT, app, "events");
      expect(fs.existsSync(dir) && fs.statSync(dir).isDirectory()).toBe(true);
    },
  );

  describe.each(AGENT_TEAM_APPS)("%s mission/ 必备子目录", (app) => {
    it.each(REQUIRED_MISSION_SUBDIRS)("mission/%s/ 存在", (sub) => {
      const dir = path.join(APP_ROOT, app, "mission", sub);
      expect(fs.existsSync(dir) && fs.statSync(dir).isDirectory()).toBe(true);
    });
  });

  it.each(AGENT_TEAM_APPS)(
    "%s 不允许出现旧版顶层目录（services/controllers/dto/agents/utils）",
    (app) => {
      const appDir = path.join(APP_ROOT, app);
      const { dirs } = listDirEntries(appDir);
      const forbidden = ["services", "controllers", "dto", "agents", "utils"];
      const offending = dirs.filter((d) => forbidden.includes(d));
      expect(offending).toEqual([]);
    },
  );
});

describe("AI Harness business-team — §8.1 强制规范", () => {
  it("business-team/ 子目录全部命中 §8.1 白名单", () => {
    const { dirs } = listDirEntries(HARNESS_BUSINESS_TEAM_ROOT);
    const offending = dirs.filter(
      (d) => !ALLOWED_HARNESS_BUSINESS_TEAM_DIRS.has(d),
    );
    expect(offending).toEqual([]);
  });

  it.each([
    "abstractions",
    "invocation",
    "dispatcher",
    "bindings",
    "lifecycle",
    "orchestrator",
    "state",
    "span",
    "events",
  ])("business-team/%s/ 必须存在（framework 核心子聚合）", (sub) => {
    const dir = path.join(HARNESS_BUSINESS_TEAM_ROOT, sub);
    expect(fs.existsSync(dir) && fs.statSync(dir).isDirectory()).toBe(true);
  });
});
