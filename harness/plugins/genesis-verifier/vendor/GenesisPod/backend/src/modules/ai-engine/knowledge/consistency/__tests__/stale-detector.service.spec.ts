/**
 * StaleDetectorService spec
 *
 * v1.5.3 P0a-3: verifies stale detection behavior, including threshold
 * application, missing-id fallback, and conservative LLM-failure fallback.
 */

import {
  StaleDetectorService,
  StaleSourceEntry,
} from "../stale-detector.service";

type ChatFn = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<{ content: string; tokensUsed: number }>;

function makeChatFn(
  results: Array<{ id: string; driftScore: number; reason?: string }>,
  tokensUsed = 100,
): jest.MockedFunction<ChatFn> {
  const content = JSON.stringify({ results });
  return jest.fn().mockResolvedValue({ content, tokensUsed });
}

function makeEntry(
  overrides: Partial<StaleSourceEntry> = {},
): StaleSourceEntry {
  return {
    id: "entry-1",
    sources: [{ referenceText: "old quote", currentText: "new quote" }],
    ...overrides,
  };
}

describe("StaleDetectorService", () => {
  let service: StaleDetectorService;

  beforeEach(() => {
    service = new StaleDetectorService();
  });

  it("returns [] without calling chatFn for empty entries", async () => {
    const chatFn = makeChatFn([]);
    const result = await service.detect([], chatFn);
    expect(chatFn).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("marks entries above the default threshold (0.3) as stale", async () => {
    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    const chatFn = makeChatFn([
      { id: "a", driftScore: 0.1 },
      { id: "b", driftScore: 0.7, reason: "meaning reversed" },
    ]);

    const result = await service.detect(entries, chatFn);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: "a", isStale: false, driftScore: 0.1 });
    expect(result[1]).toEqual({
      id: "b",
      isStale: true,
      driftScore: 0.7,
      reason: "meaning reversed",
    });
  });

  it("respects custom staleThreshold", async () => {
    const entries = [makeEntry({ id: "a" })];
    const chatFn = makeChatFn([
      { id: "a", driftScore: 0.4, reason: "moderate shift" },
    ]);

    const result = await service.detect(entries, chatFn, {
      staleThreshold: 0.5,
    });

    expect(result[0].isStale).toBe(false);
    expect(result[0].driftScore).toBe(0.4);
  });

  it("preserves input order even when LLM returns results in different order", async () => {
    const entries = [
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
      makeEntry({ id: "c" }),
    ];
    const chatFn = makeChatFn([
      { id: "c", driftScore: 0.9 },
      { id: "a", driftScore: 0.1 },
      { id: "b", driftScore: 0.5 },
    ]);

    const result = await service.detect(entries, chatFn);

    expect(result.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to driftScore=0 for entries missing in LLM response", async () => {
    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    const chatFn = makeChatFn([{ id: "a", driftScore: 0.9 }]);

    const result = await service.detect(entries, chatFn);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ id: "b", isStale: false, driftScore: 0 });
  });

  it("clamps driftScore out of [0,1] range to 0", async () => {
    const entries = [makeEntry({ id: "a" })];
    const chatFn = makeChatFn([{ id: "a", driftScore: 1.5 }]);

    const result = await service.detect(entries, chatFn);

    expect(result[0].driftScore).toBe(0);
    expect(result[0].isStale).toBe(false);
  });

  it("handles non-JSON LLM response by returning all-not-stale", async () => {
    const entries = [makeEntry({ id: "a" }), makeEntry({ id: "b" })];
    const chatFn: jest.MockedFunction<ChatFn> = jest
      .fn()
      .mockResolvedValue({ content: "no json here", tokensUsed: 50 });

    const result = await service.detect(entries, chatFn);

    expect(result).toHaveLength(2);
    expect(result.every((r) => !r.isStale)).toBe(true);
  });

  it("returns conservative fallback (all-not-stale) on chatFn rejection", async () => {
    const entries = [makeEntry({ id: "a" })];
    const chatFn: jest.MockedFunction<ChatFn> = jest
      .fn()
      .mockRejectedValue(new Error("LLM down"));

    const result = await service.detect(entries, chatFn);

    expect(result).toEqual([{ id: "a", isStale: false, driftScore: 0 }]);
  });

  it("omits reason when entry is not stale", async () => {
    const entries = [makeEntry({ id: "a" })];
    const chatFn = makeChatFn([
      { id: "a", driftScore: 0.1, reason: "minor whitespace only" },
    ]);

    const result = await service.detect(entries, chatFn);

    expect(result[0].isStale).toBe(false);
    expect(result[0].reason).toBeUndefined();
  });

  it("buildUserPrompt includes all source pairs and truncates long texts", async () => {
    const entries = [
      makeEntry({
        id: "long",
        sources: [
          { referenceText: "x".repeat(700), currentText: "y".repeat(700) },
        ],
      }),
    ];
    const prompt = service.buildUserPrompt(entries);

    expect(prompt).toContain("Entry: long");
    expect(prompt).toContain("Reference quote:");
    expect(prompt).toContain("Current text:");
    // truncation marker
    expect(prompt).toContain("…");
  });
});
