import { Injectable, Optional } from "@nestjs/common";
import { Subject } from "rxjs";
import { TeamFacade } from "@/modules/ai-harness/facade";
import { DeepResearchSSEEvent, SearchRound } from "./types";
import { AgentState, DiscussionMessage } from "./discussion-types";

/**
 * 讨论流工具服务
 *
 * 职责: SSE 事件发射、Agent 状态查找、通用异步工具（超时、延迟、唯一来源计数）。
 * 无业务状态，所有方法均为纯工具函数或薄包装。
 */
@Injectable()
export class DiscussionStreamService {
  constructor(@Optional() private readonly teamFacade?: TeamFacade) {}

  getAgent(team: Map<string, AgentState>, id: string): AgentState {
    const agent = team.get(id);
    if (!agent) {
      throw new Error(`Agent "${id}" not initialized in team`);
    }
    return agent;
  }

  /**
   * 统一消息发送：同时推送 SSE 事件和 A2A Bus 消息（供可观测性使用）
   */
  publishMessage(
    sessionId: string,
    msg: DiscussionMessage,
    subject: Subject<DeepResearchSSEEvent>,
  ): void {
    subject.next({ type: "discussion.message", data: msg });
    void this.teamFacade?.a2aPublish({
      sessionId,
      // Discussion agents are virtual roles with no UUID; agentRole is their stable identifier
      fromAgentId: msg.agentRole,
      type: "info_share",
      payload: {
        phase: msg.phase,
        messageType: msg.messageType,
        content: msg.content.slice(0, 500),
      },
    });
  }

  emitTyping(subject: Subject<DeepResearchSSEEvent>, agent: AgentState): void {
    subject.next({
      type: "discussion.typing",
      data: {
        agentRole: agent.config.role,
        agentName: agent.config.name,
      },
    });
  }

  async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string,
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} 超时 (${timeoutMs / 1000}秒)`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  countUniqueSources(searchRounds: SearchRound[]): number {
    const urls = new Set<string>();
    for (const round of searchRounds) {
      for (const source of round.sources) {
        urls.add(source.url);
      }
    }
    return urls.size;
  }
}
