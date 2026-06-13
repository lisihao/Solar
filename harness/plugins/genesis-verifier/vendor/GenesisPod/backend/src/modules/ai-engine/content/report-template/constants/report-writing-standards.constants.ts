/**
 * Topic Insights - Report Writing Standards
 *
 * Centralized writing standards for professional report generation.
 * These constants are injected into LLM prompts to control output quality.
 *
 * Injection points:
 * - getWritingStandards() → section-writer (每个写手写每节时)
 * - ANALYSIS_DEPTH, CITATION_STANDARDS, CHART_STANDARDS → dimension-research prompt
 * - SYNTHESIS_FORMATTING, EXECUTIVE_SUMMARY_FORMAT → report-synthesis prompt
 *
 * Design principles:
 * - 连续视图 & 章节视图: 深度、充实、有论证（不追求简洁）
 * - 快速视图: 由结构化 JSON 字段驱动，不受本文件控制
 * - Token budget: 总 prompt ≈ 80K chars，标准部分应控制在 ~5K chars 以内
 *
 * Benchmarked against:
 * - McKinsey: Pyramid Principle, SCR framework, Exhibit design (Action Title + Takeaway + Source)
 * - BCG: Insight-Action pattern, So-What framework
 * - Stanford HAI: Chapter Highlights, structured research reports
 * - Gartner: Strategic Planning Assumptions, Hype Cycle
 * - The Economist: Quantitative expression standards
 * - Oxford CEBM: Evidence grading hierarchy
 */

// ============ Core Writing Standards (injected via getWritingStandards → section-writer) ============

/**
 * Heading hierarchy rules for dimension content.
 * AI content is embedded under `## DimensionName`, so only ### and #### are allowed.
 */
export const HEADING_HIERARCHY = `## 标题层级规范

你的内容将嵌入在 \`## 维度名\` 下方，因此：
- 子章节使用 \`###\` 三级标题（如 ### 背景概述、### 现状分析）
- 子子章节使用 \`####\` 四级标题（如 #### 竞争格局）
- 禁止使用 \`#\` 一级标题和 \`##\` 二级标题（这两级由报告框架控制）
- 禁止使用 \`#####\` 及更深层级

层级规则：最多 2 级（### 和 ####），章节结构靠内容组织而非标题嵌套。`;

/**
 * Narrative structure standards.
 * Benchmarked against McKinsey Pyramid Principle and BCG Insight-Action pattern.
 *
 * 核心理念：结论先行 + So-What 测试 + 时间锚定
 * 这是报告"读起来像专业报告"的关键差异点
 */
export const NARRATIVE_STRUCTURE = `## 叙事结构规范

### 结论先行（McKinsey Pyramid Principle）
- 每个 ### 子节的第一段必须是该节的核心结论或判断，而非背景铺垫
- 后续段落提供数据支撑和详细论证，形成"倒三角"结构
- 禁止"综上所述..."模式——不要在末尾才揭示结论
- 正确示例："开源大模型在推理能力上已接近闭源模型的 90% 水平[1]。这一判断基于以下三个维度的证据..."
- 错误示例："近年来，大模型技术发展迅速。在这个背景下，我们对开源模型进行了研究。通过分析...综上所述，开源模型已接近闭源水平。"

### So-What 测试（BCG Insight-Action Pattern）
- 每个主要论点后必须回答"这意味着什么"——对谁、产生什么影响、需要什么行动
- 纯现象描述不构成洞察，必须附带判断性推论
- 正确："训练成本下降 80%[2]，**这使得中小企业首次具备了自建专属模型的经济可行性**"
- 错误："训练成本下降 80%[2]。"（缺少"so what"）

### 时间锚定
- 预测性判断须标注时间窗口："预计 2025-2027 年..."、"中期（3-5 年）..."
- 禁止无时间限定的断言："必将取代..."、"未来一定..."
- 历史数据标注年份："2024 年市场规模达 XX（IDC, 2024Q4）"

### 维度独立性
- 每个维度必须聚焦自己的核心主题，不要重复其他维度的内容
- 如需引用其他维度的结论，用一句话概述并注明"详见XX维度分析"
- 同一数据点、案例、论据不要在多个维度中详细展开

### 禁止教科书式写作
- 报告是洞察分析，不是概念介绍。禁止大段解释基础概念（如"什么是大模型"、"Transformer 架构原理"等）
- 假设读者已有领域基本知识，直接进入分析和判断
- 如需提及技术背景，用一句话带过即可，不要展开教学
- 第一个维度尤其容易退化为"概述/背景介绍"，请确保第一个维度也是有独立洞察的分析`;

/**
 * Professional tone, language, and expression standards.
 * Benchmarked against McKinsey (SCR framework), Stanford HAI (third-person neutral),
 * and The Economist Style Guide (quantitative expression).
 */
