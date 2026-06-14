import { Injectable, Logger } from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import { DeepResearchStatus } from "@prisma/client";
import { BillingContext } from "../../../platform/facade";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  StartDeepResearchDto,
  DeepResearchSSEEvent,
  PlanApprovalRequest,
  PlanApprovalResponse,
} from "./types";
import { DiscussionPhaseCoordinatorService } from "./discussion-phase-coordinator.service";
import { DiscussionSessionService } from "./discussion-session.service";

/**
 * 讨论驱动型研究编排器（Thin Facade）
 *
 * 职责: 保持对外 public API 不变，将实际执行委托给子服务：
 * - DiscussionPhaseCoordinatorService: 研究流程编排（FSM + LLM 调用）
 * - DiscussionSessionService: Session CRUD 持久化
 *
 * 流程: Ideation → Execution → Findings → Synthesis
 */
@Injectable()
export class DiscussionOrchestratorService {
  private readonly logger = new Logger(DiscussionOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly coordinator: DiscussionPhaseCoordinatorService,
    private readonly sessionService: DiscussionSessionService,
  ) {}

  /**
   * 启动讨论驱动型研究（SSE 事件流）
   */
  startResearch(
    projectId: string,
    dto: StartDeepResearchDto,
  ): Observable<DeepResearchSSEEvent> {
    const subject = new Subject<DeepResearchSSEEvent>();

    (async () => {
      const project = await this.prisma.researchProject.findUnique({
        where: { id: projectId },
        select: { userId: true },
      });

      if (!project) {
        throw new Error("Project not found");
      }

      const depth = dto.options?.depth || "standard";

      await BillingContext.run(
        {
          userId: project.userId,
          moduleType: "deep-research",
          operationType: `research-${depth}`,
          description: `Deep Research Discussion (${depth}) - ${dto.query.slice(0, 50)}...`,
        },
        async () => {
          await this.coordinator.executeDiscussion(projectId, dto, subject);
        },
      );
    })().catch((error) => {
      this.logger.error(`Discussion research failed: ${error}`);
      subject.next({
        type: "error",
        data: {
          code: "EXECUTION_ERROR",
          message: error.message || "研究执行失败",
          recoverable: false,
        },
      });
      subject.complete();
    });

    return subject.asObservable();
  }

  /**
   * 仅生成研究计划（不执行），返回供用户审批的 PlanApprovalRequest
   */
  async generatePlanOnly(
    projectId: string,
    dto: StartDeepResearchDto,
  ): Promise<PlanApprovalRequest> {
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    const depth = dto.options?.depth || "standard";

    return BillingContext.run(
      {
        userId: project.userId,
        moduleType: "deep-research",
        operationType: `research-plan-${depth}`,
        description: `Deep Research Plan Generation (${depth}) - ${dto.query.slice(0, 50)}...`,
      },
      () => this.coordinator.generatePlanOnly(projectId, dto),
    );
  }

  /**
   * 审批研究计划并启动或取消执行
   */
  async approvePlan(
    sessionId: string,
    approval: PlanApprovalResponse,
  ): Promise<{ sessionId: string; status: string }> {
    const session = await this.prisma.deepResearchSession.findUnique({
      where: { id: sessionId },
      include: { project: { select: { userId: true } } },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status !== DeepResearchStatus.PLAN_READY) {
      throw new Error(
        `Session ${sessionId} is not in PLAN_READY state (current: ${session.status})`,
      );
    }

    if (!approval.approved) {
      // 用户拒绝：取消会话
      await this.sessionService.updateSession(sessionId, {
        status: DeepResearchStatus.CANCELLED,
        error: approval.feedback ?? "用户取消了研究计划",
      });
      this.logger.log(`[approvePlan] Session ${sessionId} cancelled by user`);
      return { sessionId, status: "cancelled" };
    }

    // 如果用户修改了计划，更新保存的计划
    if (approval.modifiedPlan) {
      await this.sessionService.updateSession(sessionId, {
        plan: approval.modifiedPlan as unknown as Record<string, unknown>,
      });
    }

    // 更新状态为 IDEATION（启动执行）
    await this.sessionService.updateSession(sessionId, {
      status: DeepResearchStatus.IDEATION,
    });

    // Fire-and-forget：启动研究执行（确保 BillingContext 传播）
    const depth = "standard";
    const existingCtx = BillingContext.get();
    const startFn = () => {
      const subject = new Subject<DeepResearchSSEEvent>();
      subject.subscribe(); // drain events — no SSE client in approval flow
      return this.coordinator.executeApprovedPlan(sessionId, subject);
    };

    const wrappedStart = existingCtx
      ? () => BillingContext.run(existingCtx, startFn)
      : async () => {
          return BillingContext.run(
            {
              userId: session.project.userId,
              moduleType: "deep-research",
              operationType: `research-${depth}`,
              description: `Deep Research Execution (approved) - ${session.query.slice(0, 50)}...`,
            },
            startFn,
          );
        };

    void wrappedStart().catch((err: unknown) => {
      this.logger.error(
        `[approvePlan] Execution failed for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    this.logger.log(
      `[approvePlan] Session ${sessionId} approved, execution started`,
    );
    return { sessionId, status: "executing" };
  }

  async getSession(sessionId: string) {
    return this.sessionService.getSession(sessionId);
  }

  async getProjectSessions(projectId: string) {
    return this.sessionService.getProjectSessions(projectId);
  }

  async deleteSession(sessionId: string) {
    return this.sessionService.deleteSession(sessionId);
  }

  async deleteSessions(sessionIds: string[]) {
    return this.sessionService.deleteSessions(sessionIds);
  }

  /**
   * Request to skip the current research phase.
   * The coordinator checks this flag at natural boundaries between LLM calls.
   */
  requestSkipPhase(projectId: string): boolean {
    return this.coordinator.requestSkipPhase(projectId);
  }
}
