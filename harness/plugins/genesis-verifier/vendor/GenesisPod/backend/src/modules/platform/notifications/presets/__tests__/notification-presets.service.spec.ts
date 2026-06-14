import { Test, TestingModule } from "@nestjs/testing";
import { NotificationPresetsService } from "../notification-presets.service";
import { NotificationService } from "../../notification.service";

describe("NotificationPresetsService", () => {
  let service: NotificationPresetsService;
  let notificationService: jest.Mocked<NotificationService>;

  const mockNotificationService = {
    batchCreateNotifications: jest.fn().mockResolvedValue({
      count: 2,
      succeeded: ["admin-1", "admin-2"],
      failed: [],
    }),
    createNotification: jest.fn().mockResolvedValue({ id: "notif-1" }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationPresetsService,
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    service = module.get<NotificationPresetsService>(
      NotificationPresetsService,
    );
    notificationService = module.get(NotificationService);
  });

  it("sends join request notifications to admins", async () => {
    await service.notifyJoinRequest({
      topicId: "topic-1",
      topicName: "Test Topic",
      applicantId: "user-2",
      applicantName: "Alice",
      adminUserIds: ["admin-1", "admin-2"],
    });

    expect(notificationService.batchCreateNotifications).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "JOIN_REQUEST",
        userIds: ["admin-1", "admin-2"],
      }),
    );
  });

  it("sends join request approval notification", async () => {
    await service.notifyJoinRequestResult({
      userId: "user-1",
      topicId: "topic-1",
      topicName: "Test Topic",
      approved: true,
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "JOIN_APPROVED",
      }),
    );
  });

  it("sends join request rejection notification", async () => {
    await service.notifyJoinRequestResult({
      userId: "user-1",
      topicId: "topic-1",
      topicName: "Test Topic",
      approved: false,
      reason: "Not eligible",
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "JOIN_REJECTED",
      }),
    );
  });

  it("sends invitation notification", async () => {
    await service.notifyInvitation({
      userId: "user-2",
      topicId: "topic-1",
      topicName: "Test Topic",
      inviterName: "Alice",
      inviteCode: "invite-code",
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "INVITATION",
      }),
    );
  });

  it("sends research completed notification", async () => {
    await service.notifyResearchCompleted({
      userId: "user-1",
      researchId: "research-1",
      researchTitle: "Test Research",
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "RESEARCH_COMPLETED",
      }),
    );
  });

  it("sends low credits notification", async () => {
    await service.notifyCreditsLow({
      userId: "user-1",
      balance: 50,
      threshold: 100,
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CREDITS_LOW",
      }),
    );
  });

  // W4 (2026-05-05): 三个任务完成 preset，appBasePath/relatedType 参数化（biz-name leakage）

  it("sends mission completed notification with appBasePath / relatedType", async () => {
    await service.notifyMissionCompleted({
      userId: "user-1",
      missionId: "m1",
      missionTitle: "M Title",
      appBasePath: "/agent-playground",
      relatedType: "agent-playground-mission",
      reviewScore: 88,
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "MISSION_COMPLETED",
        actionUrl: "/agent-playground/team/m1",
        relatedType: "agent-playground-mission",
        relatedId: "m1",
      }),
    );
  });

  it("sends writing task completed notification with appBasePath / relatedType", async () => {
    await service.notifyWritingTaskCompleted({
      userId: "user-1",
      projectId: "p1",
      missionId: "w1",
      projectName: "我的小说",
      missionType: "continue_story",
      appBasePath: "/ai-writing/projects",
      relatedType: "writing-mission",
      totalWords: 12345,
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "WRITING_COMPLETED",
        actionUrl: "/ai-writing/projects/p1",
        relatedType: "writing-mission",
        relatedId: "w1",
      }),
    );
  });

  it("sends office slides completed notification with appBasePath / relatedType", async () => {
    await service.notifyOfficeSlidesCompleted({
      userId: "user-1",
      missionId: "s1",
      title: "Q4 业务回顾",
      appBasePath: "/ai-office/slides",
      relatedType: "slides-mission",
      pageCount: 18,
    });

    expect(notificationService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "OFFICE_COMPLETED",
        actionUrl: "/ai-office/slides/s1",
        relatedType: "slides-mission",
        relatedId: "s1",
      }),
    );
  });
});
