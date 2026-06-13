/**
 * MarketplaceController — read-only agent marketplace catalog API
 *
 * Routes:
 *   GET /company/marketplace         → full MarketplaceCatalog
 *   GET /company/marketplace/agents  → AgentCatalogItem[]
 *   GET /company/marketplace/skills  → SkillCatalogItem[]
 *   GET /company/marketplace/tools   → ToolCatalogItem[]
 *   GET /company/marketplace/workflows → WorkflowCatalogItem[]
 */

import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { MarketplaceCatalogService } from "./marketplace-catalog.service";
import type {
  AgentCatalogItem,
  MarketplaceCatalog,
  SkillCatalogItem,
  ToolCatalogItem,
  WorkflowCatalogItem,
} from "./marketplace.dto";

@ApiTags("Company / Marketplace")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("company/marketplace")
export class MarketplaceController {
  constructor(private readonly catalogService: MarketplaceCatalogService) {}

  @Get()
  @ApiOperation({ summary: "获取完整智能体市场目录" })
  getCatalog(): MarketplaceCatalog {
    return this.catalogService.getCatalog();
  }

  @Get("agents")
  @ApiOperation({ summary: "获取智能体列表" })
  getAgents(): AgentCatalogItem[] {
    return this.catalogService.getAgents();
  }

  @Get("skills")
  @ApiOperation({ summary: "获取技能列表" })
  getSkills(): SkillCatalogItem[] {
    return this.catalogService.getSkills();
  }

  @Get("tools")
  @ApiOperation({ summary: "获取工具列表" })
  getTools(): ToolCatalogItem[] {
    return this.catalogService.getTools();
  }

  @Get("workflows")
  @ApiOperation({ summary: "获取工作流列表" })
  getWorkflows(): WorkflowCatalogItem[] {
    return this.catalogService.getWorkflows();
  }
}
