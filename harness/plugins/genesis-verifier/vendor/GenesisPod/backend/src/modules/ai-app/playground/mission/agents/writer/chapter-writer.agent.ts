/**
 * ChapterWriterAgent —— 撰写单个章节（参照 TI SECTION_WRITING_SYSTEM_PROMPT）
 *
 * 严格写作规范：内联加粗、禁止套话、引用编号、列表/段落规则。
 */

import { z } from "zod";
import {
  AgentSpec,
  DefineAgent,
  CHAPTER_WRITER_INTERNAL_MAX_ITERATIONS,
} from "@/modules/ai-harness/facade";
// ★ 沉淀接入: 外部 evidence 进 prompt 前用 XML 隔离 + sanitize（防 OWASP LLM01）
//   + TI report-writing-standards.constants（与 TI dimension-research.prompt.ts 同源）
import {
  wrapExternalContent,
  HEADING_HIERARCHY,
  NARRATIVE_STRUCTURE,
  PROFESSIONAL_TONE,
  FORMATTING_LIMITS,
  CITATION_STANDARDS,
  ANALYSIS_DEPTH,
  CHART_STANDARDS,
  TABLE_STANDARDS,
  QUALITY_CHECKLIST,
} from "@/modules/ai-harness/facade";

const Input = z.object({
  topic: z.string(),
  dimension: z.string(),
  language: z.enum(["zh-CN", "en-US"]),
  chapter: z.object({
    index: z.number().int(),
    heading: z.string(),
    thesis: z.string(),
    keyPoints: z.array(z.string()),
  }),
  sources: z.array(
    z.object({
      claim: z.string(),
      evidence: z.string(),
      source: z.string(),
    }),
  ),
  // ★ P0-R4-5 (round 4): 25000 与 budget.maxTokens=22000 矛盾导致 epic 死循环；
  // 降到 12000 让 LLM 单次输出可达 ≥85% 字数门槛；epic 200K → 17 章 × 12K 拼接
  targetWords: z.number().int().min(200).max(12000),
  /** lengthProfile 档位（可选，用于 prompt 中展示 per-profile 字数范围） */
  lengthProfile: z
    .enum(["brief", "standard", "deep", "extended", "epic", "mega"])
    .optional(),
  /** 之前已写完的章节标题列表（用于去重，不要重复前文） */
  previousChapterHeadings: z.array(z.string()).optional(),
  previousCritique: z.string().optional(),
  previousDraft: z.string().optional(),
  /**
   * ★ 2026-05-07 图文匹配（学 TI Stage 4-5）：
   * 该维度的候选图列表。LLM 写章节时可在合适段落后插入 `![caption](#FIG-N)`
   * 占位符引用图，由 reportAssembler 在落地阶段映射到实际图片渲染。
   * 不传或为空时，仅依赖 reportAssembler 自动追加章节末尾（兼容原行为）。
   */
  availableFigures: z
    .array(
      z.object({
        figureId: z.string(), // FIG-1, FIG-2, ...
        caption: z.string(),
        sourceUrl: z.string().optional(),
        relevanceHint: z.enum(["high", "medium", "low"]).optional(),
      }),
    )
    .optional(),
});

const Output = z.object({
  index: z.number().int(),
  heading: z.string(),
  body: z.string(),
  wordCount: z.number().int(),
  citationsUsed: z.array(z.string()),
  /**
   * ★ 2026-05-07 P1 图文匹配闭环（学 TI section-writer.figureReferences 模式）：
   * LLM 决定本章节要引用哪些图（按 input.availableFigures 的 figureId）。
   * 不嵌入 markdown body，由结构化字段输出，reportAssembler 据此关联到
   * 章节段落 + 落地为 ArtifactFigure（绕开 LLM 编号空间与 fig-id 不一致的问题）。
   * 留空表示本章不引用图（reportAssembler 仍可按 researcher.figureCandidates 兜底追加）。
   */
  figureReferences: z
    .array(
      z.object({
        figureId: z.string(), // 必须来自 input.availableFigures.figureId
        /** 段落锚点：1-based。LLM 估计图最适合插在第几个段落之后 */
        anchorParagraph: z.number().int().min(1).optional(),
        /** 可选自定义 caption（缺则用 input.availableFigures[i].caption） */
        caption: z.string().optional(),
      }),
    )
    .default([]),
});

