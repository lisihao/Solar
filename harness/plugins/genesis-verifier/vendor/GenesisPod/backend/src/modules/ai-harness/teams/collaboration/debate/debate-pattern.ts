/**
 * DebatePattern - 通用辩论编排基元（无持久化、无 NestJS DI）。
 *
 * 来源：W1 PR2，evidence: teams-mode-review.md §3.1 P0-4。
 *
 * 责任边界：
 *   - 接收抽象 IDebateAgent 列表 + 配置
 *   - 按 RED → BLUE → ... 轮转调度，可选 JUDGE 末轮总结
 *   - 维护每个 agent 的独立对话历史（agent 间隔离）
 *   - 在每轮通过 IDebateAgent.chat() 调用底层 LLM
 *   - 返回所有回合的 DebateRoundResult 序列
 *
 * 不做：
 *   - 落库（agent 自己负责，pattern 只读历史不存历史）
 *   - 计费（agent 自己实现，pattern 只透传 signal）
 *   - 投票（VotingManager 是另一个 pattern）
 *   - 流式事件（消费者按需自己 emit）
 */

import { Logger } from "@nestjs/common";
import {
  buildAgentSystemPrompt,
  composeJudgeUserMessage,
  composeRoundUserMessage,
} from "./debate-prompts";
import {
  DebatePatternConfig,
  DebateRoundResult,
  IDebateAgent,
} from "./debate.types";

interface RunDebateInput {
  /** 辩题 */
  topic: string;
  /** 参与辩论的 agents（必须 1 RED + 1 BLUE，可选 1 JUDGE） */
  agents: IDebateAgent[];
  /** 配置 */
  config?: DebatePatternConfig;
}

interface AgentHistory {
  agentId: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}

const DEFAULT_MAX_ROUNDS = 3;

export class DebatePattern {
  private readonly logger = new Logger(DebatePattern.name);

  /**
   * 跑完整场辩论，返回有序回合结果。
   *
   * 调度顺序：
   *   round 1: RED, BLUE
   *   round 2: RED, BLUE  （RED 看到上一轮 BLUE）
   *   ...
   *   round N: RED, BLUE
   *   final  : JUDGE（如启用）—— 看到全部双方发言
   */
  async runDebate(input: RunDebateInput): Promise<DebateRoundResult[]> {
    const { topic, agents, config } = input;
    const maxRounds = config?.maxRounds ?? DEFAULT_MAX_ROUNDS;
    const enableJudge = config?.enableJudge ?? false;
    const signal = config?.signal;

    const red = agents.find((a) => a.role === "RED");
    const blue = agents.find((a) => a.role === "BLUE");
    const judge = agents.find((a) => a.role === "JUDGE");

    if (!red || !blue) {
      throw new Error(
        "DebatePattern.runDebate: must include exactly one RED and one BLUE agent",
      );
    }
    if (enableJudge && !judge) {
      throw new Error(
        "DebatePattern.runDebate: enableJudge=true but no JUDGE agent provided",
      );
    }

    this.logger.log(
      `[DebatePattern] start topic="${topic}" rounds=${maxRounds} judge=${enableJudge}`,
    );

    const histories: AgentHistory[] = agents.map((a) => ({
      agentId: a.id,
      history: [],
    }));
    const findHistory = (id: string): AgentHistory => {
      const h = histories.find((x) => x.agentId === id);
      if (!h) throw new Error(`history for ${id} missing (impossible)`);
      return h;
    };

    const results: DebateRoundResult[] = [];
    const redSpeeches: string[] = [];
    const blueSpeeches: string[] = [];
    let lastRedContent = "";
    let lastBlueContent = "";

    for (let round = 1; round <= maxRounds; round += 1) {
      this.checkAborted(signal);

      // ===== RED 发言 =====
      const redSystem = buildAgentSystemPrompt({
        role: "RED",
        topic,
        myDisplayName: red.displayName,
        opponentDisplayName: blue.displayName,
      });
      const redUserMessage = composeRoundUserMessage(
        round,
        round === 1 ? undefined : lastBlueContent,
      );
      const redHist = findHistory(red.id);
      const redResp = await red.chat({
        systemPrompt: redSystem,
        history: redHist.history,
        userMessage: redUserMessage,
        signal,
      });
      lastRedContent = redResp.content;
      redSpeeches.push(redResp.content);
      redHist.history.push(
        { role: "user", content: redUserMessage },
        { role: "assistant", content: redResp.content },
      );
      results.push({
        round,
        speakerId: red.id,
        role: "RED",
        content: redResp.content,
        tokensUsed: redResp.tokensUsed,
      });

      this.checkAborted(signal);

      // ===== BLUE 发言 =====
      const blueSystem = buildAgentSystemPrompt({
        role: "BLUE",
        topic,
        myDisplayName: blue.displayName,
        opponentDisplayName: red.displayName,
      });
      const blueUserMessage = composeRoundUserMessage(round, lastRedContent);
      const blueHist = findHistory(blue.id);
      const blueResp = await blue.chat({
        systemPrompt: blueSystem,
        history: blueHist.history,
        userMessage: blueUserMessage,
        signal,
      });
      lastBlueContent = blueResp.content;
      blueSpeeches.push(blueResp.content);
      blueHist.history.push(
        { role: "user", content: blueUserMessage },
        { role: "assistant", content: blueResp.content },
      );
      results.push({
        round,
        speakerId: blue.id,
        role: "BLUE",
        content: blueResp.content,
        tokensUsed: blueResp.tokensUsed,
      });
    }

    if (enableJudge && judge) {
      this.checkAborted(signal);

      const judgeSystem = buildAgentSystemPrompt({
        role: "JUDGE",
        topic,
        myDisplayName: judge.displayName,
        opponentDisplayName: "",
      });
      const judgeUserMessage = composeJudgeUserMessage({
        topic,
        redDisplayName: red.displayName,
        blueDisplayName: blue.displayName,
        redSpeeches,
        blueSpeeches,
      });
      const judgeHist = findHistory(judge.id);
      const judgeResp = await judge.chat({
        systemPrompt: judgeSystem,
        history: judgeHist.history,
        userMessage: judgeUserMessage,
        signal,
      });
      judgeHist.history.push(
        { role: "user", content: judgeUserMessage },
        { role: "assistant", content: judgeResp.content },
      );
      results.push({
        round: maxRounds + 1,
        speakerId: judge.id,
        role: "JUDGE",
        content: judgeResp.content,
        tokensUsed: judgeResp.tokensUsed,
      });
    }

    this.logger.log(
      `[DebatePattern] done rounds=${results.length} totalTokens=${results.reduce((s, r) => s + (r.tokensUsed ?? 0), 0)}`,
    );
    return results;
  }

  private checkAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
      throw new Error("DebatePattern aborted by signal");
    }
  }
}
