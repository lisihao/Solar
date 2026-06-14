# LLM Wiki Round 5 + Round 6 集体评审纪要

**评审对象**：[llm-wiki.md](./llm-wiki.md) v1.3 → v1.4
**评审日期**：2026-05-09
**评审方式**：v1.3 4 路并行（R5）+ v1.4 仅 architect 复评（R6，因 R5 其余 3 路 APPROVED 不重复）
**最终结果**：✅ **4/4 APPROVED-FOR-IMPLEMENTATION**

---

## 1. R5 总览（4 路对 v1.3）

| 路径             | 结论                               | 主要发现                                                                                                                                                                           |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reviewer         | **APPROVED-FOR-IMPLEMENTATION** ✅ | P0a 1.5d 可实现；mock 边界清晰；v1.2.1 安全约束全保留                                                                                                                              |
| security-auditor | **APPROVED-FOR-IMPLEMENTATION** ✅ | injection 防护层次合理（engine 拿到的是已包裹内容）；KB 边界靠 kbId+hasAccess 不靠 entityType；v1.2.1 安全机制全保留                                                               |
| tester           | **APPROVED-FOR-IMPLEMENTATION** ✅ | mock 边界清晰；wiki/ 子目录 80% 覆盖率仍能达；v1.2.1 13 项必测 spec 全保留（部分迁到 P0a engine 路径）                                                                             |
| architect        | NEEDS-CHANGES ❌                   | **2 BLOCKER**：MultiResolutionSearchService 过度抽象 / consistency 与 cross-cutting-synthesis 概念双源 + **3 非阻塞**：slug 5 处既有双源 / facade 命名 / sanitizeMarkdownBody 复用 |

**R5 计票**：3 APPROVED + 1 NEEDS-CHANGES → v1.4 修订

---

## 2. v1.4 修订清单（吸收 R5 architect 5 项）

### A. BLOCKER 修订

| 编号 | 问题                                                                                                                                                                             | v1.4 修订                                                                                                                                                                                                                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1  | `MultiResolutionSearchService` 过度抽象（单消费方 + 现有 `EmbeddingService` + `VectorService.similaritySearch({filter, topK})` 已可表达；CLAUDE.md "3 处使用再考虑抽象")         | 整体砍掉。§3.1 删除该 service 文件；§5.2 Branch B 改为两步直调 `embeddingService.embed(question) + vectorService.similaritySearch(qVec, {filter:{sourceTable:'wiki_page_embeddings', kbId, resolution:'ONELINER'}, topK:15})`；§3.2 边界表改为"直调 EmbeddingService+VectorService"；facade 减 1 export |
| A-2  | `ai-engine/knowledge/consistency/` 与现有 `cross-cutting-synthesis.service.ts` 的 `Contradiction`/`ResearchGap` 类型重叠（已被 topic-insights 用），违反"同名概念全项目唯一"红线 | CONTRADICTION/DATA_GAP 改为给 `CrossCuttingSynthesisService` 加 2 个低级 public API：`detectContradictions(documents)` / `detectDataGaps(documents, opts)`；wiki-lint + topic-insights 共用单源。`consistency/` 子目录只留 `StaleDetectorService`（quote vs raw hash 是独有语义无既有对应物）           |

### B. 非阻塞修订（同步收入）

| 编号 | 问题                                                                                                                               | v1.4 修订                                                                                                                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1  | `slug-normalize` 仅"上提到 engine"等于又添加第 6 处实现，留 5 处既有 ad-hoc 双源                                                   | §3.1 + §8 P0a 明示：同 PR 替换 `report-artifact-assembler` / `structural-report-assembler` / `ai-model-discovery` / `secret-name.catalog` / `custom-agent.dto` 5 处 ad-hoc slugify；P0a 验证标准要求"原调用方测试仍绿"     |
| B-2  | facade export 4 个，2 个用 token 形式与既有 class export 模式不一致；`parseWikiLinks` / `normalizeSlug` 通用名易与下游业务概念冲突 | 砍至 3 项 + 命名加 Markdown 前缀：`parseMarkdownWikiLinks` (function) / `normalizeMarkdownSlug` (function) / `StaleDetectorService` (class)。CrossCuttingSynthesisService 已有 export 不变（新加 2 方法通过同 class 访问） |
| B-3  | wiki-page.service body 解析路径未明示是否复用 engine 的 `sanitizeMarkdownBody`                                                     | §3.1 wiki-page.service 描述、§3.2 边界表、§5.1 Step G、§11 安全 checklist 末行四处一致：body 入库前必调 `sanitizeMarkdownBody`，与 frontend `rehype-sanitize` 形成双层防护                                                 |

---

## 3. R6 复核（仅 architect 对 v1.4）

| 路径      | 结论                               | 核对                                                                                                                                                                               |
| --------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| architect | **APPROVED-FOR-IMPLEMENTATION** ✅ | R5 BLOCKER 2 项 + 非阻塞 3 项全 FIXED；新引入 1 处 §3.1 L222 doc-drift（已在终版同步修复）+ 1 实施提示（CrossCuttingSynthesisService 加注释标"wiki-lint+TI 共用，不要塞专属字段"） |

---

## 4. 跨 6 轮最终计票