@DefineAgent({
  id: "playground.chapter-writer",
  identity: {
    role: "chapter-writer",
    description:
      "Writes one chapter of a dimension report, TI-style strict format",
  },
  // ★ 2026-06-07 根因修复（"章节稳定 55 分判失败"实证 mission 7ddaad2f）：
  //   原 loop:"reflexion" 会自动套上全局默认通用判官（self + critical，且 critical
  //   跑在 CHAT_FAST 弱 tier，judge.service 注释自承"critical 永远 50 分污染 composite"）。
  //   这俩"有瑕疵就 <60"的通用判官给完整 11K-token 章节打 44/22.5/42.5（还不稳定），
  //   在章节到达权威的外部 chapter-reviewer（按章节 rubric 打 85-95）之前就把它毙了。
  //   设计本想用 maxIterations=1 关掉内部自评，但 reflexion 修订由 maxRevisions(=2) 驱动、
  //   与 maxIterations 无关 → 从未生效。外部 chapter-pipeline 已含完整 写→评→改 循环
  //   （chapter-pipeline.helper），内部 reflexion 纯属冗余双层循环。
  //   改 react：单次撰写、无内部判官 gate；外部 chapter-reviewer 是唯一权威 gate（设计原意）。
  loop: "react",
  // ★ Round 3 真问题修复 (2026-04-29):
  //   原 outputLength="long" → 8000 maxTokens，等于 targetWords 上限 (8000 字)。
  //   中文 1:1 token，意味着 LLM 单次输出永远会被 maxTokens 截断到约 80% 实际产出。
  //   这是用户实测"extended (25K) 实际只 5K (20%)"的真因之一。
  //   切到 "extended" → 16000 maxTokens，给 8000 字 chapter 留出 2× 缓冲。
  taskProfile: { creativity: "medium", outputLength: "extended" },
  inputSchema: Input,
  outputSchema: Output,
  // P1a (2026-05-25, env-gated ENABLE_DELIMITED_FINALIZE)：章节 body 是长篇散文，
  //   best-effort 模型(DeepSeek json_object)塞 JSON 时未转义引号会崩整轮 finalize。
  //   声明 body 为 prose 字段 → 走分隔纯文本块，长文不进 JSON，免转义。
  finalizeProseFields: ["body"],
  // ★ 2026-06-07: loop 已改 react（见上），内部不再有 reflexion 自评循环；
  //   maxIterations 仅作 react 内 finalize 校验/容错的轮次预算（沿用集中常量）。
  //   外部 chapter-reviewer 评分是唯一权威 gate。
  budget: {
    maxTokens: 22_000,
    maxIterations: CHAPTER_WRITER_INTERNAL_MAX_ITERATIONS,
  },
})
export class ChapterWriterAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    // ★ 2026-05-07 洞察类型 v1：targetWords 是 per-章 字数硬牵引（per-dim-pipeline
    //   按 depth 推算）；PROFILE_WORD_RANGES[lengthProfile] 提供档位级 hint 让 LLM
    //   理解全局规模感（mission level）。两者共存：targetWords 是局部硬目标，
    //   profileRange 是全局软参考（不冲突）。
    //   字数语义已软化：低于 800 字也接受，不强制 retry（per-章 牵引 ≠ 硬约束）
    const PROFILE_WORD_RANGES: Record<
      NonNullable<z.infer<typeof Input>["lengthProfile"]>,
      [number, number]
    > = {
      brief: [600, 1000],
      standard: [1200, 1800],
      deep: [1500, 2500], // 对齐 v1 deep 中位
      extended: [2000, 3000],
      epic: [2500, 3500],
      mega: [3000, 4000],
    };
    const profileRange = input.lengthProfile
      ? PROFILE_WORD_RANGES[input.lengthProfile]
      : null;

    // ★ 沉淀接入: 外部 evidence 文本用 wrapExternalContent 包装，防注入
    const sourceList = input.sources
      .map((s, i) => {
        const wrappedEvidence = wrapExternalContent(s.evidence, {
          source: "research-evidence",
          maxLength: 240,
        });
        return `  [${i + 1}] claim=${s.claim} | source=${s.source}\n${wrappedEvidence}`;
      })
      .join("\n");
    const lang =
      input.language === "zh-CN"
        ? "用简体中文撰写。"
        : "Write in formal English.";
    return [
      `你是一位专业的研究分析师，负责撰写研究报告的第 ${input.chapter.index} 章。`,
      lang,
      ``,
      `## 章节规格`,
      `- 维度: ${input.dimension}（topic: ${input.topic}）`,
      `- 章节标题: ${input.chapter.heading}`,
      `- 章节核心论点 (thesis): ${input.chapter.thesis}`,
      `- keyPoints: ${input.chapter.keyPoints.map((p, i) => `${i + 1}) ${p}`).join("；")}`,
      // ★ 2026-05-07 字数软化（用户对齐）：从"必须 ≥ 0.85 才合格"改为"建议范围（牵引）"
      //   低于 800 字也接受不打回；超出范围也接受。retry 触发条件迁出字数（见 reviewer）。
      // ★ 2026-05-23 P2-728：给"区间"而非单一刚性数字。生产方对每个 dim 算出的
      //   targetWordsPerChapter 在常见配置下被夹逼成定值(dimTargetWords/章节数)，LLM
      //   把单一数字当硬锚 → 大量章节恒为同一字数(实测 728)。给 0.7–1.4× 区间让
      //   LLM 按话题密度自然浮动。
      `- **建议字数: ${Math.round(input.targetWords * 0.7)}–${Math.round(input.targetWords * 1.4)} 字（目标牵引区间，按本章话题密度自行决定，不是硬约束）**${profileRange ? `\n- 档位范围参考: ${profileRange[0]}-${profileRange[1]} 字` : ""}`,
      `- 字数语义：**该章话题密度高就多写，密度低就少写**。低于 800 字也可以接受，不会因为字数不足被打回。`,
      `- **不要为凑字数而堆砌**。1500 字的扎实分析 > 4000 字的注水稀释。`,
      input.targetWords >= 3000
        ? `- 章节体量参考: ${input.targetWords} 字 ≈ ${Math.round(input.targetWords / 600)} 个论述段落（每段 ~600 字）`
        : "",
      ``,
      `## 核心要求`,
      `1. **聚焦性**: 只写本章节，不要越界其他章节内容`,
      `2. **深度**: 即使字数有限，也要有洞察力，不是信息堆砌`,
      `3. **证据支撑**: 关键论点必须有引用，使用 \`[N]\` 格式（N 对应下方"可用资料"编号，从 1 开始）`,
      `4. **连贯性**: 与前置章节保持逻辑连贯，避免重复前文论点`,
      ``,
      // ★ 2026-04-30 (PR-F): 全量复用 TI report-writing-standards.constants（与
      //   topic-insights/prompts/dimension-research.prompt.ts 同源）。
      //   原 inline "写作风格规范" 6 行下线 — TI 标准更全面（McKinsey Pyramid +
      //   BCG So-What + 量化表达 + 因果区分 + 反箭头链 + 反教科书）。
      HEADING_HIERARCHY,
      ``,
      NARRATIVE_STRUCTURE,
      ``,
      PROFESSIONAL_TONE,
      ``,
      FORMATTING_LIMITS,
      ``,
      CITATION_STANDARDS,
      ``,
      ANALYSIS_DEPTH,
      ``,
      CHART_STANDARDS,
      ``,
      TABLE_STANDARDS,
      ``,
      QUALITY_CHECKLIST,
      ``,
      `## 章节结构（柔性，论点驱动而非固定模板）`,
      // ★ 2026-05-08 PR-3 (mission 843f6958 实证修): body 第一行必须是正文段落
      //   不能直接是 H3 子小节标题。原因：reportAssembler 拼接时章节 heading 用 H3，
      //   body 第一行如果也是 H3 子小节 → 章节标题 + 子小节标题紧挨着无引言（77 处实证），
      //   视觉上"H3 套 H3"且章节没自己的论述。
      `**关键格式约束**：body **第一行必须是正文段落**（含独立判断 + 引用），`,
      `**不要以 \`### 子小节标题\` / \`#### \` / 列表 / 表格开头**。`,
      `章节 heading 由 per-dim 拼接器加在 body 之前，body 自身不重复章节名。`,
      ``,
      `1. **首段**：直接以独立判断开头（不必加 \`> **核心判断**：\` blockquote 模板；该模板每章重复就形成八股，禁止）`,
      input.targetWords >= 5000
        ? `2. **主体 ${Math.max(5, Math.round(input.targetWords / 800))} 段**：每段围绕 1 个分析维度展开（数据 / 案例 / 因果 / 对比 / 推演），含具体数字 / 时间 / 实体 + \`[N]\` 引用。每段必须 400-800 字`
        : `2. **主体 3-5 段**：每段一个独立 thesis claim + 具体数字 / 时间 / 实体 / 案例 + \`[N]\` 引用`,
      `3. **末段**：直接给可操作启示句（不必加 \`**Implications**：\` 前缀；该模板每章重复就成八股，禁止）`,
      ``,
      `## 段落必须有独立观点（核心要求 — 与 TI dimension-research 对齐）`,
      `每段必须有独立、具体、可被证伪的 thesis claim，不是模板套话。`,
      ``,
      `✅ 段首直接给独立判断 + 具体证据 + 因果解释：`,
      `「Anthropic 在 2026-04 的 API Overview 把 Managed Agents 与 Claude models`,
      `并列为程序化访问对象，这意味着**官方已把 Managed Agents 提升到 API 一级`,
      `对象** [1]。」`,
      ``,
      `❌ 套话 / 模板感 / 无独立判断：`,
      `- "随着 X 的发展 / 在当今 / 众所周知 / 综上所述"`,
      `- "本章核心判断是 ..." 仅复述章节标题（不构成独立观点）`,
      ``,
      `**每章至少 1~2 个独立分析判断**，不能仅复述 finding。措辞示例：`,
      `- "这意味着 ..." / "核心原因在于 ..." / "值得警惕的是 ..."`,
      `- "更准确的表述应是 ..." / "不能据此推出 ... 的强结论"`,
      `- "审慎地说 ..." / "但加强的是 ... 不是 ..."`,
      ``,
      `## 去模板化（绝对禁止八股）`,
      `- ❌ 每章首段都用 \`> **核心判断**：xxx\` 这种 blockquote 模板`,
      `- ❌ 每章末段都用 \`**Implications**：xxx\` 这种固定前缀`,
      `- ❌ 同一报告里所有章节用同一句式开头`,
      `- ✓ 每章可有自己的开头节奏，但不允许同一模板复用`,
      input.previousChapterHeadings && input.previousChapterHeadings.length > 0
        ? `\n### 已写过的前置章节（避免重复）\n${input.previousChapterHeadings.map((h, i) => `  - ${i + 1}. ${h}`).join("\n")}\n`
        : "",
      ``,
      `## 严禁格式（违反将被 reviewer 打回）`,
      `- ❌ 加粗独占一行（如 "**关键瓶颈**" 后换行写正文）`,
      `- ❌ 加粗段落开头导语句（"**综合现有证据，可以得出**：..."）`,
      `- ❌ 加粗序数词 / 过渡词（"**其一**"、"**其二**"）`,
      `- ❌ 本章要点块（任何 "**本章要点**" 标题）`,
      `- ❌ 无 marker 短句独行`,
      `- ❌ 字数统计 / 编辑备注（如 "(约 850 字)"）`,
      `- ❌ HTML 标签 / HTML 实体`,
      // ★ 2026-04-30: H2 滥用治理 —— LLM 经常把 keyPoint "1./2./3." 写成 ## H2，
      //   导致 reportAssembler buildSectionTree 把每个 keyPoint 切成独立章节 → 章节
      //   视图碎成 50+ 张卡片。强制 chapter body 内只能有 0 或 1 个 ## H2（即 chapter
      //   标题本身），keyPoint 子小节必须用 ### H3 或正文段落。
      `- ❌ chapter 正文中再写 \`## \` H2 标题（一个 chapter 只允许一个顶层 H2 = 章标题）`,
      `- ❌ 用 \`## 1. xxx\` / \`## （一）xxx\` / \`## 其一：xxx\` 这类编号 H2 切分论点 ——`,
      `      keyPoint 论点必须用 ### H3 或直接段落论述展开，不能升级为同级章节`,
      ``,
      // ★ Phase 1 TI prompt 移植: 反电报式写作硬约束（dimension-research.prompt 验证有效）
      `## 禁止电报式写作（最严格的反 AI 痕迹规则）`,
      `每个段落必须由完整的分析性论述组成，每段 100-300 字。`,
      `严格禁止：`,
      `  - 条目式罗列（"指标名：数值"形式）`,
      `  - 短句独行（多个极短的独立段落，每段 1-2 句、10-50 字、各自成段）`,
      `  - 用换行代替分析（一个论点写完应该展开论证，不是另起一段写下一个）`,
      ``,
      `❌ 错误示例（禁止）：`,
      `多数主流架构仍依赖中心调度。`,
      ``,
      `代理增多后协调成本呈指数上升。`,
      ``,
      `缺乏统一协议放大异构集成摩擦。`,
      ``,
      `✅ 正确示例：`,
      `当前架构面临三重结构性挑战：**多数主流方案仍依赖中心调度机制**，随着代理`,
      `数量增加，协调成本呈指数级上升 [3]；缺乏统一通信协议进一步放大了异构`,
      `集成摩擦。这意味着... [核心分析判断]`,
      ``,
      // ★ Phase 1 TI prompt 移植: [N] 引用严格性
      `## 引用编号严格对应（防 LLM 编号混淆）`,
      `- 写 [3] 时必须确认讨论的内容确实来自"可用资料 [3]"，不要凭印象`,
      `- 不确定数据来自哪条资料时**不要加引用**，宁可不引也不能错引`,
      `- 只用 [N] 数字格式，不用 (Author, Year) / (1) / [作者 2024] 等其他格式`,
      ``,
      input.previousCritique
        ? `## 上一轮 Reviewer critique（必须针对性修复）\n${input.previousCritique}\n`
        : "",
      input.previousDraft
        ? `\n## 上一轮草稿（仅供参考，不要原样重发，针对 critique 重构）\n${input.previousDraft.slice(0, 2500)}\n`
        : "",
      ``,
      // ★ 2026-05-07 P1 图文匹配闭环（学 TI Stage 4-5 figure registry）：
      //   1) 写正文时**用文字描述**对应数据/趋势（"如统计图所示..." / "增速曲线呈倒 V 型 [3]"）
      //   2) 在 finalize output.figureReferences 数组里**结构化输出**要引用的图（带 figureId
      //      + anchorParagraph 段落锚点），由 reportAssembler 据此关联渲染
      //   3) 严禁在 markdown body 里直接写 `![](#FIG-N)` —— LLM 编号空间与 reportAssembler
      //      的 fig-{sec.id}-{i} 不一致，会渲染破图
      input.availableFigures && input.availableFigures.length > 0
        ? [
            `## 可用图片（单一契约：仅在 finalize JSON 输出 figureReferences）`,
            `本维度从证据源抽出 ${input.availableFigures.length} 张图。`,
            ``,
            // ★ 2026-05-08 PR-2 (mission 843f6958 实证修): 移除"两件事一起做"双轨措辞
            //   原版让 LLM 困惑 → 写出 4 类垃圾格式（inline url / prompt 提示语当 url /
            //   <figureReferences> HTML 标签 / <figure> 标签）。改为单契约：body 只写
            //   自然语言文字描述，图通过 finalize.figureReferences JSON 字段输出。
            `**正文（body）**：用自然语言引述数据/趋势，**不要写任何 markdown 图片语法**。`,
            `   ✅ "近三年 LLM 调用量增长 **350%**，呈现明显加速 [3]"`,
            `   ✅ "如统计所示，60% 公司将 Agent 预算翻倍"`,
            ``,
            `**finalize.figureReferences**：在 JSON envelope 里**结构化**声明本章引用的图：`,
            `   {`,
            `     "figureId": "FIG-1",          // 必须来自下方候选清单`,
            `     "anchorParagraph": 2,         // 1-based 段落锚点`,
            `     "caption": "可选自定义说明"  // 缺省用候选图自带 caption`,
            `   }`,
            `每章 0-2 张图为宜，不强相关就不要硬塞。reportAssembler 会按 figureId 关联渲染。`,
            ``,
            `**严禁（实证 LLM 高频违规模式）**：`,
            `- ❌ body 里写 \`![alt](#FIG-N)\` / \`![alt](https://任何URL)\`（任何 markdown 图片语法）`,
            `- ❌ body 里写 \`![](FIG-1位置由figureReferences控制)\`（把 prompt 提示语当 URL）`,
            `- ❌ body 里写 \`<figureReferences>引用FIG-N...</figureReferences>\`（JSON 字段名当 XML 标签）`,
            `- ❌ body 里写 \`<figure>参考FIG-N...</figure>\`（HTML figure 标签）`,
            `- ❌ figureId 写候选清单里不存在的编号（凭空编 FIG-99）`,
            `- ❌ anchorParagraph 超出实际段落数（章节 5 段不要写 anchorParagraph: 8）`,
            `✅ 唯一正确路径：body 只写文字 + finalize.figureReferences JSON 字段声明引用`,
            ``,
            `候选图清单（**注意只用 figureId 标识，不要把 caption/source 当 URL 写进 body**）：`,
            // ★ 2026-05-08 PR-2: 移除 sourceUrl 暴露（旧 prompt 把 URL 给了 LLM，
            //   LLM 直接写 ![alt](https://...) 绕过 #fig-N 占位机制）
            ...input.availableFigures.map(
              (f) =>
                `  [${f.figureId}] ${f.caption}${f.relevanceHint ? ` (relevance=${f.relevanceHint})` : ""}`,
            ),
            ``,
          ].join("\n")
        : "",
      `## 可用资料（[N] 引用编号 = 下方编号）`,
      sourceList,
      ``,
      `## 输出 JSON envelope（★ 严格格式，框架 ReActLoop / ReflexionLoop 解析必需）`,
      ``,
      `必须包装在 finalize action 里返回，否则会被 parseDecision 报 InvalidActionError`,
      `（虽有 finalize-raw 兜底但会污染 log）。**正确格式**：`,
      `{`,
      `  "thinking": "<一句话说明本章关键判断（≤60 字）>",`,
      `  "action": {`,
      `    "kind": "finalize",`,
      `    "output": {`,
      `      "index": ${input.chapter.index},`,
      `      "heading": "${input.chapter.heading}",`,
      `      "body": "<完整 markdown 正文，含 [N] 引用编号；不写 ![](#FIG-N) 占位符>",`,
      `      "wordCount": <实际字数>,`,
      `      "citationsUsed": ["<source url 1>", "<source url 2>"],`,
      input.availableFigures && input.availableFigures.length > 0
        ? `      "figureReferences": [{ "figureId": "FIG-1", "anchorParagraph": 2 }]  // 0-2 张相关图，留空数组也行`
        : `      "figureReferences": []  // 本章无候选图，留空数组`,
      `    }`,
      `  }`,
      `}`,
      ``,
      `❌ 错误（直接发 output 顶层）：{ "index": ..., "heading": ..., "body": ... }`,
      `✅ 正确（包装在 action.output 里）：{ "thinking": "...", "action": { "kind": "finalize", "output": {...} } }`,
    ].join("\n");
  }
}
