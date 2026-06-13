/**
 * MissionGraphController — knowledge-graph endpoints for a mission
 *
 * GET  /api/v1/playground/missions/:id/graph  → MissionGraphArtifact
 * POST /api/v1/playground/missions/:id/graph  → MissionGraphArtifact (builds/rebuilds)
 */

import {
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { MissionOwnershipRegistry } from "@/modules/ai-harness/facade";
import { MissionStore } from "../../mission/lifecycle/mission-store.service";
import { BaseMissionController } from "./base-mission.controller";
import { MissionGraphService } from "../../mission/graph/mission-graph.service";
import type {
  MissionGraphArtifact,
  NodeEnrichment,
} from "../../mission/graph/mission-graph.types";

@Controller("playground")
@UseGuards(JwtAuthGuard)
export class MissionGraphController extends BaseMissionController {
  constructor(
    ownership: MissionOwnershipRegistry,
    store: MissionStore,
    private readonly graphService: MissionGraphService,
  ) {
    super(ownership, store);
  }

  /**
   * GET /api/v1/playground/missions/:id/graph
   * Returns the current graph artifact (status:'NONE' + nulls if never built).
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Get("missions/:id/graph")
  async getGraph(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<MissionGraphArtifact> {
    await this.assertReadAccess(id, req.user?.id);
    return this.graphService.getArtifact(req.user.id, id);
  }

  /**
   * POST /api/v1/playground/missions/:id/graph
   * Builds or rebuilds the graph artifact synchronously; persists and returns READY result.
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post("missions/:id/graph")
  async buildGraph(
    @Param("id") id: string,
    @Request() req: RequestWithUser,
  ): Promise<MissionGraphArtifact> {
    await this.assertReadAccess(id, req.user?.id);
    return this.graphService.build(req.user.id, id);
  }

  /**
   * GET /api/v1/playground/missions/:id/graph/node/:nodeId/enrich
   * 点击节点时按需用 web-search + LLM 综合该实体的画像（简介/事实/来源）。
   */
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get("missions/:id/graph/node/:nodeId/enrich")
  async enrichNode(
    @Param("id") id: string,
    @Param("nodeId") nodeId: string,
    @Request() req: RequestWithUser,
  ): Promise<NodeEnrichment> {
    await this.assertReadAccess(id, req.user?.id);
    return this.graphService.enrichNode(req.user.id, id, nodeId);
  }
}
