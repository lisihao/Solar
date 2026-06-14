import { Test } from "@nestjs/testing";
import { RadarDailyBriefingRepo } from "../radar-daily-briefing.repo";
import { NarrativeService } from "../narrative.service";

const TOPIC_ID = "topic-1";
const NARRATIVE_ID = "narr-abc";

function makeBriefing(date: string, signals: object[]) {
  return {
    id: `briefing-${date}`,
    topicId: TOPIC_ID,
    userId: "user-1",
    briefingDate: new Date(date),
    generationRunId: null,
    signals,
    status: "completed",
    generatedAt: new Date(),
  };
}

describe("NarrativeService.getNarrativeThread", () => {
  let service: NarrativeService;
  let repo: { findRecentByTopic: jest.Mock };

  beforeEach(async () => {
    repo = { findRecentByTopic: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        NarrativeService,
        { provide: RadarDailyBriefingRepo, useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(NarrativeService);
  });

  it("returns null when no briefings contain the narrativeId", async () => {
    repo.findRecentByTopic.mockResolvedValueOnce([
      makeBriefing("2026-05-18", [
        { id: "s-1", narrativeId: "other-narr", title: "T1", tier: 2 },
      ]),
    ]);
    const result = await service.getNarrativeThread(TOPIC_ID, NARRATIVE_ID);
    expect(result).toBeNull();
  });

  it("returns null when only 1 episode matches (< 2 threshold)", async () => {
    repo.findRecentByTopic.mockResolvedValueOnce([
      makeBriefing("2026-05-18", [
        { id: "s-1", narrativeId: NARRATIVE_ID, title: "Single ep", tier: 3 },
      ]),
    ]);
    const result = await service.getNarrativeThread(TOPIC_ID, NARRATIVE_ID);
    expect(result).toBeNull();
  });

  it("returns sorted episodes asc + label = latest title when >= 2 episodes", async () => {
    // briefings returned desc from repo (newest first), service must sort asc
    repo.findRecentByTopic.mockResolvedValueOnce([
      makeBriefing("2026-05-18", [
        {
          id: "s-3",
          narrativeId: NARRATIVE_ID,
          title: "Episode 3 title",
          tier: 3,
        },
      ]),
      makeBriefing("2026-05-16", [
        {
          id: "s-2",
          narrativeId: NARRATIVE_ID,
          title: "Episode 2 title",
          tier: 2,
        },
        { id: "s-x", narrativeId: "other", title: "Noise", tier: 1 },
      ]),
      makeBriefing("2026-05-14", [
        {
          id: "s-1",
          narrativeId: NARRATIVE_ID,
          title: "Episode 1 title",
          tier: 1,
        },
      ]),
    ]);

    const result = await service.getNarrativeThread(TOPIC_ID, NARRATIVE_ID);

    expect(result).not.toBeNull();
    expect(result!.narrativeId).toBe(NARRATIVE_ID);
    // label must be the latest episode's title (2026-05-18 = "Episode 3 title")
    expect(result!.label).toBe("Episode 3 title");
    // episodes must be sorted asc by date
    expect(result!.episodes).toHaveLength(3);
    expect(result!.episodes[0].date).toBe("2026-05-14");
    expect(result!.episodes[0].signalId).toBe("s-1");
    expect(result!.episodes[1].date).toBe("2026-05-16");
    expect(result!.episodes[1].signalId).toBe("s-2");
    expect(result!.episodes[2].date).toBe("2026-05-18");
    expect(result!.episodes[2].signalId).toBe("s-3");
    // noise signal must be excluded
    const ids = result!.episodes.map((e) => e.signalId);
    expect(ids).not.toContain("s-x");
  });
});
