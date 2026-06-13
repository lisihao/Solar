import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../common/guards/admin.guard";
import { ResearchTemplateService } from "@/modules/ai-app/research/services/research-template.service";
import {
  CreateResearchTemplateDto,
  UpdateResearchTemplateDto,
} from "./dto/research-template-admin.dto";

@ApiTags("Admin - Research Templates")
@Controller("admin/research/templates")
@UseGuards(JwtAuthGuard, AdminGuard)
export class ResearchController {
  constructor(
    private readonly researchTemplateService: ResearchTemplateService,
  ) {}

  @Get()
  @ApiOperation({ summary: "List all research templates" })
  @ApiQuery({ name: "category", required: false })
  @ApiQuery({ name: "enabled", required: false })
  @ApiResponse({
    status: 200,
    description: "Returns list of research templates",
  })
  findAll(
    @Query("category") category?: string,
    @Query("enabled") enabled?: string,
  ) {
    return this.researchTemplateService.findAll({ category, enabled });
  }

  @Get(":id")
  @ApiOperation({ summary: "Get research template by ID" })
  @ApiParam({ name: "id", description: "Research template ID" })
  @ApiResponse({ status: 200, description: "Returns research template" })
  findOne(@Param("id") id: string) {
    return this.researchTemplateService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: "Create research template" })
  @ApiResponse({ status: 201, description: "Research template created" })
  create(@Body() dto: CreateResearchTemplateDto) {
    return this.researchTemplateService.create(dto);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update research template" })
  @ApiParam({ name: "id", description: "Research template ID" })
  @ApiResponse({ status: 200, description: "Research template updated" })
  update(@Param("id") id: string, @Body() dto: UpdateResearchTemplateDto) {
    return this.researchTemplateService.update(id, dto);
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete research template (non-built-in only)" })
  @ApiParam({ name: "id", description: "Research template ID" })
  @ApiResponse({ status: 200, description: "Research template deleted" })
  delete(@Param("id") id: string) {
    return this.researchTemplateService.delete(id);
  }

  @Post(":id/duplicate")
  @ApiOperation({ summary: "Duplicate a research template" })
  @ApiParam({ name: "id", description: "Research template ID to duplicate" })
  @ApiResponse({ status: 201, description: "Research template duplicated" })
  duplicate(@Param("id") id: string) {
    return this.researchTemplateService.duplicate(id, `${Date.now()}`);
  }
}
