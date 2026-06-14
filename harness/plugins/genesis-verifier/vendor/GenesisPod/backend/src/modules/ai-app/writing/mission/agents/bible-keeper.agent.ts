/**
 * BibleKeeperAgent (mission-pipeline 形态) —— Story Bible 守护者
 *
 * B1 迁移：从 `agents/bible-keeper.agent.ts`（BaseAgent）迁到 AgentSpec + @DefineAgent。
 * 职责保留：设定查询 / 角色状态更新建议 / 时间线事件 / 设定变更验证 / 快照。
 *
 * 注：旧 BibleKeeper 大部分 operation 是纯内存查询（不调 LLM），只有 validate_change
 * 走 LLM。迁移后 Agent 只负责「需要 LLM 的语义校验」形态——纯查询型 operation 的
 * 数据装配由 s2 stage（调 StoryBible/Character/WorldSetting 领域 service）完成后，
 * 把要校验的子集喂进来；Agent 侧 prompt 覆盖全部 operation 语义，runner 按需调用。
 */

import { z } from "zod";
import { AgentSpec, DefineAgent } from "@/modules/ai-harness/facade";
import type {
  WritingContextPackage,
  WritingCharacterEntity,
  CharacterStateSnapshot,
  TimelineEventEntity,
} from "../../interfaces/writing-context.interface";

const Input = z.object({
  operation: z.enum([
    "query_character",
    "query_world",
    "query_timeline",
    "query_terminology",
    "update_character_state",
    "add_timeline_event",
    "validate_change",
    "get_snapshot",
  ]),
  projectId: z.string(),
  contextPackage: z.custom<WritingContextPackage>(),
  params: z.object({
    characterName: z.string().optional(),
    characterId: z.string().optional(),
    worldCategory: z.string().optional(),
    timeRange: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
      })
      .optional(),
    term: z.string().optional(),
    newState: z.custom<CharacterStateSnapshot>().optional(),
    sourceChapterId: z.string().optional(),
    newEvent: z.custom<TimelineEventEntity>().optional(),
    proposedChange: z
      .object({
        type: z.enum(["character", "world", "timeline", "terminology"]),
        data: z.record(z.string(), z.unknown()),
      })
      .optional(),
  }),
});

const Output = z.object({
  operation: z.string(),
  success: z.boolean(),
  result: z.object({
    character: z.custom<WritingCharacterEntity>().optional(),
    characters: z.array(z.custom<WritingCharacterEntity>()).optional(),
    worldSettings: z
      .array(
        z.object({
          category: z.string(),
          name: z.string(),
          description: z.string(),
          rules: z.array(z.string()).optional(),
        }),
      )
      .optional(),
    timelineEvents: z.array(z.custom<TimelineEventEntity>()).optional(),
    terminology: z
      .object({
        term: z.string(),
        definition: z.string(),
        variants: z.array(z.string()).optional(),
      })
      .optional(),
    snapshot: z
      .custom<WritingContextPackage["extensions"]["storyBible"]>()
      .optional(),
    validation: z
      .object({
        valid: z.boolean(),
        conflicts: z.array(
          z.object({
            type: z.string(),
            description: z.string(),
            existingValue: z.string(),
            proposedValue: z.string(),
          }),
        ),
        suggestions: z.array(z.string()),
      })
      .optional(),
  }),
  warnings: z.array(z.string()).optional(),
});

export type BibleKeeperInput = z.infer<typeof Input>;
export type BibleKeeperOutput = z.infer<typeof Output>;

@DefineAgent({
  id: "writing.bible-keeper",
  identity: {
    role: "bible-keeper",
    description:
      "Story Bible 守护者 - 维护设定一致性、提供查询服务、审核设定变更",
  },
  loop: "react",
  taskProfile: { creativity: "low", outputLength: "medium" },
  inputSchema: Input,
  outputSchema: Output,
  budget: { maxTokens: 4_000, maxIterations: 3, maxIterationsHardCap: 4 },
})
export class BibleKeeperAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const bible = input.contextPackage.extensions.storyBible;

    const header = [
      `你是 Story Bible 守护者，负责维护小说所有设定的一致性，并响应设定相关请求。`,
      ``,
      `## 核心职责`,
      `- 设定管理：维护角色、世界观、时间线、术语等所有设定`,
      `- 查询服务：响应设定查询请求，准确返回已有设定`,
      `- 变更控制：审核设定变更，防止与现有设定冲突`,
      `- 状态追踪：追踪角色状态随剧情的变化`,
      ``,
      `## 当前操作：${input.operation}`,
      ``,
    ];

    if (input.operation === "validate_change") {
      return [
        ...header,
        `## 设定变更验证原则`,
        `1. 新设定不能与已有设定矛盾`,
        `2. 角色属性变更需要有合理的剧情支撑`,
        `3. 世界观规则不能随意改变`,
        `4. 术语使用需要保持一致`,
        ``,
        `## 现有设定（截断）`,
        JSON.stringify(bible, null, 2).slice(0, 5000),
        ``,
        `请验证待验证的变更（params.proposedChange）是否与现有设定冲突，`,
        `输出到 result.validation（valid / conflicts / suggestions）。`,
      ].join("\n");
    }

    return [
      ...header,
      `## 查询/维护原则`,
      `- 查询类操作（query_*、get_snapshot）：基于现有设定准确返回，不臆造未存在的信息；`,
      `  找不到时在 warnings 中说明，success 仍可为 true。`,
      `- 维护类操作（update_character_state、add_timeline_event）：实际落库由服务层完成，`,
      `  你只产出变更建议与冲突提示（result.validation.suggestions）。`,
      ``,
      `请按当前 operation 的语义，将结果填入对应的 result 字段。`,
    ].join("\n");
  }
}
