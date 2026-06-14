/**
 * ResearchMemoryService Supplemental Tests
 *
 * Targets uncovered lines:
 * - line 174: filtered out invalid findings warning (findings with empty entity/category/finding)
 * - line 191: P2021 (table not exist) error in extractAndStoreFindings createMany
 * - lines 271-274: P2021 in getRelevantMemories
 * - lines 339-342: P2021 in getMemorySummary
 * - lines 380-389: buildExtractionPrompt with object-format findings/trends/challenges
 */

// Break the ai-harness/facade import chain
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));
jest.mock("@/modules/ai-harness/facade", () => ({
  ChatFacade: jest.fn(),
}));

import { Test, TestingModule } from "@nestjs/testing";
import { ResearchMemoryService } from "../research-memory.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ChatFacade } from "@/modules/ai-harness/facade";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePrismaP2021(): PrismaClientKnownRequestError {
  return new PrismaClientKnownRequestError("Table does not exist", {
    code: "P2021",
    clientVersion: "5.0.0",
    meta: {},
  });
}

function buildMocks() {
  const mockPrisma = {
    researchMission: {
      findUnique: jest.fn(),
    },
    researchMemory: {
      findMany: jest.fn(),
      createMany: jest.fn(),
      deleteMany: jest.fn(),
    },
  };

  const mockAiFacade = {
    chat: jest.fn().mockResolvedValue({
      content: JSON.stringify({
        findings: [
          {
            entity: "AI Market",
            finding: "AI market is growing at 15% annually",
            category: "fact",
            confidence: 0.9,
            sourceDimension: "Market Analysis",
            sourceUrls: [],
            tags: ["AI", "market"],
          },
        ],
      }),
    }),
  };

  return { mockPrisma, mockAiFacade };
}

