/**
 * 辩论 Pattern - 纯函数 prompt 构造器。
 *
 * 这些函数是无副作用、无依赖的 string templating，便于单元测试。
 * 来源：从 ai-app/teams/services/collaboration/debate.service.ts 的
 *      buildAgentPrompt 抽取（W1 PR2，evidence: teams-mode-review.md §3.1 P0-4）。
 */

import type { DebateRole } from "./debate.types";

interface AgentPromptInput {
  role: DebateRole;
  topic: string;
  myDisplayName: string;
  opponentDisplayName: string;
}

/**
 * 构造单个辩手的 system prompt。
 *
 * 设计要点：
 * - 身份、立场、对手、规则、格式 5 块结构化，便于模型对齐
 * - JUDGE 角色无对手，prompt 形态不同
 * - 不含任何业务（Topic / Mission / 房间）字段，纯抽象
 */
export function buildAgentSystemPrompt(input: AgentPromptInput): string {
  const { role, topic, myDisplayName, opponentDisplayName } = input;

  if (role === "RED") {
    return [
      "【身份信息】",
      `- 你的名字：${myDisplayName}`,
      "- 你的角色：正方/红方辩手",
      `- 你的对手：${opponentDisplayName}（反方/蓝方）`,
      "",
      "【辩论主题】",
      `>>> ${topic} <<<`,
      "",
      "【核心规则】",
      "1. 你必须支持正方立场（支持/赞成）",
      "2. 只讨论上述主题，不讨论任何其他话题",
      "3. 必须针对对手的观点进行回应和反驳",
      `4. 每次发言结尾用 @${opponentDisplayName} 邀请对方回应`,
      "",
      "【发言格式】",
      `**辩论主题**：${topic}`,
      "**我方立场**：正方/支持",
      "**核心论点**：[2-3个论点]",
      "**数据佐证**：[证据来源]",
      "**向对方提问**：[问题]",
      "",
      `@${opponentDisplayName} 请回应`,
    ].join("\n");
  }

  if (role === "BLUE") {
    return [
      "【身份信息】",
      `- 你的名字：${myDisplayName}`,
      "- 你的角色：反方/蓝方辩手",
      `- 你的对手：${opponentDisplayName}（正方/红方）`,
      "",
      "【辩论主题】",
      `>>> ${topic} <<<`,
      "",
      "【核心规则】",
      "1. 你必须支持反方立场（反对/质疑）",
      "2. 只讨论上述主题，不讨论任何其他话题",
      "3. 必须针对对手的观点进行反驳",
      `4. 每次发言结尾用 @${opponentDisplayName} 邀请对方回应`,
      "",
      "【发言格式】",
      `**辩论主题**：${topic}`,
      "**对方观点问题**：[指出问题]",
      "**我方反驳**：[2-3个反驳点]",
      "**反面证据**：[证据来源]",
      "**质疑点**：[尖锐问题]",
      "",
      `@${opponentDisplayName} 请继续`,
    ].join("\n");
  }

  // JUDGE
  return [
    "【辩论主题】",
    `>>> ${topic} <<<`,
    "",
    "【职责】",
    "1. 客观评估双方论点的有效性",
    "2. 指出各方论证的优缺点",
    "3. 总结辩论要点",
    "4. 给出公正的评判",
    "",
    "【评判格式】",
    `**辩论主题**：${topic}`,
    "**正方论点评估**：[评价]",
    "**反方论点评估**：[评价]",
    "**关键交锋点**：[总结]",
    "**综合评判**：[结论]",
  ].join("\n");
}

/**
 * 构造发给辩手的"本回合 user 消息"。
 *
 * - 第一回合且无对手发言时，给出开场指令
 * - 后续回合传入对手最新发言
 */
export function composeRoundUserMessage(
  round: number,
  opponentLastMessage: string | undefined,
): string {
  if (opponentLastMessage && opponentLastMessage.trim().length > 0) {
    return `【对手发言】\n${opponentLastMessage}\n\n请针对上述观点进行回应。`;
  }
  return `这是第 ${round} 轮辩论。请阐述你的观点。`;
}

/**
 * 构造 Judge 的总结请求消息。
 *
 * 输入是双方各回合的发言摘要；输出由 judge 自由发挥按其 system prompt 给出评判。
 *
 * 评审修订（R2 阻塞）：标签可定制，默认中文「正方/反方」；
 * adapter 层（如 ai-app/teams 或 ai-app/ask）可注入本地化标签或自定义术语。
 */
export function composeJudgeUserMessage(input: {
  topic: string;
  redDisplayName: string;
  blueDisplayName: string;
  redSpeeches: string[];
  blueSpeeches: string[];
  /** 正方在评判记录中的标签，默认「正方」 */
  redLabel?: string;
  /** 反方在评判记录中的标签，默认「反方」 */
  blueLabel?: string;
  /** 评判提示语，默认中文，可覆盖 */
  judgeInstruction?: string;
}): string {
  const {
    topic,
    redDisplayName,
    blueDisplayName,
    redSpeeches,
    blueSpeeches,
    redLabel = "正方",
    blueLabel = "反方",
    judgeInstruction = "请按你的评判格式输出综合评判。",
  } = input;
  const redBlock = redSpeeches
    .map((s, i) => `[${redDisplayName} - 第 ${i + 1} 轮]\n${s}`)
    .join("\n\n");
  const blueBlock = blueSpeeches
    .map((s, i) => `[${blueDisplayName} - 第 ${i + 1} 轮]\n${s}`)
    .join("\n\n");
  return [
    `【辩论主题】${topic}`,
    "",
    `【${redLabel}发言记录】`,
    redBlock || "（无）",
    "",
    `【${blueLabel}发言记录】`,
    blueBlock || "（无）",
    "",
    judgeInstruction,
  ].join("\n");
}