| 维度      | R1                             | R2                   | R3                          | R4          | R5                               | R6          | 终态 |
| --------- | ------------------------------ | -------------------- | --------------------------- | ----------- | -------------------------------- | ----------- | ---- |
| architect | NEEDS-CHANGES (3 BLOCKER 虚构) | APPROVED ✅          | APPROVED ✅                 | -           | NEEDS-CHANGES (2 BLOCKER 错上提) | APPROVED ✅ | ✅   |
| reviewer  | NEEDS-CHANGES (3 P0)           | NEEDS-CHANGES (9)    | NEEDS-CHANGES (2 doc-drift) | APPROVED ✅ | APPROVED ✅                      | -           | ✅   |
| security  | NEEDS-CHANGES (2 P0)           | NEEDS-CHANGES (2 P1) | NEEDS-CHANGES (1 P1+3 P2)   | APPROVED ✅ | APPROVED ✅                      | -           | ✅   |
| tester    | NEEDS-CHANGES (1 BLOCKER)      | APPROVED ✅          | APPROVED ✅                 | -           | APPROVED ✅                      | -           | ✅   |

**4/4 APPROVED-FOR-IMPLEMENTATION** 共识达成于 R6（跨轮整合）。

---

## 5. 元教训（R5+R6 双倍打脸 + 6 轮总迭代精华）

1. **架构归属审查必须 3 维度问，不止 1 维度**：
   - ① 是否穿透 facade（依赖方向）
   - ② 是否过度集中 app（漏上提）
   - ③ 是否过度抽象/与既有重叠（错上提）
     v1.0~v1.2 architect 只问 ①，漏 ②；v1.3 弥补 ② 又错在 ③。下次设计任务的 architect prompt 必须明文列三项。

2. **"上提"不是机械动作，要核对既有能力库**：v1.3 拟新建 `MultiResolutionSearchService` / `ConsistencyChecker` 都犯同一个错——没读 engine facade 已 export 什么 + knowledge/synthesis 已 export 什么。架构师 R5 一句 grep 就发现 `CrossCuttingSynthesisService` 已 export `Contradiction`/`ResearchGap` 给 topic-insights 用了。**Read 既有 service 类型 export > 新建 service**。

3. **"3 处使用再考虑抽象"红线**：CLAUDE.md 反过度抽象规则。`MultiResolutionSearchService` 实际只有 wiki 一个消费方，不构成抽象触发条件。"上提为通用能力" 不能跳过这条 — 即使叫"通用"，单消费方就是过度抽象。

4. **上提同时必须清旧双源**：把 X 上提到 engine 但留下 5 处旧实现 = 增加第 6 处双源，比不上提还糟。slug-normalize 教训：上提的 PR 必须包含"替换全项目所有 ad-hoc 实现"作为强制验收项。

5. **跨轮 APPROVED 才算共识，错峰 APPROVED 不算**：architect 在 R2/R3 都 APPROVED，但在 R5 又找出 v1.3 的 2 BLOCKER。**最后一轮才能定调**——本轮架构归属审查只在 v1.3 触发是因为 v1.0~v1.2 没引入"上提到 engine"的动作。

6. **小修走 v1.x（不是 v1.x.1）但仍能省一轮**：v1.4 是大幅修订（砍 service / 折叠到既有 service / 改 facade），所以走 v1.4 而非 v1.3.1；但因为只动 architect 关心的归属维度，R6 只复评 architect 一路（其余 3 路 R5 APPROVED 不重复审），节省 75% 评审成本。**评审范围匹配修改范围**。

7. **6 轮迭代 ≠ 设计差，意味着维度覆盖深**：R1 找虚构 entity（实状对齐）/ R2 找 schema 关系缺漏（数据完整性）/ R3 找数字漂移 + deletes 路径漏 / R4 ≈ R3 修小补 / R5 找能力归属错 / R6 收尾。**12 维度 4 路评审在不同轮触发不同维度的发现**，单维度审查会漏掉 5/6 轮的真问题。

---

## 6. 实施前最终建议（按 P0 phase 执行）

1. **P0a engine 通用能力（1.5d）**：
   - `ai-engine/content/markdown/wiki-link-parser.util.ts` + `slug-normalize.util.ts`，**同 PR 替换 5 处 ad-hoc slugify**
   - `ai-engine/knowledge/synthesis/cross-cutting-synthesis.service.ts` 加 2 个 public API + 注释标"被 wiki-lint + topic-insights 共用，不要塞专属字段"
   - `ai-engine/knowledge/consistency/stale-detector.service.ts` + `consistency.module.ts`（仅 1 service）
   - facade 加 3 export
2. **P0b schema + ADR（1d）**：10 张表 + ADR 不变
3. **P1 ingest + edit + log（4d）**：spec 含 13 项必测（v1.2.1 锁定）+ wikiEnabled gate + revert IDOR + zod parse + SELECT FOR UPDATE
4. **P2 query + lint（3d）**：wiki-query Branch B 直调 engine 基元 spec；wiki-lint mock CrossCuttingSynthesisService.detect\* + StaleDetectorService 验证传参
5. **P3 UI + export（4d）**：tree nav + diff 视图 + lint 面板 + ExportJob 集成

每 Phase 落地后做一次 4 路集体评审到 4/4 共识再进下一 Phase。
