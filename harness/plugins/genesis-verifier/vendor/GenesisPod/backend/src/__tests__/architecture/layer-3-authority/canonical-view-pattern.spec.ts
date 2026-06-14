/**
 * canonical-view-pattern.spec.ts — Cross-app canonical view 不变量看护（2026-05-26 thinning §B7 收尾）
 *
 * 落地依据：thinning plan §6.2 base contract / §B2 read model / §B3 todo+artifact /
 *           §B7 social-radar 对齐 / §13 success criteria
 *
 * 不变量（对所有 mission-based app 强制）：
 *
 *   I1. 每个 app 必有 `mission/projectors/<app>-mission-view.projector.ts`
 *   I2. 每个 app 必有 `mission/projectors/<app>-todo-board.projector.ts`（B7 freeze）
 *   I3. 每个 app 必有 `mission/query/<app>-mission-query.service.ts`
 *   I4. QueryInputs interface 必含 `events: ReadonlyArray<...>` 字段（projector 必须能消费 events）
 *   I5. mission-view projector 必接 todo board projector（不再用 buildEmptyTodoBoardSentinel）
 *   I6. canonical view contract 必从 harness facade re-export base types（mirror playground）
 *
 * 新增 mission app 时把它加进 MISSION_APPS，缺任一不变量即红。
 *
 * 这是把"分层约束变成可执行规则" — 不靠评审口头解释，靠 spec assertion。
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const APP_ROOT = join(__dirname, "../../../modules/ai-app");

interface MissionAppSpec {
  /** app 目录名（与 ai-app/<name>/ 一致）。 */
  name: string;
  /** projector 文件前缀（如 social → social-mission-view） */
  filePrefix: string;
  /** query service 文件前缀 */
  queryPrefix: string;
  /** view-state contract 路径（相对 app root） */
  contractRel: string;
}

const MISSION_APPS: MissionAppSpec[] = [
  {
    name: "playground",
    filePrefix: "mission-view",
    queryPrefix: "mission-query",
    contractRel: "api/contracts/view-state.contract.ts",
  },
  {
    name: "social",
    filePrefix: "social-mission-view",
    queryPrefix: "social-mission-query",
    contractRel: "api/contracts/view-state.contract.ts",
  },
  {
    name: "radar",
    filePrefix: "radar-mission-view",
    queryPrefix: "radar-mission-query",
    contractRel: "api/contracts/view-state.contract.ts",
  },
];

describe("Canonical view pattern — cross-app invariants", () => {
  describe.each(MISSION_APPS)("$name", (app) => {
    const appRoot = join(APP_ROOT, app.name);
    const viewProjectorPath = join(
      appRoot,
      "mission/projectors",
      `${app.filePrefix}.projector.ts`,
    );
    const todoBoardProjectorPath = join(
      appRoot,
      "mission/projectors",
      `${app.name === "playground" ? "todo-board" : `${app.name}-todo-board`}.projector.ts`,
    );
    const queryServicePath = join(
      appRoot,
      "mission/query",
      `${app.queryPrefix}.service.ts`,
    );
    const contractPath = join(appRoot, app.contractRel);

    it("I1: mission-view.projector 文件存在", () => {
      expect(existsSync(viewProjectorPath)).toBe(true);
    });

    it("I2: todo-board.projector 文件存在（B7 freeze — 禁止 sentinel-only）", () => {
      expect(existsSync(todoBoardProjectorPath)).toBe(true);
    });

    it("I3: mission-query.service 文件存在", () => {
      expect(existsSync(queryServicePath)).toBe(true);
    });

    it("I4: QueryInputs interface 含 events ReadonlyArray 字段", () => {
      const content = readFileSync(queryServicePath, "utf8");
      // 匹配 events: ReadonlyArray<...> 或 events: Array<...> 或 events: T[]
      const hasEventsField = /events\s*:\s*(ReadonlyArray|Array)\s*</.test(
        content,
      );
      expect(hasEventsField).toBe(true);
    });

    it("I5: mission-view.projector 调用 todo board projector（不再 sentinel-only）", () => {
      const content = readFileSync(viewProjectorPath, "utf8");
      // 匹配 projectXxxTodoBoard(row, ...) 或 projectTodoBoard(row, ...)
      const callsTodoProjector = /project(?:Social|Radar)?TodoBoard\s*\(/.test(
        content,
      );
      expect(callsTodoProjector).toBe(true);
    });

    it("I6: contract re-exports MissionViewBase types from harness facade", () => {
      const content = readFileSync(contractPath, "utf8");
      expect(content).toMatch(/@\/modules\/ai-harness\/facade/);
      expect(content).toMatch(/MissionViewBase(Mission|Stage|Agent|Status)?/);
    });
  });

  it("Cross-check: MISSION_APPS 与 plan §16.4 三 app 列表一致（防漏 app）", () => {
    const expected = ["playground", "social", "radar"];
    expect(MISSION_APPS.map((a) => a.name).sort()).toEqual(expected.sort());
  });
});

describe("Canonical view pattern — anti-regression checks", () => {
  it("playground todo-board.projector 必用 anchor sort（sortByAnchor）", () => {
    const content = readFileSync(
      join(
        APP_ROOT,
        "playground/mission/projectors/todo-board.projector.ts",
      ),
      "utf8",
    );
    // anchor sort 是历史 deriveTodoLedger 的 STAGE_ORDER + ORIGIN_SUBORDER 设计；
    // backend port 必须保留同语义。
    expect(content).toMatch(/sortByAnchor|sortKey/);
    expect(content).toMatch(/STAGE_ORDINAL/);
  });

  it("playground todo-board.projector dim todos 必有 parentId 树形锚定", () => {
    const content = readFileSync(
      join(
        APP_ROOT,
        "playground/mission/projectors/todo-board.projector.ts",
      ),
      "utf8",
    );
    // 树形展示要求：dim 任务以 system:s3-researchers 为父节点
    expect(content).toMatch(/parentId:\s*["']system:s3-researchers["']/);
  });

  it("backend SocketBroadcastAdapter 必注入 refreshHints（§6.7.3 multi-pod）", () => {
    const adapterPath = join(
      __dirname,
      "../../../modules/ai-harness/protocols/realtime/socket-broadcast.adapter.ts",
    );
    const content = readFileSync(adapterPath, "utf8");
    expect(content).toMatch(/deriveRefreshHints/);
    expect(content).toMatch(/refreshHints/);
  });

  it("ResumeRerunPolicy 算法在 harness（business-agnostic lift）", () => {
    const frameworkPath = join(
      __dirname,
      "../../../modules/ai-harness/teams/business-team/rerun/business-team-resume-rerun-policy.framework.ts",
    );
    expect(existsSync(frameworkPath)).toBe(true);
    const content = readFileSync(frameworkPath, "utf8");
    expect(content).toMatch(/computeResumable/);
    expect(content).toMatch(/computeRerunnableStages/);
    // 不应在 framework 内引用具体 app 名（business-name-agnostic）
    expect(content).not.toMatch(/playground|topic-insights|playground\b/);
  });
});