export const PROFESSIONAL_TONE = `## 文风规范

### 分析语气（第三人称为主，第一人称为辅）
- 数据呈现用第三人称陈述句："数据显示..."、"证据表明..."、"研究指出..."
- 独立判断用克制的第一人称：每个子节最多 1 次"我们认为"或"分析表明"
- 全文"我们认为/判断/看到"合计不超过 10 次
- 对标：McKinsey 用 "Our analysis shows"（低频），Stanford HAI 用第三人称

### 量化表达规范（对标 The Economist Style Guide）
- 关键数据必须有对比锚点，提供参照系：
  - 正确："市场规模达 1200 亿美元，同比增长 23%，为近五年最高增速"
  - 错误："市场规模达 1200 亿美元"（孤立数字无意义）
- 增长率/占比须标注时间范围和基数
- 禁止模糊量词替代具体数据："大幅增长" → 用百分比；"显著提升" → 用具体倍数

### 因果表达规范
- 区分相关性和因果性：
  - 有因果证据："A 导致了 B（研究表明...）[3]"
  - 仅有相关性："A 与 B 呈正相关"
- 禁止无限定的因果断言："必然导致"、"一定会"、"不可避免地"

### 禁止清单
- 口语化表达：禁止"翻车"、"跑得起"、"压舱石"、"试金石"等
- 繁体中文字符：全文使用简体中文，禁止"無"、"與"等繁体字
- 套话开头：禁止"随着...的发展"、"在当今..."
- 箭头链：禁止使用 → 符号串联因果。用"这导致..."、"进而引发..."、"其结果是..."等自然语言表达

### 标题规范
- 标题中**禁止包含引用标记**：如 \`### 1.5. 演化路径[113][114]\` 是错误的，引用标记只能出现在正文段落中
- 标题应简洁明了，不超过 30 字

### 术语一致性
- 每个术语首次出现时标注英文原文，如：能力密度（Capability Density）
- 后续全文统一使用中文形式
- 禁止同一概念中英文随意切换

### 绝对禁止泄露的内部信息
- **禁止字数统计**：不要输出"（字数：约XXX字）"、"（当前字数: XXX）"、"[当前字数: XXX]"、"(字数：约1350字)"等任何形式的字数标注。包括但不限于：括号内的字数、方括号内的字数、行尾的字数备注
- **禁止角色名**：不要输出"Leader"、"Agent"、"研究Agent"、"分析Agent"、"Leader 分配的"等内部多Agent流程的角色名称
- **禁止引用教材/课程**：不要使用"从学习路线图可见"、"多模态课程常将"、"在学习路线中"等表述。你是在撰写研究报告，不是编写教程
- **禁止内部标注**：不要输出"数据支撑总结"、"独立洞察"、"需补充...验证"等内部工作流标注

### 数学公式
- **使用标准 LaTeX 语法**：公式将由前端 KaTeX 渲染
- 行内公式使用 \`$...$\` 包裹，如 \`$O(n^2)$\`、\`$\\frac{a}{b}$\`
- 独立公式使用 \`$$...$$\` 包裹
- 简单表达式可直接写 Unicode：如 O(n²)、√n
- 禁止使用代码块（\`\`\`）展示公式
- **完整性要求**：一个数学表达式必须在同一对 \`$...$\` 内。禁止 \`$A$ $\\in$ $B$\` 这样的拆分写法，正确写法是 \`$A \\in B$\`。\\frac、\\left、\\right、\\sqrt 等必须与其参数在同一 $ 块内`;

/**
 * Hard limits on formatting elements.
 * Benchmarked against McKinsey (3-5 bold/page) and Nature Reviews (max 7 display items).
 */
export const FORMATTING_LIMITS = `## 格式元素限额（硬性约束）

对标来源：McKinsey 3-5 bold/页，Nature Reviews max 7 展示项/篇

### 加粗（**bold**）— 硬性格式要求

**核心规则：加粗只能内联出现在句子中间，绝不单独占一行，绝不出现在句子开头。**

- **必须**：每个 ### 子节正文中必须有 1-2 处内联加粗，标注该子节最核心的观点或论断
  - 正确示例：\`这一趋势的**核心驱动力**是成本大幅下降，使中小企业首次具备了自建专属模型的经济可行性\`
  - 正确示例：\`实验数据表明，**开源模型已逼近闭源 90% 的性能**，竞争格局正在重塑\`
  - 正确示例：\`通信机制不仅是传输管道，更是**决定系统稳定性的核心基础设施**，缺乏结构化设计会导致任务失稳\`
- 每个子节加粗不超过 2 处（过多加粗失去强调效果）
- **严禁**：单独一行只写加粗内容（如 \`**核心观点：**\` 独占一行，再换行写正文）
- **严禁**：用加粗文本开头一个段落，再加冒号引出正文，如：\`**图 1 所示的工作流程正体现了这一点**：...\` 或 \`**综合现有证据，可以得出一个较明确的判断**：...\`——这类句式应直接从分析内容写起，无需加粗导语
- **严禁**：加粗序数词、过渡词、连接词、枚举标记：~~**首先**~~、~~**其次**~~、~~**最后**~~、~~**一是**~~、~~**其一**~~、~~**其二**~~、~~**第一**~~、~~**第二**~~、~~**一方面**~~、~~**另一方面**~~、~~**此外**~~——这些是结构词，不是核心内容
- 避免加粗：单独的数字/百分比（如 ~~**68倍**~~、~~**25%**~~）
- 避免加粗：整句（超过 30 字不应整体加粗）
- 加粗文本应构成"扫描层"：读者仅看加粗内容即可获取核心论点

### 引用块（> blockquote）
- 全文（含所有维度）最多 8 个引用块（不含"本章要点"）
- 每个维度最多 1 个引用块（选该维度最核心的单条判断）
- 每个引用块不超过 80 字
- 格式：\`> **判断句内容。**\`（整句加粗）
- 引用块内容不得与本章要点中的任何一条重复
- 禁止每段结尾都加引用块总结
- 禁止补充节（跨维度/风险/战略）使用引用块

### 分割线（---）
- 禁止在 detailedContent 中使用 ---
- 章节分隔由标题层级自动实现

### 列表
- 有序列表统一 1. 2. 3.（阿拉伯数字），禁止中文数字"一、二、三"
- 无序列表统一 - （短横线）
- 列表项不超过 2 层嵌套
- **每条列表项不超过 100 字**：超长列表项应拆分为多条，或改用段落展开
- 列表不是段落的替代品：每条列表项应是独立的点，不要把结论性段落放在列表末尾

### 列表与段落的边界（重要）
- **列表只用于真正并列的具体事项**：公司/机构名称、技术工具、操作步骤、关键指标名称等——每条项目是独立名词短语，不含完整的论证
- **分析性并列观点必须写成段落**：如果列表项含有动词、因果推理、趋势判断、影响评估（即"完整的分析判断句"），它就不是列表项，必须扩写为段落，用"一方面...另一方面..."、"首先...其次..."等过渡词在段落内自然衔接
- 判断标准：把列表项单独拿出来，如果读起来是"一句话结论"，就改成段落；如果读起来是"一个具体的名字/步骤"，就保留列表
- **严禁"其一/其二/其三"bullet**：如果你要用"其一...其二...其三..."或"第一...第二...第三..."并列，必须写成段落（用"...包含三层：首先...其次...第三..."连续行文），不能拆成列表项
- **严禁在标题下方用 bullet 作"速览摘要"**：### 标题后第一段必须是实质性分析段落，不得用 bullet 列出本节要点总结；章节末尾同样禁止用 bullet 做小结

### 章节字数均衡
- 同一报告中各维度章节字数应相对均衡，最长章节不超过最短章节的 2 倍
- 每个维度建议 1500-3000 字（中文），过短说明分析不够深入
- 每个 ### 子节建议 300-800 字，过短则缺乏论证，过长则应拆分`;

