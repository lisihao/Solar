import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
  Patch,
  Delete,
  Sse,
  MessageEvent,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Observable, interval, map, switchMap, from, takeWhile } from "rxjs";
import { JwtAuthGuard } from "../../../common/guards/jwt-auth.guard";
import type { RequestWithUser } from "../../../common/types/express-request.types";
import { UpdateVisibilityDto } from "../../../common/visibility";
import { AiSimulationService, ViewPerspective } from "./ai-simulation.service";
import { Prisma, SimulationTeam, SimulationRunStatus } from "@prisma/client";
import { ExternalDataService } from "./external-data.service";
import { AIAssistService } from "./ai-assist.service";

@ApiTags("AI Simulation")
@Controller("simulation")
@UseGuards(JwtAuthGuard)
export class AiSimulationController {
  constructor(
    private readonly simulationService: AiSimulationService,
    private readonly externalData: ExternalDataService,
    private readonly aiAssist: AIAssistService,
  ) {}

  @Post("scenarios")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async createScenario(
    @Body()
    body: {
      name: string;
      industry: string;
      region?: string;
      goals?: Prisma.InputJsonValue;
      constraints?: Prisma.InputJsonValue;
      dataSources?: Prisma.InputJsonValue;
      companies?: Array<{
        name: string;
        type?: string;
        market?: string;
        metrics?: Prisma.InputJsonValue;
        publicData?: Prisma.InputJsonValue;
        privateData?: Prisma.InputJsonValue;
      }>;
      agents?: Array<{
        companyName?: string;
        team: SimulationTeam;
        role: string;
        persona?: Prisma.InputJsonValue;
        memoryPublic?: Prisma.InputJsonValue;
        memoryPrivate?: Prisma.InputJsonValue;
        tools?: Prisma.InputJsonValue;
      }>;
    },
  ) {
    return this.simulationService.createScenario(body);
  }

  @Get("scenarios")
  async listScenarios() {
    return this.simulationService.listScenarios();
  }

  @Get("scenarios/:id")
  async getScenario(@Param("id") id: string) {
    return this.simulationService.getScenarioById(id);
  }

