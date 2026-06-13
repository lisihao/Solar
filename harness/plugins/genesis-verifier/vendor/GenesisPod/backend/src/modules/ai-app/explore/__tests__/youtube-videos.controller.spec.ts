import { Test, TestingModule } from "@nestjs/testing";
import { UnauthorizedException } from "@nestjs/common";
import { YoutubeVideosController } from "../youtube-videos.controller";
import { YoutubeVideosService } from "../youtube-videos.service";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../../../../common/guards/optional-jwt-auth.guard";

const mockGuard = { canActivate: () => true };

describe("YoutubeVideosController", () => {
  let controller: YoutubeVideosController;
  let svc: {
    saveVideo: jest.Mock;
    getUserVideos: jest.Mock;
    getVideoById: jest.Mock;
    deleteVideo: jest.Mock;
  };

  beforeEach(async () => {
    svc = {
      saveVideo: jest.fn(),
      getUserVideos: jest.fn(),
      getVideoById: jest.fn(),
      deleteVideo: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [YoutubeVideosController],
      providers: [{ provide: YoutubeVideosService, useValue: svc }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockGuard)
      .overrideGuard(OptionalJwtAuthGuard)
      .useValue(mockGuard)
      .compile();
    controller = module.get(YoutubeVideosController);
  });

  describe("saveVideo", () => {
    it("delegates to service when authenticated", async () => {
      svc.saveVideo.mockResolvedValue({ id: "v1" });
      const result = await controller.saveVideo(
        { user: { id: "u1", email: "a@b" } } as never,
        { videoId: "abc" } as never,
      );
      expect(svc.saveVideo).toHaveBeenCalledWith("u1", { videoId: "abc" });
      expect(result).toEqual({ id: "v1" });
    });

    it("throws UnauthorizedException when no user id", async () => {
      await expect(
        controller.saveVideo(
          { user: undefined } as never,
          { videoId: "abc" } as never,
        ),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("getUserVideos", () => {
    it("returns service list when authenticated", async () => {
      svc.getUserVideos.mockResolvedValue([{ id: "v1" }]);
      const result = await controller.getUserVideos({
        user: { id: "u1", email: "a@b" },
      } as never);
      expect(result).toEqual([{ id: "v1" }]);
    });

    it("returns empty array for unauthenticated user", async () => {
      const result = await controller.getUserVideos({
        user: undefined,
      } as never);
      expect(result).toEqual([]);
      expect(svc.getUserVideos).not.toHaveBeenCalled();
    });
  });

  describe("getVideoById", () => {
    it("delegates to service when authenticated", async () => {
      svc.getVideoById.mockResolvedValue({ id: "v1" });
      const result = await controller.getVideoById("v1", {
        user: { id: "u1", email: "a@b" },
      } as never);
      expect(svc.getVideoById).toHaveBeenCalledWith("v1", "u1");
      expect(result).toEqual({ id: "v1" });
    });

    it("throws UnauthorizedException when no user id", async () => {
      await expect(
        controller.getVideoById("v1", { user: undefined } as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe("deleteVideo", () => {
    it("delegates to service when authenticated", async () => {
      svc.deleteVideo.mockResolvedValue({
        message: "Video deleted successfully",
      });
      const result = await controller.deleteVideo("v1", {
        user: { id: "u1", email: "a@b" },
      } as never);
      expect(svc.deleteVideo).toHaveBeenCalledWith("v1", "u1");
      expect(result).toEqual({ message: "Video deleted successfully" });
    });

    it("throws UnauthorizedException when no user id", async () => {
      await expect(
        controller.deleteVideo("v1", { user: undefined } as never),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