/**
 * Direction B: Dimension opening conclusion (one-line core thesis).
 * Replaces the multi-bullet Chapter Highlights pattern.
 * Benchmarked against Gartner Research Note "Key Finding" pattern.
 */
export const DIMENSION_OPENING_CONCLUSION = `## 维度核心结论（Direction B — 首节必须包含）

detailedContent 的**绝对第一行**（在任何 ### 标题之前）必须写一行核心结论：

> **核心判断**：[本维度最重要的结论，≤50字，具体可验证，包含关键数据或事实]

约束（严格执行）：
- **只允许一行**，不得扩展为列表或多个要点
- **禁止泛化描述**：如"XX领域正在快速发展"、"各方面都有重要进展"等是不合格的
- **必须包含至少一个具体数据点**或可验证的事实（数字、公司名、事件等）
- 这一行是读者阅读本维度的第一印象，必须让读者立刻掌握核心结论
- 若为第一节（前置章节为"无"），必须写；后续节直接进入正文
- 对标 Gartner Research Note 的 "Key Finding" 模式

正确示例：
> **核心判断**：2025年大模型推理成本同比下降73%，开源模型在80%企业任务上达到闭源90%性能，商业壁垒实质消失。

错误示例（过于泛化）：
> **核心判断**：AI领域正在快速发展，各方面都有重要进展值得关注。`;

/** @deprecated Use DIMENSION_OPENING_CONCLUSION instead. Kept for backward compatibility. */
export const CHAPTER_HIGHLIGHTS = DIMENSION_OPENING_CONCLUSION;

// ============ Dimension Research Standards (injected directly into dimension-research.prompt) ============

/**
 * Analysis depth requirement with advanced optional frameworks.
 * Enhanced with competitive landscape, scenario analysis, value chain analysis.
 * Benchmarked against McKinsey, BCG, Gartner methodologies.
 */
export const ANALYSIS_DEPTH = `## 分析深度要求

每个关键论点必须回答"为什么"至少深入两层，但不要套用固定模板。

### 基础分析框架（根据内容特点灵活选择，不必每个论点都套用）
- 现象-机制-影响：适用于技术趋势分析
- 数据-对比-判断：适用于市场格局分析
- 现状-瓶颈-路径：适用于挑战与机会分析

### 高级分析工具（视主题需要选用，不强制）
- **竞争格局分析**：市场份额 + 战略定位对比，用表格呈现（对标 Gartner Magic Quadrant 思路）
- **情景分析**：不确定性高时，提供 2-3 个情景（基准/乐观/悲观），每个标注关键假设
- **价值链分析**：分析产业链各环节的价值分布和变化趋势
- **技术成熟度判断**：标注技术所处阶段（早期概念 / 快速发展 / 规模应用 / 成熟稳定）

### 对比分析规范
- 3 个及以上实体的多维对比**必须用表格**，禁止在段落中散落对比
- 对比维度至少 3 个，对比对象至少 3 个
- 对比结论须明确指出"谁领先、在哪领先、差距多大"

禁止：对每个话题都机械套用"现象层→机制层→结构层→启示层"四层结构。`;

/**
 * Citation quality standards with evidence grading.
 * Enhanced with Oxford CEBM-inspired evidence hierarchy and data timeliness rules.
 */
