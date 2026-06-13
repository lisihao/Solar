/**
 * Stage→Agent 数值契约注册表 —— 系统级"不允许违反契约"的单一执行点
 * （2026-05-22 ③ 专项：防架构腐朽）
 *
 * 背景：管线(生产方)算出的数值喂给 agent inputSchema(消费方)，两侧若各定义边界则
 * 漂移 → 运行时 InputValidationError → mission 崩（历史反复发生）。
 *
 * 机制：把每个"stage 产数值 → agent 消费"的边界**集中登记在此一处**。配套的
 * stage-contracts.spec.ts 遍历本表，对每条调 assertNumberProducerWithinSchema 机械断言
 * "生产方范围 ⊆ 消费方 schema"。任一边漂移 → CI 红，合不进主干。
 *
 * 新增一条 stage→agent 数值边界时：在此登记一行，central 测试自动覆盖（无需再各写一份）。
 * 生产方范围一律引用 contracts/*.contract.ts 的单一源常量，禁止写字面量。
 */

import { DimensionOutlinePlannerAgent } from "../../mission/agents/writer/dimension-outline-planner.agent";
import { ChapterWriterAgent } from "../../mission/agents/writer/chapter-writer.agent";
import { CHAPTER_COUNT_RANGE } from "./chapter-count.contract";
import { CHAPTER_WORDS_PER_CHAPTER_RANGE } from "./word-budget.contract";

export interface StageNumberContract {
  /** 消费方 agent 类（@DefineAgent 提供 inputSchema） */
  readonly agent: new (...args: never[]) => unknown;
  /** agent inputSchema 上的数值字段名 */
  readonly field: string;
  /** 生产方能产出的最小值（来自单一源常量，禁字面量） */
  readonly producerMin: number;
  /** 生产方能产出的最大值（来自单一源常量，禁字面量） */
  readonly producerMax: number;
  /** 生产方位置 + 说明 */
  readonly note: string;
}

export const STAGE_NUMBER_CONTRACTS: readonly StageNumberContract[] = [
  {
    agent: DimensionOutlinePlannerAgent,
    field: "targetChapterCount",
    producerMin: CHAPTER_COUNT_RANGE.min,
    producerMax: CHAPTER_COUNT_RANGE.max,
    note: "per-dim-pipeline clampChapterCount(CHAPTER_COUNT_RANGE)",
  },
  {
    agent: ChapterWriterAgent,
    field: "targetWords",
    producerMin: CHAPTER_WORDS_PER_CHAPTER_RANGE.min,
    producerMax: CHAPTER_WORDS_PER_CHAPTER_RANGE.max,
    note: "per-dim targetWordsPerChapter + s7 normalizeTargetWords 并集",
  },
];
