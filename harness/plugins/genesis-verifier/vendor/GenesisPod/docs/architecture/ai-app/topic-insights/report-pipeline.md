# Topic Insights 报告生成管线 — 全链路基线文档

> 版本: 2.0 | 日期: 2026-03-16 | 维护者: Claude Code
> 基于代码 commit: `790ca01a2`

## 概览

Topic Insights 报告生成是一个多阶段、多 LLM 调用的管线，从用户创建话题到最终报告输出共 7 个环节。

**三道铁墙架构**：在管线中设置三道清理关卡，无论 LLM 输出什么内容，最终报告不会包含垃圾。

```
用户创建话题
    ↓
[环节1] Leader 规划维度
    ↓
[环节2] 多维度并行执行
    ├─ [2.1] 搜索 → evidence 收集
    ├─ [2.2] Leader 规划 outline（keyPoints, sections）
    ├─ [2.3] Section Writer 生成各章节
    │   ├─ extractContent() → 去除 markdown 代码块包装
    │   ├─ parseChartOutput() → 分离 markdown/JSON
    │   ├─ ★ 第一道铁墙: sanitizeSectionOutput() → 清理 JSON/元注释/指令泄漏
    │   ├─ QualityGate 检查/修复
    │   └─ Section revision（如需）
    ├─ [2.4] Leader 整合维度内容
    ├─ [2.5] 证据保存 + 引用重映射
    └─ [2.6] 分析结果转换
    ↓
[环节3] Report Synthesis（跨维度合成）
    ↓
[环节4] 报告组装 assembleFullReport
    ├─ processDimensionContent（每维度规范化）
    │   ├─ stripLeadingHeading
    │   ├─ stripChartJsonFromContent
    │   ├─ ★ 第二道铁墙: stripLeadingBulletLists() + sanitizeSectionOutput()
    │   ├─ formatDimensionContent（标题编号、去重、截断）
    │   └─ resolveChartPlaceholders（图片位置插入）← 在铁墙之后执行
    ├─ 拼接所有维度 + 补充内容
    └─ 参考文献生成
    ↓
[环节5] postProcessFinalReport 后处理
    ├─ 20+ 步格式修复
    └─ ★ 第三道铁墙: stripLeadingBulletLists() + sanitizeSectionOutput()
         + stripCitationStacking() + replaceMarketingLanguage()
    ↓
[环节6] outputReview 质量审查（只评分不修改）
    ↓
[环节7] 保存到数据库
```

---

## 铁墙架构详解

### 铁墙函数（`utils/sanitize-output.utils.ts`）

| 函数                         | 作用                                         | 策略                                      |
| ---------------------------- | -------------------------------------------- | ----------------------------------------- |
| `sanitizeSectionOutput()`    | 清理 JSON 残留、元注释、指令泄漏、错误图片等 | **黑名单过滤**：匹配已知的垃圾模式并删除  |
| `stripLeadingBulletLists()`  | 删除 H2/H3 标题后紧跟的 3+ bullet list       | **结构检测**：识别 heading → bullets 模式 |
| `stripCitationStacking()`    | 单句 3+ 连续引用 → 保留前 2 个               | **正则替换**                              |
| `replaceMarketingLanguage()` | 营销话术替换为中性表述                       | **正则替换**                              |

### `sanitizeSectionOutput` 黑名单规则

| 规则                   | 匹配模式                           | 示例                                   |
| ---------------------- | ---------------------------------- | -------------------------------------- |
| JSON 属性行            | `"key": value`（不含 5+ 中文字符） | `"figureId": "FIG-8"`                  |
| 孤立 JSON 符号         | `^[\]}{,]+$`                       | `}` `]`                                |
| 方括号元注释           | `[字数...] [图表...] [待定...]`    | `[字数约1520字]`                       |
| 字数统计行             | `字数统计：约N字`                  | `字数统计：约 1580 字`                 |
| 圆括号元注释           | `（注：...） （不含...）`          | `（注：本输出严格基于...）`            |
| 内部配置说明           | `以下是...图表/配置/引用`          | `**以下是本维度使用的图表引用配置**：` |
| Figure References 标签 | `Figure References [`              | `figureReferences [`                   |
| 错误图片格式           | `!(url)`                           | `!(https://example.com/img.png)`       |
| 裸 URL 行              | `^https://...`                     | 独立行的 URL                           |

