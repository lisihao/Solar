# Topic Insights 报告质量系统升级方案

> **文档版本**: v1.1 (Review Revised)
> **创建日期**: 2026-03-05
> **修订日期**: 2026-03-05
> **作者**: Claude Code
> **状态**: 评审修订完成，待确认后进入详细设计
> **关联模块**: `backend/src/modules/ai-app/topic-insights/`

---

## 1. 背景与目标

### 1.1 问题发现

通过对 Topic Insights 导出报告（主题："基础大模型技术发展趋势"，182 条引用，7 个维度）的系统质量分析，识别出 **51 个不专业问题**，归结为 **6 个系统性根因**：

| 根因                                            | 影响问题数 | 严重度 |
| ----------------------------------------------- | ---------- | ------ |
| 标题层级坍塌（+2 提升导致 h5 泛滥）             | 3          | P0     |
| Prompt 写作风格失控（加粗/blockquote/模板僵化） | 14         | P0     |
| 结论章节语义重叠导致重复                        | 3          | P1     |
| 引用质量无门控                                  | 5          | P1     |
| 图表导出空白 + 数据浅薄                         | 5          | P0     |
| 分割线/排版过密                                 | 6          | P2     |

### 1.2 SOTA 对标

对标 McKinsey、Gartner、Stanford HAI、CB Insights、Nature Reviews 等业界顶级报告：

| 维度           | 当前状态                         | 业界基准                       | 差距       |
| -------------- | -------------------------------- | ------------------------------ | ---------- |
| 加粗密度       | 313 处（每段 1+）                | 3-5 处/页，占比 15-30%         | 5-10x 过度 |
| 标题层级       | 6 级（h1-h6 全用，h5 占 182 个） | 3 级（最多 4 级）              | 层级混乱   |
| Callout/引用块 | 98 个                            | 1 个/2-3 页                    | 10x 过度   |
| 图表数据点     | 2-3 个/图                        | 最少 5 个/图                   | 不达标     |
| 引用密度       | 182 条但集中在 5 条来源反复引用  | 10-15 条/千字，均匀分布        | 虚高       |
| 主观表达       | "我们认为"118 次                 | "We believe" 1-2 次/全文       | 50x+ 过度  |
| 分割线         | 51 条 `<hr>`                     | 章节间用间距，不用 `<hr>`      | 不专业     |
| 章节摘要       | 无                               | 每章 3-5 条要点速览            | 缺失       |
| 执行摘要       | 多段密集文字                     | SCR 框架，3-5 条 bold 核心发现 | 格式弱     |

### 1.3 目标

将 Topic Insights 报告质量提升至 **与 McKinsey/Gartner 报告格式可比** 的专业水准：

- 标题层级清晰（3 级为主）
- 加粗精准聚焦核心判断（每节 1-2 处）
- 引用块稀缺且有冲击力（全文 10-15 个）
- 图表数据充实（5+ 数据点）
- 术语统一、文风专业
- 导出完整可用

---

## 2. 根因定位（代码级）

### 2.1 根因 R1：标题层级坍塌

**代码位置**: `report-synthesis.service.ts:901-906`、`report-generator.service.ts:522-527`（两处完全相同）

```typescript
// 当前：全量 +2 提升（两个 service 文件重复代码）
content = content.replace(/^(#{1,6})\s+/gm, (_match, hashes: string) => {
  const newLevel = Math.min(hashes.length + 2, 6);
  return "#".repeat(newLevel) + " ";
});
```

**因果链**:

```
Prompt 要求 AI 用 ### (h3) 写子节
→ 组装时统一 +2
→ ### 变成 ##### (h5)，#### 变成 ###### (h6)
→ numberSubHeadings() 匹配 #{3,4} 但内容已是 #{5,6}
→ 编号逻辑失效，视觉层级扁平
→ 导出报告 182 个 h5，标题全部同样大小
```

**关联文件**:

- `report-synthesis.service.ts:2080-2106` — `numberSubHeadings()` 正则 `/^(#{3,4})\s+/`
- `report-generator.service.ts:1249-1276` — 完全相同的 `numberSubHeadings()` 副本
- `dimension-research.prompt.ts:128` — "每个子章节必须以 Markdown 三级标题（###）开始"

### 2.2 根因 R2：Prompt 写作风格失控

**代码位置**: `dimension-research.prompt.ts:541-556`

```
## 根因分析框架（每个核心论点必须包含）
1. **现象层**：...
2. **机制层**：...
3. **结构层**：...
4. **启示层**：...
禁止只停留在现象描述。每个关键论点必须回答"为什么会这样？"至少深入两层。

## 专业写作规范
- 关键数据点用 **加粗** 标注
- 因果链用「→」连接：原因 → 中间机制 → 结果
- 重要结论以 > 引用块突出
```

`report-synthesis.prompt.ts:158-162`:

```
- 使用 > 引用框突出核心观点
- 使用 **粗体** 标注关键词
```

`dimension-research.prompt.ts:536`:

```
用"我们认为..."、"核心驱动力是..."表达分析判断
```

**因果链**:

```
Prompt 说"每个核心论点必须包含四层" → AI 对每个话题都套四层模板 (152 次)
Prompt 说"关键数据点用加粗" → AI 把所有数字都加粗 (313 处)
Prompt 说"重要结论以 > 引用块突出" → AI 每段后面都加引用块 (98 个)
Prompt 说"因果链用→连接" → 大量箭头链 (14 处显式 + 大量隐式)
Prompt 说"用我们认为表达判断" → 118 次"我们认为/判断/看到"
所有指令都是"鼓励使用"而无上限约束
```

