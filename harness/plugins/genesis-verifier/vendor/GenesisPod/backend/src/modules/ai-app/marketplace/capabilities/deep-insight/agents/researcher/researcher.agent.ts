/**
 * Researcher Agent —— 单轮 ReAct + 真实 web 搜索
 *
 * 一个 mission 派 N 个 researcher 并行（每维度 1 个）。
 * 每个 researcher 单 dim 走 react loop：
 *   1. 一轮 parallel web-search（2-4 query）
 *   2. 至多一轮 web-scraper 抓 1-2 个高价值 url
 *   3. finalize 输出 narrow JSON
 *
 * 历史教训：曾用 reflexion + self/critical verifier + 5-stage workflow，
 * 单 dim 烧 80-100K tokens，6 dim mission ≈ 600K-1M tokens。完全不可接受。
 * 现在改 react loop + 限制 budget + 简化 prompt，单 dim 目标 ~25K tokens，
 * 6 dim ≈ 150K，相比旧方案减少 75-85%。
 */

import { z } from "zod";
import {
  AgentSpec,
  DefineAgent,
  RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA,
  RESEARCHER_MAX_ITERATIONS,
  RESEARCHER_MAX_ITERATIONS_HARD_CAP,
  RESEARCHER_MAX_WALL_TIME_MS,
} from "@/modules/ai-harness/facade";
import { getExternalContentNotice } from "@/modules/ai-engine/facade";
import {
  DEFAULT_SEARCH_TIME_RANGE,
  formatDateYmd,
  getSearchTimeRangeLabel,
  resolveSearchTimeRangeSince,
  SEARCH_TIME_RANGE_VALUES,
} from "@/common/search/search-time-range";
// ★ 2026-05-13: route min-findings business-rule floor through typed runtime config
import { resolveMinFindings } from "../../contract/research-tuning";

const Input = z.object({
  topic: z.string(),
  dimension: z.string(),
  /** 用户在 mission launch 时填的研究描述（背景/约束/关注角度/排除项）——
   *  透传给 researcher，让搜证遵循用户 brief（2026-05-29 修：原先只到 Leader）。 */
  description: z.string().max(10000).optional(),
  language: z.enum(["zh-CN", "en-US"]),
  /**
   * Lead M1 dispatch 时下发的 critique —— 让 researcher 知道"上一轮哪里没做好"。
   * 自愈 retry 也通过 topicSuffix 走，但 Lead 给的 critique 含具体维度反馈，
   * 走单独字段表达"这是 Lead 让你回炉重做"，不混进 topic。
   */
  critique: z.string().optional(),
  /** ★ withFigures=true 时强制 researcher 调 web-scraper extractImages=true 抽图 */
  withFigures: z.boolean().default(true),
  /**
   * ★ 用户在 mission launch 时选的本地 KB —— 调 rag-search 时必须把这些 ids 作为
   * knowledgeBaseIds 参数传入，否则 rag-search 不会启用本地召回。
   * 空 / 不传 → 直接跳过 rag-search 走 web-search。
   */
  knowledgeBaseIds: z.array(z.string().uuid()).optional(),
  searchTimeRange: z
    .enum(SEARCH_TIME_RANGE_VALUES)
    .default(DEFAULT_SEARCH_TIME_RANGE),
});

