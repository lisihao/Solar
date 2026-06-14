/**
 * playground-as-template.spec.ts —— Cross-app Tier 1 framework adoption parity.
 *
 * playground-as-template.md §2 Tier 1 Core MUST：
 *   每个 mission app（playground / radar / social）必须 extends 这套 Tier 1
 *   framework + 用 Tier 1 helper，新增 mission app 必须满足同样不变量。
 *
 * 与 canonical-view-pattern.spec.ts 的关系：那个看 view contract / projector / query
 * service 文件存在与函数调用（I1-I6）；本 spec 看 framework class 真 extends + 通用
 * helper 真使用，是它的补集，不重复。
 *
 * 落地依据：[playground-as-template.md](../../../../../docs/architecture/ai-app/playground/playground-as-template.md)
 */

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const APP_ROOT = join(__dirname, "../../../modules/ai-app");
const HARNESS_FACADE = join(
  __dirname,
  "../../../modules/ai-harness/facade/index.ts",
);

interface MissionAppSpec {
  /** app 目录名 */
  name: string;
  /** pipeline dispatcher 文件名匹配（substring）。playground 用 `.pipeline.ts`，
   *  radar/social 用 `-pipeline-dispatcher.service.ts`。 */
  dispatcherNameSubstrings: string[];
  /** event buffer 文件名匹配。playground 是 `mission-event-buffer.service.ts`，
   *  radar 是 `radar-mission-event-buffer.service.ts`，social 是 `social-event-buffer.service.ts`。 */
  eventBufferNameSubstrings: string[];
  /** todo-board projector 文件名（已在 canonical-view 覆盖存在性，这里只查 extends） */
  todoBoardProjectorPath: string;
  /** mission-view projector 文件名（查 helper 调用） */
  missionViewProjectorPath: string;
}

const MISSION_APPS: MissionAppSpec[] = [
  {
    name: "playground",
    dispatcherNameSubstrings: ["playground.pipeline"],
    eventBufferNameSubstrings: ["mission-event-buffer"],
    todoBoardProjectorPath: "mission/projectors/todo-board.projector.ts",
    missionViewProjectorPath: "mission/projectors/mission-view.projector.ts",
  },
  {
    name: "radar",
    dispatcherNameSubstrings: ["radar-pipeline-dispatcher.service"],
    eventBufferNameSubstrings: ["radar-mission-event-buffer.service"],
    todoBoardProjectorPath: "mission/projectors/radar-todo-board.projector.ts",
    missionViewProjectorPath:
      "mission/projectors/radar-mission-view.projector.ts",
  },
  {
    name: "social",
    dispatcherNameSubstrings: ["social-pipeline-dispatcher.service"],
    eventBufferNameSubstrings: ["social-event-buffer.service"],
    todoBoardProjectorPath: "mission/projectors/social-todo-board.projector.ts",
    missionViewProjectorPath:
      "mission/projectors/social-mission-view.projector.ts",
  },
];

function findFileBySubstring(dir: string, substrings: string[]): string | null {
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    for (const sub of substrings) {
      if (e.name.includes(sub)) return join(dir, e.name);
    }
  }
  return null;
}

