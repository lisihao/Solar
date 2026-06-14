/**
 * MCP External Server Admin Controller
 *
 * Manages external MCP server connections: CRUD, connect/disconnect, tool discovery.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { MCPClientRegistryService } from "../../../ai-engine/facade";
import {
  CreateExternalServerDto,
  UpdateExternalServerDto,
} from "./external-servers.dto";

@Controller("admin/mcp/external-servers")
@ApiTags("Admin - MCP External Servers")
@UseGuards(JwtAuthGuard, AdminGuard)
export class MCPExternalController {
  private readonly logger = new Logger(MCPExternalController.name);

  constructor(private readonly registryService: MCPClientRegistryService) {}

  @Get()
  @ApiOperation({
    summary: "List all external MCP servers with connection status",
  })
  @ApiResponse({
    status: 200,
    description: "Returns list of external MCP servers with connection status",
  })
  async findAll() {
    this.logger.log("Admin: Fetching external MCP servers");
    return this.registryService.getConnectionStatuses();
  }

  @Post()
  @ApiOperation({ summary: "Add new external MCP server" })
  @ApiResponse({ status: 201, description: "External MCP server created" })
  async create(@Body() dto: CreateExternalServerDto) {
    this.logger.log(`Admin: Adding external MCP server ${dto.serverId}`);
    return this.registryService.addServer({
      ...dto,
      metadata: dto.metadata as Parameters<
        typeof this.registryService.addServer
      >[0]["metadata"],
    });
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update external MCP server config" })
  @ApiParam({ name: "id", description: "Server database ID" })
  @ApiResponse({
    status: 200,
    description: "External MCP server config updated",
  })
  async update(@Param("id") id: string, @Body() dto: UpdateExternalServerDto) {
    this.logger.log(`Admin: Updating external MCP server ${id}`);
    return this.registryService.updateServer(id, {
      ...dto,
      metadata: dto.metadata as Parameters<
        typeof this.registryService.updateServer
      >[1]["metadata"],
    });
  }

  @Delete(":id")
  @ApiOperation({ summary: "Remove external MCP server" })
  @ApiParam({ name: "id", description: "Server database ID" })
  @ApiResponse({ status: 200, description: "External MCP server removed" })
  async remove(@Param("id") id: string) {
    this.logger.log(`Admin: Removing external MCP server ${id}`);
    return this.registryService.removeServer(id);
  }

  @Post(":id/connect")
  @ApiOperation({ summary: "Connect to external MCP server" })
  @ApiParam({ name: "id", description: "Server database ID" })
  @ApiResponse({ status: 200, description: "Connected to external MCP server" })
  async connect(@Param("id") id: string) {
    const server = await this.registryService.findById(id);
    if (!server) {
      throw new NotFoundException(`External MCP server not found: ${id}`);
    }

    this.logger.log(
      `Admin: Connecting to external MCP server ${server.name} (${server.serverId})`,
    );
    await this.registryService.connectServer(server.serverId);
    return { status: "connected", serverId: server.serverId };
  }

  @Post(":id/disconnect")
  @ApiOperation({ summary: "Disconnect from external MCP server" })
  @ApiParam({ name: "id", description: "Server database ID" })
  @ApiResponse({
    status: 200,
    description: "Disconnected from external MCP server",
  })
  async disconnect(@Param("id") id: string) {
    const server = await this.registryService.findById(id);
    if (!server) {
      throw new NotFoundException(`External MCP server not found: ${id}`);
    }

    this.logger.log(
      `Admin: Disconnecting from external MCP server ${server.name} (${server.serverId})`,
    );
    await this.registryService.disconnectServer(server.serverId);
    return { status: "disconnected", serverId: server.serverId };
  }

  @Get(":id/tools")
  @ApiOperation({ summary: "List tools discovered from external MCP server" })
  @ApiParam({ name: "id", description: "Server database ID" })
  @ApiResponse({
    status: 200,
    description: "Returns list of tools from external MCP server",
  })
  async listTools(@Param("id") id: string) {
    const server = await this.registryService.findById(id);
    if (!server) {
      throw new NotFoundException(`External MCP server not found: ${id}`);
    }

    this.logger.log(
      `Admin: Listing tools from external MCP server ${server.name} (${server.serverId})`,
    );
    return this.registryService.discoverTools(server.serverId);
  }
}
