# Topic Insights 报告质量控制方案

> 版本: 1.0 | 日期: 2026-03-16 | 基于: topic-insights-report-pipeline.md

## 核心原则

1. **不信任任何 LLM 输出** — 每个 LLM 调用的输出都视为"脏数据"，必须经过清理才能传递到下一环节
2. **正面定义而非反面枚举** — 定义"什么是合格输出"，而非无穷地枚举"什么是不合格的"
3. **三道铁墙** — section 级、dimension 级、report 级各有一道清理关卡，任何垃圾最多穿透一道
4. **prompt 做减法** — 删除无效的禁止规则，回归简洁清晰的正面指令

---

## 逐环节质量控制

### 环节1: Leader 规划维度

**当前状态**: 低风险，无需修改

**输入**: 用户提供的 topic name/description
**输出**: dimensions[] with name, description, searchQueries

| 控制点   | 要求           | 现状             | 措施     |
| -------- | -------------- | ---------------- | -------- |
| 维度数量 | 3-8 个         | ✅ prompt 已约束 | 无需修改 |
| 维度命名 | 简洁，无元注释 | ✅ 正常          | 无需修改 |

---

### 环节2.1: 搜索阶段

**当前状态**: 中风险，evidence 质量影响下游

**输入**: dimension, searchQueries
**输出**: evidenceData[], evidenceSummary

| 控制点           | 要求                 | 现状                           | 措施                                                                             |
| ---------------- | -------------------- | ------------------------------ | -------------------------------------------------------------------------------- |
| evidence 相关性  | 与 topic 主题相关    | ❌ 有无关来源（Microalgae 等） | **措施 A1**: 在 `filterJunkReferences` 中增加标题关键词过滤（已实现）            |
| fullContent 质量 | 纯文本，无 HTML/JSON | ⚠️ 偶有残留                    | **措施 A2**: `enrichSearchResults` 后增加 `sanitizeFullContent()` 清理 HTML 标签 |
| PDF 处理         | 跳过不抓取           | ✅ 已实现                      | 无需修改                                                                         |

---

### 环节2.2: Leader 规划 Outline

**当前状态**: 中风险，keyPoints 和 description 是下游污染源之一

**输入**: topic, dimension, evidenceSummary
**输出**: outline.sections[{ title, description, keyPoints[], targetWords }]

| 控制点           | 要求               | 现状                               | 措施                                                                                |
| ---------------- | ------------------ | ---------------------------------- | ----------------------------------------------------------------------------------- |
| keyPoints 格式   | 短句，无序号前缀   | ✅ normalize 去序号前缀            | 已实现                                                                              |
| keyPoints 数量   | 3-6 个/section     | ✅ prompt 已约束                   | 无需修改                                                                            |
| description 内容 | 分析问题，无元注释 | ✅ 已集成 `stripLLMMetaNotes()`    | **措施 B2**: outline 解析后对每个 section.description 执行 `stripLLMMetaNotes()` ✅ |
| allocatedFigures | figureId 合法      | ✅ validateAllocatedFigures 已校验 | 无需修改                                                                            |

---

### 环节2.3: Section Writer 生成章节 ★ 最高风险

**当前状态**: 高风险，这是所有内容污染的主要源头

**输入**: keyPoints, evidenceData, previousSections, allocatedFigures
**输出**: markdown 正文 + 可选的 chart JSON

#### 控制策略: Prompt 简化 + 铁墙清理

**措施 C1: Prompt 回退到简洁版**

当前 prompt 有 20+ 条禁止规则，LLM 注意力被分散。回退策略：

| 保留的规则        | 删除的规则                                 |
| ----------------- | ------------------------------------------ |
| 专业客观简洁      | ~~禁止营销语气~~（改用后处理清理）         |
| 使用 [N] 引用格式 | ~~禁止原样输出要点列表~~（改用后处理删除） |
| 段落 100-300 字   | ~~数量声明必须准确~~（改用后处理检测）     |
| 禁止 HTML 标签    | ~~禁止泄漏内部指令~~（改用后处理清理）     |
| 禁止伪代码        | ~~禁止独占一行加粗~~（改用后处理转换）     |
| 禁止维度级总结    | ~~语句必须完整通顺~~（LLM 无法自检）       |
| 编号格式统一      | ~~每句最多2个引用~~（改用后处理拆分）      |