### 三道铁墙执行位置

| 铁墙       | 执行位置                                              | 代码文件:行号                       | 输入                           |
| ---------- | ----------------------------------------------------- | ----------------------------------- | ------------------------------ |
| **第一道** | section-writer.service.ts parseChartOutput 之后       | section-writer.service.ts:336-337   | 单个 section 的 LLM 原始输出   |
| **第二道** | processDimensionContent resolveChartPlaceholders 之前 | report-assembler.service.ts:179-180 | 维度完整内容（含所有 section） |
| **第三道** | postProcessFinalReport 最后                           | report-assembler.service.ts:837-841 | 完整报告 markdown              |

**关键约束**：第二道铁墙必须在 `resolveChartPlaceholders` 之前执行，因为删除 bullets 会改变段落编号，影响图片插入位置。

---

## 环节详解

### 环节1: Leader 规划维度

| 项目        | 内容                                                                 |
| ----------- | -------------------------------------------------------------------- |
| **Service** | `services/core/leader/leader-planning.service.ts` → `planResearch()` |
| **Prompt**  | `prompts/research-leader.prompt.ts` → `LEADER_PLAN_PROMPT`           |
| **输入**    | topic name, description, type, language                              |
| **输出**    | `LeaderPlan { dimensions[], globalOutline }`                         |
| **铁墙**    | 无（低风险）                                                         |

### 环节2.1: 搜索阶段

| 项目        | 内容                                                                                  |
| ----------- | ------------------------------------------------------------------------------------- |
| **Service** | `services/dimension/dimension-search.service.ts`                                      |
| **输入**    | topic, dimension, searchQueries                                                       |
| **输出**    | `SearchPhaseResult { evidenceData[], figureRegistry }`                                |
| **清理**    | PDF URL 跳过抓取（search.service.ts）；无关来源标题关键词过滤（filterJunkReferences） |

### 环节2.2: Leader 规划 Outline

| 项目        | 内容                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| **Service** | `services/core/leader/leader-planning.service.ts` → `planDimensionOutline()`                          |
| **输出**    | `DimensionOutline { sections[{ title, description, keyPoints[], targetWords, allocatedFigures[] }] }` |
| **清理**    | `validateAllocatedFigures()` 校验图表 ID                                                              |

**keyPoints 数据流**:

```
Leader LLM → outline.sections[].keyPoints (字符串数组)
    ↓
section-writer.service.ts 行 149-159
    → 去除序号前缀 + 格式化为编号列表 "1. xxx\n2. yyy\n3. zzz"
    ↓
渲染到 SECTION_WRITING_USER_PROMPT_TEMPLATE 的 {{keyPoints}}
    → prompt 说明"以下方向应自然融入段落论述，不要在开头罗列"
    ↓
Section Writer LLM 生成内容
    → LLM 可能仍然输出 bullets（由铁墙清理）
```

### 环节2.3: Section Writer 生成章节 ★ 最高风险

| 项目        | 内容                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| **Service** | `services/dimension/section-writer.service.ts` → `writeSection()`       |
| **Prompt**  | 精简版（6 条正面规则，无禁止规则）                                      |
| **输出**    | `SectionWriteResult { content, figureReferences[], generatedCharts[] }` |

**Prompt 设计原则**：只保留 LLM 能遵守的正面指令，不再使用"禁止"规则。

当前写作风格规则（6 条）：

```
- 专业、客观、简洁
- 用具体数据和事实说话，用 [N] 格式引用证据
- 全文以段落论述为主体，每段 100-300 字
- 有序列表用 1. 2. 3. 格式，无序列表用 - 格式
- 段落中可适当使用加粗强调关键术语
- 禁止使用 HTML 标签、HTML 实体、伪代码
```

**LLM 输出处理链**：