### 2.3 根因 R3：结论章节语义重叠

**代码位置**: `report-synthesis.prompt.ts:59-69`

```typescript
// JSON schema 中三个字段语义重叠：
"strategicRecommendations": {
  "fullText": "...",  // 包含按角色的建议
  "forEnterprise": ..., "forInvestors": ..., "forPolicymakers": ...
},
"conclusion": "...包含：### 核心判断提炼、### 情景展望、### 差异化行动建议（按角色分段）",
"scenarioOutlook": { "baseline": ..., "optimistic": ..., "pessimistic": ... }
```

**因果链**:

```
conclusion 要求包含"差异化行动建议（按角色分段）"
→ 与 strategicRecommendations.fullText 完全重叠
conclusion 要求包含"情景展望"
→ 与 scenarioOutlook 字段完全重叠
AI 在三个字段中各写一遍相似内容
→ buildFullReportFromDimensions() 依次拼接三个章节
→ 导出报告中"核心判断提炼"4 次、"情景展望"4 次、"差异化行动建议"4 次
```

### 2.4 根因 R4：引用质量无门控

**代码链路**: 证据从搜索结果直接进入 `DimensionAnalysisInput.evidence[]`，无中间过滤层。

- `astrogeology.usgs.gov/pygeoapi//llm-stats.com/` — 搜索引擎重定向 URL 未被识别
- `vertu.com/lifestyle/` — 奢侈品手机品牌生活方式频道
- `ctcd.edu/sites/myctcd/discover/` — 社区学院门户转载 Medium 文章
- 同一 URL 不同 query params 被当作不同来源（去重仅精确匹配）

### 2.5 根因 R5：图表导出空白

**代码位置**: `html-capture.service.ts:249-300`

```typescript
// 克隆 recharts SVG
const origSvg = wrapper.querySelector("svg.recharts-surface");
const svgClone = origSvg.cloneNode(true);
```

**因果链**:

```
recharts ResponsiveContainer 基于容器宽度动态渲染
→ 导出时如果容器不可见（隐藏 tab/面板），SVG 内容为空
→ cloneNode(true) 克隆空 SVG
→ 导出 HTML 中图表区域空白，仅存 legend 图标 (14x14px)
→ sr-only 数据表格保留但被 CSS 隐藏
```

**图表数据浅薄**: prompt 要求"至少 3 个精确数据点"，但 AI 生成阶段和收集阶段均无最低数据点校验，2 个数据点的图表也通过。

### 2.6 根因 R6：分割线过密

**代码位置**: `report-synthesis.service.ts:1043-1063`

```typescript
parts.push(`## ${labels.crossDimension}\n`);
parts.push(stripLeadingHeading(sc.crossDimensionAnalysis));
parts.push("\n---\n"); // 每个章节后都硬编码 ---
```

7 个维度 + 5 个补充章节 = 12+ 条分割线（由代码注入），AI 在 `detailedContent` 内部还可能自行生成更多 `---`。

---

## 3. 方案设计

### 3.1 设计原则

1. **Prompt 常量模块化**：所有写作规范抽取为 `prompts/report-writing-standards.constants.ts` 常量模块，与 prompt 模板分离，便于独立迭代
2. **可量化约束**：每条规范配备数值上限/下限，支持后处理自动检测
3. **对标 SOTA**：每条改进有明确的业界对标依据
4. **渐进式落地**：4 个 Phase，Phase 1 零代码风险
5. **共享逻辑抽取**：两个 service 的重复代码统一到 utils

### 3.2 写作规范模块化架构

> **设计决策**：写作规范是给**产品 LLM** 用的 prompt 指令，不是给 Claude Code 用的开发 skill。因此放在 `prompts/` 目录下作为 TypeScript 常量模块，而非 `.claude/skills/`。

```
backend/src/modules/ai-app/topic-insights/
  prompts/
    report-writing-standards.constants.ts   ← 新增：写作规范常量模块
    dimension-research.prompt.ts  ← 修改：引用规范常量
    report-synthesis.prompt.ts    ← 修改：引用规范常量
    consistency-check.prompt.ts   ← 修改：同步更新写作风格指令
  utils/
    report-formatting.utils.ts    ← 新增：共享格式化逻辑
```

**Prompt 引用方式**:

```typescript
// prompts/report-writing-standards.constants.ts
export const PROFESSIONAL_TONE = `## 文风规范\n...`;
export const FORMATTING_LIMITS = `## 格式元素限额\n...`;
export const CITATION_STANDARDS = `## 引用规范\n...`;
export const CHART_STANDARDS = `## 图表规范\n...`;
export const CHAPTER_HIGHLIGHTS = `## 章节要点速览\n...`;
export const ANALYSIS_DEPTH = `## 分析深度要求\n...`;
export const EXECUTIVE_SUMMARY_FORMAT = `## 执行摘要规范\n...`;
export const HEADING_HIERARCHY = `## 标题层级规范\n...`;

// dimension-research.prompt.ts 引用
import {
  PROFESSIONAL_TONE,
  FORMATTING_LIMITS,
  CITATION_STANDARDS,
  CHART_STANDARDS,
  CHAPTER_HIGHLIGHTS,
  ANALYSIS_DEPTH,
  HEADING_HIERARCHY,
} from "./report-writing-standards.constants";

