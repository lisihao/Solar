/**
 * CrossCuttingSynthesisService — detectContradictions / detectDataGaps
 *
 * v1.5.3 P0a-3: low-level public APIs added for wiki-lint + topic-insights.
 * These are thin adapters over synthesize(); tests verify the adapter
 * (document → dimension shape conversion + return value selection).
 */

import {
  CrossCuttingSynthesisService,
  SynthesisDocument,
} from "../cross-cutting-synthesis.service";

type ChatFn = (
  systemPrompt: string,
  userPrompt: string,
) => Promise<{ content: string; tokensUsed: number }>;

function makeChatFn(
  payload: {
    contradictions?: unknown[];
    gaps?: unknown[];
    themes?: unknown[];
    summary?: string;
  } = {},
  tokensUsed = 200,
): jest.MockedFunction<ChatFn> {
  const content = JSON.stringify({
    crossCuttingThemes: payload.themes ?? [],
    contradictions: payload.contradictions ?? [],
    gaps: payload.gaps ?? [],
    executiveSummary: payload.summary ?? "",
  });
  return jest.fn().mockResolvedValue({ content, tokensUsed });
}

function makeDoc(
  overrides: Partial<SynthesisDocument> = {},
): SynthesisDocument {
  return {
    id: "doc-1",
    title: "Doc One",
    body: "Some markdown body.",
    ...overrides,
  };
}

describe("CrossCuttingSynthesisService.detectContradictions", () => {
  let service: CrossCuttingSynthesisService;

  beforeEach(() => {
    service = new CrossCuttingSynthesisService();
  });

  it("returns [] without calling chatFn for empty documents", async () => {
    const chatFn = makeChatFn();
    const result = await service.detectContradictions([], chatFn);
    expect(chatFn).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("forwards documents as dimensions and returns parsed contradictions", async () => {
    const docs = [
      makeDoc({ id: "a", title: "A" }),
      makeDoc({ id: "b", title: "B" }),
    ];
    const chatFn = makeChatFn({
      contradictions: [
        {
          topic: "Growth direction",
          dimensionA: "A",
          dimensionB: "B",
          descriptionA: "growing",
          descriptionB: "declining",
        },
      ],
    });

    const result = await service.detectContradictions(docs, chatFn);

    expect(chatFn).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe("Growth direction");
    expect(result[0].dimensionA).toBe("A");

    // user prompt should embed each doc's title as a dimension name
    const userPrompt = chatFn.mock.calls[0][1];
    expect(userPrompt).toContain("Dimension: A");
    expect(userPrompt).toContain("Dimension: B");
  });

  it("respects samplingLimit by truncating input set", async () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      makeDoc({ id: `d${i}`, title: `T${i}` }),
    );
    const chatFn = makeChatFn({ contradictions: [] });

    await service.detectContradictions(docs, chatFn, { samplingLimit: 3 });

    const userPrompt = chatFn.mock.calls[0][1];
    expect(userPrompt).toContain("Total dimensions: 3");
    expect(userPrompt).toContain("T0");
    expect(userPrompt).toContain("T2");
    expect(userPrompt).not.toContain("T3");
  });

  it("returns [] on chatFn failure (synthesize fallback)", async () => {
    const docs = [makeDoc()];
    const chatFn: jest.MockedFunction<ChatFn> = jest
      .fn()
      .mockRejectedValue(new Error("LLM down"));

    const result = await service.detectContradictions(docs, chatFn);

    expect(result).toEqual([]);
  });

  it("falls back to id when title is undefined", async () => {
    const docs = [makeDoc({ id: "doc-x", title: undefined })];
    const chatFn = makeChatFn({ contradictions: [] });

    await service.detectContradictions(docs, chatFn);

    const userPrompt = chatFn.mock.calls[0][1];
    expect(userPrompt).toContain("doc-x");
  });
});

describe("CrossCuttingSynthesisService.detectDataGaps", () => {
  let service: CrossCuttingSynthesisService;

  beforeEach(() => {
    service = new CrossCuttingSynthesisService();
  });

  it("returns [] without calling chatFn for empty documents", async () => {
    const chatFn = makeChatFn();
    const result = await service.detectDataGaps([], chatFn);
    expect(chatFn).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("returns parsed gaps from synthesize result", async () => {
    const docs = [makeDoc()];
    const chatFn = makeChatFn({
      gaps: [
        {
          area: "Long-term effects",
          coveredBy: ["Doc One"],
          missingPerspective: "10-year outlook",
        },
      ],
    });

    const result = await service.detectDataGaps(docs, chatFn);

    expect(result).toHaveLength(1);
    expect(result[0].area).toBe("Long-term effects");
  });

  it("excludes gaps whose area matches existingEntityIds (case-insensitive)", async () => {
    const docs = [makeDoc()];
    const chatFn = makeChatFn({
      gaps: [
        { area: "Renewable Energy", coveredBy: [], missingPerspective: "..." },
        { area: "Quantum Computing", coveredBy: [], missingPerspective: "..." },
      ],
    });

    const result = await service.detectDataGaps(docs, chatFn, {
      existingEntityIds: ["renewable-energy"],
    });

    expect(result).toHaveLength(1);
    expect(result[0].area).toBe("Quantum Computing");
  });

  it("returns all gaps when existingEntityIds is empty", async () => {
    const docs = [makeDoc()];
    const chatFn = makeChatFn({
      gaps: [{ area: "X", coveredBy: [], missingPerspective: "..." }],
    });

    const result = await service.detectDataGaps(docs, chatFn, {
      existingEntityIds: [],
    });

    expect(result).toHaveLength(1);
  });

  it("returns [] on chatFn failure", async () => {
    const docs = [makeDoc()];
    const chatFn: jest.MockedFunction<ChatFn> = jest
      .fn()
      .mockRejectedValue(new Error("boom"));

    const result = await service.detectDataGaps(docs, chatFn);

    expect(result).toEqual([]);
  });
});