export const CITATION_STANDARDS = `## 引用规范

### 引用分布（硬性约束）
- 每个子节应引用至少 2 个不同来源
- **单一来源在全文中被引用不超过 5 次**（硬性上限，违反将被标记为质量问题）
- 如发现某来源被反复使用，必须寻找替代来源分散引用
- 禁止同一来源在连续 3 个段落中反复出现

### 引用密度
- 对标：学术综述 ~25 引用/千字，行业报告 ~10 引用/千字
- 目标：每千字 10-15 处引用，均匀分布
- 禁止连续引用 3 个以上相同来源编号

### 证据分级（Evidence Grading）
- **一级来源（强证据）**：学术论文（peer-reviewed）、官方统计数据、审计财报、标准化基准测试（如 MMLU, HumanEval）
  → 直接引用，无需限定语
- **二级来源（中等证据）**：权威机构报告（Gartner/IDC/McKinsey）、官方技术博客、白皮书
  → 引用时加"据 XX 报告..."
- **三级来源（弱证据）**：新闻报道、行业访谈、社区讨论、未经审计的企业公告
  → 引用时加限定语"据报道..."、"有观点认为..."
- 每个核心论断至少需要 1 个一级或二级来源支撑
- 仅依赖三级来源的论断，应在表述中体现不确定性

### 数据时效性
- 统计数据标注采集年份："2025 年市场规模达 XX（IDC, 2025Q2）"
- 超过 2 年的数据须提示时效："该数据为 2023 年统计，最新情况可能有变化"
- 预测数据标注预测机构和发布时间`;

/**
 * Chart data standards with type selection guide and takeaway line.
 * Benchmarked against McKinsey Exhibit Design (Action Title + Takeaway + Source),
 * Edward Tufte (Data-Ink ratio), and The Economist chart standards.
 */
export const CHART_STANDARDS = `## 图表规范

对标来源：McKinsey Exhibit 三要素，Tufte Data-Ink Ratio，APA/IEEE 图表就近原则

### 位置规范（最重要）
- **紧跟首次提及**：图表必须放在讨论该数据的段落之后（after_paragraph_N），禁止集中在章节末尾
- **图文对应**：在引用图表的段落中，必须用自然语言引述图表内容，如"从数据可以看出..."、"上述图表揭示了..."
- **禁止集中堆放**：禁止在章节末尾或报告末尾集中放置所有图表
- position 字段首选 after_paragraph_N（N 为与图表最相关的段落序号），其次 after_heading_N

### 图表类型选择（The Economist 对标）
- 趋势变化 → 折线图（line）
- 类别对比 → 柱状图（bar）；超过 7 个类别用横向柱状图
- 占比分布 → 饼图仅在 ≤5 扇区时使用；>5 扇区改用堆叠柱状图
- 相关性分析 → 散点图
- 多维度对比 → 雷达图（≤6 维度）

### 数据点要求（按图表类型区分）
- 柱状图（bar）：最少 3 个数据点
- 折线图（line/area）：最少 5 个数据点
- 饼图（pie）：最少 3 个扇区
- 散点图/雷达图（radar）：最少 10 个数据点
- 2 个数据点的对比改用行内文字或表格呈现

### 图表叙事三要素（McKinsey Exhibit Standard）
1. **Action Title**（发现性标题）：标题必须是完整的判断句
   - 正确："开源模型参数规模在 2024-2026 年稳定在 120B-235B 区间"
   - 错误："典型LLM参数规模演进（示意）"
   - 禁止标题中出现"示意"、"概念"、"定性对比"等弱化词
2. **Takeaway Line**（结论提示）：图表的 subtitle 字段须用一句话点明读者应得出的结论
3. **Source Line**（来源标注）：每张图表标注数据来源

### 数据诚信
- Y 轴须从 0 开始（如有特殊原因须标注）
- 百分比数据标注样本量或基数
- 禁止使用 3D 效果

### 数量建议
- 每个维度 2-4 张图（含生成图表和引用配图），鼓励图文并茂
- 全文 15-25 张图为佳，确保核心论点有可视化支撑
- 质量优先，数量合理：每张图须与论述内容相关，不堆砌无关配图`;

/**
 * Table usage standards.
 * Missing from original — McKinsey and Gartner heavily use structured tables.
 */
export const TABLE_STANDARDS = `## 表格规范

### 适用场景（必须用表格的情况）
- 3 个及以上实体 × 3 个及以上维度的对比 → 必须用表格，禁止散文描述
- 关键指标汇总 → 表格
- 时间线/里程碑 → 表格
- 竞争格局对比 → 表格

### 格式要求
- 表头加粗
- 数值右对齐，文本左对齐
- 表格上方有引导段落说明表格用途和结论
- 表格行数不超过 15 行；超过时只展示 Top N 并注明
- 无数据填"—"
- 数值统一精度（如统一保留 1 位小数）
- 含货币时标注币种（如"美元"或"$"），含百分比时标注基数`;

// ============ Synthesis Standards (injected into report-synthesis.prompt) ============

/**
 * Executive summary format (McKinsey SCR framework).
 * Enhanced with opportunity sizing and key uncertainties (BCG/Deloitte patterns).
 */