````
LLM 原始输出
  ↓ extractContent() — 去除 ```markdown 包装
  ↓ parseChartOutput() — 分离 markdown 和 chart JSON
  ↓ ★ 第一道铁墙: sanitizeSectionOutput() — 清理垃圾行
  ↓ 内容长度检查（< minLength 则抛异常触发重试）
  ↓ 返回 SectionWriteResult
````

### 环节2.3.1: QualityGate 检查

| 项目         | 内容                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| **Service**  | `services/quality/report-quality-gate.service.ts` → `validateDimensionContent()` |
| **输入**     | 第一道铁墙清理后的 section content                                               |
| **调用位置** | `dimension-mission.service.ts` 行 1554                                           |

**QualityGate 职责（精简后）**：

- **格式规范化**：标题层级、分割线、加粗密度、引用块
- **清理**：stripLLMMetaNotes、stripInternalFigureNotation、stripChartJsonFromContent
- **检测并触发 rewrite**：数量声明不匹配、语言一致性、内容过短
- **自动删除**：裸 keyPoints（### 后 3+ bullets）、引用堆积（3+ → 保留前 2）、营销话术

**注意**：QualityGate 处理的是单个 section 内容。dimension 级别的 bullets 由第二道铁墙处理。

### 环节2.4: Leader 整合维度内容

| 项目        | 内容                                                                                |
| ----------- | ----------------------------------------------------------------------------------- |
| **Service** | `services/core/research/research-leader.service.ts` → `integrateDimensionResults()` |
| **输入**    | sectionResults[]                                                                    |
| **输出**    | `IntegratedDimensionResult { content, metadata { summary, keyFindings[] } }`        |
| **铁墙**    | ✅ `sanitizeSectionOutput()` on fullContent（所有 3 个返回路径）                    |

### 环节2.5: 证据保存 + 引用重映射

| 项目     | 内容                                      |
| -------- | ----------------------------------------- |
| **函数** | `saveEvidence()` + `replaceEvidenceIds()` |
| **作用** | `[promptIndex]` → `[dbCitationIndex]`     |
| **清理** | 无（纯数字替换）                          |

**引用编号体系**：

- 每个 section 的 evidence 通过 `filterEvidenceForSection` 过滤，保留 `promptIndex`（全局位置）
- `formatEvidenceForPrompt` 使用 `promptIndex` 编号（不再从 1 重新编号）
- `replaceEvidenceIds` 将 promptIndex 映射到 DB citationIndex

### 环节3: Report Synthesis

| 项目        | 内容                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Service** | `services/report/report-synthesis.service.ts` → `synthesizeReport()`                                                                    |
| **输出**    | `SupplementaryContent { preface, executiveSummary, crossDimensionAnalysis, riskAssessment, strategicRecommendations, conclusion }`      |
| **铁墙**    | ✅ `sanitizeSectionOutput()` on preface, executiveSummary, conclusion, crossDimensionAnalysis, riskAssessment, strategicRecommendations |

**补充内容独立存储**：crossDimensionAnalysis、riskAssessment、strategicRecommendations 作为 ComprehensiveReport 的独立字段，不再拼入 conclusion（防止重复）。

### 环节4: 报告组装

| 项目        | 内容                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| **Service** | `services/report/report-assembler.service.ts` → `assembleFullReport()` |
| **输入**    | topic, dimensionInputs[], supplementaryContent                         |

**processDimensionContent 管道**（当前实际执行顺序）：

```
1. stripLeadingHeading — 去除前导标题
2. stripChartJsonFromContent — 去除 Chart JSON
3. ★ 第二道铁墙:
   a. stripLeadingBulletLists — 删除 heading 后的裸 bullets
   b. sanitizeSectionOutput — 黑名单清理
4. formatDimensionContent（委托给共享管道）:
   a. sanitizeHeadingLevels
   b. deduplicateHeadings
   c. numberSubHeadings
   d. hierarchicalNumberBoldListItems
   e. deduplicateParagraphs
   f. 截断（MAX_DIMENSION_CHARS）
   g. resolveChartPlaceholders ← 在铁墙之后，段落编号正确
   h. stripInternalFigureNotation
   i. stripLLMMetaNotes