const Output = z.object({
  dimension: z.string(),
  findings: z.array(
    z.object({
      claim: z.string(),
      evidence: z.string(),
      // 必修 #17: 放宽 URL 校验
      source: z.string().min(1),
      // ★ 2026-04-30 (PR-C): 引用元数据补全（mission 4fd5efa1 暴露：86% citation
      //   title=domain、0 条有 snippet、0 条有 publishedAt → hover tooltip 富信息
      //   全部空转、时间过滤永远归到「未标日期」、可信度评分单一）。这里把
      //   web-search / web-scraper / arxiv-search 等工具 observation 中已有的
      //   字段透传到 finding，让下游 buildCitations 能还原完整元数据。
      sourceTitle: z.string().optional(),
      sourceSnippet: z.string().optional(),
      sourcePublishedAt: z.string().optional(),
    }),
  ),
  summary: z.string(),
  // ★ Phase P1-1: 图候选（图来源红线 baseline §7.4）
  // Researcher 在 web-scraper / arxiv-search 等 tool observation 中遇到原图时，
  // 抽取 figureCandidates（必须含 sourceUrl + 来自参考文献，不能 LLM 编造图）。
  // 不抽到图时给空数组（withFigures=false 时也允许空）。
  figureCandidates: z
    .array(
      z.object({
        // P53-1: sourceUrl 强制 http(s) 协议
        sourceUrl: z
          .string()
          .min(8)
          .refine((s) => /^https?:\/\//i.test(s), {
            message: "sourceUrl 必须以 http:// 或 https:// 开头",
          }),
        // imageUrl: 可选，但若有则必须 https 或 data:image
        imageUrl: z
          .string()
          .optional()
          .refine(
            (s) => !s || /^https:\/\//i.test(s) || /^data:image\//i.test(s),
            { message: "imageUrl 必须 https:// 或 data:image" },
          ),
        caption: z.string().min(3),
        sourcePageOrSection: z.string().optional(),
        relevanceHint: z.enum(["high", "medium", "low"]).default("medium"),
      }),
    )
    // Phase P34-1: 单 dim cap 5 张图
    .max(5)
    .default([]),
});