export const EXECUTIVE_SUMMARY_FORMAT = `## 执行摘要（对标 McKinsey SCR 框架）

### 结构（严格按顺序，每个区块必须有 \`###\` 子标题）
1. **核心论断**（加粗段落，1 句话，30 字以内）：全文最重要的单一结论
2. **背景**（段落，2-3 句）：研究范围和时间窗口
3. \`### 核心发现\`（3-5 条编号列表）：每条 1-2 句话，加粗要点句
4. \`### 关键指标\`（表格）：指标名 | 数值 | 来源
5. \`### 机会规模\`（1-2 句）：量化该话题的市场规模、影响范围或资金流向
6. \`### 风险预警\`（2-3 条编号列表）：每条 1 句话
7. \`### 关键不确定性\`（2 条）：可能颠覆以上判断的变量，区分于已知风险
8. \`### 行动建议\`（3 条按角色编号列表）：角色名加粗 + 1 句话建议

### 约束
- 总长度 500-800 字
- 核心发现每条加粗第一句（判断句），第二句不加粗（数据支撑）
- 行动建议每条角色名加粗（如 **企业决策者：**）
- 表格与正文对齐（不缩进在编号列表下），位于 \`### 关键指标\` 标题之后
- 必须独立可读：不读全文也能获取核心信息
- 禁止使用引用块
- 禁止多段编号列表无标题并列`;

/**
 * Formatting standards for report synthesis (supplementary sections).
 * Replaces the permissive "use bold and blockquotes" instructions.
 */
export const SYNTHESIS_FORMATTING = `## 格式要求
- 使用 Markdown 格式
- 用表格呈现结构化数据（如风险矩阵、关键指标）
- 加粗仅用于核心判断句（每节最多 2 处）
- 禁止在补充内容中使用 > 引用块（引用块预算留给维度章节）
- 禁止使用 --- 分割线

### 补充内容标题层级
- 跨维度关联分析、风险评估、战略建议等补充内容必须使用 ### 子标题组织结构
- 例如跨维度分析下使用 "### 因果链分析"、"### 系统性风险"、"### 维度对比" 等子标题
- 战略建议下按受众使用 "### 企业决策者"、"### 投资者"、"### 技术从业者" 等子标题
- 禁止用纯加粗文本代替标题（如 **技术架构：** 应改为 ### 技术架构）
- 每条列表项不超过 100 字，结论性内容用段落而非列表项表达`;

/**
 * LLM self-check checklist, injected at the end of prompts.
 * Inspired by McKinsey Blue Team Review process.
 */
export const QUALITY_CHECKLIST = `## 输出前自检（写完后逐项确认）

### 叙事质量
- 每个 ### 子节第一段是否为结论性陈述（而非背景铺垫）？
- 每个核心论断是否回答了"so what"（意味着什么）？
- 预测性判断是否标注了时间窗口？

### 数据质量
- 关键数据是否有对比锚点（同比/环比/行业均值）？
- 引用数据是否标注了来源和年份？
- 是否存在论断仅依赖单一来源？

### 格式合规
- 加粗文本串读能否构成完整的论点链？
- 章节要点是否每条 ≤30 字？
- 3+ 实体的多维对比是否使用了表格？
- 是否存在被禁止的内部信息泄露？`;

// ============ English Variants ============

export const HEADING_HIERARCHY_EN = `## Heading Hierarchy Rules

Your content is embedded under \`## DimensionName\`, so:
- Use \`###\` for sub-sections (e.g. ### Background, ### Current Analysis)
- Use \`####\` for sub-sub-sections (e.g. #### Competitive Landscape)
- Do NOT use \`#\` or \`##\` (reserved for report framework)
- Do NOT use \`#####\` or deeper levels

Rule: Maximum 2 levels (### and ####). Structure through content, not heading depth.`;

export const NARRATIVE_STRUCTURE_EN = `## Narrative Structure Standards

### Conclusion First (McKinsey Pyramid Principle)
- The first paragraph of each ### sub-section MUST state the core conclusion or judgment, not background
- Subsequent paragraphs provide data support and detailed arguments ("inverted triangle")
- Do NOT use "In conclusion..." patterns — never save the conclusion for the end
- Correct: "Open-source LLMs have reached 90% of proprietary model performance on key benchmarks[1]. This conclusion is supported by..."
- Wrong: "In recent years, LLM technology has developed rapidly. Against this backdrop... In summary, open-source models have reached..."

### So-What Test (BCG Insight-Action Pattern)
- Every major argument must answer "what does this mean" — for whom, what impact, what action needed
- Pure observation is not insight — must include judgmental inference
- Correct: "Training costs dropped 80%[2], **making it economically viable for SMEs to build proprietary models for the first time**"
- Wrong: "Training costs dropped 80%[2]." (missing "so what")

### Time Anchoring
- Predictive statements must include time windows: "expected in 2025-2027...", "medium-term (3-5 years)..."
- Do NOT make unqualified assertions: "will inevitably replace...", "will definitely..."
- Historical data must include year: "2024 market size reached XX (IDC, 2024Q4)"

### Dimension Independence
- Each dimension must focus on its own core theme — do not repeat content from other dimensions
- When referencing another dimension's conclusions, summarize in one sentence and note "see [Dimension X] for details"
- The same data point, case study, or argument must not be elaborated in multiple dimensions

### No Textbook-Style Writing
- This report is analytical insight, not a concept introduction. Do not write lengthy explanations of basic concepts (e.g., "what is a large language model", "how Transformer architecture works")
- Assume readers have foundational domain knowledge — go directly to analysis and judgment
- If technical background is needed, one sentence is sufficient; do not expand into tutorial content
- The first dimension is especially prone to devolving into "overview/background introduction" — ensure the first dimension also delivers independent analytical insight`;