// 在 prompt 模板中拼接
const prompt = `
${systemPrompt}

${HEADING_HIERARCHY}
${PROFESSIONAL_TONE}
${FORMATTING_LIMITS}
${CITATION_STANDARDS}
${CHART_STANDARDS}
${CHAPTER_HIGHLIGHTS}
${ANALYSIS_DEPTH}

## 输出格式
...
`;
```

**优势**：

- TypeScript 类型安全，IDE 可跳转
- 与现有 prompt 模式一致（纯字符串拼接）
- 未来如需 A/B 测试，可改为函数返回不同版本的字符串

### 3.3 Phase 1：Prompt 层改造（零代码风险）

#### 3.3.1 写作风格规范（`PROFESSIONAL_TONE`）

**当前 prompt**:

```
用"我们认为..."、"核心驱动力是..."表达分析判断
```

**改为**:

```markdown
## 文风规范

### 分析语气（第三人称为主，第一人称为辅）

- 数据呈现用第三人称陈述句："数据显示..."、"证据表明..."、"研究指出..."
- 独立判断用克制的第一人称：每个子节最多 1 次"我们认为"或"分析表明"
- 全文"我们认为/判断/看到"合计不超过 10 次
- 对标：McKinsey 用 "Our analysis shows"（低频），Stanford HAI 用第三人称

### 禁止清单

- 口语化表达：禁止"翻车"、"跑得起"、"压舱石"、"试金石"等
- 繁体中文字符：全文使用简体中文，禁止"無"、"與"等繁体字
- 套话开头：禁止"随着...的发展"、"在当今..."
- 箭头链：禁止使用 → 符号串联因果。用"这导致..."、"进而引发..."、"其结果是..."等自然语言表达

### 术语一致性

- 每个术语首次出现时标注英文原文，如：能力密度（Capability Density）
- 后续全文统一使用中文形式
- 禁止同一概念中英文随意切换
```

#### 3.3.2 格式元素限额（`FORMATTING_LIMITS`）

**当前 prompt**:

```
关键数据点用 **加粗** 标注
重要结论以 > 引用块突出
```

**改为**:

```markdown
## 格式元素限额（硬性约束）

对标来源：McKinsey 3-5 bold/页，Nature Reviews max 7 展示项/篇

### 加粗（**bold**）

- 每个子节（### 标题下）最多 2 处加粗
- 仅加粗核心判断性语句（如"开源模型已逼近闭源 90% 性能"）
- 禁止加粗：单独的数字/百分比/倍数（如 ~~**68倍**~~、~~**25%**~~）
- 禁止加粗：整句（超过 30 字的内容不应整体加粗）
- 加粗文本应构成"扫描层"：读者仅看加粗内容即可获取核心论点

### 引用块（> blockquote）

- 全文（含所有维度）最多 10-15 个引用块
- 每个维度最多 2 个引用块
- 每个引用块不超过 150 字
- 仅用于：该维度最核心的 1 个判断 + 该维度最关键的 1 个数据发现
- 禁止每段结尾都加引用块总结

### 分割线（---）

- 禁止在 detailedContent 中使用 ---
- 章节分隔由标题层级自动实现

### 列表

- 有序列表统一 1. 2. 3.（阿拉伯数字），禁止中文数字
- 无序列表统一 - （短横线）
- 列表项不超过 2 层嵌套
```

#### 3.3.3 根因分析框架改造（`ANALYSIS_DEPTH`）

**当前 prompt**:

```
## 根因分析框架（每个核心论点必须包含）
1. 现象层 2. 机制层 3. 结构层 4. 启示层
```

**改为**:

```markdown
## 分析深度要求

每个关键论点必须回答"为什么"至少深入两层，但不要套用固定模板。

可选分析框架（根据内容特点灵活选择，不必每个论点都套用）：

- 现象-机制-影响：适用于技术趋势分析
- 数据-对比-判断：适用于市场格局分析
- 现状-瓶颈-路径：适用于挑战与机会分析

禁止：对每个话题都机械套用"现象层→机制层→结构层→启示层"四层结构。
```

#### 3.3.4 标题层级规范（`HEADING_HIERARCHY`）

**新增 prompt 指令**（配合 Phase 2 代码改造）：

```markdown
## 标题层级规范

你的内容将嵌入在 `## 维度名` 下方，因此：

- 子章节使用 `###` 三级标题（如 ### 背景概述、### 现状分析）
- 子子章节使用 `####` 四级标题（如 #### 竞争格局）
- 禁止使用 `#` 一级标题和 `##` 二级标题（这两级由报告框架控制）
- 禁止使用 `#####` 及更深层级

层级规则：最多 2 级（### 和 ####），章节结构靠内容组织而非标题嵌套。
```

#### 3.3.5 引用质量指令（`CITATION_STANDARDS`）

```markdown
## 引用规范

### 引用分布

- 每个子节应引用至少 2 个不同来源
- 单一来源在全文中被引用不超过 5 次
- 如发现某来源被反复使用，检查是否有替代来源

### 引用密度

- 对标：学术综述 ~25 引用/千字，行业报告 ~10 引用/千字
- 目标：每千字 10-15 处引用，均匀分布
- 禁止连续引用 3 个以上相同来源编号

### 来源权威性

- 优先引用：学术期刊、官方技术博客、权威行业报告
- 谨慎引用：新闻转载、社区讨论、个人博客
- 数据类引用必须标注具体来源页码或章节
```

#### 3.3.6 图表数据标准（`CHART_STANDARDS`）

```markdown
## 图表规范

