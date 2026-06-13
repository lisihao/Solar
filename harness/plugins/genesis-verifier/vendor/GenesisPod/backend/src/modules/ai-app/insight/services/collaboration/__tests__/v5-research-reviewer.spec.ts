import { describe, it, expect, beforeEach } from "@jest/globals";
import { ResearchReviewerService } from "../research-reviewer.service";
import { createMockAiEngineFacade } from "../../../__tests__/mocks";

describe("ResearchReviewerService - V5 Methods", () => {
  let service: ResearchReviewerService;
  let mockAiFacade: ReturnType<typeof createMockAiEngineFacade>;

  beforeEach(() => {
    mockAiFacade = createMockAiEngineFacade();
    service = new ResearchReviewerService(mockAiFacade as any);
  });

  describe("validateClaims", () => {
    it("should batch 12 claims into 3 calls", async () => {
      const claims = Array.from({ length: 12 }, (_, i) => ({
        id: `c${i}`,
        statement: `Claim ${i}`,
        sectionId: "s1",
        sourceEvidenceIndices: [0],
        importance: "medium" as const,
      }));

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          results: [
            {
              claimId: "c0",
              status: "verified",
              supportingSourceIndices: [0],
              contradictingSourceIndices: [],
              explanation: "ok",
            },
          ],
        }),
      });

      await service.validateClaims(claims, "evidence");
      // 12 claims / 5 per batch = 3 calls
      expect(mockAiFacade.chatWithSkills).toHaveBeenCalledTimes(3);
    });

    it("should mark batch claims as unverified on failure", async () => {
      const claims = Array.from({ length: 7 }, (_, i) => ({
        id: `c${i}`,
        statement: `Claim ${i}`,
        sectionId: "s1",
        sourceEvidenceIndices: [0],
        importance: "medium" as const,
      }));

      // First batch succeeds, second fails
      mockAiFacade.chatWithSkills
        .mockResolvedValueOnce({
          content: JSON.stringify({
            results: claims.slice(0, 5).map((c) => ({
              claimId: c.id,
              status: "verified",
              supportingSourceIndices: [0],
              contradictingSourceIndices: [],
              explanation: "ok",
            })),
          }),
        })
        .mockRejectedValueOnce(new Error("API error"));

      const result = await service.validateClaims(claims, "evidence");

      // 5 verified from first batch + 2 unverified from failed second batch
      expect(result.stats.verified).toBe(5);
      expect(result.stats.unverified).toBe(2);
      expect(result.stats.total).toBe(7);
    });

    it("should return empty for 0 claims without calling AI", async () => {
      const result = await service.validateClaims([], "evidence");
      expect(result.results).toEqual([]);
      expect(result.stats.total).toBe(0);
      expect(mockAiFacade.chatWithSkills).not.toHaveBeenCalled();
    });

    it("should compute stats correctly", async () => {
      const claims = Array.from({ length: 3 }, (_, i) => ({
        id: `c${i}`,
        statement: `Claim ${i}`,
        sectionId: "s1",
        sourceEvidenceIndices: [0],
        importance: "medium" as const,
      }));

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          results: [
            {
              claimId: "c0",
              status: "verified",
              supportingSourceIndices: [],
              contradictingSourceIndices: [],
              explanation: "",
            },
            {
              claimId: "c1",
              status: "disputed",
              supportingSourceIndices: [],
              contradictingSourceIndices: [],
              explanation: "",
            },
            {
              claimId: "c2",
              status: "unverified",
              supportingSourceIndices: [],
              contradictingSourceIndices: [],
              explanation: "",
            },
          ],
        }),
      });

      const result = await service.validateClaims(claims, "evidence");
      expect(result.stats).toEqual({
        verified: 1,
        unverified: 1,
        disputed: 1,
        total: 3,
      });
    });
  });

  describe("factCheckReport", () => {
    it("should extract citations and fact check them", async () => {
      const report =
        "Market grew 15% according to reports [1]. Revenue doubled [2].";
      const evidence = [
        { id: "e1", title: "Market Report", snippet: "Market grew 15%" },
        { id: "e2", title: "Financial Report", snippet: "Revenue doubled" },
      ];

      mockAiFacade.chatWithSkills.mockResolvedValue({
        content: JSON.stringify({
          citations: [
            {
              citationMark: "[1]",
              context: "Market grew 15%",
              consistent: true,
            },
            {
              citationMark: "[2]",
              context: "Revenue doubled",
              consistent: true,
            },
          ],
          accuracyScore: 95,
          issues: [],
        }),
      });

      const result = await service.factCheckReport(report, evidence);
      expect(result.accuracyScore).toBe(95);
      expect(result.citations).toHaveLength(2);
    });

    it("should return accuracyScore=100 when no citations found", async () => {
      const result = await service.factCheckReport("No citations here.", []);
      expect(result.accuracyScore).toBe(100);
      expect(result.citations).toEqual([]);
      expect(mockAiFacade.chatWithSkills).not.toHaveBeenCalled();
    });

    it("should return accuracyScore=0 on AI failure", async () => {
      const report = "Something [1] happened.";
      const evidence = [{ id: "e1", title: "Report", snippet: "data" }];

      mockAiFacade.chatWithSkills.mockRejectedValue(new Error("API error"));

      const result = await service.factCheckReport(report, evidence);
      expect(result.accuracyScore).toBe(0);
      expect(result.issues).toContain("事实核查过程出错");
    });
  });
});