  @Patch("scenarios/:id")
  async updateScenario(
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      industry?: string;
      region?: string;
      goals?: Prisma.InputJsonValue;
      constraints?: Prisma.InputJsonValue;
      dataSources?: Prisma.InputJsonValue;
      companies?: Array<{
        name: string;
        type?: string;
        market?: string;
        metrics?: Prisma.InputJsonValue;
        publicData?: Prisma.InputJsonValue;
        privateData?: Prisma.InputJsonValue;
      }>;
      agents?: Array<{
        companyName?: string;
        team: SimulationTeam;
        role: string;
        persona?: Prisma.InputJsonValue;
        memoryPublic?: Prisma.InputJsonValue;
        memoryPrivate?: Prisma.InputJsonValue;
        tools?: Prisma.InputJsonValue;
      }>;
    },
  ) {
    return this.simulationService.updateScenario(id, body);
  }

  @Delete("scenarios/:id")
  async deleteScenario(@Param("id") id: string) {
    return this.simulationService.deleteScenario(id);
  }

  @Patch("scenarios/:id/visibility")
  async updateVisibility(
    @Request() req: RequestWithUser,
    @Param("id") id: string,
    @Body() dto: UpdateVisibilityDto,
  ) {
    return this.simulationService.updateVisibility(
      req.user.id,
      id,
      dto.visibility,
    );
  }

  @Post("runs")
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async startRun(
    @Body()
    body: {
      scenarioId: string;
      rounds?: number;
      params?: Prisma.InputJsonValue;
    },
  ) {
    return this.simulationService.startRun({
      scenarioId: body.scenarioId,
      rounds: body.rounds,
      params: body.params,
    });
  }

  @Get("runs/:id")
  async getRun(
    @Param("id") id: string,
    @Query("perspective") perspective?: ViewPerspective,
  ) {
    // 验证视角参数
    const validPerspectives: ViewPerspective[] = [
      "GOD",
      "BLUE",
      "RED",
      "GREEN",
      "WHITE",
    ];
    const validatedPerspective =
      perspective && validPerspectives.includes(perspective)
        ? perspective
        : undefined;
    return this.simulationService.getRunById(id, validatedPerspective);
  }

  @Delete("runs/:id")
  async deleteRun(@Param("id") id: string) {
    return this.simulationService.deleteRun(id);
  }

  @Patch("runs/:id/resume")
  async resumeRun(@Param("id") id: string) {
    return this.simulationService.resumeRun(id);
  }

  @Patch("runs/:id/pause")
  async pauseRun(@Param("id") id: string) {
    return this.simulationService.pauseRun(id);
  }

  @Post("runs/:id/intervene")
  async interveneRun(
    @Param("id") id: string,
    @Body() body: { message: string; injectEvent?: Record<string, unknown> },
  ) {
    return this.simulationService.interveneRun(id, body);
  }

  @Get("external/snapshot")
  async getExternalSnapshot() {
    return this.externalData.getSnapshot();
  }

  @Post("external-data/test")
  async testExternalProvider(
    @Body()
    body: {
      id: string;
      name: string;
      category?: string;
      baseUrl?: string;
      apiKey?: string;
      headers?: string;
      enabled?: boolean;
    },
  ) {
    // Test provider with provided configuration
    return this.externalData.testProvider(body);
  }

  // ========== AI Assist APIs ==========

  /**
   * AI辅助分析行业竞争格局，推荐公司和角色配置
   */
  @Post("ai-assist/analyze")
  async analyzeIndustry(
    @Body()
    body: {
      industry: string;
      region?: string;
      existingCompanies?: string[];
    },
  ) {
    return this.aiAssist.analyzeIndustry(body);
  }

  /**
   * AI辅助推荐角色配置
   */
  @Post("ai-assist/suggest-agents")
  async suggestAgents(
    @Body()
    body: {
      industry: string;
      companies: Array<{ name: string; type: string }>;
      existingAgents?: Array<{ role: string; team: string }>;
    },
  ) {
    const agents = await this.aiAssist.suggestAgents(body);
    return { agents };
  }

  /**
   * AI辅助生成推演场景建议
   */
  @Post("ai-assist/suggest-scenario")
  async suggestScenario(
    @Body()
    body: {
      industry: string;
      region?: string;
      goals?: string;
    },
  ) {
    return this.aiAssist.generateScenarioSuggestions(body);
  }

  /**
   * AI辅助生成公司量化指标
   */
  @Post("ai-assist/generate-metrics")
  async generateCompanyMetrics(
    @Body()
    body: {
      companyName: string;
      companyType: string;
      industry: string;
      market?: string;
    },
  ) {
    return this.aiAssist.generateCompanyMetrics(body);
  }

  /**
   * AI辅助推荐推演参数
   */
  @Post("ai-assist/suggest-params")
  async suggestParams(
    @Body()
    body: {
      industry: string;
      region?: string;
      companyCount?: number;
      agentCount?: number;
      goals?: {
        targetShare?: string;
        risk?: string;
        growth?: string;
      };
    },
  ) {
    return this.aiAssist.suggestParams(body);
  }

  // ========== SSE Real-time Updates ==========

  /**
   * SSE端点：实时推送推演状态更新
   * 前端通过 EventSource 连接此端点接收实时更新
   */
  @Sse("runs/:id/events")
  runEvents(
    @Param("id") id: string,
    @Query("perspective") perspective?: ViewPerspective,
  ): Observable<MessageEvent> {
    // 验证视角参数
    const validPerspectives: ViewPerspective[] = [
      "GOD",
      "BLUE",
      "RED",
      "GREEN",
      "WHITE",
    ];
    const validatedPerspective =
      perspective && validPerspectives.includes(perspective)
        ? perspective
        : undefined;
    // 每2秒轮询一次运行状态
    return interval(2000).pipe(
      switchMap(() =>
        from(this.simulationService.getRunById(id, validatedPerspective)),
      ),
      takeWhile((run) => {
        // 当运行完成或失败时停止推送
        if (!run) return false;
        return (
          run.status !== SimulationRunStatus.COMPLETED &&
          run.status !== SimulationRunStatus.FAILED
        );
      }, true), // inclusive: 包含最后一个状态
      map((run) => {
        if (!run) {
          return {
            data: JSON.stringify({
              type: "error",
              message: "Run not found",
            }),
          };
        }

        // 构建事件数据
        const eventData: Record<string, unknown> = {
          type: "status_update",
          runId: run.id,
          status: run.status,
          currentRound: run.currentRound,
          rounds: run.rounds,
          timestamp: new Date().toISOString(),
        };

        // 如果有最新的turn，添加turn信息
        if (run.turns && run.turns.length > 0) {
          const latestTurn = run.turns[run.turns.length - 1];
          eventData.latestTurn = {
            roundNumber: latestTurn.roundNumber,
            adjudication: latestTurn.adjudication,
            hasBlackSwan:
              !!// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma JSON column cast; adjudication shape varies by round
              (latestTurn.adjudication as Record<string, any> | null)
                ?.blackSwanEvent,
          };

          // 检查是否有新回合完成
          if (latestTurn.roundNumber === run.currentRound) {
            eventData.type = "turn_complete";
          }
        }

        // 如果运行暂停，标记需要人类干预
        if (run.status === SimulationRunStatus.PAUSED) {
          eventData.type = "human_intervention_required";
          eventData.message = `推演已在第${run.currentRound}回合暂停，等待人类干预`;
        }

        // 如果运行完成
        if (run.status === SimulationRunStatus.COMPLETED) {
          eventData.type = "run_completed";
          eventData.summary = run.summary;
        }

        return { data: JSON.stringify(eventData) };
      }),
    );
  }

  /**
   * 获取推演报告（公开版/内部版）
   */
  @Get("runs/:id/report")
  async getRunReport(
    @Param("id") id: string,
    @Param("version") version?: "public" | "internal",
  ) {
    const run = await this.simulationService.getRunById(id);
    if (!run || !run.summary) {
      return { error: "Report not available" };
    }

    const summary = run.summary as Record<string, unknown>;
    if (version === "public" && summary.publicReport) {
      return summary.publicReport;
    }
    if (version === "internal" && summary.internalReport) {
      return summary.internalReport;
    }

    return summary;
  }
}
