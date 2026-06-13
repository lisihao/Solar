import { Test } from "@nestjs/testing";
import { NotificationEventListener } from "../notification-event-listener.service";
import { NotificationPresetsService } from "@/modules/platform/facade";
import type { TaskCompletedNotificationPayload } from "../notification-event-listener.service";

describe("NotificationEventListener", () => {
  let listener: NotificationEventListener;
  let presets: jest.Mocked<NotificationPresetsService>;

  beforeEach(async () => {
    presets = {
      notifyResearchCompleted: jest.fn().mockResolvedValue(undefined),
      notifyWritingTaskCompleted: jest.fn().mockResolvedValue(undefined),
      notifyOfficeSlidesCompleted: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationPresetsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationEventListener,
        { provide: NotificationPresetsService, useValue: presets },
      ],
    }).compile();

    listener = moduleRef.get(NotificationEventListener);
  });

  // ─── kind=research ────────────────────────────────────────────────

  it("dispatches research kind to notifyResearchCompleted", async () => {
    await listener.handleTaskCompleted({
      kind: "research",
      userId: "u1",
      refId: "mission-1",
      parentId: "topic-1",
      title: "美国 AI 宏观洞察",
      metrics: { completedTasks: 5, totalTasks: 5 },
    });

    expect(presets.notifyResearchCompleted).toHaveBeenCalledWith({
      userId: "u1",
      researchId: "mission-1",
      researchTitle: "美国 AI 宏观洞察",
      // 2026-05-12: 转发 topicId 给 preset 用作 /ai-insights/topic/{id} 真实路由
      topicId: "topic-1",
    });
  });

  // ─── kind=writing ─────────────────────────────────────────────────

  it("dispatches writing kind with project metadata + biz-name params", async () => {
    await listener.handleTaskCompleted({
      kind: "writing",
      userId: "u1",
      refId: "mission-w1",
      parentId: "project-1",
      title: "我的小说",
      missionType: "continue_story",
      metrics: { totalWords: 12000 },
    });

    expect(presets.notifyWritingTaskCompleted).toHaveBeenCalledWith({
      userId: "u1",
      projectId: "project-1",
      missionId: "mission-w1",
      projectName: "我的小说",
      missionType: "continue_story",
      appBasePath: "/ai-writing/projects",
      relatedType: "writing-mission",
      totalWords: 12000,
    });
  });

  it("falls back to refId for projectId when parentId missing", async () => {
    await listener.handleTaskCompleted({
      kind: "writing",
      userId: "u1",
      refId: "mission-w2",
      title: "标题",
      missionType: "full_story",
    });

    expect(presets.notifyWritingTaskCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "mission-w2" }),
    );
  });

  // ─── kind=office-slides ───────────────────────────────────────────

  it("dispatches office-slides kind with pageCount + biz-name params", async () => {
    await listener.handleTaskCompleted({
      kind: "office-slides",
      userId: "u1",
      refId: "slides-1",
      title: "Q4 业务回顾",
      metrics: { pageCount: 18 },
    });

    expect(presets.notifyOfficeSlidesCompleted).toHaveBeenCalledWith({
      userId: "u1",
      missionId: "slides-1",
      title: "Q4 业务回顾",
      appBasePath: "/ai-office/slides",
      relatedType: "slides-mission",
      pageCount: 18,
    });
  });

  // ─── 守护逻辑 ─────────────────────────────────────────────────────

  it("skips when userId missing", async () => {
    await listener.handleTaskCompleted({
      kind: "research",
      userId: "",
      refId: "mission-1",
      title: "X",
    });

    expect(presets.notifyResearchCompleted).not.toHaveBeenCalled();
  });

  it("skips when refId missing", async () => {
    await listener.handleTaskCompleted({
      kind: "research",
      userId: "u1",
      refId: "",
      title: "X",
    });

    expect(presets.notifyResearchCompleted).not.toHaveBeenCalled();
  });

  it("uses refId as fallback when title is empty", async () => {
    await listener.handleTaskCompleted({
      kind: "research",
      userId: "u1",
      refId: "mission-no-title",
      title: "",
    });

    expect(presets.notifyResearchCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ researchTitle: "mission-no-title" }),
    );
  });

  it("swallows preset errors (logs only)", async () => {
    presets.notifyResearchCompleted.mockRejectedValue(new Error("DB down"));

    await expect(
      listener.handleTaskCompleted({
        kind: "research",
        userId: "u1",
        refId: "m1",
        title: "X",
      } satisfies TaskCompletedNotificationPayload),
    ).resolves.toBeUndefined();
  });

  it("ignores unknown kind without throwing", async () => {
    await expect(
      listener.handleTaskCompleted({
        // @ts-expect-error 故意传未知 kind 测试运行时容错
        kind: "unknown-kind",
        userId: "u1",
        refId: "m1",
        title: "X",
      }),
    ).resolves.toBeUndefined();

    expect(presets.notifyResearchCompleted).not.toHaveBeenCalled();
    expect(presets.notifyWritingTaskCompleted).not.toHaveBeenCalled();
    expect(presets.notifyOfficeSlidesCompleted).not.toHaveBeenCalled();
  });
});
