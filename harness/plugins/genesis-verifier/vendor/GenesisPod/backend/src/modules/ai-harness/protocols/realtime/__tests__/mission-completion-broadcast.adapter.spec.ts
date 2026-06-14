import { Test } from "@nestjs/testing";
import { MissionCompletionBroadcastAdapter } from "../mission-completion-broadcast.adapter";
import { NotificationPresetsService } from "@/modules/platform/facade";
import type { DomainEvent } from "@/common/events";

describe("MissionCompletionBroadcastAdapter (generic)", () => {
  let adapter: MissionCompletionBroadcastAdapter;
  let presets: jest.Mocked<NotificationPresetsService>;

  beforeEach(async () => {
    presets = {
      notifyMissionCompleted: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<NotificationPresetsService>;

    const moduleRef = await Test.createTestingModule({
      providers: [
        MissionCompletionBroadcastAdapter,
        { provide: NotificationPresetsService, useValue: presets },
      ],
    }).compile();

    adapter = moduleRef.get(MissionCompletionBroadcastAdapter);
  });

  // ─── accepts（通用后缀匹配，零业务名）────────────────────────────
  describe("accepts", () => {
    it.each([
      "playground.mission:completed",
      "radar.mission:completed",
      "writing.mission:completed",
    ])("accepts any <domain>.mission:completed (%s)", (type) => {
      expect(
        adapter.accepts({
          type,
          scope: { userId: "u1" },
          payload: {},
          timestamp: 1,
        } as DomainEvent),
      ).toBe(true);
    });

    it.each(["playground.agent:thought", "x.mission:failed"])(
      "rejects non-completion events (%s)",
      (type) => {
        expect(
          adapter.accepts({
            type,
            scope: { userId: "u1" },
            payload: {},
            timestamp: 1,
          } as DomainEvent),
        ).toBe(false);
      },
    );
  });

  // ─── broadcast（业务细节全部来自 payload）────────────────────────
  describe("broadcast", () => {
    const event = (payload: Record<string, unknown>): DomainEvent =>
      ({
        type: "playground.mission:completed",
        scope: { userId: "u1", missionId: "m1" },
        payload,
        timestamp: 1,
      }) as DomainEvent;

    const fullPayload = {
      leaderSigned: true,
      reviewScore: 87,
      missionTitle: "Anthropic 产品策略分析",
      appBasePath: "/playground",
      relatedType: "playground-mission",
    };

    it("calls notifyMissionCompleted from payload (no DB query)", async () => {
      await adapter.broadcast(event(fullPayload));
      expect(presets.notifyMissionCompleted).toHaveBeenCalledWith({
        userId: "u1",
        missionId: "m1",
        missionTitle: "Anthropic 产品策略分析",
        appBasePath: "/playground",
        relatedType: "playground-mission",
        reviewScore: 87,
      });
    });

    it("falls back to missionId when missionTitle missing/blank", async () => {
      await adapter.broadcast(event({ ...fullPayload, missionTitle: "  " }));
      expect(presets.notifyMissionCompleted).toHaveBeenCalledWith(
        expect.objectContaining({ missionTitle: "m1" }),
      );
    });

    it("skips when leaderSigned=false (rejected mission)", async () => {
      await adapter.broadcast(event({ ...fullPayload, leaderSigned: false }));
      expect(presets.notifyMissionCompleted).not.toHaveBeenCalled();
    });

    it("skips when payload missing appBasePath/relatedType (no business route)", async () => {
      await adapter.broadcast(event({ leaderSigned: true, reviewScore: 87 }));
      expect(presets.notifyMissionCompleted).not.toHaveBeenCalled();
    });

    it("skips when scope has no userId", async () => {
      await adapter.broadcast({
        ...event(fullPayload),
        scope: { missionId: "m1" },
      } as DomainEvent);
      expect(presets.notifyMissionCompleted).not.toHaveBeenCalled();
    });

    it("skips when scope has no missionId", async () => {
      await adapter.broadcast({
        ...event(fullPayload),
        scope: { userId: "u1" },
      } as DomainEvent);
      expect(presets.notifyMissionCompleted).not.toHaveBeenCalled();
    });

    it("swallows preset errors (logs only, never throws)", async () => {
      presets.notifyMissionCompleted.mockRejectedValue(new Error("DB down"));
      await expect(
        adapter.broadcast(event(fullPayload)),
      ).resolves.toBeUndefined();
    });
  });
});