export const PROFESSIONAL_TONE_EN = `## Writing Style Standards

### Analytical Tone (third-person primary, first-person secondary)
- Present data in third person: "Data indicates...", "Evidence suggests...", "Research shows..."
- Use restrained first person for judgments: max 1 "our analysis shows" per sub-section
- Total first-person expressions ("we believe/observe/find") max 10 across entire document
- Benchmarked: McKinsey uses "Our analysis shows" (sparingly), Stanford HAI uses third person

### Quantitative Expression Standards (The Economist Style Guide)
- Key data must have comparison anchors:
  - Correct: "Market reached $120B, up 23% YoY, the highest growth rate in five years"
  - Wrong: "Market reached $120B" (isolated number without context)
- Growth rates/percentages must include time range and base
- Do NOT substitute vague qualifiers for specific data: "significant growth" → use actual percentage

### Causal Expression Standards
- Distinguish correlation from causation:
  - With causal evidence: "A caused B (research demonstrates...)[3]"
  - Correlation only: "A is positively correlated with B"
- Do NOT use unqualified causal assertions: "will inevitably lead to...", "will definitely..."

### Prohibited
- Colloquial expressions
- Cliche openings: "In today's rapidly evolving...", "As we navigate..."
- Arrow chains: Do NOT use → to chain causality. Use "this leads to...", "which in turn causes...", "resulting in..."

### Heading Rules
- **Never include citation markers in headings**: e.g. \`### 1.5. Evolution Paths[113][114]\` is wrong. Citations belong in body text only.
- Keep headings concise (under 30 words)

### Terminology Consistency
- First occurrence of each term: include original term in parentheses if non-English
- Use consistent English terminology throughout
- Do not switch between equivalent terms

### Absolutely Prohibited Internal Information
- **No word counts**: Never output "(word count: ~XXX)", "(current count: XXX)" or similar
- **No role names**: Never output "Leader", "Agent", "Research Agent" or similar internal multi-agent role names
- **No textbook references**: Do not use "as the curriculum shows", "the learning roadmap indicates"
- **No internal annotations**: Never output "data support summary", "independent insight", "needs verification"

### Math Formulas
- **Use standard LaTeX syntax**: Rendered by frontend KaTeX
- Inline formulas: \`$...$\` (e.g. \`$O(n^2)$\`, \`$\\frac{a}{b}$\`)
- Display formulas: \`$$...$$\`
- Simple expressions can use Unicode: O(n²), √n
- **Completeness**: One math expression must be in a single \`$...$\` pair. Never split like \`$A$ $\\in$ $B$\``;

export const FORMATTING_LIMITS_EN = `## Formatting Limits (Hard Constraints)

### Bold (**bold**) — Hard constraints
- Max 2 bold items per sub-section (### heading)
- **Only bold core arguments inline within a sentence** (e.g., "open-source models now match **90% of closed-source performance**")
- **Never bold the opening phrase of a paragraph** (e.g., ~~**"The chart above illustrates this point":**~~ content... — just write the analysis directly)
- **Never bold ordinal/transition markers**: ~~**First**~~, ~~**Second**~~, ~~**Finally**~~, ~~**On one hand**~~, ~~**On the other hand**~~, ~~**Moreover**~~ — these are structural connectors, not core content
- Avoid bolding: standalone numbers/percentages, entire sentences (>30 words)
- Bold text should form a "scan layer": reader gets core insights from bold alone
- **Never use "First/Second/Third" as bullet items** for analytical parallel points — write them as connected paragraphs instead

### Blockquotes (> blockquote)
- Max 8 blockquotes across entire report (excluding Chapter Highlights)
- Max 1 blockquote per dimension (the single most important judgment)
- Each blockquote max 80 words, format: \`> **Judgment sentence.**\` (bold entire sentence)
- Blockquote content must not duplicate any Chapter Highlights point
- Do NOT use blockquotes in supplementary sections (cross-dimension/risk/strategy)

### Horizontal Rules (---)
- Do NOT use --- in detailedContent
- Section separation is handled by heading hierarchy

### Lists
- Ordered lists: 1. 2. 3. (Arabic numerals only)
- Unordered lists: - (dash only)
- Max 2 nesting levels
- **Each list item max 100 characters**: Split long items into multiple items or use paragraphs
- Lists are not paragraph substitutes: Do not put concluding paragraphs as list items

### Lists vs Paragraphs (Important)
- **Lists are only for truly parallel concrete items**: company/organization names, technical tools, operational steps, key metric names — each item is an independent noun phrase with no full argument
- **Analytical parallel arguments must be written as paragraphs**: if a list item contains a verb, causal reasoning, trend judgment, or impact assessment (i.e., a "complete analytical sentence"), it is not a list item — expand it into a paragraph and connect with "on one hand...on the other hand...", "firstly...secondly..." as natural transitions within prose
- Decision rule: extract the item on its own — if it reads as a "one-sentence conclusion", convert to paragraph; if it reads as "a specific name/step", keep as list item

### Section Word Count Balance
- Word counts across dimensions in the same report should be relatively balanced — the longest section must not exceed twice the shortest
- Each dimension should target 1500-3000 words; falling short indicates insufficient depth of analysis
- Each ### sub-section should target 300-800 words; too short means insufficient argumentation, too long should be split`;

