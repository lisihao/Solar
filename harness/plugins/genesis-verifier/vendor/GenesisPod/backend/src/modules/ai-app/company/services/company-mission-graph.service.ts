/**
 * CompanyMissionGraphService —— company mission 的知识图谱构建/读取。
 *
 * 与 playground MissionGraphService 对称：本服务只持 company 私有职责
 * （加载报告正文 + userId ownership 校验 + 持久化到 company_mission_graphs），
 * 「报告正文 → 图谱」核心 pipeline 委托平台共享 MissionGraphBuilderService。
 *
 * 报告原料：company mission 完成后把报告正文存在 CompanyMission.result.summary
 * （见 company-mission.service runViaCapability 落库），此处读取它喂给构建器。
 */

import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  MissionGraphBuilderService,
  type MissionGraph,
  type Analyses,
  type MissionGraphArtifact,
  type NodeEnrichment,
} from "@/modules/ai-app/marketplace/graph";

const OPERATION_PREFIX = "company.mission-graph";

@Injectable()
export class CompanyMissionGraphService {
  private readonly logger = new Logger(CompanyMissionGraphService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly builder: MissionGraphBuilderService,
  ) {}

  /**
   * 读取 mission 报告正文 + ownership 校验。
   * mission 不存在或不属于该 user → ForbiddenException（不泄露存在性）。
   */
  private async loadReportText(
    userId: string,
    missionId: string,
  ): Promise<string> {
    const mission = await this.prisma.companyMission.findUnique({
      where: { id: missionId },
    });
    if (!mission || mission.userId !== userId) {
      throw new ForbiddenException(`mission ${missionId} not found`);
    }
    const result = mission.result as { summary?: unknown } | null;
    const summary =
      result && typeof result.summary === "string" ? result.summary : "";
    return summary;
  }

  // ── getArtifact ─────────────────────────────────────────────────────────────

  async getArtifact(
    userId: string,
    missionId: string,
  ): Promise<MissionGraphArtifact> {
    await this.loadReportText(userId, missionId); // ownership 校验

    const row = await this.prisma.companyMissionGraph.findUnique({
      where: { missionId },
    });
    if (!row) {
      return { status: "NONE", graph: null, analyses: null, generatedAt: null };
    }
    return {
      status: row.status as MissionGraphArtifact["status"],
      graph: row.graph as unknown as MissionGraph,
      analyses: row.analyses as unknown as Analyses,
      generatedAt: row.generatedAt.toISOString(),
    };
  }

  // ── build ───────────────────────────────────────────────────────────────────

  async build(
    userId: string,
    missionId: string,
  ): Promise<MissionGraphArtifact> {
    try {
      const reportText = await this.loadReportText(userId, missionId);
      if (!reportText) {
        this.logger.warn(
          `[graph:build] empty report text for company mission=${missionId}`,
        );
        return this._persistFailed(missionId, userId);
      }

      const built = await this.builder.build(userId, reportText, {
        operationPrefix: OPERATION_PREFIX,
      });
      if (!built) {
        return this._persistFailed(missionId, userId);
      }

      const now = new Date();
      await this.prisma.companyMissionGraph.upsert({
        where: { missionId },
        create: {
          missionId,
          ownerId: userId,
          status: "READY",
          graph: built.graph as unknown as Prisma.InputJsonValue,
          analyses: built.analyses as unknown as Prisma.InputJsonValue,
          generatedAt: now,
        },
        update: {
          ownerId: userId,
          status: "READY",
          graph: built.graph as unknown as Prisma.InputJsonValue,
          analyses: built.analyses as unknown as Prisma.InputJsonValue,
          generatedAt: now,
        },
      });

      return {
        status: "READY",
        graph: built.graph,
        analyses: built.analyses,
        generatedAt: now.toISOString(),
      };
    } catch (err: unknown) {
      if (err instanceof ForbiddenException) throw err;
      this.logger.warn(
        `[graph:build] unexpected error company mission=${missionId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this._persistFailed(missionId, userId);
    }
  }

  // ── enrichNode ────────────────────────────────────────────────────────────────

  async enrichNode(
    userId: string,
    missionId: string,
    nodeId: string,
  ): Promise<NodeEnrichment> {
    const artifact = await this.getArtifact(userId, missionId); // 内含 ownership 校验
    const node = (artifact.graph?.nodes ?? []).find((n) => n.id === nodeId);
    if (!node) {
      throw new NotFoundException(`graph node ${nodeId} not found`);
    }
    return this.builder.enrichNode(userId, node, {
      operationPrefix: OPERATION_PREFIX,
    });
  }

  // ── persist FAILED ──────────────────────────────────────────────────────────

  private async _persistFailed(
    missionId: string,
    userId: string,
  ): Promise<MissionGraphArtifact> {
    const emptyGraph: MissionGraph = {
      nodes: [],
      edges: [],
      stats: { totalNodes: 0, totalEdges: 0 },
    };
    const emptyAnalyses: Analyses = {
      keyNodes: { items: [], summary: "" },
      relatedness: { pairs: [], summary: "" },
      competitive: { clusters: [], summary: "" },
      community: { communities: [], summary: "" },
      supplyChain: { layers: [], summary: "" },
    };

    try {
      await this.prisma.companyMissionGraph.upsert({
        where: { missionId },
        create: {
          missionId,
          ownerId: userId,
          status: "FAILED",
          graph: emptyGraph as unknown as Prisma.InputJsonValue,
          analyses: emptyAnalyses as unknown as Prisma.InputJsonValue,
          generatedAt: new Date(),
        },
        update: {
          status: "FAILED",
          graph: emptyGraph as unknown as Prisma.InputJsonValue,
          analyses: emptyAnalyses as unknown as Prisma.InputJsonValue,
          generatedAt: new Date(),
        },
      });
    } catch (persistErr: unknown) {
      this.logger.warn(
        `[graph:persistFailed] upsert failed for company mission=${missionId}: ${
          persistErr instanceof Error ? persistErr.message : String(persistErr)
        }`,
      );
    }

    return { status: "FAILED", graph: null, analyses: null, generatedAt: null };
  }
}
