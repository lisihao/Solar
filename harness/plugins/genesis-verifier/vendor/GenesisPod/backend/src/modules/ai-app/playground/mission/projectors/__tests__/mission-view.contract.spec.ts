/**
 * mission-view.contract.spec.ts —— Canonical view contract type-level invariants（B1-3）
 *
 * 落地依据：thinning plan §6 / §B1-3 / §10.1
 *
 * 本 spec 不调用 projector（B2 才有），只验证 contract 形状是 type-level 自洽 +
 * 必填 enum 取值在编译期被锁定（防 status enum 漂移）。
 *
 * projector 行为级断言在 fixture-replay.spec.ts。
 */

import {
  TERMINAL_MISSION_STATUSES,
  isMissionTerminal,
  type MissionStatus,
  type StageStatus,
  type AgentPhase,
  type RefreshHintFamily,
  type MissionViewBase,
  type PlaygroundDomainView,
  type MissionViewEnvelope,
  type RerunnableStageEntry,
} from "../../../api/contracts/view-state.contract";
import {
  V1_TO_V2_MAPPING_RULES,
  isReportArtifactV2,
  type ReportArtifactV2,
} from "../../../api/contracts/artifact.contract";

describe("§6.4.1 mission.status enum freeze", () => {
  it("锁定 6 个允许值（任何修改必须同步 plan §6.4.1）", () => {
    const allowed: MissionStatus[] = [
      "starting",
      "running",
      "completed",
      "failed",
      "cancelled",
      "quality-failed",
    ];
    expect(allowed).toHaveLength(6);
  });

  it("terminal 集合包含且仅包含 4 个 terminal 状态（§6.4.1 additional rule 1）", () => {
    expect(TERMINAL_MISSION_STATUSES.size).toBe(4);
    expect(TERMINAL_MISSION_STATUSES.has("completed")).toBe(true);
    expect(TERMINAL_MISSION_STATUSES.has("failed")).toBe(true);
    expect(TERMINAL_MISSION_STATUSES.has("cancelled")).toBe(true);
    expect(TERMINAL_MISSION_STATUSES.has("quality-failed")).toBe(true);
    // running / starting 不是 terminal
    expect(isMissionTerminal("running")).toBe(false);
    expect(isMissionTerminal("starting")).toBe(false);
  });
});

describe("§6.4.2 stage.status enum freeze", () => {
  it("锁定 5 个允许值", () => {
    const allowed: StageStatus[] = [
      "pending",
      "running",
      "done",
      "failed",
      "skipped",
    ];
    expect(allowed).toHaveLength(5);
  });
});

describe("§6.4.3 agent.phase enum freeze", () => {
  it("锁定 4 个允许值", () => {
    const allowed: AgentPhase[] = ["pending", "running", "completed", "failed"];
    expect(allowed).toHaveLength(4);
  });
});

describe("§6.7 refreshHints family freeze", () => {
  it("锁定 7 个 family 取值（plan §6.7 Recommended hint families）", () => {
    const allowed: RefreshHintFamily[] = [
      "mission",
      "stages",
      "agents",
      "artifact",
      "todo",
      "cost",
      "memory",
    ];
    expect(allowed).toHaveLength(7);
  });
});

describe("§6.2 / §6.3 MissionViewBase + PlaygroundDomainView shape sanity", () => {
  it("MissionViewBase 顶层字段类型契约（type-level，结构断言）", () => {
    const sample: MissionViewBase = {
      mission: {
        id: "x",
        status: "running",
        resumable: false,
        canCancel: true,
        rerunnableStages: [],
      },
      stages: [],
      agents: [],
      timelineVersion: 0,
      snapshotVersion: 0,
    };
    expect(sample.mission.status).toBe("running");
    expect(sample.timelineVersion).toBe(0);
    expect(sample.snapshotVersion).toBe(0);
  });

  it("PlaygroundDomainView 必填 references + reportVersions（§6.3 line 873-874）", () => {
    const sample: PlaygroundDomainView = {
      mission: {
        id: "x",
        status: "completed",
        resumable: false,
        canCancel: false,
        rerunnableStages: [],
      },
      stages: [],
      agents: [],
      references: [],
      reportVersions: [],
      timelineVersion: 0,
      snapshotVersion: 0,
    };
    expect(Array.isArray(sample.references)).toBe(true);
    expect(Array.isArray(sample.reportVersions)).toBe(true);
  });

  it("MissionViewEnvelope 顶层 envelope 形状（§B2-3 sibling-route 字段冲突规避）", () => {
    const env: MissionViewEnvelope = {
      view: {
        mission: {
          id: "x",
          status: "running",
          resumable: false,
          canCancel: false,
          rerunnableStages: [],
        },
        stages: [],
        agents: [],
        references: [],
        reportVersions: [],
        timelineVersion: 0,
        snapshotVersion: 0,
      },
    };
    expect(env.view.mission.id).toBe("x");
  });
});

describe("§6.5.2 RerunnableStageEntry 形状", () => {
  it("denied entry 应能携带 reason", () => {
    const entry: RerunnableStageEntry = {
      id: "s1-budget",
      allowed: false,
      reason: "cheap to restart, no meaningful checkpoint",
    };
    expect(entry.allowed).toBe(false);
    expect(entry.reason).toBeDefined();
  });
});

describe("§6.6.2 V1 → V2 normalization rules 表完整", () => {
  it("恰好 6 条规则（任何修改必须同步 plan §6.6.2）", () => {
    expect(V1_TO_V2_MAPPING_RULES).toHaveLength(6);
    const ruleNumbers = V1_TO_V2_MAPPING_RULES.map((r) => r.rule);
    expect(ruleNumbers).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rule 5 必须明确 hostname-derived fallback title 规则", () => {
    const rule5 = V1_TO_V2_MAPPING_RULES.find((r) => r.rule === 5);
    expect(rule5).toBeDefined();
    expect(rule5!.note).toMatch(/hostname/i);
  });
});

describe("artifact v2 type guard", () => {
  it("非 object 返回 false", () => {
    expect(isReportArtifactV2(null)).toBe(false);
    expect(isReportArtifactV2("string")).toBe(false);
  });

  it("缺关键字段返回 false", () => {
    expect(isReportArtifactV2({ content: {} })).toBe(false);
  });

  it("v2 形状的 minimal object 返回 true", () => {
    const minimal = {
      content: { fullMarkdown: "", fullReportSize: 0 },
      sections: [],
      citations: [],
      figures: [],
      quickView: {},
      factTable: [],
      metadata: {},
      quality: {},
    } as unknown as ReportArtifactV2;
    expect(isReportArtifactV2(minimal)).toBe(true);
  });
});