**原则**: prompt 只保留 LLM **能做到**的正面指令，所有**做不到**的禁止规则改用后处理兜底。

**措施 C2: keyPoints 格式**

回退到编号列表格式（LLM 理解更好），但在 prompt 中明确说明：

```
## 本节需要覆盖的分析方向
（以下方向应自然融入段落论述中，不要在文章开头罗列）
1. xxx
2. yyy
3. zzz
```

不再使用分号连接（LLM 不理解），也不再使用强制禁止语气（LLM 忽略禁止规则）。

**措施 C3: Section 级铁墙（第一道）**

在 `parseChartOutput` 之后、`validateDimensionContent` 之前，新增 `sanitizeSectionOutput()` 函数：

```typescript
function sanitizeSectionOutput(content: string): string {
  // 1. 删除任何含 "key": 的 JSON 行（不在代码块中）
  // 2. 删除孤立符号行 [ ] { } ,
  // 3. 删除 [字数...] [图表引用...] [待定] 等方括号元注释
  // 4. 删除 （注：...） （不含...） 等圆括号元注释
  // 5. 删除 "以下是..." 类内部说明行
  // 6. 删除 Figure References / figureReferences 文本行
  // 7. 删除 !(url) 格式的错误图片
  // 8. 压缩三连空行
  return cleaned;
}
```

**关键设计**: 这个函数不是按模式枚举，而是定义**合格行的白名单**：

- 中文段落（长度 > 10，含中文字符）
- 标题行（以 # 开头）
- bullet list 行（以 - \* • 开头，后跟中文）
- 编号列表行（以数字. 开头）
- 表格行（以 | 开头和结尾）
- chart 占位符（`<!-- chart:... -->`）
- 空行

**不在白名单中的行一律删除**。这比枚举黑名单更可靠，因为黑名单永远不完整。

---

### 环节2.3.2: QualityGate 检查

**当前状态**: 检查项多但有盲区

**控制策略**: 精简为核心检查，不再承担清理职责

| 检查项            | 类型     | 措施                                                              |
| ----------------- | -------- | ----------------------------------------------------------------- |
| 标题层级          | 自动修复 | 保留                                                              |
| 分割线            | 自动修复 | 保留                                                              |
| 加粗密度          | 自动修复 | 保留                                                              |
| 引用块            | 自动修复 | 保留                                                              |
| LLM meta 清理     | 自动修复 | **措施 D1**: 移到 sanitizeSectionOutput，QualityGate 不再重复清理 |
| 裸 keyPoints 删除 | 自动修复 | **措施 D2**: 移到 sanitizeSectionOutput                           |
| 引用堆积拆分      | 自动修复 | **措施 D3**: 移到 sanitizeSectionOutput                           |
| 营销话术          | 自动修复 | **措施 D4**: 移到 sanitizeSectionOutput                           |
| 数量声明不匹配    | rewrite  | **措施 D5**: 保留，触发 revision                                  |
| 语言一致性        | rewrite  | 保留                                                              |
| 内容过短          | rewrite  | 保留                                                              |

**原则**: QualityGate 只做两件事 — (1) 格式规范化（标题层级等）(2) 内容质量判断（触发 rewrite）。所有清理工作交给 sanitizeSectionOutput。

---

### 环节2.4: Leader 整合维度内容

**当前状态**: 中风险，keyFindings 可能以 bullet list 形式被拼入报告

**输入**: sectionResults[]
**输出**: integratedResult { content, metadata.keyFindings[] }

| 控制点           | 要求              | 现状                                | 措施                                                           |
| ---------------- | ----------------- | ----------------------------------- | -------------------------------------------------------------- |
| content 质量     | 各 section 已清理 | ✅ 已集成 `sanitizeSectionOutput()` | **措施 E1**: 3 个返回路径均已执行 `sanitizeSectionOutput()` ✅ |
| keyFindings 格式 | 字符串数组        | ✅                                  | 无需修改                                                       |

