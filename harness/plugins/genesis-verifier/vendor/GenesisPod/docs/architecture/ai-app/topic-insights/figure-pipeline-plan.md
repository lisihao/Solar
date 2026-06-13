# Figure Pipeline Redesign Plan

> 归档日期：2026-03-18

## 目标

用 Embedding（向量相似度）替代 Vision LLM 实现图片过滤，解决：

- Vision 慢（每张图 8s fetch + 30s LLM = 最坏 38s）
- Vision 不可靠（CDN 封锁、rate limit、超时）
- Vision 过度保守（宁缺毋滥导致有效图被误删）

## 完整数据链

```
网页 HTML
  │
  ▼
[Stage 1] FigureExtractorService.extractFigures()
  → URL 黑名单过滤（logo/icon/tracking-pixel）
  → CDN URL 升级（缩略图 → 高清）
  → HTTP GET Range + magic bytes 验证（5KB~5MB）
  → 输出：ExtractedFigure[]（已验证可访问）
  │
  ▼
[Stage 2] FigureRelevanceService.filterRelevantFigures()    ← 本次改造重点
  当前：Vision LLM（看图像素判断 chart vs stock photo）
  目标：Embedding 方案
    ① type = chart/table/diagram → 直接保留（0 次 API 调用）
    ② type = photo，caption.trim().length < 10 → 拒绝
    ③ type = photo，caption 有效 → embed(caption) vs embed(topicTitle)，cosine >= 0.35 → 保留
    ④ Embedding 失败 → type-based fallback（chart 保留，photo 有长 caption 保留）
  预期性能提升：80 张图 ~50 分钟 → ~1 分钟
  │
  ▼
[Stage 3] evidence-summary.utils.buildFiguresSummary()
  → 按类型排序（chart > photo），可信度排序
  → 截断前 40 张，生成 figureId（FIG-1...FIG-40）
  → 输出：figureRegistry（Map<figureId, FigureRegistryEntry>）
  │
  ▼
[Stage 4] LeaderPlanningService.planDimensionOutline()
  → LLM 从 FIG-1...FIG-40 中为每 section 分配 0-2 张
  → 输出：allocatedFigures[].figureId（imageUrl 由下游回填）
  │
  ▼
[Stage 5] SectionWriterService.writeSection()              ← 已改造完成
  → LLM 撰写章节
  → backfillFigureUrls（从 registry 回填 imageUrl）
  → Citation-driven injection（最多 +2 张）
  → Embedding 主力过滤（v10）：
      matchCount >= 1 → 快速保留
      matchCount = 0 && keywords 存在 → embed(caption) vs embed(sectionCtx)，cosine >= 0.3
      refText < 5 字符 → 拒绝
      Embedding 失败 → fail-open（宁可放行）
  │
  ▼
[Stage 6] ReportSynthesisService.collectAllCharts()
  → 跨维度 URL 去重（seenImageUrls）
  → 每维度上限 8 张
  → Step 8.5 孤儿恢复（seenRecoveryUrls URL 去重防重复）
  → 输出：ReportChart[]（最终进入报告）
```

## 已完成改造

- [x] Stage 5 (SectionWriterService)：keyword + Embedding 主力方案（v10）
- [x] Stage 6 orphan recovery：seenRecoveryUrls URL 去重防重复图片
- [x] Stage 2 (FigureRelevanceService)：替换 Vision → Embedding（v17）
  - 移除：fetchImageAsBase64、Vision chatStructured 调用、信号量、所有 Vision 相关常量
  - 新增：AIEngineFacade 注入、topicTitle embedding Promise 缓存、cosine >= 0.35 判断
  - 修复 B2：typeBasedFallback 收紧（photo + caption >= 10 字符才保留）
- [x] 修复 B1：getSectionEmbedding 竞态 → Promise 缓存（section-writer.service.ts）

## 待完成改造

（全部改造已完成）

## 已知 Bug（检视结果）

| ID  | 严重度 | 位置                     | 问题                                                                                                      | 状态                          |
| --- | ------ | ------------------------ | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| B1  | 中     | section-writer.ts:603    | getSectionEmbedding 竞态：null 缓存在 Promise.all 并发下不生效，同一 section 的 embedding 被重复请求 N 次 | 已修复（Promise 缓存）        |
| B2  | 中     | figure-relevance.ts:250  | typeBasedFallback 对 photo 过宽：有 caption 的 photo 全部通过，Vision 失败时无有效兜底                    | 已修复（caption >= 10 chars） |
| B3  | 低     | report-synthesis.ts:1314 | collectAllCharts 丢弃重复 URL 图片时无日志                                                                | 可接受                        |
| B4  | 低     | report-synthesis.ts:737  | referencedChartIds 含 undefined 类型（TypeScript 类型不严格，不影响运行时）                               | 可接受                        |
| B5  | 低     | leader-planning.ts:887   | planDimensionOutline 日志中 figureId 数量含 LLM 编造的无效 ID                                             | 可接受                        |

## Embedding 阈值

| 过滤层                | 阈值           | 语义                        |
| --------------------- | -------------- | --------------------------- |
| Stage 2（全局质量）   | cosine >= 0.35 | 图片 caption 与研究主题相关 |
| Stage 5（section 级） | cosine >= 0.30 | 图片 caption 与当前章节相关 |

Stage 2 阈值更高，因为是全局过滤，要求图片与整个主题相关。
Stage 5 阈值稍低，因为已经过 Stage 2，且是 section 级精细匹配。

## 精度分析（仿真结果摘要）

新 Embedding 方案 vs 旧 Vision 方案：

| 图片类型                       | Vision 结果      | Embedding 结果          | 一致性 |
| ------------------------------ | ---------------- | ----------------------- | ------ |
| chart/table/diagram            | KEEP             | KEEP（直接规则）        | 一致   |
| 人物头像（有 caption）         | REMOVE           | REMOVE（cosine < 0.15） | 一致   |
| 风景照                         | REMOVE           | REMOVE（cosine < 0.1）  | 一致   |
| 空 caption photo               | 不确定（看图）   | REMOVE（规则拒绝）      | 更确定 |
| 泛化活动照（有描述性 caption） | REMOVE（约 80%） | KEEP（cosine ~0.35+）   | 退步点 |
| 技术演示照（有描述性 caption） | KEEP             | KEEP（cosine >= 0.35）  | 一致   |

唯一退步点（泛化活动照）由 Stage 5 的 section 级 Embedding 作为第二道防线拦截。
