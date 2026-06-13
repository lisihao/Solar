import { RadarWeeklyBriefingService } from "../radar-weekly-briefing.service";
import type { DailySignal } from "../radar-daily-briefing.repo";

function mkSignal(over: Partial<DailySignal>): DailySignal {
  return {
    id: over.id ?? `s-${Math.random()}`,
    tier: 2,
    title: "title",
    oneLineTakeaway: "takeaway",
    whyItMatters: "why",
    whatsNext: "next",
    signalTags: ["turning_point"],
    entities: ["NVIDIA"],
    evidenceItemIds: ["evid-1"],
    ...over,
  };
}

describe("RadarWeeklyBriefingService.assemblePayload (B6 模板拼装)", () => {
  const svc = new RadarWeeklyBriefingService(
    {} as never, // prisma 不参与 assemblePayload，跳过
    {} as never, // dailyRepo 同上
  );

  it("counts tier3/tier2 across week", () => {
    const dailies = [
      {
        briefingDate: new Date("2026-05-12"),
        signals: [
          mkSignal({ tier: 3, score: 0.95 }),
          mkSignal({ tier: 2, score: 0.7 }),
        ],
      },
      {
        briefingDate: new Date("2026-05-14"),
        signals: [
          mkSignal({ tier: 3, score: 0.85 }),
          mkSignal({ tier: 1, score: 0.3 }),
        ],
      },
    ];
    const out = svc.assemblePayload(dailies, {
      topicId: "t",
      weekStart: new Date(),
      weekEnd: new Date(),
    });
    expect(out.tier3Count).toBe(2);
    expect(out.tier2Count).toBe(1);
    expect(out.candidatesTotal).toBe(4);
  });

  it("topSignals sorts ⭐⭐⭐ by score desc and caps at 10", () => {
    const dailies = [
      {
        briefingDate: new Date("2026-05-12"),
        signals: Array.from({ length: 15 }, (_, i) =>
          mkSignal({
            id: `s-${i}`,
            tier: 3,
            score: 1 - i * 0.05,
            title: `title-${i}`,
          }),
        ),
      },
    ];
    const out = svc.assemblePayload(dailies, {
      topicId: "t",
      weekStart: new Date(),
      weekEnd: new Date(),
    });
    expect(out.topSignals).toHaveLength(10);
    expect(out.topSignals[0].title).toBe("title-0");
    expect(out.topSignals[9].title).toBe("title-9");
  });

  it("narrativeMap aggregates by narrativeId and drops singletons (<2 episodes)", () => {
    const dailies = [
      {
        briefingDate: new Date("2026-05-12"),
        signals: [
          mkSignal({ id: "s1", narrativeId: "n1", title: "ep1" }),
          mkSignal({ id: "s2", narrativeId: "lone" }),
        ],
      },
      {
        briefingDate: new Date("2026-05-14"),
        signals: [mkSignal({ id: "s3", narrativeId: "n1", title: "ep2" })],
      },
      {
        briefingDate: new Date("2026-05-16"),
        signals: [mkSignal({ id: "s4", narrativeId: "n1", title: "ep3" })],
      },
    ];
    const out = svc.assemblePayload(dailies, {
      topicId: "t",
      weekStart: new Date(),
      weekEnd: new Date(),
    });
    expect(out.narrativeMap).toHaveLength(1);
    expect(out.narrativeMap[0].narrativeId).toBe("n1");
    expect(out.narrativeMap[0].episodes).toHaveLength(3);
    expect(out.narrativeMap[0].latestTitle).toBe("ep3");
  });

  it("returns empty payload when no daily briefing in week", () => {
    const out = svc.assemblePayload([], {
      topicId: "t",
      weekStart: new Date(),
      weekEnd: new Date(),
    });
    expect(out.candidatesTotal).toBe(0);
    expect(out.tier3Count).toBe(0);
    expect(out.topSignals).toHaveLength(0);
    expect(out.narrativeMap).toHaveLength(0);
  });

  it("newEntities dedup across signals", () => {
    const dailies = [
      {
        briefingDate: new Date("2026-05-12"),
        signals: [
          mkSignal({ entities: ["NVIDIA", "OpenAI"] }),
          mkSignal({ entities: ["NVIDIA", "Anthropic"] }),
        ],
      },
    ];
    const out = svc.assemblePayload(dailies, {
      topicId: "t",
      weekStart: new Date(),
      weekEnd: new Date(),
    });
    expect(out.newEntities.sort()).toEqual(["Anthropic", "NVIDIA", "OpenAI"]);
  });
});