export const DIMENSION_OPENING_CONCLUSION_EN = `## Dimension Core Conclusion (Direction B — required at start of first section)

The **absolute first line** of detailedContent (before any ### heading) must be a single core judgment:

> **Key Finding**: [The most important conclusion of this dimension, ≤50 words, specific and verifiable, includes key data]

Constraints:
- **One line only** — do not expand into a bullet list
- **No generic statements**: "The field is evolving rapidly" is not acceptable
- **Must include at least one specific data point** or verifiable fact (number, company, event)
- If this is the first section (no previous sections), this line is mandatory; subsequent sections go straight into content
- Benchmarked against Gartner Research Note "Key Finding" pattern

Good example:
> **Key Finding**: LLM inference costs fell 73% YoY in 2025; open-source models match closed-source performance on 80% of enterprise tasks, effectively eliminating the commercial moat.`;

/** @deprecated Use DIMENSION_OPENING_CONCLUSION_EN instead. Kept for backward compatibility. */
export const CHAPTER_HIGHLIGHTS_EN = DIMENSION_OPENING_CONCLUSION_EN;

export const EXECUTIVE_SUMMARY_FORMAT_EN = `## Executive Summary (McKinsey SCR Framework)

### Structure (strict order, each block must have a \`###\` sub-heading)
1. **Thesis Statement** (bold paragraph, 1 sentence, max 30 words): The single most important conclusion
2. **Context** (paragraph, 2-3 sentences): Research scope and time window
3. \`### Core Findings\` (3-5 items, numbered): Each 1-2 sentences, bold the judgment sentence
4. \`### Key Metrics\` (table): Metric | Value | Source
5. \`### Opportunity Sizing\` (1-2 sentences): Quantify the market size, impact scope, or capital flows
6. \`### Risk Alerts\` (2-3 items, numbered): Each 1 sentence
7. \`### Key Uncertainties\` (2 items): Variables that could overturn the above conclusions (distinct from known risks)
8. \`### Action Items\` (3 items, by audience): Bold audience role + 1 sentence recommendation

### Constraints
- Total length 500-800 words
- Core findings: bold first sentence (judgment), second sentence plain (data support)
- Action items: bold audience role (e.g., **Enterprise Leaders:**)
- Table aligned with body text (not indented under numbered list), placed after \`### Key Metrics\`
- Must be independently readable: core information without reading full report
- Do NOT use blockquotes
- Do NOT place multiple numbered lists without sub-headings`;

export const ANALYSIS_DEPTH_EN = `## Analysis Depth Requirements

Every key argument must answer "why" at least two levels deep, but do not apply a rigid template.

### Basic Analytical Frameworks (choose flexibly based on content)
- Phenomenon-Mechanism-Impact: for technology trend analysis
- Data-Comparison-Judgment: for market landscape analysis
- Status-Bottleneck-Path: for challenge & opportunity analysis

### Advanced Analysis Tools (use when the topic requires, not mandatory)
- **Competitive Landscape**: Market share + strategic positioning comparison, present in tables
- **Scenario Analysis**: When uncertainty is high, provide 2-3 scenarios (base/optimistic/pessimistic), each with key assumptions
- **Value Chain Analysis**: Analyze value distribution and change trends across industry chain segments
- **Technology Maturity Assessment**: Label technology stage (early concept / rapid growth / scale deployment / mature stable)

### Comparative Analysis Rules
- Multi-entity comparisons (3+) across multiple dimensions MUST use tables, not prose
- At least 3 comparison dimensions and 3 comparison subjects
- Comparison conclusions must clearly state "who leads, in what area, by how much"

Prohibited: Mechanically applying a rigid "phenomenon → mechanism → structure → implication" four-layer framework.`;

export const CITATION_STANDARDS_EN = `## Citation Standards

### Citation Distribution (Hard Constraints)
- Each sub-section should cite at least 2 different sources
- **A single source must not be cited more than 5 times across the entire document** (hard limit)
- If a source is used repeatedly, find alternative sources to distribute citations
- Do not cite the same source in 3 consecutive paragraphs

### Citation Density
- Benchmark: Academic reviews ~25 citations/1000 words, industry reports ~10/1000 words
- Target: 10-15 citations per 1000 words, evenly distributed
- Do not cite the same source number 3+ times consecutively

### Evidence Grading
- **Tier 1 (Strong Evidence)**: Peer-reviewed papers, official statistics, audited financials, standardized benchmarks (MMLU, HumanEval)
  → Cite directly without qualifiers
- **Tier 2 (Moderate Evidence)**: Authoritative reports (Gartner/IDC/McKinsey), official tech blogs, white papers
  → Cite with "According to XX report..."
- **Tier 3 (Weak Evidence)**: News articles, industry interviews, community discussions, unaudited announcements
  → Cite with qualifiers: "reportedly...", "some observers suggest..."
- Every core argument needs at least 1 Tier 1 or Tier 2 source
- Arguments based solely on Tier 3 sources should reflect uncertainty in phrasing

### Data Timeliness
- Statistics must include collection year: "2025 market size reached XX (IDC, 2025Q2)"
- Data older than 2 years: note timeliness concern
- Forecast data must note forecasting institution and publication date`;

