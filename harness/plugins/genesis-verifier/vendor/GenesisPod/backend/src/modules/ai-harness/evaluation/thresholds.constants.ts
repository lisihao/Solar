/**
 * 质量阈值集中配置 —— 单一来源
 *
 * 历史：consumer / reflexion-loop / s8-writer / per-dim-pipeline 各自硬编码
 * 60/70/75 阈值，相互不一致触发死循环（mission 165c967f 死锁 70+min 真因：
 * per-dim PASS=75 + reviewer 实测 66-68 → 永远 revise）。
 *
 * 现在所有 quality gate 都从此处 import，确保 mission 全链路阈值一致。
 *
 * Tuning 历史：
 * - 2026-04-30 (commit f955b9ae1) reflexion-loop 默认从 75 → 60
 * - 2026-05-01 (PR-G iter8) per-dim-pipeline / s8-writer 也降到 60
 *
 * 当前 LLM 输出质量分布观测：65-75 区间集中。设为 60 让"基本可用"的章节
 * 直接放行，>=70 的"高质量"章节自然也通过；只有 <60 的"明显有问题"章节
 * 触发 revise。
 */

/**
 * Reviewer 通过分数下限。
 * - 评分 >= 此值 → pass，章节进入下一阶段
 * - 评分 < 此值  → revise，进入修订循环
 *
 * 三层联动（避免出现 reflexion pass 但 chapter-pipeline reject 的内部矛盾）：
 * 1. reflexion-loop.passThreshold（agent 内部 self/external/critical verifier）
 * 2. s8-writer-draft-report.passThreshold（mission 级 writer judge consensus）
 * 3. per-dim-pipeline.PASS_THRESHOLD（章节级 chapter-reviewer）
 *
 * 三处全部走此常量，调一处即三处生效。
 */
export const REVIEW_PASS_THRESHOLD = 60;

/**
 * 章节重写循环的分数衰减下限：随重试轮次降低通过线，但不低于此值。
 * 单一源（取代 chapter-pipeline 内联的魔法数字 40）。
 */
export const REVIEW_REWRITE_FLOOR = 40;

/**
 * 章节级 writer/reviewer 修订循环最大重试次数。
 * - 1 = 每章最多 2 attempts（1 初稿 + 1 修订）
 *
 * LLM 在收到 critique 后第 2 次往往能改进；第 3、4 次边际收益≈0 但成本翻倍。
 * 极少数仍不达标的章节由 mergeUndersizedSections / postProcessFinalReport
 * 在装配阶段兜底处理，不再靠 review loop 补救。
 */
export const CHAPTER_MAX_REVISION_ATTEMPTS = 1;

/**
 * Mission 级 writer 重写最大次数（s8 顶层）。
 * - 2 = 最多 2 次完整 mission writer attempts
 */
export const MISSION_WRITER_MAX_ATTEMPTS = 2;

/**
 * Reviewer 连续失败容忍次数（per-dim-pipeline 用）。
 * 超过此值 reviewer 视为持续故障，放弃该章节的复审循环，直接 accept 当前 draft。
 */
export const MAX_CONSECUTIVE_REVIEWER_FAILURES = 2;

// ============ Agent-level Budget Caps ============
//
// 这些 cap 之前散落在各 agent decorator 里硬编码，与 review pass 阈值组合时
// 容易产生指数爆炸（mission 165c967f 70+min 卡死真因之一）。集中到此处统一
// 调优，避免 chapter-writer × reflexion × outer revise loop 的乘积失控。

/**
 * Chapter writer 单次调用内部 reflexion 最大迭代数。
 * - 1 = 写 1 次后就 finalize（不在 agent 内部再 self-critique）
 *   外部已有 chapter-reviewer 评分 + revise loop（per-dim-pipeline），
 *   再叠 reflexion 等于双层评审。把内部 reflexion 收敛到 1 让外部评审权重最大化。
 * - 之前 4 → 与外部 4 次 revise 相乘 = 16 LLM calls/章节
 */
export const CHAPTER_WRITER_INTERNAL_MAX_ITERATIONS = 1;

/**
 * Chapter reviewer simple-loop 最大迭代数。
 * - 1 = 评分一次就出 verdict，不内部 self-critique
 */
export const CHAPTER_REVIEWER_INTERNAL_MAX_ITERATIONS = 1;

/**
 * Researcher ReAct loop 最大迭代数（柔性 cap）。
 * - 5 = 1 search + 1-2 scrape + 1 finalize + buffer
 * - 实际 framework 还会按 maxWallTimeMs / maxTokens 提前退出
 */
export const RESEARCHER_MAX_ITERATIONS = 5;

/**
 * Researcher 硬上限（无论 budgetMultiplier 如何放大都不可越过）。
 * - 10 = base 5 × 2 容错系数
 * - 这是防 leader-assess-research 用 budgetMultiplier 7× 把 base 5 放大到 35 触发
 *   60+ 轮死循环（mission 8c7b4358 真因）的硬护栏
 */
export const RESEARCHER_MAX_ITERATIONS_HARD_CAP = 10;

/**
 * Researcher 单 dim wall-time 上限（毫秒）。
 * - 600s = 10min，覆盖 1 search + 1-2 scrape + figure extraction
 * - 框架通过 maxWallTimeMs 强制 abort，避免 reasoning 模型 232s/call × 多轮死等
 */
export const RESEARCHER_MAX_WALL_TIME_MS = 600_000;

// ============ Self-Driven Agent Team Caps ============

/**
 * RubricGenerator 产出的 passLine 硬上界。
 * - clamp(passLine, REVIEW_PASS_THRESHOLD=60, RUBRIC_PASS_LINE_CAP=90)
 * - 防止 passLine→99 导致质量门永远无法通过（无谓多轮重试浪费 token）
 * - 设计见 docs/architecture/ai-harness/self-driven-team/ §5.2/§9
 */
export const RUBRIC_PASS_LINE_CAP = 90;

/**
 * Self-Driven Agent 单 mission 最大循环迭代数（全局硬 cap）。
 * - RoleInventory 可声明 custom 但不得超过此值（safety-09）
 * - 防止自驱循环无节制烧钱（mission 165c967f 类事故的一般化护栏）
 */
export const SELF_DRIVEN_AGENT_MAX_ITERATIONS = 8;
