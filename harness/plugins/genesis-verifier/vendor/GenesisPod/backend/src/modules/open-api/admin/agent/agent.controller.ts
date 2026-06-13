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
  Logger,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { AgentConfigService } from "../../../ai-harness/facade";
import {
  CreateAgentConfigDto,
  UpdateAgentConfigDto,
} from "../dto/agent-config-admin.dto";

@ApiTags("Admin - Agent Configuration")
@Controller("admin/agents")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name);

  constructor(private readonly agentConfigService: AgentConfigService) {}

  @Get()
  @ApiOperation({ summary: "List all agent configurations" })
  @ApiQuery({
    name: "domain",
    required: false,
    description: "Filter by domain",
  })
  @ApiQuery({
    name: "enabled",
    required: false,
    description: "Filter by enabled status",
  })
  @ApiResponse({
    status: 200,
    description: "Returns list of agent configurations",
  })
  async findAll(
    @Query("domain") domain?: string,
    @Query("enabled") enabled?: string,
  ) {
    this.logger.log("Admin: Fetching agent configurations");
    return this.agentConfigService.findAll({
      domain,
      enabled: enabled !== undefined ? enabled === "true" : undefined,
    });
  }

  @Get(":id")
  @ApiOperation({ summary: "Get agent configuration by ID" })
  @ApiParam({ name: "id", description: "Agent config ID" })
  @ApiResponse({ status: 200, description: "Returns agent configuration" })
  async findOne(@Param("id") id: string) {
    return this.agentConfigService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: "Create agent configuration" })
  @ApiResponse({ status: 201, description: "Agent configuration created" })
  async create(@Body() dto: CreateAgentConfigDto) {
    this.logger.log(`Admin: Creating agent config for ${dto.agentId}`);
    return this.agentConfigService.create({
      ...dto,
      taskProfile: dto.taskProfile as Parameters<
        typeof this.agentConfigService.create
      >[0]["taskProfile"],
    });
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update agent configuration" })
  @ApiParam({ name: "id", description: "Agent config ID" })
  @ApiResponse({ status: 200, description: "Agent configuration updated" })
  async update(@Param("id") id: string, @Body() dto: UpdateAgentConfigDto) {
    this.logger.log(`Admin: Updating agent config ${id}`);
    return this.agentConfigService.update(id, {
      ...dto,
      taskProfile: dto.taskProfile as Parameters<
        typeof this.agentConfigService.update
      >[1]["taskProfile"],
    });
  }

  @Delete(":id")
  @ApiOperation({ summary: "Delete agent configuration (non-built-in only)" })
  @ApiParam({ name: "id", description: "Agent config ID" })
  @ApiResponse({ status: 200, description: "Agent configuration deleted" })
  async delete(@Param("id") id: string) {
    this.logger.log(`Admin: Deleting agent config ${id}`);
    return this.agentConfigService.delete(id);
  }
}