@DefineAgent({
  id: "playground.researcher",
  version: "1.2.0",
  identity: {
    role: "researcher",
    description:
      "Domain researcher — single-pass: search → optional scrape → finalize",
  },
  // ★ react（不再 reflexion）：reflexion 强制 verifier 评分低 revision，
  // 在 reasoning model + 长 prompt 上单 revision 烧 80K，2 个 revision 240K。
  // verifier 评分由上层 orchestrator 的 reviewer 阶段做（一次性），不在每 dim 重做。
  loop: "react",
  // ★ Tool Recall（runtime 召回）—— 不再硬编码工具 id 列表。
  // AgentRunner.performToolRecall() 启动时从 ToolRegistry 实时召回 'information'
  // category 下所有 enabled 工具。Leader 给 dim 提供 toolHint 时进一步收窄。
  // 工具 CRUD 自动跟进，无需改 spec。
  toolCategories: ["information"],
  // ★ rag-search + 学术四件套必入白名单（2026-05-01 fix）：
  //   performToolRecall Step 2 路径 B 用 tool.tags 做 sub-category 匹配，
  //   Leader hint.categories 偏 ['web','policy','community'] 时（实际 prod 7 天
  //   332 次 mission 全无 academic）academic 工具 tags=['academic','research',...]
  //   不与 hint 交集 → 全部被排除。declaredIds 在路径 B 末尾保底加回，所以
  //   显式列在 tools 里：academic 工具在所有 dim 都可见（不依赖 Leader hint），
  //   rag-search 同理（tags=['knowledge','rag',...] 也不与 academic hint 交集）。
  //   prod 实证：过去 7 天 playground 0 次调 OpenAlex/Semantic Scholar/PubMed，
  //   只 14 次 ArXiv（且全失败 timeout/429）。
  // ★ 2026-05-01 工具矩阵对齐 TI（Topic-Insights 已验证好用的数据源）：
  //   academic 4 件套 + 行业研报 + 社媒 全部进 declaredIds 永远兜底，与 Leader
  //   hint 解耦。tool id 必须与 ToolRegistry 注册的 id 完全一致：
  //   - pubmed 不带 -search 后缀（历史命名）
  //   - industry-report-search / social-x-search 是新沉淀的 BaseTool 包装
  //     （原 TI SearchAdapter 不在 ToolRegistry，playground 调不到）
  // 2026-05-09 真因修复：prompt 里被点名引导的工具必须全部进白名单。
  // 之前缺 web-scraper/web-search/data-fetch → ToolInvoker not_in_whitelist →
  // RUNNER_OUTPUT_SCHEMA_MISMATCH 自愈死循环（screenshot 47，5m58s/26.5k tokens 烧零产出）。
  // 全量审计后另发现 8 处遗漏：knowledge-graph / federal-register / congress-gov /
  // whitehouse-news / github-search / hackernews-search / file-parser / finance-api。
  //
  // ★ 扩展规约：以后新增工具/数据源只要打算 researcher 调用，必须同时在两处声明：
  //   1) 这个数组（白名单）
  //   2) buildSystem() 里 "Tool selection" 段落的 use-case hint（让 LLM 自然选）
  // 缺一个 LLM 就废一半（要么调不到，要么不知道何时调）。
  tools: [
    // === 检索 / 知识库 ===
    "rag-search",
    "knowledge-graph",
    // === 学术 ===
    "arxiv-search",
    "openalex-search",
    "semantic-scholar",
    "pubmed",
    // === 政策 ===
    "federal-register",
    "congress-gov",
    "whitehouse-news",
    // === 社区 / 代码 ===
    "github-search",
    "hackernews-search",
    "social-x-search",
    // === 行业研报 / 财经数据（持续扩展类，向 a16z/McKinsey/SemiAnalysis/Gartner... 加源） ===
    "industry-report-search",
    "finance-api",
    // === 招聘 / 视频 ===
    "job-search",
    "youtube-search",
    // === 通用 web + 抽取 ===
    "web-search",
    "web-scraper",
    "data-fetch",
    "file-parser",
  ],
  // PR-X-skill-bridge: dimension-research 协议 + web-research 工具使用规范
  skills: ["dimension-research", "web-research"],
  taskProfile: {
    creativity: "low",
    // ★ 2026-05-23 (long→extended)：finalize 要吐多条带 URL/quote 的 finding，
    //   long=8000 maxTokens 对中文 JSON 常被截断(finish_reason=length) → repair 削薄/
    //   失败 → 维度降级。extended=16000 给 finalize JSON 留足头寸(与 chapter-writer 同策)。
    outputLength: "extended",
    reasoningDepth: "moderate",
  },
  inputSchema: Input,
  outputSchema: Output,
  // #35: strict JSON schema derived from Output zod — enables provider-level
  // enforcement of the finalize payload shape on final iterations (approachingLimit=true).
  // Derived following the 6-rule spec: optional→not required, .default()→not required,
  // .refine() dropped, .min() dropped, additionalProperties:false at every object.
  outputJsonSchema: RESEARCHER_FINALIZE_OUTPUT_JSON_SCHEMA,
  // P1a/P1b (2026-05-25, env-gated ENABLE_DELIMITED_FINALIZE)：finalize 时把
  //   长文 summary 走纯文本块、findings 数组走 NDJSON（一行一条）——best-effort
  //   模型(DeepSeek json_object)长文塞 JSON 会因未转义引号崩整轮；分隔载体下
  //   一条坏只丢一条，直接提升 findings 留存率（对 minSources≥15 是质变）。
  finalizeProseFields: ["summary"],
  finalizeNdjsonArrayField: "findings",
  // ★ budget 大幅收紧：120K → 30K，maxIter 20 → 5
  // 单 dim 5 iter 足够：1 search + 1 scrape + 1 finalize = 3 iter；5 iter 留 buffer
  // 6 dim × 30K = 180K（vs 旧 720K），减 75%
  // ★ wallTime 600s（默认 300s）—— withFigures=true 时必须多 1 轮 web-scraper extractImages，
  //   抽图本身 60-120s，5 min 容易超时致 RUNNER_OUTPUT_SCHEMA_MISMATCH retry 风暴。
  // ★ Phase P1 fix (2026-04-29 mission 8c7b4358)：maxIterationsHardCap=10 是绝对硬上限。
  //   leader-assess-research stage 用 budgetMultiplier 7.28× 把 base 5 放大到 36，
  //   触发 LLM 60+ 轮 parallel_tool_call 永不 finalize 的死循环（44 分钟单 dim retry）。
  //   硬上限 10 = base 5 × 2，给容错重试一轮但不给"再搜很多轮"的余地。
  //   maxTokens / maxWallTimeMs 仍允许放大（容错），只锁 maxIterations（决策边界）。
  // ★ 2026-05-01 (PR-G iter9): 走集中常量。maxTokens 仍 dim 自治
  budget: {
    maxTokens: 30_000,
    maxIterations: RESEARCHER_MAX_ITERATIONS,
    maxIterationsHardCap: RESEARCHER_MAX_ITERATIONS_HARD_CAP,
    maxWallTimeMs: RESEARCHER_MAX_WALL_TIME_MS,
  },
  // ★ 工具前置闸（2026-06-07 prod mission df6c14ea 根因修复）：弱模型常
  //   第 1 轮就 finalize、0 工具、编造 arxiv.org/nature.com 假来源 → 维度 0/100。
  //   开启后 researcher 必须先成功调用一次检索工具才允许 finalize（react-loop 强制）。
  requireToolBeforeFinalize: true,
})
export class ResearcherAgent extends AgentSpec<typeof Input, typeof Output> {
  buildSystemPrompt({ input }: { input: z.infer<typeof Input> }): string {
    const currentDate = new Date().toISOString().slice(0, 10);
    // ★ Iter 2a: 时效性约束 —— 默认查询 12 个月内来源（深度档可放宽到 24 个月，
    //   由 Researcher 自己根据题材判断）。这避免 LLM 拉到 5 年前旧文章导致评分 freshness 低。
    const searchTimeRange = input.searchTimeRange ?? DEFAULT_SEARCH_TIME_RANGE;
    const since = resolveSearchTimeRangeSince(searchTimeRange);
    const sinceYmd = since ? formatDateYmd(since) : undefined;
    const sinceYm = sinceYmd?.slice(0, 7);
    const selectedRangeLabel = getSearchTimeRangeLabel(searchTimeRange);
    const critiqueBlock = input.critique
      ? [
          ``,
          `## ★ Lead M1 critique（你必须回应这个）`,
          `Lead 在 M1 评估了你上一轮的产出，指出以下问题：`,
          `> ${input.critique}`,
          `这次重做必须直接回应这些问题（覆盖率 / 来源质量 / 证据具体度）。`,
          `不要原样重复上一轮的 query 和 finding。`,
          ``,
          `## ★★★ 退出闸（必须遵守，否则被框架强制中断）`,
          `你**最多 3 轮 parallel_tool_call**。3 轮后 framework 会注入 ITERATION BUDGET WARNING reminder，`,
          `下一轮 LLM 必须 emit { "kind": "finalize", ... }，不允许再调 tool。`,
          `如果 3 轮内没集齐 critique 要求的所有源（5-7 个一手源 / 州法 / 执行案例），`,
          `**直接 finalize 当前 findings**，并在 summary 字段尾部追加：`,
          `  「未能在 budget 内集齐：[列出还缺什么]」`,
          `这样 leader 在二审能看到诚实的 gap，比反复刷 tool 跑超时更可信。`,
          `质量 > 完整：4 条扎实的 finding 比 7 条凑数 finding 更高分。`,
        ].join("\n")
      : "";

    const kbIds = input.knowledgeBaseIds ?? [];
    const kbBlock =
      kbIds.length > 0
        ? [
            ``,
            `## ★ 本地知识库（用户选的）`,
            `用户在 mission launch 时选了 ${kbIds.length} 个本地 KB（id: ${kbIds.join(", ")}）。`,
            `调 rag-search 时**必须把这些 id 作为 knowledgeBaseIds 参数传入**，否则不会启用本地召回。`,
            `示例 tool call: { "tool": "rag-search", "input": { "query": "...", "knowledgeBaseIds": ${JSON.stringify(kbIds)}, "topK": 5, "threshold": 0.6 } }`,
            `（threshold 必须 ≥ 0.6 提高相关度门槛，过滤掉跑题命中；KB 与本 dim 不符时宁可空手而归、改走 web-search）`,
            // ★ 2026-05-22 修知识库污染：KB 可能与本 dim 不相关（用户可能挂了跑题的库）。
            //   rag 仅作补充，web-search 强制兜底，且跑题 rag 命中必须丢弃。
            `⚠️ rag-search 仅作本地补充：**无论 rag 结果如何，本 dim 必须额外做 ≥1 轮 web-search** 获取真实、近期、切题的外部证据——绝不能只靠 KB 出 finding。`,
            `⚠️ 若 rag 命中内容与维度「${input.dimension}」明显不相关（跑题/换主题），**直接忽略这些命中**，不要据此写 finding，以 web-search / 专用搜索结果为准。`,
          ].join("\n")
        : [
            ``,
            `## 本地知识库`,
            `本 mission **未挂任何本地知识库**（knowledgeBaseIds 为空）。`,
            `⚠️ **不要调用 rag-search / knowledge-graph** —— 它们没有 KB 可检，必然返回空、白白消耗 budget 与轮次。`,
            `直接用外部检索：按本 dim 性质选 academic / industry-report-search / policy / finance-api / web-search 等。`,
          ].join("\n");

    const descBlock = input.description?.trim()
      ? [
          ``,
          `## ★ 用户研究描述（必须遵循的 brief）`,
          `用户在发起本 mission 时提供了以下背景/约束/关注角度/排除项，**你的搜证与 finding 必须紧扣它**：`,
          `> ${input.description.trim().replace(/\n/g, "\n> ")}`,
          `若搜到的内容与该 brief 的约束/排除项冲突，以 brief 为准。`,
        ].join("\n")
      : "";

    return [
      `You are a domain researcher for topic "${input.topic}", dimension "${input.dimension}".`,
      `Current date: ${currentDate}. Language: ${input.language}.`,
      descBlock,
      ``,
      `## 外部内容安全（不可信来源隔离）`,
      getExternalContentNotice(input.language),
      critiqueBlock,
      kbBlock,
      ``,
      `## Tool selection`,
      `查看 <available_tools> block —— 那是 runtime 从 ToolRegistry 实时召回的工具集，`,
      `Leader 已根据本 dim 的性质做过收窄（标 ★ recommended 的优先用，但不强制）。`,
      `按工具描述匹配本 dim 的需求：`,
      `- 内部知识 / 已索引内容相关 → rag-search 类（**仅当本 mission 挂了本地 KB 时**，见上方"本地知识库"说明；无 KB 别用）`,
      `- 实体关系（人/组织/产品） → knowledge-graph 类（同样需要已索引数据，无 KB 时跳过）`,
      `- 学术/科研性质 → academic 类（arxiv / openalex / pubmed / semantic-scholar 等）`,
      `- 政策/法规 → policy 类（federal-register / congress-gov / whitehouse-news 等）`,
      `- 代码/开源 → community 类（github-search / hackernews-search 等）`,
      `- **商业 / 市场 / 竞品 / 行业趋势 / 战略分析 → industry-report-search**（精选 a16z / McKinsey / BCG / SemiAnalysis / Gartner / Forrester / Stratechery / Brookings 等 18 家高质量研报源，比通用 web-search 信噪比高 5-10×；商战/产业/赛道分析 dim 必首选）`,
      `- **财经 / 宏观 / 估值 / 财报数据 → finance-api**（结构化金融数据，比 web-search 抓 PDF 表格更准）`,
      `- 招聘 / 人才动向 → job-search；视频佐证 → youtube-search；社媒舆情 → social-x-search`,
      `- 通用网页 → web-search / web-scraper / data-fetch（fallback，前述类目都不命中再用）`,
      ``,
      `## Workflow (efficient, do NOT iterate beyond what's needed)`,
      kbIds.length > 0
        ? `1. **本地 KB 已挂载**: 先 1 query rag-search（记得传 knowledgeBaseIds）看内部知识够不够。`
        : `1. **无本地 KB**: 跳过 rag-search / knowledge-graph（会返回空），直接进第 2 步外部检索。`,
      `2. **One multi-tool search round（≥2 种不同工具类型）**: emit ONE parallel_tool_call with 4-6 queries，`,
      `   **本轮必须横跨 ≥2 种不同工具类型**（不要 5 个 query 全是 web-search）——按本 dim 性质从 <available_tools>`,
      `   里挑：研究/科研类 dim 必带 academic（arxiv / openalex / semantic-scholar / pubmed）；商业/市场/竞品/赛道 dim`,
      `   必带 industry-report-search；政策/法规 dim 必带 policy 类；财经/估值 dim 必带 finance-api；**外加 ≥1 个`,
      `   web-search 兜底**。★ recommended 的优先。`,
      `   ★ 为什么：不同工具命中**不同的来源域名** → 唯一来源数翻倍 → 本维度章节更多、证据更足。只靠 web-search`,
      `   一种工具，来源会挤在少数门户站、唯一来源数上不去（维度被结构性限制为 4 章）。`,
      input.withFigures
        ? `3. **★ 必须 1 轮 web-scraper extractImages=true**（withFigures=true）：从 search 结果里挑 1-2 个高价值图文 URL（如 stanford / mckinsey / brookings / 政府 / arxiv 报告），调用 web-scraper 时**必须带 extractImages=true**。工具会把合法 <img>（过滤图标/pixel）放进 output.images。再从 output.images 抽 1-3 张到 figureCandidates。**没调 web-scraper extractImages 视为不达标**。`
        : `3. **At most one scrape/parse round**: 高价值 URL 抓全文用 web-scraper / file-parser。摘要够用就跳过这步。`,
      `4. **Finalize**: emit { kind: "finalize", output: {...} } matching the schema below.`,
      ``,
      `## Hard constraints to control cost`,
      `- Do NOT repeat similar queries across rounds.`,
      `- ★ 2026-05-02 调整 (用户实证报告参考文献仅 17 条，对标 TI 几百条)：`,
      `  Target 12-18 findings per dim — 多 dim 拼接后才能达到 100+ 引用。`,
      `  每条 finding 仍是 1 short evidence quote 即可（不要为了凑数把每条写长）。`,
      // ★ 2026-05-22 (来源多样性 — 决定本维度章节数)：下游按"唯一来源数"派生章节数
      //   （每章需 ~2 个唯一来源）。findings 若挤在少数几个 URL 上 → 维度只能开 4 章、
      //   报告偏薄、评审证据分上不去。
      `- ★★ **来源多样性硬要求：本维度 findings 必须覆盖 ≥12 个不同的来源 URL/域名**（不是 12 条`,
      `  finding 挤在 3-4 个站点上）。下游按唯一来源数派生章节数（每章 ~2 个唯一来源）：来源越`,
      `  多样，本维度章节越丰富、证据越足、评审分越高。单轮多 query 时**有意覆盖不同站点 / 不同`,
      `  角度 / 不同机构**（官方+研报+学术+新闻+财经各取一些），避免同源堆叠。`,
      `- Use search snippets directly when sufficient; scrape ONLY for missing critical numbers.`,
      `- 单轮 parallel_tool_call 一次性发 4-6 个 query 把 finding 凑齐，避免反复 iterate。`,
      ``,
      `## ★ 时效性约束（freshness — 影响 dim 5-axis 评分中的 freshness 维度）`,
      `currentDate = ${currentDate}`,
      `selected searchTimeRange = ${searchTimeRange} (${selectedRangeLabel})`,
      ...(sinceYmd
        ? [
            `- 只把 ${sinceYmd} 及之后发布的资料作为当前判断的主要证据，不要自行放宽时间窗`,
            `- 调用支持 timeRange 参数的搜索工具时，必须显式传入 { "timeRange": "${searchTimeRange}" }`,
            `- 调用 web-search 时，可在 query 末尾补充 "after:${sinceYm}" 帮搜索引擎进一步过滤，但这只是补强，不能代替 timeRange 参数`,
            `- 调用不支持结构化 timeRange 的工具时，必须在 query 或数值过滤中带上等价的时间约束`,
          ]
        : [
            `- 当前 mission 允许 all time 检索，但仍应优先选最近资料，并清楚写明发布日期`,
          ]),
      `- finding.source 写明发布日期（如 "2025-08-15"）让评分器能识别 freshness`,
      ``,
      `## Figure candidates (★★ 图来源红线 — 编造图直接 mission 失败)`,
      `严禁红线：`,
      `  ❌ 不要从 unsplash / pexels / shutterstock 等 stock 图库找配图`,
      `  ❌ 不要写假 URL（必须是 tool 观察结果里**真实存在的**链接）`,
      `  ❌ 不要"我觉得这里需要个图"凭空创建（Assembler 会五项校验删除并 trace 警告）`,
      `  ❌ 不要写 AI 生成图片（image-generation 工具已禁用 ToolACL）`,
      ``,
      `合法来源：`,
      `  ✅ web-scraper output.images[]（已过滤图标/pixel；调用时 extractImages=true）`,
      `  ✅ web-scraper 返回的 HTML 内 <img src="...">（必须 https://）`,
      `  ✅ arxiv-search / pubmed 返回的 paper figure URL`,
      `  ✅ data-fetch 拿到的 JSON API 内含图片 URL`,
      `  ✅ evidence URL 本身（OG image 元数据，作为 sourceUrl）`,
      ``,
      `如果 tool 观察结果中包含**真实图片**，按下面格式抽取到 figureCandidates 数组。`,
      `没抽到图时给 [] 即可。**有疑问就给 [] —— 宁缺勿滥**。`,
      ``,
      `合法 figureCandidate 例子：`,
      `  { "sourceUrl": "https://arxiv.org/abs/2401.12345",`,
      `    "imageUrl": "https://arxiv.org/figs/2401.12345/fig3.png",`,
      `    "caption": "Architecture diagram of MoE routing",`,
      `    "sourcePageOrSection": "Figure 3",`,
      `    "relevanceHint": "high" }`,
      ``,
      `非法（违规会被 Assembler 删除）：`,
      `  - imageUrl=http:// (必须 https://)`,
      `  - sourceUrl 为 unsplash.com / pexels.com (stock 图库)`,
      `  - caption 为占位文字 / 编造内容`,
      ``,
      `每个 candidate 必须含：`,
      `- sourceUrl: 图所在原文献的 URL（必填，至少 8 字符）`,
      `- imageUrl: 真实图片直链（可选，从 evidence 抽到的 <img src> 或 figure URL）`,
      `- caption: 图说明 ≥ 3 字符（从原文 figcaption / alt 提取）`,
      `- sourcePageOrSection: "Figure 3" / "Section 4.2" 之类位置标记（可选）`,
      `- relevanceHint: "high" | "medium" | "low"（评估与本 dim 的相关性）`,
      ``,
      `## Output JSON shape (field names must match exactly)`,
      `{`,
      `  "dimension": "${input.dimension}",`,
      `  "findings": [`,
      `    { "claim": "<verifiable specific statement, include numbers/dates/entities>",`,
      `      "evidence": "<1 sentence quote or data point>",`,
      `      "source": "<URL or DOI/arxiv id>",`,
      `      // ★ 引用元数据补全（必填，让下游 citation 不再 fallback 成 domain）：`,
      `      // - sourceTitle: web-search/scrape 结果里的 page title 或 og:title`,
      `      //   （e.g. "API Overview - Claude API"，不要写域名 "platform.claude.com"）`,
      `      "sourceTitle": "<page 真实标题（必填，从 search 结果 title / scrape og:title 取）>",`,
      `      // - sourceSnippet: 1-2 句关键摘要，从 search snippet / scrape og:description 取`,
      `      //   或者本 finding 直接关联的原文片段（≤ 300 chars）`,
      `      "sourceSnippet": "<原文摘要或 search snippet（必填，≤300 字）>",`,
      `      // - sourcePublishedAt: ISO-8601 日期（如 "2025-08-15" 或 "2025-08-15T00:00:00Z"），`,
      `      //   从 search 结果 date 字段 / scrape article:published_time / 页面正文中提取；`,
      `      //   找不到就省略字段（不要瞎填）`,
      `      "sourcePublishedAt": "<YYYY-MM-DD 或 ISO-8601，可选，找不到时省略>" }`,
      `    // 4-5 findings`,
      `  ],`,
      `  "summary": "<2-3 sentences synthesizing findings>",`,
      `  "figureCandidates": [`,
      `    { "sourceUrl": "...", "imageUrl": "...", "caption": "...", "sourcePageOrSection": "Figure 3", "relevanceHint": "high" }`,
      `    // 0-3 张，没有就 []`,
      `  ]`,
      `}`,
    ].join("\n");
  }

