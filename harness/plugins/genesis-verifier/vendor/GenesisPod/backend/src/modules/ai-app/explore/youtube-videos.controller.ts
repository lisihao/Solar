import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { YoutubeVideosService } from "./youtube-videos.service";
import { SaveVideoDto } from "./dto/save-video.dto";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { OptionalJwtAuthGuard } from "../../../common/guards/optional-jwt-auth.guard";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}
import { Public } from "../../../common/decorators/public.decorator";

/**
 * YouTube视频管理控制器
 */
@ApiTags("YouTube Videos")
@Controller("youtube-videos")
export class YoutubeVideosController {
  constructor(private readonly youtubeVideosService: YoutubeVideosService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  async saveVideo(
    @Request() req: AuthenticatedRequest,
    @Body() saveVideoDto: SaveVideoDto,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.youtubeVideosService.saveVideo(userId, saveVideoDto);
  }

  @Public()
  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  async getUserVideos(@Request() req: AuthenticatedRequest) {
    const userId = req.user?.id;
    // Return empty array for unauthenticated users
    if (!userId) {
      return [];
    }
    return this.youtubeVideosService.getUserVideos(userId);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  async getVideoById(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.youtubeVideosService.getVideoById(id, userId);
  }

  @Delete(":id")
  @UseGuards(JwtAuthGuard)
  async deleteVideo(
    @Param("id") id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new UnauthorizedException("User not authenticated");
    }
    return this.youtubeVideosService.deleteVideo(id, userId);
  }
}