```

**图片位置规则**：

- `figureReferences[].position` 格式为 `"after_paragraph_N"`（1-based）
- `injectChartsByPosition` 扫描段落结束点（非空行后跟空行的位置）
- 在第 N 个段落结束点后插入 `<!-- chart:dimX-secY-figZ -->`
- 无明确位置时均匀分布

**参考文献生成**：

- 只包含 fullReport 中被 `[N]` 引用的来源
- `filterJunkReferences`：域名黑名单 + 标题关键词黑名单（biopolymer、microalgae 等）
- 标题截断 150 字
- 无访问日期

### 环节5: postProcessFinalReport

| 项目        | 内容                                                       |
| ----------- | ---------------------------------------------------------- |
| **Service** | `report-assembler.service.ts` → `postProcessFinalReport()` |

**处理步骤**（关键步骤）：

1. 移除残余 figure 占位符
2. stripInternalFigureNotation
3. stripLLMMetaNotes
4. repairTruncatedBlockquoteBullets
5. decodeHtmlEntities
6. repairBrokenListItems / clearBrokenMediaAndEmptyBlocks
7. repairMarkdownTables / ensureBlankLineAfterTables
8. splitWallOfText（拆分超长段落）
9. detectAndPromoteHeadings / deduplicateHeadingEcho
10. bold-only → ### 标题转换
11. 双重 ### 修复
12. 空引用 `[]` 清理
13. 三连空行压缩
14. wrapPseudoCodeBlocks / collapseExcessSubHeadings / removeEmptyHeadings
15. **★ 第三道铁墙**：
    - `stripLeadingBulletLists()` — 全文删除 heading 后裸 bullets
    - `sanitizeSectionOutput()` — 黑名单清理
    - `stripCitationStacking()` — 引用堆积拆分
    - `replaceMarketingLanguage()` — 营销话术替换

### 环节6-7: outputReview + 保存

- outputReview 通过 `generateChatCompletion` 统一走 Secret Manager 获取 API key
- 报告保存到 `topic_reports` 表的 `full_report` 字段

---

## 清理函数调用矩阵（当前实际状态）

| 清理函数                    | 第一道铁墙（section） | 第二道铁墙（dimension） | processDimContent | 第三道铁墙（report） |
| --------------------------- | --------------------- | ----------------------- | ----------------- | -------------------- |
| sanitizeSectionOutput       | ✅                    | ✅                      | —                 | ✅                   |
| stripLeadingBulletLists     | —                     | ✅                      | —                 | ✅                   |
| stripCitationStacking       | —                     | —                       | —                 | ✅                   |
| replaceMarketingLanguage    | —                     | —                       | —                 | ✅                   |
| stripChartJsonFromContent   | —                     | —                       | ✅                | —                    |
| stripLLMMetaNotes           | —                     | —                       | ✅×2              | ✅                   |
| stripInternalFigureNotation | —                     | —                       | ✅                | ✅                   |
| sanitizeHeadingLevels       | —                     | —                       | ✅                | —                    |
| numberSubHeadings           | —                     | —                       | ✅                | —                    |
| resolveChartPlaceholders    | —                     | —                       | ✅（在铁墙后）    | —                    |
| deduplicateParagraphs       | —                     | —                       | ✅                | —                    |
| bold-only → ###             | —                     | —                       | —                 | ✅                   |
| 双重 ### 修复               | —                     | —                       | —                 | ✅                   |
| 空引用清理                  | —                     | —                       | —                 | ✅                   |

---

## 铁墙覆盖完整性

所有环节均已集成铁墙清理，无遗漏：

| 环节                          | 清理函数                                                                                                                        | 状态      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 2.2 planDimensionOutline      | `stripLLMMetaNotes()` on section.description                                                                                    | ✅ 已集成 |
| 2.3 Section Writer            | `sanitizeSectionOutput()` — 第一道铁墙                                                                                          | ✅ 已集成 |
| 2.4 integrateDimensionResults | `sanitizeSectionOutput()` on fullContent                                                                                        | ✅ 已集成 |
| 3 normalizeReportResponse     | `sanitizeSectionOutput()` on preface/executiveSummary/conclusion/crossDimension/risk/strat                                      | ✅ 已集成 |
| 4 processDimensionContent     | `stripLeadingBulletLists()` + `sanitizeSectionOutput()` — 第二道铁墙                                                            | ✅ 已集成 |
| 5 postProcessFinalReport      | `stripLeadingBulletLists()` + `sanitizeSectionOutput()` + `stripCitationStacking()` + `replaceMarketingLanguage()` — 第三道铁墙 | ✅ 已集成 |

---

## API Key 解析架构

所有 LLM 调用统一通过 Secret Manager 获取 API key：

- `AiChatModelConfigService.getApiKeyForModel()` — 优先 secretKey → Secret Manager
- `ai_models.api_key` 明文字段已清空（migration `20260315_clear_plaintext_api_keys`）
- Facade 层 `getModelById()` / `getFullModelConfig()` 通过 `resolveApiKey()` 解析

---

_最后更新: 2026-03-16 v2.0_
