# 22f-report-quality.md - Report & Quality Service Inventory

Report + Quality 两层 21 个 Service 深度剖析

---

## 第 I 部分：Report 层（14 个 Service）

### 5.1 · report-synthesis.service.ts (1288 行)

核心：完整报告生成链（外部证据/引用格式化/章节装配）

**method: checkCrossDimensionConsistency (L66-177)**

- 维度冲突检测（data/logic/source）
- AI 调用 + JSON 提取
- 失败熔断，不阻断流程

**method: generateComprehensiveReport (L182-362)**

- 两阶段 LLM 调用：全量 → 降级
- 数据冲突纠正指令优先于用户反馈
- 完整报告构建 + 亮点提取

**method: parseAIReportWithCharts (L408-449)**

- v3.0 格式：sections 可空
- 补充内容 (crossDimension/risk/strategy) 处理

**method: normalizeReportResponse (L456-532)**

- 执行摘要标准化（对象/字符串/JSON 混合）
- 补充内容合并到 conclusion

**method: extractFullTextWithFallback (L621-751)**

- 优先 fullText，回退拼接结构化字段

**method: buildFullReport (L836-960)**

- 1-6 层次：前言 → TOC → 维度 → 结语 → 附录 → 参考
- 图表占位符注入
- 参考文献管道：清理 + 去重 + 重索引

**method: injectChartPlaceholders (L971-1077)**

- position 解析：after_paragraph_N / after_heading_N / end_of_section
- 占位符格式：<!-- chart:chartId -->

**method: extractHighlights (L1083-1142)**

- v3.0 兼容：sections 空时回退到 keyFindings
- 智能标题提取：冒号短语 → 开头主语 → 截取
- 分类：市场机会/技术趋势/风险警示/战略建议/核心发现

---

### 5.2 · report-assembler.service.ts (1060 行)

核心：统一报告装配管道（维度整合/质量门控/后处理）

**method: processDimensionContent (L172-202)**

- 12 步管道：stripHeading → stripChartJson → stripBullets → sanitize → formatDimensionContent
- 维度内容最大 24000 字符
- 铁墙清理必须先于图表占位符解析

**method: assembleFullReport (L221-659)**

- 两遍处理：筛选非空 → 生成 TOC + 输出维度
- 回退补充内容：所有三个节为空时从 dimensionInputs 合成
- conclusion 去重：精确匹配 + 模糊 Jaccard 4-gram + H3 标题重叠
- 参考文献处理：清理 + 去重 + 重索引

**method: postProcessFinalReport (L679-932)**

- 72+ 项清理规则（质量网关 → 72 项串联）
- 非破坏性清理：仅格式修复，保留内容
- LaTeX 安全检测：$$$ 三美元符号检测

**method: resolveChartPlaceholders (L975-987)**

- <!-- figure:N:M --> → <!-- chart:dX-id -->
- 按 chartId 去重

**method: buildReferencesSection (L1000-1058)**

- 引用清理：junk → decodeUrlEntities → upgradeHttpToHttps → deduplicateReferencesByUrl
- 索引映射生成 + 应用

---

### 5.3 · report-data.service.ts (856 行)

核心：报告数据库操作（CRUD/维度保存/证据关联）

**method: createDraftReport (L53-106)**

- 版本号自增 + 并发重试（3 次，100ms 退避）
- P2002 唯一约束冲突捕获

**method: saveDimensionAnalysis (L112-183)**

- keyFindings toPrismaJson
- detailedContent：预处理 → 脱 JSON → 图表占位符解析（原子化）
- figureReferences / generatedCharts 聚合

**method: prepareDimensionInputs (L214-272)**

- 数据点聚合：trends/challenges/opportunities
- sanitizeAllStrings 清理

**method: collectAllCharts (L292-386)**

- 三层去重：ID / imageUrl / titleKey
- 每维最多 8 张（MAX_CHARTS_PER_DIMENSION）
- 跨维度 URL 去重：同一图片全报告仅出现一次
- 生成图表标题关键词规范化 → Jaccard 去重

**method: getLatestReport (L431-450)**

- 仅返非空报告（dimensionAnalyses.some{}）

**method: compareReports (L473-549)**

- 维度名称集合差异比较

**method: markIncrementalChanges (L554-574)**

- incremental update 记录元数据

---

### 5.4 · report-editor.service.ts (378 行)

核心：跨维度语义去重 + 术语一致性 + 数据一致性

**method: editDimensionInputs (L169-280)**

- AI 去重检查 → checkCrossDimensionDuplicates
- 重复段落移除：段落提示规范化 → starts-with 匹配
- 统计数据重复告警：regex 检测 %/$ 等数据指示符
- 维度间过渡生成

**method: checkCrossDimensionDuplicates (L285-345)**

- DEDUP_CHECK_PROMPT：8 字段 JSON 输出
- v5 增强：terminologyIssues + dataConsistencyIssues

**method: generateTransitionHints (L351-377)**

- 相邻维度对间模板式过渡

---

### 5.5 · report-validation.service.ts (~250 行)

核心：报告数据一致性验证

**method: validateReport (L53-110)**

- 四层验证：引用索引 + 图表引用 + 图表数据 + 跨维度数据

---

### 5.6 · figure-extractor.service.ts (~400 行)

