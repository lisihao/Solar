import { NotFoundException } from "@nestjs/common";
import { YoutubeVideosService } from "../youtube-videos.service";

describe("YoutubeVideosService", () => {
  let service: YoutubeVideosService;
  let prisma: {
    youTubeVideo: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      youTubeVideo: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };
    service = new YoutubeVideosService(prisma as never);
  });

  describe("saveVideo", () => {
    it("creates a new video when not existing", async () => {
      prisma.youTubeVideo.findUnique.mockResolvedValue(null);
      prisma.youTubeVideo.create.mockResolvedValue({ id: "v1" });

      const dto = {
        videoId: "abc123",
        title: "Demo",
        url: "https://youtube.com/watch?v=abc123",
        transcript: "hello",
        translatedText: "你好",
        aiReport: "AI report content",
      };
      const result = await service.saveVideo("user-1", dto as never);

      expect(prisma.youTubeVideo.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          videoId: "abc123",
          title: "Demo",
          url: "https://youtube.com/watch?v=abc123",
          transcript: "hello",
          translatedText: "你好",
          aiReport: "AI report content",
        },
      });
      expect(result).toEqual({ id: "v1" });
    });

    it("updates existing video and only includes provided optional fields", async () => {
      prisma.youTubeVideo.findUnique.mockResolvedValue({ id: "v-old" });
      prisma.youTubeVideo.update.mockResolvedValue({
        id: "v-old",
        title: "New",
      });

      const result = await service.saveVideo("user-1", {
        videoId: "abc",
        title: "New",
        url: "https://youtube.com/watch?v=abc",
        transcript: "updated transcript",
      } as never);

      expect(prisma.youTubeVideo.update).toHaveBeenCalledWith({
        where: { id: "v-old" },
        data: {
          title: "New",
          url: "https://youtube.com/watch?v=abc",
          transcript: "updated transcript",
        },
      });
      expect(result).toEqual({ id: "v-old", title: "New" });
    });

    it("update with translatedText only", async () => {
      prisma.youTubeVideo.findUnique.mockResolvedValue({ id: "v-old" });
      prisma.youTubeVideo.update.mockResolvedValue({});

      await service.saveVideo("user-1", {
        videoId: "abc",
        title: "X",
        url: "https://youtube.com/watch?v=abc",
        translatedText: "中文",
      } as never);

      expect(prisma.youTubeVideo.update).toHaveBeenCalledWith({
        where: { id: "v-old" },
        data: {
          title: "X",
          url: "https://youtube.com/watch?v=abc",
          translatedText: "中文",
        },
      });
    });

    it("update with aiReport only", async () => {
      prisma.youTubeVideo.findUnique.mockResolvedValue({ id: "v-old" });
      prisma.youTubeVideo.update.mockResolvedValue({});

      await service.saveVideo("user-1", {
        videoId: "abc",
        title: "X",
        url: "https://youtube.com/watch?v=abc",
        aiReport: "summary",
      } as never);

      expect(prisma.youTubeVideo.update).toHaveBeenCalledWith({
        where: { id: "v-old" },
        data: {
          title: "X",
          url: "https://youtube.com/watch?v=abc",
          aiReport: "summary",
        },
      });
    });

    it("update without optional fields", async () => {
      prisma.youTubeVideo.findUnique.mockResolvedValue({ id: "v-old" });
      prisma.youTubeVideo.update.mockResolvedValue({});

      await service.saveVideo("user-1", {
        videoId: "abc",
        title: "X",
        url: "https://youtube.com/watch?v=abc",
      } as never);

      expect(prisma.youTubeVideo.update).toHaveBeenCalledWith({
        where: { id: "v-old" },
        data: { title: "X", url: "https://youtube.com/watch?v=abc" },
      });
    });
  });

  describe("getUserVideos", () => {
    it("returns user videos sorted by createdAt desc", async () => {
      const items = [{ id: "v1" }, { id: "v2" }];
      prisma.youTubeVideo.findMany.mockResolvedValue(items);

      const result = await service.getUserVideos("user-1");

      expect(prisma.youTubeVideo.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
      });
      expect(result).toBe(items);
    });
  });

  describe("getVideoById", () => {
    it("returns the video when found and owned by user", async () => {
      prisma.youTubeVideo.findFirst.mockResolvedValue({ id: "v1" });

      const result = await service.getVideoById("v1", "user-1");

      expect(prisma.youTubeVideo.findFirst).toHaveBeenCalledWith({
        where: { id: "v1", userId: "user-1" },
      });
      expect(result).toEqual({ id: "v1" });
    });

    it("throws NotFoundException when video missing or not owned", async () => {
      prisma.youTubeVideo.findFirst.mockResolvedValue(null);

      await expect(service.getVideoById("missing", "user-1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("deleteVideo", () => {
    it("deletes when ownership verified", async () => {
      prisma.youTubeVideo.findFirst.mockResolvedValue({ id: "v1" });
      prisma.youTubeVideo.delete.mockResolvedValue({});

      const result = await service.deleteVideo("v1", "user-1");

      expect(prisma.youTubeVideo.delete).toHaveBeenCalledWith({
        where: { id: "v1" },
      });
      expect(result).toEqual({ message: "Video deleted successfully" });
    });

    it("throws NotFoundException when not owned", async () => {
      prisma.youTubeVideo.findFirst.mockResolvedValue(null);

      await expect(service.deleteVideo("v1", "user-1")).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.youTubeVideo.delete).not.toHaveBeenCalled();
    });
  });
});
