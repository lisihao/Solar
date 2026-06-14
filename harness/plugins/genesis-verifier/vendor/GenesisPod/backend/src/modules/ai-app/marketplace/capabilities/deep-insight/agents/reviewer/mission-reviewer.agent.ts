/**
 * Reviewer Agent —— 单 Reflexion 评审器；用作 Verify Consensus 的一员
 *
 * Orchestrator 把 Writer 输出送给 JudgeService.judgeWithConsensus(['external','critical','self'])。
 * 本 Agent 是"显式的 reviewer 角色"——业务方可注入额外的 Reviewer agent 替代 verifier。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import { ResearchReportSchema } from "../../contract/research-report.schema";

const Input = z.object({
  topic: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  draftReport: ResearchReportSchema,
});

const Output = z.object({
  score: z.number().min(0).max(100),
  verdict: z.enum(["approve", "revise", "reject"]),
  notes: z.array(z.string()),
});

@DefineAgent({
  id: "playground.reviewer",
  identity: {
    role: "reviewer",
    description: "Final QA reviewer — score the draft report on 4 dimensions",
  },
  loop: "simple",
  // PR-X-skill-bridge: L3 multi-judge 评分协议
  skills: ["multi-judge-mission-review"],
  taskProfile: {
    creativity: "deterministic",
    outputLength: "short",
    taskKind: "review",
  },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 16_000, maxIterations: 4 },
})
export class MissionReviewerAgent extends AgentSpec<
  typeof Input,
  typeof Output
> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    return [
      `You are the final reviewer for the research report on "${input.topic}".`,
      `Language: ${input.language}.`,
      ``,
      `Score 0-100 on:`,
      `- Accuracy of claims (citation quality)`,
      `- Coverage of dimensions`,
      `- Logical structure`,
      `- Clarity and actionability`,
      ``,
      `Verdict: approve (>= 80) / revise (60-79) / reject (< 60)`,
    ].join("\n");
  }
}
