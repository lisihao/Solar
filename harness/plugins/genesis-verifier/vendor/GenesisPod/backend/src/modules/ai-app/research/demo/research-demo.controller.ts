import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Request,
  UseGuards,
  UnauthorizedException,
  ParseUUIDPipe,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../common/types/express-request.types";
import { ResearchDemoService } from "./research-demo.service";
import { GenerateDemoDto } from "./research-demo.dto";
import { BillingContextInterceptor } from "../interceptors/billing-context.interceptor";

@ApiTags("ai-studio")
@ApiBearerAuth("access-token")
@Controller("ai-studio/projects/:projectId")
@UseGuards(JwtAuthGuard)
@UseInterceptors(BillingContextInterceptor)
export class ResearchDemoController {
  constructor(private readonly demoService: ResearchDemoService) {}

  @Get("demos")
  @ApiOperation({ summary: "List all demos for a project" })
  async listDemos(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    return this.demoService.listByProject(userId, projectId);
  }

  @Get("demos/:demoId")
  @ApiOperation({ summary: "Get demo details" })
  async getDemo(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("demoId", ParseUUIDPipe) demoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    return this.demoService.getById(userId, projectId, demoId);
  }

  @Post("ideas/:ideaId/generate-demo")
  @ApiOperation({ summary: "Generate a demo for an idea" })
  async generateDemo(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("ideaId", ParseUUIDPipe) ideaId: string,
    @Body() dto: GenerateDemoDto,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    return this.demoService.createForIdea(userId, projectId, ideaId, dto.title);
  }

  @Delete("demos/:demoId")
  @ApiOperation({ summary: "Delete a demo" })
  async deleteDemo(
    @Request() req: RequestWithUser,
    @Param("projectId", ParseUUIDPipe) projectId: string,
    @Param("demoId", ParseUUIDPipe) demoId: string,
  ) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException("User not authenticated");

    await this.demoService.delete(userId, projectId, demoId);
    return { deleted: true };
  }
}