export const CHART_STANDARDS_EN = `## Chart Standards

### Position (Most Important)
- **Adjacent to first mention**: Charts must be placed after the paragraph discussing the data, never clustered at section end
- **Text-chart correspondence**: The paragraph referencing the chart must describe its content in natural language
- position field: prefer after_paragraph_N, then after_heading_N

### Chart Type Selection
- Trends → line chart
- Category comparison → bar chart; >7 categories use horizontal bar
- Distribution → pie chart only with ≤5 sectors; >5 use stacked bar
- Correlation → scatter plot
- Multi-dimension comparison → radar chart (≤6 dimensions)

### Data Point Requirements
- Bar: minimum 3 data points
- Line/area: minimum 5 data points
- Pie: minimum 3 sectors
- Scatter/radar: minimum 10 data points
- 2 data points: use inline text or table instead

### Exhibit Three Elements (McKinsey Standard)
1. **Action Title**: Must be a complete finding statement (not a label)
2. **Takeaway Line**: subtitle field with one sentence telling the reader what conclusion to draw
3. **Source Line**: Data source attribution on every chart

### Data Integrity
- Y-axis should start from 0 (annotate if not)
- Percentage data must note sample size or base
- No 3D effects

### Quantity Guidelines
- 2-4 visuals per dimension (including generated charts and referenced images), encourage rich illustration
- 15-25 visuals across entire report, ensuring core arguments have visual support
- Quality first, quantity reasonable: every image must be relevant to the discussion, no filler images`;

export const TABLE_STANDARDS_EN = `## Table Standards

### When to Use Tables
- 3+ entities × 3+ dimensions comparison → must use table, no prose
- Key metric summaries → table
- Timelines/milestones → table
- Competitive landscape comparison → table

### Formatting
- Bold headers
- Numbers right-aligned, text left-aligned
- Introductory paragraph above table explaining purpose and conclusion
- Max 15 rows; show Top N if more
- No empty cells — use "—" for missing data
- Consistent precision (e.g., all 1 decimal place)
- Currency must note denomination, percentages must note base`;

export const QUALITY_CHECKLIST_EN = `## Pre-Output Self-Check

### Narrative Quality
- Does each ### sub-section lead with a conclusion (not background)?
- Does every core argument answer "so what" (what does this mean)?
- Do predictive statements include time windows?

### Data Quality
- Does key data have comparison anchors (YoY/QoQ/industry average)?
- Is cited data annotated with source and year?
- Are there arguments relying on a single source?

### Format Compliance
- Can bold text be read in sequence to form a complete argument chain?
- Is each chapter highlight ≤30 words?
- Are 3+ entity comparisons presented in tables?
- Is there any prohibited internal information leakage?`;

// ============ Resolvers ============

/**
 * Language-aware writing standards resolver.
 *
 * Returns the complete set of writing standards as a single string block
 * in the appropriate language. Used by section-writer for each section.
 *
 * Includes: heading hierarchy, narrative structure, professional tone,
 * formatting limits, dimension opening conclusion (Direction B).
 *
 * Does NOT include: analysis depth, citation standards, chart standards
 * (these are injected separately in dimension-research prompts).
 *
 * @param language "zh" | "en" (default "zh")
 */
export function getWritingStandards(language: string = "zh"): string {
  if (language.startsWith("en")) {
    return [
      HEADING_HIERARCHY_EN,
      NARRATIVE_STRUCTURE_EN,
      PROFESSIONAL_TONE_EN,
      FORMATTING_LIMITS_EN,
      DIMENSION_OPENING_CONCLUSION_EN,
    ].join("\n\n");
  }
  return [
    HEADING_HIERARCHY,
    NARRATIVE_STRUCTURE,
    PROFESSIONAL_TONE,
    FORMATTING_LIMITS,
    DIMENSION_OPENING_CONCLUSION,
  ].join("\n\n");
}

/**
 * Language-aware executive summary format.
 */
export function getExecutiveSummaryFormat(language: string = "zh"): string {
  return language.startsWith("en")
    ? EXECUTIVE_SUMMARY_FORMAT_EN
    : EXECUTIVE_SUMMARY_FORMAT;
}

/**
 * Language-aware dimension research standards.
 * Combines analysis depth + citation standards + chart standards + table standards.
 * Used by dimension-research prompts.
 *
 * @param language "zh" | "en" (default "zh")
 */
export function getDimensionResearchStandards(language: string = "zh"): string {
  if (language.startsWith("en")) {
    return [
      ANALYSIS_DEPTH_EN,
      CITATION_STANDARDS_EN,
      CHART_STANDARDS_EN,
      TABLE_STANDARDS_EN,
    ].join("\n\n");
  }
  return [
    ANALYSIS_DEPTH,
    CITATION_STANDARDS,
    CHART_STANDARDS,
    TABLE_STANDARDS,
  ].join("\n\n");
}

/**
 * Language-aware quality checklist.
 * Can be appended to any prompt as a final self-check instruction.
 *
 * @param language "zh" | "en" (default "zh")
 */
export function getQualityChecklist(language: string = "zh"): string {
  return language.startsWith("en") ? QUALITY_CHECKLIST_EN : QUALITY_CHECKLIST;
}