  /**
   * ★ 内容驱动退出闸：finalize 时框架调此校验。issues 非空就 reject + critique
   * → LLM 直接补缺。这是退出机制的"业务级硬要求"，比 zod schema 更严：
   *   - findings 数量下限 4
   *   - 每条 finding 三元组完整 + claim 含具体词
   *   - source 必须形似 URL（http 或带 .）
   *   - summary 不能是占位
   */
  validateBusinessRules(output: z.infer<typeof Output>): void {
    const issues: string[] = [];
    const findings = output?.findings ?? [];
    // ★ 阈值走能力级单一源（env MIN_FINDINGS_THRESHOLD，缺省 5）。本地推理模型常 plateau
    //   在 3 findings，故可经 env 调低，避免逼模型做不到的 self-heal 重试。
    const minFindings = resolveMinFindings();
    if (!Array.isArray(findings) || findings.length < minFindings) {
      issues.push(
        `findings.length=${findings.length} (要求 ≥${minFindings}，请用已搜到的工具结果补到至少 ${minFindings} 条)`,
      );
    }
    findings.forEach((f, i) => {
      if (!f?.claim || f.claim.trim().length < 10) {
        issues.push(
          `findings[${i}].claim 太短或缺失（要求 ≥10 字符且含具体数字/时间/实体）`,
        );
      }
      if (!f?.evidence || f.evidence.trim().length < 5) {
        issues.push(`findings[${i}].evidence 缺失或过短`);
      }
      if (!f?.source || f.source.trim().length < 4) {
        issues.push(`findings[${i}].source 缺失`);
      } else if (
        // 2026-05-13: 把 rag-search KB 结果的 wiki-page:/kb-doc: scheme 也算合法 source。
        // 原 regex 只认 http/doi/arxiv → KB 命中的 finding 一律被 reject → ReAct loop
        // 反复重试 → budget 提前耗尽 → 下游 grade 阶段被 abort（mission f1d9fee0 真因）。
        !/^https?:|^doi:|^arxiv:|^wiki-page:|^kb-doc:|^kb:|\./i.test(
          f.source.trim(),
        )
      ) {
        issues.push(
          `findings[${i}].source="${f.source.slice(0, 30)}" 不像 URL/DOI/KB ref（必须是 http(s):// / doi: / arxiv: / wiki-page: / kb-doc: 前缀，或含 .）`,
        );
      }
    });
    if (!output?.summary || output.summary.trim().length < 20) {
      issues.push(`summary 缺失或过短（要求 ≥20 字符的真实综合，不接受占位）`);
    }
    if (issues.length > 0) {
      throw new Error(issues.join("; "));
    }
  }
}
