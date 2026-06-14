import { Test, TestingModule } from "@nestjs/testing";
import { NotificationDispatcher } from "../notification-dispatcher.service";
import { RadarMissionCompletePreset } from "../presets/radar-mission-complete.preset";

describe("RadarMissionCompletePreset (PR-DR1a 老 caller 迁移示范)", () => {
  let preset: RadarMissionCompletePreset;
  let dispatcher: jest.Mocked<NotificationDispatcher>;

  beforeEach(async () => {
    dispatcher = {
      dispatch: jest.fn().mockResolvedValue({
        userId: "u1",
        type: "RADAR_MISSION_COMPLETE",
        results: [{ channel: "site", status: "sent" }],
        delivered: true,
      }),
    } as unknown as jest.Mocked<NotificationDispatcher>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RadarMissionCompletePreset,
        { provide: NotificationDispatcher, useValue: dispatcher },
      ],
    }).compile();
    preset = module.get(RadarMissionCompletePreset);
  });

  it.each([
    ["discovery", "AI 雷达数据源发现完成"],
    ["refresh", "AI 雷达数据刷新完成"],
    ["daily-briefing", "今日精选已出炉"],
  ] as const)("missionKind=%s → title=%s", async (kind, expectedTitle) => {
    await preset.notify({
      userId: "u1",
      topicId: "t1",
      topicName: "英伟达股价",
      missionKind: kind,
      itemCount: 5,
    });
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        type: "RADAR_MISSION_COMPLETE",
        title: expectedTitle,
        message: "「英伟达股价」本次更新 5 条",
        link: "/ai-radar/topic/t1",
        metadata: { topicId: "t1", missionKind: kind, itemCount: 5 },
      }),
    );
  });

  it("itemCount=0 + refresh → 显示'本次无新内容 · 持续监控中'", async () => {
    await preset.notify({
      userId: "u1",
      topicId: "t1",
      topicName: "测试主题",
      missionKind: "refresh",
      itemCount: 0,
    });
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        message: "「测试主题」本次无新内容 · 持续监控中",
      }),
    );
  });

  it("R1 behavior 整改：itemCount=0 + daily-briefing → '今日无新信号'（对齐 A1 决策）", async () => {
    await preset.notify({
      userId: "u1",
      topicId: "t1",
      topicName: "英伟达",
      missionKind: "daily-briefing",
      itemCount: 0,
    });
    expect(dispatcher.dispatch).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        message: "「英伟达」今日无新信号 · 持续监控中",
      }),
    );
  });

  it("返回 dispatcher 的 DispatchResult", async () => {
    const result = await preset.notify({
      userId: "u1",
      topicId: "t1",
      topicName: "x",
      missionKind: "discovery",
      itemCount: 1,
    });
    expect(result.delivered).toBe(true);
    expect(result.results[0]?.channel).toBe("site");
  });
});
