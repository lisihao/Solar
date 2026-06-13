/**
 * MissionDagController —— Mission DAG 可视化端点
 *
 * 2026-05-26 用户拍板 "后端定义、前端呈现":
 *   - GET /missions/:id/dag                  → 整张图(nodes + edges + 实时状态)
 *   - GET /missions/:id/dag/cascade?from=X   → 重跑 X 的级联预览
 *   - 真正的"触发重跑"复用现有 POST /missions/:id/todos/:todoId/local-rerun,
 *     不在这里造重复端点。
 */

import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../../../common/types/express-request.types";
import { MissionOwnershipRegistry } from "@/modules/ai-harness/facade";
import { MissionStore } from "../lifecycle/mission-store.service";
import { BaseMissionController } from "../../api/controller/base-mission.controller";
import { MissionDagService } from "./mission-dag.service";
import type {
  MissionDagCascadePreview,
  MissionDagGraph,
  MissionDagReactSnapshot,
} from "./mission-dag.types";

@Controller("playground")
@UseGuards(JwtAuthGuard)
export class MissionDagController extends BaseMissionController {
  constructor(
    ownership: MissionOwnershipRegistry,
    store: MissionStore,
    private readonly dagService: MissionDagService,
  ) {
    super(ownership, store);
  }

  /**
   * GET /api/v1/playground/missions/:id/dag
   * 返回完整 mission DAG(13 macro stage + 维度展开 + 边),前端直接渲染。
   */
  @Get("missions/:id/dag")
  async getDag(
    @Param("id") missionId: string,
    @Request() req: RequestWithUser,
  ): Promise<MissionDagGraph> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    await this.assertOwnership(missionId, userId);
    return this.dagService.buildGraph(missionId, userId);
  }

  /**
   * GET /api/v1/playground/missions/:id/dag/cascade?from=NODE_ID
   * 重跑某节点的级联预览(将重跑哪些下游 / 保留哪些 / 是否允许)。
   */
  @Get("missions/:id/dag/cascade")
  async getCascadePreview(
    @Param("id") missionId: string,
    @Query("from") nodeId: string,
    @Request() req: RequestWithUser,
  ): Promise<MissionDagCascadePreview> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    if (!nodeId) {
      throw new ForbiddenException("query param 'from' is required");
    }
    await this.assertOwnership(missionId, userId);
    return this.dagService.computeCascade(missionId, userId, nodeId);
  }

  /**
   * GET /api/v1/playground/missions/:id/dag/react/:nodeId
   * 该节点的 ReAct 内部循环快照(Phase 2):
   *   - 从 MissionEventBuffer 聚合 agent-* 事件
   *   - 推 lastThought / lastAction / lastObservation / iter / finalizeAttempts /
   *     currentStep / phase 等,前端画 ring 用。
   */
  @Get("missions/:id/dag/react/:nodeId")
  async getReactSnapshot(
    @Param("id") missionId: string,
    @Param("nodeId") nodeId: string,
    @Request() req: RequestWithUser,
  ): Promise<MissionDagReactSnapshot> {
    const userId = req.user?.id;
    if (!userId) throw new ForbiddenException("Authentication required");
    await this.assertOwnership(missionId, userId);
    return this.dagService.buildReactSnapshot(missionId, userId, nodeId);
  }
}
