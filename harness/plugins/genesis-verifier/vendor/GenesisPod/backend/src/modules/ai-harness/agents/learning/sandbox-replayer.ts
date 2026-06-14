/**
 * SandboxReplayer 预置实现 (PR-T)
 *
 * 业务方按需选用：
 *   - NoopSandboxReplayer：永远返 80 分（仅做契约 smoke）
 *   - LlmSelfCheckReplayer：用 LLM 自己评估"如果用此 skill 处理样本，预期分数多少"
 *   - DryRunReplayer：业务方提供 dryRunFn(skill, sample)，跑业务逻辑得分
 *
 * 真正的"重跑历史 task"由业务方实现 IDryRunSandboxReplayer，
 * 因为 Harness 不知道业务的 task store。
 */

import type { SandboxReplayer } from "./skill-learning-coordinator";
import { AiChatService } from "../../../ai-engine/llm/chat/ai-chat.service";

/** 永远 pass，用于框架自检 / 不接 LLM 的轻量场景 */
export class NoopSandboxReplayer implements SandboxReplayer {
  async sample(): Promise<readonly { id: string; input: unknown }[]> {
    return [];
  }
  async replay(): Promise<{ score: number; note?: string }> {
    return { score: 80, note: "noop replayer always returns 80" };
  }
}

const SKILL_REPLAY_PROMPT = `你是 Skill 验证员。下面给你一段 SKILL.md 内容和一个历史 task 输入。
请评估"如果一个 agent 严格遵循此 skill 处理这个输入，预期能否得到合格答案"。

输出严格 JSON：
{
  "score": 0-100,
  "note": "简评 ≤200 字，说明 skill 与 task 的契合度 / 缺失点"
}

评分维度：
- skill 是否覆盖 task 的核心需求（30%）
- skill 中的工具 / 步骤是否可执行（30%）
- skill 是否有错误处理 / 边界条件（20%）
- skill 描述的清晰度 / 可复用性（20%）`;

/**
 * LlmSelfCheckReplayer —— 用 LLM 元评估 skill 与 task 的契合度
 *
 * 优点：业务方零工作量；
 * 缺点：LLM 评分有误差，不如真实 dry-run 准；
 * 适合：早期 / 没有 task store 的场景。
 *
 * 业务方需提供 sampleProvider 把历史 task 拉出来。
 */
export class LlmSelfCheckReplayer implements SandboxReplayer {
  constructor(
    private readonly chat: AiChatService,
    private readonly sampleProvider: (
      roleId: string,
      n: number,
    ) => Promise<readonly { id: string; input: unknown }[]>,
  ) {}

  async sample(
    roleId: string,
    n: number,
  ): Promise<readonly { id: string; input: unknown }[]> {
    return this.sampleProvider(roleId, n);
  }

  async replay(
    candidateMarkdown: string,
    sample: { id: string; input: unknown },
  ): Promise<{ score: number; note?: string }> {
    try {
      const res = await this.chat.chat({
        systemPrompt: SKILL_REPLAY_PROMPT,
        messages: [
          {
            role: "user",
            content: `# Skill\n\`\`\`\n${candidateMarkdown.slice(0, 3000)}\n\`\`\`\n\n# Task input\n\`\`\`json\n${JSON.stringify(sample.input).slice(0, 2000)}\n\`\`\``,
          },
        ],
        taskProfile: { creativity: "deterministic", outputLength: "short" },
        responseFormat: "json",
      });
      const obj = JSON.parse(this.stripFences(res.content)) as {
        score?: number;
        note?: string;
      };
      const score =
        typeof obj.score === "number"
          ? Math.max(0, Math.min(100, obj.score))
          : 50;
      return { score, note: obj.note };
    } catch (err) {
      return {
        score: 50,
        note: `LlmSelfCheckReplayer failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private stripFences(s: string): string {
    let t = s.trim();
    if (t.startsWith("```")) {
      t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
    }
    return t;
  }
}
