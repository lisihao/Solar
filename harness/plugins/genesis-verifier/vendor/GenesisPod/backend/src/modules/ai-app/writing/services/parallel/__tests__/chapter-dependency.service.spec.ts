import { ChapterDependencyService } from "../chapter-dependency.service";

describe("ChapterDependencyService", () => {
  let service: ChapterDependencyService;
  let prisma: {
    writingChapter: {
      update: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      writingChapter: {
        update: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new ChapterDependencyService(prisma as never);
  });

  describe("analyze", () => {
    it("infers dependency from previous chapter when no explicit dependsOn", async () => {
      const chapters = [
        { id: "c1", chapterNumber: 1 },
        { id: "c2", chapterNumber: 2 },
        { id: "c3", chapterNumber: 3 },
      ];
      const graph = await service.analyze(chapters);
      expect(graph.get("c1")).toEqual([]);
      expect(graph.get("c2")).toEqual(["c1"]);
      expect(graph.get("c3")).toEqual(["c2"]);
    });

    it("uses explicit dependsOn when set (non-empty)", async () => {
      const chapters = [
        { id: "c1", chapterNumber: 1 },
        { id: "c2", chapterNumber: 2, dependsOn: ["c1"] },
      ];
      const graph = await service.analyze(chapters);
      expect(graph.get("c2")).toEqual(["c1"]);
    });

    it("throws on circular dependencies", async () => {
      const chapters = [
        { id: "a", chapterNumber: 1, dependsOn: ["b"] },
        { id: "b", chapterNumber: 2, dependsOn: ["a"] },
      ];
      await expect(service.analyze(chapters)).rejects.toThrow(
        /Circular dependency/,
      );
    });

    it("self-dependency triggers cycle detection", async () => {
      const chapters = [{ id: "a", chapterNumber: 1, dependsOn: ["a"] }];
      await expect(service.analyze(chapters)).rejects.toThrow(
        /Circular dependency/,
      );
    });

    it("handles disconnected graph without cycle", async () => {
      const chapters = [
        { id: "a", chapterNumber: 1, dependsOn: [] },
        { id: "b", chapterNumber: 5, dependsOn: [] },
      ];
      const graph = await service.analyze(chapters);
      expect(graph.size).toBe(2);
    });
  });

  describe("updateDependencies", () => {
    it("updates writingChapter row with new dependsOn", async () => {
      prisma.writingChapter.update.mockResolvedValue({ id: "c1" });
      await service.updateDependencies("c1", ["c2", "c3"]);
      expect(prisma.writingChapter.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { dependsOn: ["c2", "c3"] },
      });
    });
  });

  describe("getIndependentChapters", () => {
    it("returns chapters with empty dependsOn", async () => {
      prisma.writingChapter.findMany.mockResolvedValue([
        { id: "a", dependsOn: [] },
        { id: "b", dependsOn: ["a"] },
        { id: "c", dependsOn: null },
      ]);
      const result = await service.getIndependentChapters("vol-1");
      expect(result).toEqual(["a", "c"]);
    });

    it("returns empty list when all chapters have deps", async () => {
      prisma.writingChapter.findMany.mockResolvedValue([
        { id: "a", dependsOn: ["x"] },
        { id: "b", dependsOn: ["y"] },
      ]);
      const result = await service.getIndependentChapters("vol-1");
      expect(result).toEqual([]);
    });
  });
});
