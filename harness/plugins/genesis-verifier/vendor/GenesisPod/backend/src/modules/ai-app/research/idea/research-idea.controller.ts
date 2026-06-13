import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  UnauthorizedException,
  ParseUUIDPipe,
  UseInterceptors,
} from "@nestjs/common";
import { ResearchIdeaType } from "@prisma/client";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { ResearchIdeaService } from "./research-idea.service";
import {
  CreateResearchIdeaDto,
  UpdateResearchIdeaDto,
} from "./research-idea.dto";
import { BillingContextInterceptor } from "../interceptors/billing-context.interceptor";

@ApiTags("ai-studio")
@ApiBearerAuth("access-token")
@Controller("ai-studio/projects/:projectId/ideas")
@UseGuards(JwtAuthGuard)
@UseInterceptors(BillingContextInterceptor)
export class ResearchIdeaController {
  constructor(private readonly ideaService: ResearchIdeaService) {}

  @Get()
  @ApiOperation({ summary: "List all ideas for a project" })
  async listIdeas(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Query("type") type?: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    const ideaType =
      type && Object.values(ResearchIdeaType).includes(type as ResearchIdeaType)
        ? (type as ResearchIdeaType)
        : undefined;

    return this.ideaService.listByProject(userId, projectId, ideaType);
  }

  @Post()
  @ApiOperation({ summary: "Create a new idea" })
  async createIdea(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Body() dto: CreateResearchIdeaDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    return this.ideaService.create(userId, projectId, dto);
  }

  @Patch(":ideaId")
  @ApiOperation({ summary: "Update an idea" })
  async updateIdea(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("ideaId", ParseUUIDPipe) ideaId: string,
    @Body() dto: UpdateResearchIdeaDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    return this.ideaService.update(userId, projectId, ideaId, dto);
  }

  @Delete(":ideaId")
  @ApiOperation({ summary: "Delete an idea" })
  async deleteIdea(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("ideaId", ParseUUIDPipe) ideaId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    await this.ideaService.delete(userId, projectId, ideaId);
    return { deleted: true };
  }

  @Post("extract-creative-ideas")
  @ApiOperation({ summary: "Extract creative ideas from project insights" })
  async extractCreativeIdeas(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    return this.ideaService.extractCreativeIdeas(userId, projectId);
  }

  @Post("sessions/:sessionId/extract")
  @ApiOperation({ summary: "Extract ideas from a discussion session" })
  async extractIdeas(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("sessionId", ParseUUIDPipe) sessionId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    return this.ideaService.extractFromSession(userId, projectId, sessionId);
  }
}
