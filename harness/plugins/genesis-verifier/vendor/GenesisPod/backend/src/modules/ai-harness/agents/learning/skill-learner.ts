/**
 * SkillLearner — 从成功 trace 抽取 SKILL.md 候选
 *
 * 输入：一次完整的 agent 执行事件流（或已完成 checkpoint）
 * 输出：SKILL.md 候选文本（frontmatter + instructions）
 *
 * Phase 6 设计：
 *   - 只产出候选文本 + 结构化 metadata，不自动入库
 *   - 人工审核后由 App 层写入 SkillRegistry 或持久化
 *   - 使用 LLM 归纳 agent 的行动模式
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import type { IAgentEvent, IAgentIdentity, IAction } from "../abstractions";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";
import { AIModelType } from "@prisma/client";

export interface SkillCandidate {
  /** 可作为 SKILL.md 文件名的 id */
  suggestedId: string;
  /** 完整 SKILL.md 文本（frontmatter + body） */
  markdown: string;
  /** 候选的 frontmatter（方便 App 层审核时展示） */
  frontmatter: {
    name: string;
    description: string;
    tags: string[];
    allowedTools: string[];
  };
  /** 产生候选的 trace 统计 */
  stats: {
    totalEvents: number;
    toolsUsed: string[];
    actionCount: number;
  };
  /** 给审核者的 reasoning（为何值得沉淀） */
  rationale: string;
}

export interface LearnFromTraceOptions {
  identity: IAgentIdentity;
  events: readonly IAgentEvent[];
  /** 如果此次 agent 完成了一个成功任务，把结果摘要传入可让候选更准确 */
  successSummary?: string;
}

const SKILL_SYNTHESIS_PROMPT = `You are a Skill Distillation assistant. Your job is to inspect a successful AI agent's execution trace and propose a reusable SKILL.md that captures the reusable protocol the agent followed.

Requirements:
1. Output ONLY the SKILL.md text (frontmatter + markdown body). No surrounding prose.
2. Frontmatter MUST include: name (kebab-case), description (<=120 chars), tags (3-5 items), allowedTools (list the tool ids used).
3. The Markdown body must describe the PROTOCOL in reusable terms (not a narrative of this one run).
4. Avoid task-specific details. Focus on the general technique.
5. Use the same voice/format as the Anthropic SKILL.md standard.
`;

@Injectable()
export class SkillLearner {
  private readonly logger = new Logger(SkillLearner.name);

  constructor(@Optional() private readonly chatService?: AiChatService) {}

  async learn(options: LearnFromTraceOptions): Promise<SkillCandidate | null> {
    if (!this.chatService) {
      this.logger.warn("SkillLearner: AiChatService unavailable, skipping");
      return null;
    }

    const { identity, events, successSummary } = options;
    const traceSummary = this.summarizeTrace(events);

    if (traceSummary.actionCount === 0) {
      // No actions — nothing to distill
      return null;
    }

    const userInput = [
      `# Role`,
      identity.role.name,
      identity.role.description ?? "",
      "",
      `# Trace summary`,
      `- actions: ${traceSummary.actionCount}`,
      `- tools used: ${traceSummary.toolsUsed.join(", ") || "(none)"}`,
      "",
      `# Action sequence (compressed)`,
      traceSummary.actionLog,
      successSummary ? `\n# Success outcome\n${successSummary}` : "",
    ].join("\n");

    let markdown: string;
    try {
      const response = await this.chatService.chat({
        messages: [{ role: "user", content: userInput }],
        systemPrompt: SKILL_SYNTHESIS_PROMPT,
        taskProfile: { creativity: "low", outputLength: "medium" },
        // 系统配置感知 —— skill-learner 是后台任务，无 userId 上下文，
        // 走全局默认 CHAT 模型
        modelType: AIModelType.CHAT,
      });
      markdown = response.content.trim();
      // Strip possible code fences
      if (markdown.startsWith("```")) {
        markdown = markdown
          .replace(/^```(?:markdown)?\s*/i, "")
          .replace(/```\s*$/i, "");
      }
    } catch (err) {
      this.logger.warn(
        `SkillLearner: synthesis failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }

    const frontmatter = this.extractFrontmatter(markdown);
    if (!frontmatter) {
      this.logger.warn(
        "SkillLearner: could not parse frontmatter from LLM output",
      );
      return null;
    }

    return {
      suggestedId: frontmatter.name,
      markdown,
      frontmatter,
      stats: {
        totalEvents: events.length,
        toolsUsed: traceSummary.toolsUsed,
        actionCount: traceSummary.actionCount,
      },
      rationale: `Derived from ${events.length} events; agent completed with ${traceSummary.actionCount} actions using ${traceSummary.toolsUsed.length} distinct tools.`,
    };
  }

  // ─── helpers ─────────────────────────────────────────────

  private summarizeTrace(events: readonly IAgentEvent[]): {
    actionCount: number;
    toolsUsed: string[];
    actionLog: string;
  } {
    const toolsUsed = new Set<string>();
    const actions: string[] = [];
    let actionCount = 0;

    for (const ev of events) {
      if (ev.type === "action_planned") {
        const action = ev.payload as IAction;
        actionCount += 1;
        if (action.kind === "tool_call") {
          toolsUsed.add(action.toolId);
          actions.push(
            `${actionCount}. tool_call ${action.toolId}(${this.shortJson(action.input)})`,
          );
        } else if (action.kind === "finalize") {
          actions.push(`${actionCount}. finalize`);
        } else {
          actions.push(`${actionCount}. ${action.kind}`);
        }
      }
    }

    return {
      actionCount,
      toolsUsed: Array.from(toolsUsed),
      actionLog: actions.join("\n"),
    };
  }

  private shortJson(obj: unknown, max = 80): string {
    try {
      const s = JSON.stringify(obj);
      return s.length > max ? s.slice(0, max) + "…" : s;
    } catch {
      return String(obj);
    }
  }

  private extractFrontmatter(
    markdown: string,
  ): SkillCandidate["frontmatter"] | null {
    const fmMatch = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!fmMatch) return null;
    const fm = fmMatch[1];

    const name = this.extractField(fm, "name");
    const description = this.extractField(fm, "description");
    if (!name || !description) return null;

    const tags = this.extractArrayField(fm, "tags");
    const allowedTools = this.extractArrayField(fm, "allowedTools");

    return { name, description, tags, allowedTools };
  }

  private extractField(yaml: string, key: string): string | null {
    const re = new RegExp(`^${key}\\s*:\\s*(.+)$`, "m");
    const m = yaml.match(re);
    if (!m) return null;
    return m[1].trim().replace(/^["']|["']$/g, "");
  }

  private extractArrayField(yaml: string, key: string): string[] {
    // Inline: tags: [a, b, c]
    const inlineRe = new RegExp(`^${key}\\s*:\\s*\\[(.*)\\]`, "m");
    const inline = yaml.match(inlineRe);
    if (inline) {
      return inline[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    // Multi-line: tags:\n  - a\n  - b
    const blockRe = new RegExp(
      `^${key}\\s*:\\s*\\n((?:\\s+-\\s+.+\\n?)+)`,
      "m",
    );
    const block = yaml.match(blockRe);
    if (block) {
      return block[1]
        .split("\n")
        .map((line) => line.replace(/^\s*-\s*/, "").trim())
        .filter(Boolean);
    }
    return [];
  }
}