---

### 环节2.5: 引用重映射

**当前状态**: 低风险

| 控制点     | 要求                          | 现状                  | 措施     |
| ---------- | ----------------------------- | --------------------- | -------- |
| 映射正确性 | promptIndex → dbCitationIndex | ✅ 已修复 promptIndex | 无需修改 |
| 替换顺序   | 从大到小                      | ✅                    | 无需修改 |

---

### 环节3: Report Synthesis

**当前状态**: 中风险

**输入**: dimensionInputs[]
**输出**: supplementaryContent { preface, executiveSummary, crossDimensionAnalysis, ... }

| 控制点            | 要求                        | 现状                                | 措施                                                                                   |
| ----------------- | --------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------- |
| 每个补充内容质量  | 纯 markdown，无 JSON/元注释 | ✅ 已集成 `sanitizeSectionOutput()` | **措施 F1**: preface/executiveSummary/conclusion/crossDimension/risk/strat 均已清理 ✅ |
| conclusion 独立性 | 不含跨维度/风险/建议内容    | ✅ 已修复                           | 无需修改                                                                               |

---

### 环节4: 报告组装 ★ 第二道铁墙

**当前状态**: 高风险，keyFindings bullets 拼入时无清理

#### 控制策略: processDimensionContent 增强 + keyFindings 清理

**措施 G1: 清理 dimension 开头的 keyFindings bullets**

在 `assembleFullReport` 中，`## N. 维度名` 拼入后、`detailedContent` 拼入前：