对标来源：McKinsey 1 展示项/1.5-2 页，Nature max 5-6 展示项/篇

### 数据点要求（按图表类型区分）

- 柱状图（bar）：最少 3 个数据点
- 折线图（line/area）：最少 5 个数据点
- 饼图（pie）：最少 3 个扇区
- 散点图/雷达图（radar）：最少 10 个数据点
- 2 个数据点的对比改用行内文字或表格呈现

### 图表标题

- 标题必须是完整的发现性句子（对标 McKinsey 标准）
  - 正确："开源模型参数规模在 2024-2026 年稳定在 120B-235B 区间"
  - 错误："典型LLM参数规模演进（示意）"
- 禁止标题中出现"示意"、"概念"、"定性对比"等弱化词

### 数量限制

- 每个维度最多 2 个图表
- 全文最多 12-14 个图表（含引用图 + 生成图）
```

#### 3.3.7 执行摘要改造（`EXECUTIVE_SUMMARY_FORMAT`）

**当前 prompt**:

```
executiveSummary.fullText: 400-600 字
```

**改为**:

```markdown
## 执行摘要（对标 McKinsey SCR 框架）

### 结构（严格按顺序）

1. **核心论断**（1 句话，30 字以内，加粗）：全文最重要的单一结论
2. **背景**（2-3 句）：研究范围和时间窗口
3. **核心发现**（3-5 条，编号列表）：每条 1-2 句话，加粗要点句
4. **关键指标**（表格）：指标名 | 数值 | 来源
5. **风险预警**（2-3 条，编号列表）：每条 1 句话
6. **行动建议**（3 条，按角色）：每条 1 句话

### 约束

- 总长度 400-600 字
- 核心发现每条加粗第一句（判断句），第二句不加粗（数据支撑）
- 必须独立可读：不读全文也能获取核心信息
- 禁止使用引用块
```

#### 3.3.8 章节要点速览（`CHAPTER_HIGHLIGHTS`）

**新增 prompt 指令**:

```markdown
## 章节要点速览（每个维度 detailedContent 开头必须包含）

在 detailedContent 最开头，第一个 ### 标题之前，插入一个引用块作为本章要点速览：

> **本章要点**
>
> - 要点 1：一句话核心发现（含关键数据）
> - 要点 2：一句话核心发现
> - 要点 3：一句话核心发现

约束：

- 3-5 条要点，每条不超过 30 字
- 这是全文中该维度唯一允许的"开头引用块"
- 对标 Stanford HAI 的 Chapter Highlights 模式
```

#### 3.3.9 `consistency-check.prompt.ts` 配套更新

一致性检查 prompt 也包含写作风格指令，需同步引用 `PROFESSIONAL_TONE` 和 `FORMATTING_LIMITS`，确保一致性检查与维度研究使用相同规范。

### 3.4 Phase 2：组装逻辑修复

#### 3.4.1 共享格式化逻辑抽取

**新增文件**: `utils/report-formatting.utils.ts`

> **设计决策**：`report-synthesis.service.ts` 和 `report-generator.service.ts` 有完全相同的标题处理、编号、去重逻辑（各自的 private method）。抽取为共享 utils，避免改一处漏一处。

```typescript
// utils/report-formatting.utils.ts

/**
 * 标题层级安全网：将 AI 不应使用的 # 和 ## 降级到 ###，保留 ###/#### 不变。
 * 配合 prompt 中"禁止使用 # 和 ##"指令，这里是异常兜底。
 */
export function sanitizeHeadingLevels(content: string): string {
  return content.replace(/^(#{1,2})\s+/gm, () => {
    // # 和 ## 都降级为 ###（AI 不应在 detailedContent 中使用这两级）
    return "### ";
  });
  // ### 和 #### 保持原样，由 numberSubHeadings 处理
  // ##### 及以下不应出现（prompt 已禁止），如出现则保持原样
}

/**
 * 给维度子标题添加层级编号。
 * ### Title → ### N.M. Title
 * #### Title → #### N.M.K. Title
 */