describe("playground-as-template — Tier 1 framework adoption parity", () => {
  describe.each(MISSION_APPS)("$name", (app) => {
    const appRoot = join(APP_ROOT, app.name);
    const pipelineDir = join(appRoot, "mission/pipeline");
    const lifecycleDir = join(appRoot, "mission/lifecycle");

    it("T1: pipeline dispatcher extends BusinessTeamMissionDispatcherFramework", () => {
      const path = findFileBySubstring(
        pipelineDir,
        app.dispatcherNameSubstrings,
      );
      expect(path).not.toBeNull();
      const src = readFileSync(path!, "utf-8");
      expect(src).toMatch(/extends\s+BusinessTeamMissionDispatcherFramework/);
    });

    it("T2: event-buffer service extends BusinessTeamEventBufferFramework", () => {
      const path = findFileBySubstring(
        lifecycleDir,
        app.eventBufferNameSubstrings,
      );
      expect(path).not.toBeNull();
      const src = readFileSync(path!, "utf-8");
      expect(src).toMatch(/extends\s+BusinessTeamEventBufferFramework/);
    });

    it("T3: todo-board projector class extends BusinessTeamTodoBoardProjectorFramework", () => {
      const path = join(appRoot, app.todoBoardProjectorPath);
      expect(existsSync(path)).toBe(true);
      const src = readFileSync(path, "utf-8");
      // 必须有 class 真 extends，不是 only import
      expect(src).toMatch(
        /class\s+\w+\s+extends\s+BusinessTeamTodoBoardProjectorFramework/,
      );
    });

    it("T4: mission-view projector uses buildMissionCostView + deriveSnapshotVersionFromRow helpers", () => {
      const path = join(appRoot, app.missionViewProjectorPath);
      expect(existsSync(path)).toBe(true);
      const src = readFileSync(path, "utf-8");
      expect(src).toMatch(/buildMissionCostView/);
      expect(src).toMatch(/deriveSnapshotVersionFromRow/);
    });

    it("T5: mission-view projector uses projectStagesByOrdinal helper", () => {
      const path = join(appRoot, app.missionViewProjectorPath);
      const src = readFileSync(path, "utf-8");
      // playground 自己写 projectStages（不走 ordinal helper，因为 stage 列表已在 frontend
      // todo-ledger.ts 历史 mirror）；radar/social 都通过 helper。所以放宽：要么调
      // helper，要么 import 自己的 projectStages module。
      const usesHelperOrLocal =
        /projectStagesByOrdinal/.test(src) || /projectStages\b/.test(src);
      expect(usesHelperOrLocal).toBe(true);
    });

    it("T6: 不穿透 ai-harness/teams/business-team/ 内部路径（facade discipline）", () => {
      const todoBoardPath = join(appRoot, app.todoBoardProjectorPath);
      const missionViewPath = join(appRoot, app.missionViewProjectorPath);
      const dispatcherPath = findFileBySubstring(
        pipelineDir,
        app.dispatcherNameSubstrings,
      );
      const eventBufferPath = findFileBySubstring(
        lifecycleDir,
        app.eventBufferNameSubstrings,
      );

      for (const p of [
        todoBoardPath,
        missionViewPath,
        dispatcherPath,
        eventBufferPath,
      ]) {
        if (!p || !existsSync(p)) continue;
        const src = readFileSync(p, "utf-8");
        // 禁止 import from "@/modules/ai-harness/teams/business-team/..."
        const violators = src.match(
          /from\s+["']@\/modules\/ai-harness\/teams\/business-team\/[^"']+["']/g,
        );
        expect(violators).toBeNull();
      }
    });
  });

  it("Cross-check: MISSION_APPS 与 canonical-view-pattern.spec 一致（防漏 app）", () => {
    const expected = ["playground", "social", "radar"];
    expect(MISSION_APPS.map((a) => a.name).sort()).toEqual(expected.sort());
  });
});

describe("playground-as-template — harness facade Tier 1 exports", () => {
  // 防御性测试：facade 自己别误删 Tier 1 导出，否则所有 mission app 都炸
  const facade = readFileSync(HARNESS_FACADE, "utf-8");

  it.each([
    "BusinessTeamMissionDispatcherFramework",
    "BusinessTeamEventBufferFramework",
    "BusinessTeamTodoBoardProjectorFramework",
    "buildMissionCostView",
    "deriveSnapshotVersionFromRow",
    "projectStagesByOrdinal",
    "MissionConfigSnapshot",
  ])("facade exports %s", (symbol) => {
    expect(facade).toMatch(new RegExp(`\\b${symbol}\\b`));
  });
});