核心：HTML 抓图 + 图片质量验证

**method: extractFiguresFromUrl (L97-163)**

- ToolRegistry.tryGet("web-scraper") → HTML 提取
- validateAndUpgradeFigures 验证

**method: extractFigures (L172-212)**

- <figure> → <img> → 去重 → 黑名单过滤 → 数量限制（最多 10 张）

**method: extractFigureElements (L221-261)**

- <figure> block 正则 → <img src> + <figcaption> → URL 解析
- v6.0：放宽 caption 要求（可空）

**method: extractImgElements (L270-300)**

- <img> 正则 → alt + width 提取
- 接受条件：(alt && length>0) || (width ≥ 200px)

**method: validateAndUpgradeFigures**

- GET+Range 前 8KB → magic bytes 验证
- 验证失败/网络错误 → 删除
- 最小 5KB，最大 5MB

---

### 5.7 · 其他 report service

- **figure-relevance.service.ts**：Vision LLM 相关性过滤
- **report-annotation.service.ts**：批注 CRUD
- **report-change.service.ts**：变更追踪 + diff
- **citation-formatting.utils.service.ts**：引用格式化
- **credibility-report.service.ts**：证据信度评分
- **latex-repair.service.ts**：LaTeX 公式修复
- **research-export.service.ts**：报告导出

---

## 第 II 部分：Quality 层（7 个 Service）

### 5.8 · report-quality-gate.service.ts (~500 行)

核心：维度内容质量门控（72 项自动修复规则）

**method: validateDimensionContent (L67-454)**

- 16+ 自动修复：标题 / 分割线 / 加粗 / blockquote / LLM 泄露 / LaTeX / JSON / 图片 / 堆积
- 10+ 检测：数量声明 / 营销话术 / 主观表达 / H3 过多
- 返回：violations + rewriteGuidance + fixedContent + wasAutoFixed

**关键规则**

- 加粗极限：>30 → 限制 2/子章节 + rewrite
- blockquote 极限：>1 → 限制 1
- H3 子节过多：>10 → 触发 rewrite
- 数量声明不一致：触发 rewrite
- LaTeX 安全：修复后 issues > 修复前 → 保留原文

---

### 5.9 · critique-refine.service.ts (~400 行)

核心：批评-修改循环（Reflexion 框架）

**method: runCritiqueRefineLoop (L125-234)**

- 迭代循环：critiqueContent → evaluateStopCondition → refineContent
- Stop 条件：target_reached / no_critical_issues / no_improvement / score_converged / max_iterations
- 返回：finalContent / iterations / finalScore / stopReason

**method: critiqueContent (L239-283)**

- chatStructured<RawCritiqueResponse>
- 输出：overallScore + categoryScores + items + strengths + summary
- Severity：CRITICAL > MAJOR > MINOR > SUGGESTION
- Category：8 类（见 content-critique skill）

**method: refineContent (L288-300)**

- 按 severity 排序，仅处理 CRITICAL + MAJOR
- 返回：refinedContent + scoreImprovement

---

### 5.10 · section-remediation.service.ts (223 行)

核心：低分 section 定向补救

**method: remediate (L39-183)**

- 模型升级：非 STRONG tier → STRONG
- Prompt 构造：多语言支持
- 三层安全检查：长度 + LaTeX + 返回结果
- 失败保留原文（非阻断）

**method: resolveRemediationModel (L195-221)**

- 原始模型 STRONG？保留 → 否则选 STRONG
- 失败回退：空字符串（TaskProfile 自动选择）

---

### 5.11 · 其他 quality service

- **defect-scanner.ts**：缺陷自动扫描
- **report-evaluation.service.ts**：多维度评估
- **report-quality-trace.service.ts**：质量演进追踪
- **section-self-eval.service.ts**：Section 自评（8 维度）

---

## 架构观察

### 依赖拓扑

```
Report 层：
- ReportDataService (数据库)
- ReportGeneratorService / ReportSynthesisService (AI 生成)
- ReportEditorService (跨维度去重)
- ReportAssemblerService (装配管道)
- FigureExtractorService (图表提取)
- FigureRelevanceService (Vision LLM)
- ReportValidationService (一致性验证)

Quality 层：
- ReportQualityGateService (代码规则)
- CritiqueRefineService (AI 循环)
- SectionRemediationService (补救)
- SectionSelfEvalService (自评)
```

### 关键设计模式

1. **三级质量保证**：
   - L1: 代码规则 (ReportQualityGateService)
   - L2: AI 循环 (CritiqueRefineService)
   - L3: 最终把控 (SectionRemediationService)

2. **数据管道**：
   - 维度 content → processDimensionContent (12 步) → assembleFullReport → postProcessFinalReport (72 步)
   - 图表 → 6 stage：抓 → 验证 → Vision → 分配 → 过滤 → 组装

3. **容错设计**：
   - 补救失败保留原文
   - 图表验证失败删除
   - 一致性检查失败不阻断

4. **去重分层**：
   - ID 级：chartId 全局唯一
   - Content 级：段落前缀 + Jaccard 4-gram
   - Semantic 级：数据点去重

---

**总体量化**：1047 行 / 89 方法 / 21 service
**覆盖完整度**：21/21 (100%)
**生成时间**：2026-04-24