```typescript
// 从 detailedContent 开头删除 keyFindings bullet list
let processed = processDimensionContent(dim.detailedContent, ...);
processed = stripLeadingBulletList(processed); // 新函数
parts.push(`## ${idx + 1}. ${dim.dimensionName}\n`);
parts.push(processed);
```

`stripLeadingBulletList`: 如果内容以 3+ 连续 bullet 行开头（空行后第一批 bullets），删除它们。

**措施 G2: 补充内容也经过清理**

`crossDimensionAnalysis`、`riskAssessment` 等补充内容在拼入前执行 `sanitizeSectionOutput()`。

**措施 G3: 参考文献质量**

- 标题截断 150 字（已实现）
- 无关标题关键词过滤（已实现）
- 只包含被引用的来源（已实现）
- 无访问日期（已实现）

---

### 环节5: postProcessFinalReport ★ 第三道铁墙（终极兜底）

**当前状态**: 步骤多但不够彻底

#### 控制策略: 增加终极清理

**措施 H1: 在所有现有步骤之后，增加 `finalSanitize()` 终极清理**

这是最后一道防线。遍历每一行，按白名单判断：

````typescript
function finalSanitize(content: string): string {
  const lines = content.split("\n");
  const cleaned = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inCodeBlock = !inCodeBlock;
      cleaned.push(line);
      continue;
    }
    if (inCodeBlock) {
      cleaned.push(line);
      continue;
    }

    const t = line.trim();

    // 白名单：这些行一定保留
    if (t === "") {
      cleaned.push(line);
      continue;
    } // 空行
    if (/^#{1,4}\s/.test(t)) {
      cleaned.push(line);
      continue;
    } // 标题
    if (/^<!--/.test(t)) {
      cleaned.push(line);
      continue;
    } // HTML 注释（chart 占位符）
    if (/^\|/.test(t)) {
      cleaned.push(line);
      continue;
    } // 表格行
    if (/^>\s/.test(t)) {
      cleaned.push(line);
      continue;
    } // 引用块
    if (/^---$/.test(t)) {
      cleaned.push(line);
      continue;
    } // 分隔线（参考文献前）
    if (/^\[\d+\]\s*\[/.test(t)) {
      cleaned.push(line);
      continue;
    } // 参考文献条目

    // 正文行：必须含中文或合理的英文文本
    if (t.length >= 10 && /[\u4e00-\u9fa5]/.test(t)) {
      // 中文段落或列表项
      cleaned.push(line);
      continue;
    }
    if (/^[-*•]\s+[\u4e00-\u9fa5]/.test(t)) {
      // 中文 bullet list
      cleaned.push(line);
      continue;
    }
    if (/^\d+\.\s+[\u4e00-\u9fa5]/.test(t)) {
      // 中文编号列表
      cleaned.push(line);
      continue;
    }

    // 不在白名单中 → 丢弃（记录日志）
    // 排除：短的英文标注行、JSON 残留、元注释、孤立符号等
  }

  return cleaned.join("\n");
}
````

**措施 H2: 裸 bullet list 全文清理**

在 `finalSanitize` 之前，扫描全文，删除任何 heading（H2 或 H3）后紧跟的 3+ bullet list：

```typescript
function stripAllLeadingBulletLists(content: string): string {
  // 匹配 ## 或 ### 标题后、第一个正文段落前的 bullet list
  // 无论是 H2 还是 H3 都处理
}
```

---

## 实施计划

### 阶段一: Prompt 简化（高优先）

| 编号 | 措施                         | 文件                           | 工作量 |
| ---- | ---------------------------- | ------------------------------ | ------ |
| C1   | 删除 prompt 中无效的禁止规则 | `dimension-research.prompt.ts` | 小     |
| C2   | keyPoints 回退到编号列表格式 | `section-writer.service.ts`    | 小     |

### 阶段二: 铁墙函数实现（核心）

| 编号 | 措施                                | 文件                                  | 工作量 |
| ---- | ----------------------------------- | ------------------------------------- | ------ |
| C3   | 实现 `sanitizeSectionOutput()`      | 新建 `utils/sanitize-output.utils.ts` | 中     |
| H1   | 实现 `finalSanitize()`              | `report-assembler.service.ts`         | 中     |
| H2   | 实现 `stripAllLeadingBulletLists()` | `report-assembler.service.ts`         | 小     |

### 阶段三: 管线集成

| 编号 | 措施                        | 集成位置                                                      | 工作量 |
| ---- | --------------------------- | ------------------------------------------------------------- | ------ |
| C3   | section 级铁墙              | `section-writer.service.ts` parseChartOutput 之后             | 小     |
| B2   | outline description 清理    | `leader-planning.service.ts` planDimensionOutline 之后        | 小     |
| E1   | 整合后清理                  | `dimension-mission.service.ts` integrateDimensionResults 之后 | 小     |
| F1   | synthesis 补充内容清理      | `report-synthesis.service.ts` normalizeReportResponse 中      | 小     |
| G1   | dimension 开头 bullets 清理 | `report-assembler.service.ts` assembleFullReport 中           | 小     |
| H1   | 终极兜底                    | `report-assembler.service.ts` postProcessFinalReport 最后     | 小     |

### 阶段四: 精简 QualityGate

| 编号  | 措施                     | 文件                             | 工作量 |
| ----- | ------------------------ | -------------------------------- | ------ |
| D1-D4 | 清理职责移出 QualityGate | `report-quality-gate.service.ts` | 小     |

### 阶段五: 验证

| 步骤 | 内容                                                     |
| ---- | -------------------------------------------------------- |
| 1    | 类型检查 + 单元测试                                      |
| 2    | 用数据库中 5 份历史报告的原始 LLM 输出测试 sanitize 函数 |
| 3    | 部署后等待新报告生成                                     |
| 4    | **逐段审读**数据库中的新报告，确认所有问题类型消失       |
| 5    | 将新报告中发现的异常模式补入防护网测试                   |

---

## 预期效果

| 问题类型        | 当前数量 | 预期                     |
| --------------- | -------- | ------------------------ |
| JSON 残留       | 0-10     | 0（铁墙白名单拦截）      |
| 裸 keyPoints    | 34       | 0（三层删除）            |
| 字数/指令泄漏   | 1-4      | 0（sanitize 白名单拦截） |
| 引用堆积        | 0-70     | 0（sanitize 拆分）       |
| 营销话术        | 0-2      | 0（sanitize 替换）       |
| 无关参考文献    | 5        | 0（标题关键词过滤）      |
| 空引用/孤立符号 | 0-5      | 0（sanitize 清理）       |

---

_最后更新: 2026-03-16_
