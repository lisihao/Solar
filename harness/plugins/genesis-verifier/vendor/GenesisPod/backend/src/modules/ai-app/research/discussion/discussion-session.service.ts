import { Injectable, Logger } from "@nestjs/common";
import { DeepResearchStatus } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";

/**
 * 研究会话持久化服务
 *
 * 职责: DeepResearchSession 的 CRUD 操作及状态自动修正。
 */
@Injectable()
export class DiscussionSessionService {
  private readonly logger = new Logger(DiscussionSessionService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSession(sessionId: string) {
    return this.prisma.deepResearchSession.findUnique({
      where: { id: sessionId },
    });
  }

  async getProjectSessions(projectId: string) {
    const sessions = await this.prisma.deepResearchSession.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    // Auto-correct stale sessions stuck in intermediate states
    // Note: PLAN_READY and CANCELLED are intentional terminal-like states — do not auto-correct them.
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const intermediateStatuses: DeepResearchStatus[] = [
      DeepResearchStatus.IDEATION,
      DeepResearchStatus.PLANNING,
      DeepResearchStatus.SEARCHING,
      DeepResearchStatus.FINDINGS,
      DeepResearchStatus.REFLECTING,
      DeepResearchStatus.SYNTHESIZING,
    ];

    for (const session of sessions) {
      if (
        intermediateStatuses.includes(session.status) &&
        now - session.updatedAt.getTime() > staleThreshold
      ) {
        // If session has discussion data, mark as COMPLETED; otherwise FAILED
        const hasContent =
          session.discussion !== null &&
          Array.isArray(session.discussion) &&
          (session.discussion as unknown[]).length > 0;
        const newStatus = hasContent
          ? DeepResearchStatus.COMPLETED
          : DeepResearchStatus.FAILED;

        this.logger.warn(
          `Auto-correcting stale session ${session.id}: ${session.status} → ${newStatus}`,
        );
        try {
          await this.prisma.deepResearchSession.update({
            where: { id: session.id },
            data: {
              status: newStatus,
              ...(newStatus === DeepResearchStatus.FAILED && {
                error: "研究会话超时中断",
              }),
              ...(newStatus === DeepResearchStatus.COMPLETED && {
                completedAt: session.updatedAt,
              }),
            },
          });
          session.status = newStatus;
        } catch (e) {
          this.logger.error(
            `Failed to auto-correct session ${session.id}: ${e}`,
          );
        }
      }
    }

    return sessions;
  }

  async deleteSession(sessionId: string) {
    return this.prisma.deepResearchSession.delete({
      where: { id: sessionId },
    });
  }

  async deleteSessions(sessionIds: string[]) {
    return this.prisma.deepResearchSession.deleteMany({
      where: { id: { in: sessionIds } },
    });
  }

  async updateSession(
    sessionId: string,
    data: {
      status?: DeepResearchStatus;
      plan?: unknown;
      searchRounds?: unknown;
      reflections?: unknown;
      thinkingChain?: unknown;
      report?: unknown;
      discussion?: unknown;
      directions?: unknown;
      sourcesUsed?: number;
      tokensUsed?: number;
      error?: string;
      completedAt?: Date;
    },
  ) {
    return this.prisma.deepResearchSession.update({
      where: { id: sessionId },
      data: JSON.parse(JSON.stringify(data)),
    });
  }
}
