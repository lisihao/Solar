import { Test, TestingModule } from "@nestjs/testing";
import { PostWriteValidationService } from "../post-write-validation.service";
import { PrismaService } from "../../../../../../common/prisma/prisma.service";

describe("PostWriteValidationService", () => {
  let service: PostWriteValidationService;
  let mockPrisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    mockPrisma = {
      writingChapter: {
        findUnique: jest.fn(),
      },
    } as unknown as jest.Mocked<PrismaService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostWriteValidationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<PostWriteValidationService>(
      PostWriteValidationService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const makeChapterWithBible = (
    overrides: {
      characters?: Array<{ name: string; appearance?: Record<string, string> }>;
      terminologies?: Array<{
        term: string;
        variants?: string[];
      }>;
      worldSettings?: Array<{ rules?: string[] }>;
    } = {},
  ) => ({
    id: "chapter-1",
    volumeId: "volume-1",
    volume: {
      id: "volume-1",
      project: {
        id: "project-1",
        storyBible: {
          id: "bible-1",
          characters: overrides.characters ?? [],
          worldSettings: overrides.worldSettings ?? [],
          terminologies: overrides.terminologies ?? [],
        },
      },
    },
  });

  describe("validate", () => {
    it("should return PASSED status when no story bible exists", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue({
        id: "chapter-1",
        volume: {
          project: {
            storyBible: null,
          },
        },
      });

      const result = await service.validate("chapter-1", "Some content");

      expect(result.status).toBe("PASSED");
      expect(result.issues).toHaveLength(0);
    });

    it("should return PASSED status when chapter not found (no bible)", async () => {
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      const result = await service.validate("nonexistent", "Some content");

      expect(result.status).toBe("PASSED");
      expect(result.issues).toHaveLength(0);
    });

    it("should return PASSED when content is consistent with bible", async () => {
      const chapter = makeChapterWithBible({
        characters: [{ name: "萧炎", appearance: { eyes: "black" } }],
        terminologies: [],
        worldSettings: [],
      });
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        chapter,
      );

      const content = "萧炎走过花园，内心平静。";
      const result = await service.validate("chapter-1", content);

      expect(result.status).toBe("PASSED");
      expect(result.issues).toHaveLength(0);
    });

    it("should detect terminology inconsistency when multiple variants used", async () => {
      const chapter = makeChapterWithBible({
        characters: [],
        terminologies: [
          {
            term: "斗气",
            variants: ["dou qi", "斗力"],
          },
        ],
        worldSettings: [],
      });
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        chapter,
      );

      // Both variants appear in content
      const content = "他的dou qi提升了，斗力也增强了，令人震惊。";
      const result = await service.validate("chapter-1", content);

      expect(result.status).toBe("ISSUES_FOUND");
      const termIssue = result.issues.find((i) => i.type === "TERMINOLOGY");
      expect(termIssue).toBeDefined();
      expect(termIssue?.severity).toBe("WARNING");
    });

    it("should not flag terminology when only one variant is used", async () => {
      const chapter = makeChapterWithBible({
        terminologies: [{ term: "斗气", variants: ["dou qi", "斗力"] }],
      });
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        chapter,
      );

      // Only one variant
      const content = "他的斗气提升了，令人震惊。";
      const result = await service.validate("chapter-1", content);

      // No terminology issue
      const termIssues = result.issues.filter((i) => i.type === "TERMINOLOGY");
      expect(termIssues).toHaveLength(0);
    });

    it("should return ISSUES_FOUND when issues are found", async () => {
      const chapter = makeChapterWithBible({
        terminologies: [{ term: "斗气", variants: ["dou qi", "斗力"] }],
      });
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        chapter,
      );

      const content = "dou qi和斗力的说法都存在于本章。";
      const result = await service.validate("chapter-1", content);

      expect(result.status).toBe("ISSUES_FOUND");
    });

    it("should collect suggestions from all issues", async () => {
      const chapter = makeChapterWithBible({
        terminologies: [{ term: "斗气", variants: ["dou qi", "斗力"] }],
      });
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        chapter,
      );

      const content = "dou qi和斗力都出现了。";
      const result = await service.validate("chapter-1", content);

      expect(result.suggestions.length).toBeGreaterThan(0);
      result.suggestions.forEach((s) => {
        expect(typeof s).toBe("string");
      });
    });

    it("should handle empty characters array", async () => {
      const chapter = makeChapterWithBible({
        characters: [],
        terminologies: [],
        worldSettings: [],
      });
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        chapter,
      );

      const result = await service.validate("chapter-1", "一些内容");

      expect(result.status).toBe("PASSED");
    });

    it("should handle world settings without rules", async () => {
      const chapter = makeChapterWithBible({
        worldSettings: [{ rules: undefined }],
      });
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        chapter,
      );

      const result = await service.validate("chapter-1", "内容");

      expect(result.issues).toHaveLength(0);
    });

    it("should handle terminology with no variants", async () => {
      const chapter = makeChapterWithBible({
        terminologies: [{ term: "斗气", variants: [] }],
      });
      (mockPrisma.writingChapter.findUnique as jest.Mock).mockResolvedValue(
        chapter,
      );

      const result = await service.validate("chapter-1", "斗气很强");

      const termIssues = result.issues.filter((i) => i.type === "TERMINOLOGY");
      expect(termIssues).toHaveLength(0);
    });
  });
});