export function numberSubHeadings(content: string, dimIndex: number): string {
  let h3Count = 0;
  let h4Count = 0;

  return content.replace(
    /^(#{3,4})\s+(.+)$/gm,
    (_match, hashes: string, title: string) => {
      const cleanTitle = title
        .replace(/^[\d.]+\s*/, "")
        .replace(/^[一二三四五六七八九十百]+[、．.]\s*/, "")
        .replace(/^（[一二三四五六七八九十百\d]+）\s*/, "")
        .trim();

      if (hashes === "###") {
        h3Count++;
        h4Count = 0;
        return `### ${dimIndex}.${h3Count}. ${cleanTitle}`;
      }
      if (hashes === "####") {
        if (h3Count === 0) h3Count = 1;
        h4Count++;
        return `#### ${dimIndex}.${h3Count}.${h4Count}. ${cleanTitle}`;
      }
      return `${hashes} ${title}`;
    },
  );
}

/**
 * 跨维度段落去重：前 DEDUP_KEY_LENGTH 字符相同的段落只保留首次出现。
 */
export function deduplicateParagraphs(
  content: string,
  globalSeenParagraphs: Set<string>,
): string {
  const DEDUP_MIN_LENGTH = 60;
  const DEDUP_KEY_LENGTH = 120;
  const paragraphs = content.split("\n\n");

  return paragraphs
    .filter((p) => {
      const trimmed = p.trim();
      if (trimmed.length < DEDUP_MIN_LENGTH) return true;
      if (/^(#|<!--|[-*>|])/.test(trimmed)) return true;
      const key = trimmed.substring(0, DEDUP_KEY_LENGTH);
      if (globalSeenParagraphs.has(key)) return false;
      globalSeenParagraphs.add(key);
      return true;
    })
    .join("\n\n");
}
```

两个 service 文件统一调用这些 utils，删除各自的 private 副本。

#### 3.4.2 标题层级修复

**方案：Prompt 源头控制 + 安全网兜底（方案 C + 安全网）**

> **设计决策**：不再对 AI 输出做全量 +2 提升。改为 prompt 明确告诉 AI 使用 ### 和 ####，安全网仅处理 AI 违规输出的 #/##。

**代码变更**（`report-synthesis.service.ts:901-906` 和 `report-generator.service.ts:522-527`）：

```typescript
// 旧代码：全量 +2
content = content.replace(/^(#{1,6})\s+/gm, (_match, hashes: string) => {
  const newLevel = Math.min(hashes.length + 2, 6);
  return "#".repeat(newLevel) + " ";
});

// 新代码：调用共享 utils
import {
  sanitizeHeadingLevels,
  numberSubHeadings,
  deduplicateParagraphs,
} from "../../utils/report-formatting.utils";
// ...
content = sanitizeHeadingLevels(content);
```

**`numberSubHeadings` 保持不变**（匹配 `#{3,4}` 正好对应），改为调用共享 utils。

**最终层级映射**:

| Markdown 源 | 来源                         | 最终 HTML | 视觉角色                         |
| ----------- | ---------------------------- | --------- | -------------------------------- |
| `#`         | 报告标题（代码生成）         | h1        | 报告标题（唯一）                 |
| `##`        | 大章节（代码生成）           | h2        | 维度名/执行摘要/跨维度分析等     |
| `###`       | AI 子节标题（prompt 指定）   | h3        | 维度内子节（编号为 1.1, 2.3 等） |
| `####`      | AI 子子节标题（prompt 指定） | h4        | 维度内子子节（编号为 1.1.1 等）  |
| `#`/`##`    | AI 异常输出（安全网捕获）    | h3        | 降级为 ###                       |

#### 3.4.3 结论去重

**方案：仅改 prompt 指令，不改 JSON schema**

> **设计决策**：不修改 `conclusion`/`scenarioOutlook`/`strategicRecommendations` 的 JSON schema 结构。改 schema 会影响前端渲染和旧数据兼容。通过 prompt 消除语义重叠即可。

**Prompt 变更**（`report-synthesis.prompt.ts:65`）：

```typescript
// 旧 prompt：
"conclusion": "结束语（800-1200字，必须用 ### 三级标题分段，包含：### 核心判断提炼、### 情景展望、### 差异化行动建议）"

// 新 prompt：
"conclusion": "结束语（300-500字，纯段落文本，不使用子标题。总结全文核心判断，展望研究主题的未来走向。禁止包含情景展望（已在 scenarioOutlook 中）和行动建议（已在 strategicRecommendations 中）。禁止与其他字段内容重复。）"
```

**User prompt 变更**（`report-synthesis.prompt.ts:153-156`）：

```typescript
// 旧 prompt：
**7. 结束语（800-1200字）**
- 核心判断提炼（不是复述执行摘要）
- 情景展望：基准情景 / 乐观情景 / 悲观情景
- 差异化行动建议（按角色分段）

// 新 prompt：
**7. 结束语（300-500字）**
- 纯段落文本，不使用子标题
- 总结全文核心判断（不是复述执行摘要，要有新的综合视角）
- 展望研究主题的未来走向（1-2句，不展开情景分析）
- 禁止包含情景展望（已由 scenarioOutlook 字段覆盖）
- 禁止包含行动建议（已由 strategicRecommendations 字段覆盖）
```

#### 3.4.4 分割线移除

```typescript
// report-synthesis.service.ts
// 移除所有 parts.push("\n---\n")
// 章节间仅靠 ## 标题分隔
```

### 3.5 Phase 3：质量门控

#### 3.5.1 Evidence URL 规范化（新增）

**新增文件**: `utils/evidence-filter.utils.ts`

> **设计决策**：不使用域名黑名单（误伤风险高，维护成本大）。聚焦 URL 规范化去重 + 低可信度过滤。

```typescript
interface EvidenceFilterResult {
  passed: TopicEvidence[];
  filtered: { evidence: TopicEvidence; reason: string }[];
}

function filterEvidence(evidence: TopicEvidence[]): EvidenceFilterResult {
  const passed: TopicEvidence[] = [];
  const filtered: { evidence: TopicEvidence; reason: string }[] = [];

  // 1. URL 规范化去重（去除 query params、fragment、trailing slash 后比较）
  const seenNormalizedUrls = new Set<string>();

  for (const e of evidence) {
    const normalizedUrl = normalizeUrl(e.url);

    // 2. 重定向 URL 检测（URL path 中嵌套了另一个完整 URL）
    if (isWrappedRedirectUrl(e.url)) {
      filtered.push({ evidence: e, reason: "Wrapped redirect URL detected" });
      continue;
    }

    // 3. URL 规范化去重
    if (seenNormalizedUrls.has(normalizedUrl)) {
      filtered.push({ evidence: e, reason: `Duplicate of ${normalizedUrl}` });
      continue;
    }
    seenNormalizedUrls.add(normalizedUrl);

    // 4. 低可信度过滤（credibilityScore < 30 的证据降级）
    if (e.credibilityScore !== null && e.credibilityScore < 30) {
      filtered.push({
        evidence: e,
        reason: `Low credibility: ${e.credibilityScore}`,
      });
      continue;
    }

    passed.push(e);
  }

  return { passed, filtered };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.search = "";
    u.hash = "";
    return u.href.replace(/\/+$/, "");
  } catch {
    return url;
  }
}

function isWrappedRedirectUrl(url: string): boolean {
  // 检测 path 中是否嵌套了完整 URL（搜索引擎重定向特征）
  try {
    const u = new URL(url);
    return /https?:\/\//.test(u.pathname);
  } catch {
    return false;
  }
}
```

#### 3.5.2 报告后处理管道（新增）

**新增方法**: `report-synthesis.service.ts` → `postProcessReport()`

> **设计决策**：Phase 1 仅做检测+日志（warning 模式），不自动修改内容。先通过 prompt 改造从源头减少问题，观察效果后再决定是否自动修复。

```typescript
interface PostProcessResult {
  content: string;
  warnings: string[];
}

private postProcessReport(markdown: string): PostProcessResult {
  const warnings: string[] = [];

  // 1. 统计加粗数量
  const boldCount = (markdown.match(/\*\*[^*]+\*\*/g) || []).length;
  if (boldCount > 80) warnings.push(`Bold count ${boldCount} exceeds limit 80`);

  // 2. 统计 blockquote 数量
  const blockquoteCount = (markdown.match(/^>/gm) || []).length;
  if (blockquoteCount > 15) warnings.push(`Blockquote count ${blockquoteCount} exceeds limit 15`);

  // 3. 统计"我们认为/判断"数量
  const weThinkCount = (markdown.match(/我们(认为|判断|看到)/g) || []).length;
  if (weThinkCount > 10) warnings.push(`"我们认为" count ${weThinkCount} exceeds limit 10`);

  // 4. 统计箭头链数量
  const arrowCount = (markdown.match(/→/g) || []).length;
  if (arrowCount > 5) warnings.push(`Arrow chain count ${arrowCount} exceeds limit 5`);

  // 5. 统计 h5/h6 标签（不应存在）
  const deepHeadingCount = (markdown.match(/^#{5,6}\s+/gm) || []).length;
  if (deepHeadingCount > 0) warnings.push(`Deep headings (h5/h6) count ${deepHeadingCount}, should be 0`);

  // 6. 移除多余的 --- 分割线（安全操作，不影响内容）
  let content = markdown.replace(/\n---\n/g, '\n\n');

  // Phase 1: 仅 warning，不自动修改加粗/引用块
  // Phase 3 后续迭代：如果 prompt 改造效果不够，再加自动剥离规则

  if (warnings.length > 0) {
    this.logger.warn(`[postProcess] Quality warnings:\n${warnings.join('\n')}`);
  }

  return { content, warnings };
}
```

#### 3.5.3 图表数据校验

> **设计决策**：校验在生成阶段（prompt 按类型指定最低数据点）和渲染阶段（前端 fallback），收集阶段不 skip 图表（避免占位符残留）。

**Prompt 层**（已在 3.3.6 覆盖）：按图表类型指定最低数据点。

**前端渲染层**（Phase 4）：数据点不足的图表渲染为表格 fallback。

```typescript
// 前端 ChartRenderer 组件
if (chart.data.length < getMinDataPoints(chart.type)) {
  return <DataTable data={chart.data} title={chart.title} />;
}
```

**收集阶段**：保留所有图表，但标记 warning。

```typescript
// report-synthesis.service.ts - collectAllCharts() 中
const minPoints = getMinDataPoints(chart.type);
if (chart.data && chart.data.length < minPoints) {
  this.logger.warn(
    `Chart "${chart.title}" has only ${chart.data.length} data points (min: ${minPoints} for ${chart.type})`,
  );
  // 不 skip，保留图表，前端 fallback 为表格
}
```

### 3.6 Phase 4：导出增强

#### 3.6.1 SVG 冻结增强

```typescript
// html-capture.service.ts - freezeRecharts()
// 增加：克隆前检测 SVG 是否有有效内容
private freezeRecharts(container: HTMLElement, clone: HTMLElement) {
  const wrappers = container.querySelectorAll('.recharts-wrapper');
  const cloneWrappers = clone.querySelectorAll('.recharts-wrapper');

  wrappers.forEach((wrapper, i) => {
    const origSvg = wrapper.querySelector('svg.recharts-surface');
    if (!origSvg || origSvg.children.length < 3) {
      // 空 SVG 回退：将 sr-only 数据表格改为可见
      const srTable = cloneWrappers[i]?.querySelector('.sr-only');
      if (srTable) srTable.classList.remove('sr-only');
      return;
    }
    // ... 现有 SVG 克隆逻辑
  });
}
```

#### 3.6.2 导出 HTML 精简

- 移除 `data-export-exclude` 的交互元素
- 引注上标样式简化：移除 `cursor-pointer`、hover 效果
- CSS 变量内联解析：`var(--radius)` → 实际值

---

## 4. 前置调研项（实施前必须确认）

### 4.1 前端 scenarioOutlook 使用位置

结论去重方案不改 JSON schema，但需确认前端是否有组件直接读取 `conclusion` 字段并按子标题解析。

**待 grep 确认**：

- `scenarioOutlook` 在前端的使用位置
- `conclusion` 在前端的渲染方式
- `strategicRecommendations` 的前端解析逻辑

### 4.2 `sanitizeReport()` 功能确认

`report-synthesis.service.ts:1072` 调用 `this.teamFacade.sanitizeReport()`，需确认其是否已有部分后处理功能（如分割线清理、格式规范化），避免与新增的 `postProcessReport()` 重复。

### 4.3 旧报告兼容

明确策略：**所有改动仅影响新生成的报告**。已存储的 `detailedContent` 和 synthesis JSON 不受影响，旧报告重新渲染时使用原始数据。

---

## 5. 评审决策记录

### 5.1 已裁定的设计决策

| #   | 决策项            | 裁定                                                                      | 理由                                         |
| --- | ----------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| D1  | 标题层级方案      | **方案 C + 安全网**（Prompt 指定 ###/####，安全网将异常 #/## 降级为 ###） | 从源头控制层级，安全网仅兜底异常             |
| D2  | 写作规范存放位置  | **`prompts/report-writing-standards.constants.ts`**（TypeScript 常量模块）          | 产品 LLM prompt 指令，不是 Claude Code skill |
| D3  | 结论去重方式      | **仅改 prompt，不改 JSON schema**                                         | 避免前端兼容问题和旧数据迁移                 |
| D4  | 加粗自动剥离      | **Phase 1 仅 warning，不自动修改**                                        | 先靠 prompt 改善，观察效果后再决定           |
| D5  | 四层分析框架      | **改为可选框架**，保留深度要求但去除强制模板                              | 完全去除会失去分析深度指导                   |
| D6  | Evidence 过滤策略 | **URL 规范化 + credibilityScore < 30 过滤**，不用域名黑名单               | 域名黑名单误伤大、维护成本高                 |
| D7  | 图表最低数据点    | **按图表类型区分**（柱 3+、线 5+、饼 3+、散 10+）                         | 不同图表类型对数据量要求不同                 |
| D8  | 图表校验位置      | **生成阶段 prompt 约束 + 渲染阶段 fallback**，收集阶段不 skip             | 避免占位符残留                               |
| D9  | 重复代码处理      | **抽取 `report-formatting.utils.ts`** 共享 utils                          | 两个 service 相同逻辑需统一维护              |

### 5.2 SOTA 对标验证

| 检查项     | 通过标准                                    | 验证方法                                                     |
| ---------- | ------------------------------------------- | ------------------------------------------------------------ |
| 加粗密度   | 每节 ≤2 处，全文 ≤80 处                     | 后处理管道 warning                                           |
| 标题层级   | h1(1) + h2(≤15) + h3(主力) + h4(少量)，h5=0 | 后处理管道 warning + 导出 HTML tag 计数                      |
| 引用块     | 全文 ≤15 个                                 | 后处理管道 warning                                           |
| 图表数据点 | 按类型：柱 ≥3、线 ≥5、饼 ≥3、散 ≥10         | collectAllCharts warning                                     |
| 主观表达   | "我们认为" ≤10 次                           | 后处理管道 warning                                           |
| 术语一致性 | 同一概念全文统一                            | 人工抽检                                                     |
| 执行摘要   | SCR 结构，≤600 字                           | 结构化字段校验                                               |
| 章节要点   | 每维度开头有 3-5 条要点                     | 正则检测 `> **本章要点**`                                    |
| 结论重复   | 0 次重复内容                                | 人工对比 conclusion/strategicRecommendations/scenarioOutlook |

### 5.3 回归风险评估

| 变更                  | 回归风险                          | 缓解措施                               |
| --------------------- | --------------------------------- | -------------------------------------- |
| Prompt 文本修改       | 低：AI 输出变化，但不影响代码逻辑 | 生成 2-3 个测试报告对比                |
| 标题层级安全网替换 +2 | 中：影响所有新生成报告            | 单元测试覆盖各种 AI 输出场景           |
| 结论 prompt 修改      | 低：仅改指令文本                  | 验证新报告 conclusion 不再包含情景展望 |
| 分割线移除            | 低：纯文本变化                    | 无                                     |
| Evidence 过滤         | 低：过滤后证据减少，不影响生成    | 保留过滤日志，可手动恢复               |
| SVG 冻结增强          | 低：仅影响导出                    | 保留现有逻辑作 fallback                |
| 后处理管道            | 低：Phase 1 仅 warning            | 不影响输出内容                         |
| Utils 抽取            | 低：纯重构，逻辑不变              | 单元测试确认行为一致                   |

---

## 6. 实施计划

### Phase 1：Prompt 改造 + 写作规范模块化

| 任务                              | 文件                                   | 类型 |
| --------------------------------- | -------------------------------------- | ---- |
| 创建写作规范常量模块              | `prompts/report-writing-standards.constants.ts`  | 新增 |
| 改造 dimension-research.prompt.ts | `prompts/dimension-research.prompt.ts` | 修改 |
| 改造 report-synthesis.prompt.ts   | `prompts/report-synthesis.prompt.ts`   | 修改 |
| 同步 consistency-check.prompt.ts  | `prompts/consistency-check.prompt.ts`  | 修改 |

**测试**：生成 2-3 个不同主题的测试报告，对比改进前后的格式指标。

### Phase 2：组装逻辑修复 + 重构

| 任务                    | 文件                                          | 类型 |
| ----------------------- | --------------------------------------------- | ---- |
| 创建共享格式化 utils    | `utils/report-formatting.utils.ts`            | 新增 |
| 替换标题层级逻辑        | `services/report/report-synthesis.service.ts` | 修改 |
| 替换标题层级逻辑        | `services/report/report-generator.service.ts` | 修改 |
| 移除分割线注入          | `services/report/report-synthesis.service.ts` | 修改 |
| 前端影响调研            | grep scenarioOutlook/conclusion 前端使用      | 调研 |
| sanitizeReport 功能确认 | 确认 teamFacade.sanitizeReport 功能           | 调研 |

**测试**：

- `numberSubHeadings` 单元测试（各种 AI 输出场景）
- `sanitizeHeadingLevels` 单元测试（含 #, ##, ###, ####, #####）
- `deduplicateParagraphs` 单元测试

### Phase 3：质量门控

| 任务                       | 文件                                          | 类型     |
| -------------------------- | --------------------------------------------- | -------- |
| Evidence URL 规范化过滤    | `utils/evidence-filter.utils.ts`              | 新增     |
| 后处理管道（warning 模式） | `services/report/report-synthesis.service.ts` | 新增方法 |
| 图表数据点 warning         | `services/report/report-synthesis.service.ts` | 修改     |

**测试**：

- Evidence 过滤单元测试（重定向 URL、低分、去重）
- 后处理管道单元测试（各指标检测）

### Phase 4：导出增强

| 任务                    | 文件                                               | 类型 |
| ----------------------- | -------------------------------------------------- | ---- |
| SVG 冻结增强            | `frontend/lib/utils/html-capture.service.ts`       | 修改 |
| 图表不足数据点 fallback | `frontend/components/topic-insights/ChartRenderer` | 修改 |
| CSS 精简                | `frontend/lib/utils/html-capture.service.ts`       | 修改 |

---

## 7. 验收标准

使用相同主题（"基础大模型技术发展趋势"）重新生成报告，对比改进前后：

| 指标              | 改进前        | 目标                        |
| ----------------- | ------------- | --------------------------- |
| h5 标签数量       | 182           | 0                           |
| h3 标签数量       | 5             | 占主体（60-80 个）          |
| 加粗处数量        | 313           | ≤80                         |
| blockquote 数量   | 98            | ≤15                         |
| "我们认为"次数    | 118           | ≤10                         |
| 箭头链 → 次数     | 14+           | 0                           |
| 分割线 `---` 数量 | 51            | 0                           |
| 结论重复章节      | 4x3=12 次重复 | 0                           |
| 图表可见性        | 0/12 可见     | 12/12 可见                  |
| 图表最低数据点    | 2             | 按类型：柱 ≥3、线 ≥5、饼 ≥3 |
| 异常引用 URL      | 3+            | 0                           |
| 章节要点速览      | 0             | 每维度 1 个                 |

---

## 附录 A：SOTA 对标详细数据

### A.1 加粗使用（来源：Nielsen Norman Group + McKinsey）

- 加粗文本占比不超过 30%
- McKinsey：每页 2-4 处加粗短语
- BCG："bold-bullet"结构 — 加粗句陈述判断，非加粗提供支撑

### A.2 标题层级（来源：Nature Reviews + Stanford HAI）

- Nature Reviews：最多 3 级标题，H3 以下不鼓励使用
- Stanford HAI（456 页）：3-4 级
- Gartner Magic Quadrant：2-3 级

### A.3 引用块（来源：Nature Reviews + McKinsey）

- Nature Reviews：全文最多 7 个展示项（图+表+框合计）
- McKinsey：每 1-2 页 1 个展示项
- 通用规则：每 2-3 页最多 1 个 callout

### A.4 图表（来源：Nature + McKinsey + OWOX）

- 柱状图：3-20 数据点
- 折线图：5+ 数据点
- 散点图：15+ 数据点
- 标题必须是发现性句子（McKinsey 标准）

### A.5 执行摘要（来源：McKinsey SCR + USC LibGuides）

- 占报告总长度 5-10%
- SCR 框架：Situation → Complication → Resolution
- 3-5 条编号/加粗核心发现
- 必须独立可读

### A.6 写作语气（来源：McKinsey/BCG/Stanford HAI/Nature）

- McKinsey/BCG：第一人称复数，"Our analysis shows"
- Stanford HAI：第三人称中立
- Nature Reviews：第三人称被动
- "We believe" 频率：全文 1-2 次

---

## 附录 B：受影响文件完整清单

| 文件                                               | Phase | 变更类型 |
| -------------------------------------------------- | ----- | -------- |
| `prompts/report-writing-standards.constants.ts`              | 1     | 新增     |
| `prompts/dimension-research.prompt.ts`             | 1     | 修改     |
| `prompts/report-synthesis.prompt.ts`               | 1     | 修改     |
| `prompts/consistency-check.prompt.ts`              | 1     | 修改     |
| `utils/report-formatting.utils.ts`                 | 2     | 新增     |
| `services/report/report-synthesis.service.ts`      | 2,3   | 修改     |
| `services/report/report-generator.service.ts`      | 2     | 修改     |
| `utils/evidence-filter.utils.ts`                   | 3     | 新增     |
| `frontend/lib/utils/html-capture.service.ts`       | 4     | 修改     |
| `frontend/components/topic-insights/ChartRenderer` | 4     | 修改     |