async function createService(mocks: ReturnType<typeof buildMocks>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ResearchMemoryService,
      { provide: PrismaService, useValue: mocks.mockPrisma },
      { provide: ChatFacade, useValue: mocks.mockAiFacade },
    ],
  }).compile();

  const service = module.get<ResearchMemoryService>(ResearchMemoryService);

  jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "error").mockImplementation(() => undefined);
  jest.spyOn(service["logger"], "debug").mockImplementation(() => undefined);

  return service;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ResearchMemoryService (supplemental)", () => {
  afterEach(() => jest.clearAllMocks());

  // ─── extractAndStoreFindings – filtered invalid findings (line 174) ──────────

  describe("extractAndStoreFindings – filtered out invalid findings (line 174)", () => {
    it("should warn when some findings have empty entity/category", async () => {
      const mocks = buildMocks();

      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        tasks: [
          {
            id: "task-1",
            dimensionName: "Market Analysis",
            result: {
              summary: "Market is growing",
              keyFindings: [],
              trends: [],
              challenges: [],
            },
            resultSummary: "Market growing",
          },
        ],
      });

      // AI returns findings with some invalid ones (empty entity or category)
      mocks.mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          findings: [
            {
              entity: "AI Market",
              finding: "15% growth",
              category: "fact",
              confidence: 0.9,
              sourceUrls: [],
              tags: [],
            },
            {
              entity: "", // empty entity → should be filtered
              finding: "some finding",
              category: "trend",
              confidence: 0.8,
              sourceUrls: [],
              tags: [],
            },
            {
              entity: "Another Entity",
              finding: "", // empty finding → filtered
              category: "trend",
              confidence: 0.7,
              sourceUrls: [],
              tags: [],
            },
          ],
        }),
      });

      mocks.mockPrisma.researchMemory.createMany.mockResolvedValue({
        count: 1,
      });

      const warnCalls: string[] = [];
      const mocks2 = buildMocks();
      mocks2.mockPrisma.researchMission.findUnique =
        mocks.mockPrisma.researchMission.findUnique;
      mocks2.mockAiFacade.chat = mocks.mockAiFacade.chat;
      mocks2.mockPrisma.researchMemory.createMany =
        mocks.mockPrisma.researchMemory.createMany;

      const service = await createService(mocks);

      jest
        .spyOn(service["logger"], "warn")
        .mockImplementation((msg: string) => {
          warnCalls.push(msg);
        });

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );

      expect(result).toBe(1);
      // Should have warned about filtered invalid findings
      const filteredWarn = warnCalls.some((c) => c.includes("Filtered out"));
      expect(filteredWarn).toBe(true);
    });
  });

  // ─── extractAndStoreFindings – P2021 table not exist (line 191) ──────────────

  describe("extractAndStoreFindings – P2021 table does not exist (line 191)", () => {
    it("should return 0 when table does not exist (P2021)", async () => {
      const mocks = buildMocks();

      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        tasks: [
          {
            id: "task-1",
            dimensionName: "Market Analysis",
            result: {
              summary: "Market is growing",
              keyFindings: [],
              trends: [],
              challenges: [],
            },
            resultSummary: "Growing",
          },
        ],
      });

      // AI returns valid findings
      mocks.mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          findings: [
            {
              entity: "AI Market",
              finding: "Growing market",
              category: "fact",
              confidence: 0.9,
              sourceUrls: [],
              tags: [],
            },
          ],
        }),
      });

      // createMany throws P2021
      mocks.mockPrisma.researchMemory.createMany.mockRejectedValue(
        makePrismaP2021(),
      );

      const service = await createService(mocks);

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );

      // Returns 0 (stored 0, not throwing)
      expect(result).toBe(0);
    });
  });

  // ─── getRelevantMemories – P2021 (lines 271-274) ─────────────────────────────

  describe("getRelevantMemories – P2021 table does not exist (lines 271-274)", () => {
    it("should return empty array when table does not exist", async () => {
      const mocks = buildMocks();

      mocks.mockPrisma.researchMemory.findMany.mockRejectedValue(
        makePrismaP2021(),
      );

      const service = await createService(mocks);

      const result = await service.getRelevantMemories("AI market", "topic-1");

      expect(result).toEqual([]);
    });
  });

  // ─── getMemorySummary – P2021 (lines 339-342) ────────────────────────────────

  describe("getMemorySummary – P2021 table does not exist (lines 339-342)", () => {
    it("should return fallback message when table does not exist", async () => {
      const mocks = buildMocks();

      mocks.mockPrisma.researchMemory.findMany.mockRejectedValue(
        makePrismaP2021(),
      );

      const service = await createService(mocks);

      const result = await service.getMemorySummary("topic-1");

      expect(result).toBe("暂无先前研究记忆。");
    });
  });

  // ─── buildExtractionPrompt – object-format findings/trends/challenges (lines 380-389) ──

  describe("buildExtractionPrompt – object-format findings and trends (lines 380-389)", () => {
    it("should handle object-format keyFindings, trends, and challenges in buildExtractionPrompt", async () => {
      const mocks = buildMocks();

      // Mission with object-format result fields (not string arrays)
      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        tasks: [
          {
            id: "task-1",
            dimensionName: "Market Analysis",
            result: {
              summary: "AI market analysis",
              keyFindings: [
                // object format (not plain string)
                { finding: "AI market grows 15% annually", title: "Growth" },
                { finding: "Cloud dominates AI infrastructure" },
              ],
              trends: [
                { description: "Generative AI adoption increasing" },
                "Edge AI is emerging", // string format
              ],
              challenges: [
                { description: "High compute costs" },
                "Regulatory uncertainty",
              ],
            },
            resultSummary: "Market growing",
          },
        ],
      });

      // AI returns findings
      mocks.mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          findings: [
            {
              entity: "AI Market",
              finding: "15% growth",
              category: "fact",
              confidence: 0.9,
              sourceUrls: [],
              tags: [],
            },
          ],
        }),
      });

      mocks.mockPrisma.researchMemory.createMany.mockResolvedValue({
        count: 1,
      });

      const service = await createService(mocks);

      // Verify the AI chat was called with a prompt that includes the object fields
      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );

      expect(result).toBe(1);
      // Verify chat was called (implies buildExtractionPrompt ran)
      expect(mocks.mockAiFacade.chat).toHaveBeenCalled();
      const callArgs = mocks.mockAiFacade.chat.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content as string;
      // The prompt should contain some recognizable content from the result fields
      expect(userMessage).toContain("Market Analysis");
    });

    it("should also work with analysisResult nested keyFindings", async () => {
      const mocks = buildMocks();

      mocks.mockPrisma.researchMission.findUnique.mockResolvedValue({
        id: "mission-1",
        tasks: [
          {
            id: "task-1",
            dimensionName: "Technology Analysis",
            result: {
              // No top-level keyFindings – uses analysisResult nested form
              analysisResult: {
                keyFindings: [
                  { finding: "GPU demand surged 300%" },
                  { finding: "Model sizes grew 10x" },
                ],
              },
              trends: [],
              challenges: [],
            },
            resultSummary: "Tech analysis done",
          },
        ],
      });

      mocks.mockAiFacade.chat.mockResolvedValue({
        content: JSON.stringify({
          findings: [
            {
              entity: "GPU Demand",
              finding: "Surged 300%",
              category: "fact",
              confidence: 0.9,
              sourceUrls: [],
              tags: [],
            },
          ],
        }),
      });

      mocks.mockPrisma.researchMemory.createMany.mockResolvedValue({
        count: 1,
      });

      const service = await createService(mocks);

      const result = await service.extractAndStoreFindings(
        "mission-1",
        "topic-1",
      );

      expect(result).toBe(1);
    });
  });
});
