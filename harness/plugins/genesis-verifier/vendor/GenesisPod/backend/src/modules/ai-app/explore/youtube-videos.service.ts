import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../../common/prisma/prisma.service";
import { SaveVideoDto } from "./dto/save-video.dto";

@Injectable()
export class YoutubeVideosService {
  constructor(private prisma: PrismaService) {}

  async saveVideo(userId: string, saveVideoDto: SaveVideoDto) {
    // Check if video already exists for this user
    const existing = await this.prisma.youTubeVideo.findUnique({
      where: {
        userId_videoId: {
          userId,
          videoId: saveVideoDto.videoId,
        },
      },
    });

    if (existing) {
      // Update existing video
      const updateData: Prisma.YouTubeVideoUpdateInput = {
        title: saveVideoDto.title,
        url: saveVideoDto.url,
      };

      if (saveVideoDto.transcript !== undefined) {
        updateData.transcript = saveVideoDto.transcript;
      }
      if (saveVideoDto.translatedText !== undefined) {
        updateData.translatedText = saveVideoDto.translatedText;
      }
      if (saveVideoDto.aiReport !== undefined) {
        updateData.aiReport = saveVideoDto.aiReport;
      }

      return this.prisma.youTubeVideo.update({
        where: { id: existing.id },
        data: updateData,
      });
    }

    // Create new video
    return this.prisma.youTubeVideo.create({
      data: {
        userId,
        videoId: saveVideoDto.videoId,
        title: saveVideoDto.title,
        url: saveVideoDto.url,
        transcript: saveVideoDto.transcript,
        translatedText: saveVideoDto.translatedText,
        aiReport: saveVideoDto.aiReport,
      },
    });
  }

  async getUserVideos(userId: string) {
    return this.prisma.youTubeVideo.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });
  }

  async getVideoById(id: string, userId: string) {
    const video = await this.prisma.youTubeVideo.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!video) {
      throw new NotFoundException("Video not found");
    }

    return video;
  }

  async deleteVideo(id: string, userId: string) {
    // Verify ownership
    const video = await this.prisma.youTubeVideo.findFirst({
      where: {
        id,
        userId,
      },
    });

    if (!video) {
      throw new NotFoundException("Video not found");
    }

    await this.prisma.youTubeVideo.delete({
      where: { id },
    });

    return { message: "Video deleted successfully" };
  }
}
