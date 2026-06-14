# LLM Wiki Round 1 集体评审纪要

**评审对象**：[llm-wiki.md](./llm-wiki.md) v1.0
**评审日期**：2026-05-08
**评审方式**：4 路并行独立审查（architect / reviewer / security-auditor / tester），互不串通
**结果**：**4/4 NEEDS-CHANGES**（其中 architect/tester 含 BLOCKER 等级）→ v1.1 全部修订 → 进 R2

---

## 1. 总体结论

| 路径             | 结论          | 严重等级                                           |
| ---------------- | ------------- | -------------------------------------------------- |
| architect        | NEEDS-CHANGES | **3 BLOCKER**（虚构 entity / 概念错位 / RAG 表错） |
| reviewer         | NEEDS-CHANGES | 3 P0                                               |
| security-auditor | NEEDS-CHANGES | 2 P0                                               |
| tester           | NEEDS-CHANGES | **1 BLOCKER**（P2 ≥20% precision 不可测） + 3 P0   |

**根因**：v1.0 写作时未充分核对代码库实状（CLAUDE.md "分析先行禁止猜测" 红线），导致 4 处不存在的 entity 被当成存在的（`fact-extraction.service` / `EmbeddingChunk` 表 / `KnowledgeBaseGuard` / `Note` 挂 `KnowledgeBase`）。

---

## 2. P0 / BLOCKER 汇总（去重，按主题分组）

### A. 现实校准（架构师 P0）

| 编号 | 问题                                                                          | v1.1 修订                                                                                                |
| ---- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| A-1  | `WikiSkillTokens` / `fact-extraction.service.ts` 不存在                       | 删除虚构提及；wiki skill 走 `PromptSkillBridge.registerDomain("library")`（writing/research 同 pattern） |
| A-2  | `KnowledgeBaseGuard` 不存在                                                   | 沿用 `KnowledgeBaseService.hasAccess()` service 层校验；不创新 Guard                                     |
| A-3  | `Note` 没挂 `KnowledgeBase`，"Note 即 raw" 是概念错位                         | raw 改为 `KnowledgeBaseDocument`；`WikiPageSource.documentId` FK to KBD                                  |
| A-4  | `EmbeddingChunk` 表不存在；现有是 `ChildEmbedding`，强 FK 挂 ChildChunk → KBD | 新建独立 `WikiPageEmbedding` 表（embedding 字段 Json，与 ChildEmbedding 一致；Railway 无 pgvector）      |

### B. 数据完整性（reviewer + tester + architect 重叠）

| 编号 | 问题                                                       | v1.1 修订                                                                                                 |
| ---- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| B-1  | `WikiDiff` 表完全没建模（管线靠它存活）                    | 新增 `WikiDiff { id, kbId, status, items, baselineHash, affectedSlugs, ... }`                             |
| B-2  | apply 原子性未明，事务边界缺失                             | 明示：creates/updates/links/log 一个 Prisma `$transaction`；invariant lint 事务外 best-effort，失败不回滚 |
| B-3  | revert 无 before-state 存储；§1.5 又说"不做版本史"自相矛盾 | 新建 `WikiPageRevision` 快照表；删 §1.5 "不做版本史" 表述，改为"最小快照不做 diff 链"                     |
| B-4  | `propose_update_page` diff 格式未定                        | 选定**全量替换 newBody**（reviewer P0 推荐）；客户端用 `diff` npm 包算 git-style 视图                     |
| B-5  | `sourceRefs Json` 失去引用完整性，doc 删除变野指针         | 拆为 `WikiPageSource` 关系表，FK to `KnowledgeBaseDocument` onDelete CASCADE                              |
| B-6  | `WikiOperationLog.pageIds String[]` 破坏关系查询           | 拆为 `WikiOperationLogPage` 关系表（带 role：CREATED/UPDATED/DELETED/AFFECTED）                           |

### C. 安全（security P0）

| 编号 | 问题                                                                           | v1.1 修订                                                                                                        |
| ---- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| C-1  | slug 字符集无约束 → export tarball 路径穿越 + 前端 href XSS                    | DTO `@Matches(/^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/)` + export 二次 `safeSlug` 替换非法字符 + DTO 拒非 ASCII 本期 |
| C-2  | wiki-ingest 把用户内容（doc rawContent）原样喂 LLM → indirect prompt injection | 强制 `wrapExternalContent()` + `EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH/EN`（已有基础设施，本设计文档强制接入点）      |

### D. 链接解析与 slug（tester P0）

| 编号 | 问题                                       | v1.1 修订                                                                                 |
| ---- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| D-1  | link-parser 用正则在代码块/转义/反引号失效 | 用 **remark AST**（前端已用 remark/rehype 系列，不是新依赖）                              |
| D-2  | slug 规范化规则未定                        | 明示 `normalizeSlug` 纯函数（lowercase + kebab-case + ASCII-only），10 条测试用例锁定边界 |

### E. 验收（tester BLOCKER）

| 编号 | 问题                                                                  | v1.1 修订                                                                                           |
| ---- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| E-1  | P2 "≥20% precision 提升" 不可在 CI 量化（无 baseline，需 golden set） | 撤掉 precision 指标；改为 spec 命令级（阈值切换边界 / Branch B 不加载非 top-K / lint 5 类 fixture） |
| E-2  | P1/P3 验收是 E2E 行为描述非命令级                                     | 全部改为 `npm test --testPathPattern=wiki` 命令级，每 phase 列必过 spec 文件清单                    |

---

## 3. P1 建议汇总（按主题分组）

### F. 简化（reviewer + architect 简化建议）

| 编号 | 建议                                                                | 修订                                                                  |
| ---- | ------------------------------------------------------------------- | --------------------------------------------------------------------- |
| F-1  | `POST /diffs/:id/apply` + `/dismiss` 合并为 `PATCH /diffs/:id`      | 合并                                                                  |
| F-2  | `POST /lint-findings/:id/resolve` 合并为 `PATCH /lint-findings/:id` | 合并                                                                  |
| F-3  | `WikiOp.QUERY` 无消费方                                             | 砍                                                                    |
| F-4  | `WikiLintFinding.resolvedByUserId` 本期单写者无消费方               | 砍                                                                    |
| F-5  | `wiki-export.service.ts` 独立文件过度                               | 并入 `wiki-page.service.ts`                                           |
| F-6  | export 自起协议重复                                                 | 复用 `ExportJob`：扩 `ExportSourceType.WIKI` + `ExportFormat.TARBALL` |

### G. 健壮性（architect + reviewer + security P1）

| 编号 | 建议                                                    | 修订                                                                                            |
| ---- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| G-1  | 体量阈值 hardcode 不灵活                                | 新建 `WikiKnowledgeBaseConfig` 表（每 KB 独立配，admin UI 后期可暴露）                          |
| G-2  | diff 并发"全 KB 单 PENDING"团队场景过严                 | 改为 affectedSlugs 集合冲突判定，空交集允许并存                                                 |
| G-3  | markdown 外链强禁过严，违反 Karpathy 原意               | 允许标准 `[text](url)` 外链；只强约束跨 wiki 必须 `[[slug]]`                                    |
| G-4  | Branch A 长 context 按 updatedAt desc 装→旧知识盲区     | 改为 BM25 / pg_trgm 对 question 排序装 body                                                     |
| G-5  | CONTRADICTION lint 全配对 LLM 调爆预算                  | 抽样上限 50 对/天，优先 7d 内变动页；进 `WikiKnowledgeBaseConfig.cronLintDailyBudgetCalls` 可配 |
| G-6  | diffId IDOR 风险（KB_A editor 跨库 apply KB_B 的 diff） | service 层第一行强制校验 `diff.knowledgeBaseId === kbId` → 403                                  |
| G-7  | `WikiPage.lastEditedBy` 字符串                          | 改 enum `WikiPageEditedBy { USER, LLM, IMPORT }`                                                |
| G-8  | sourceRef.span 后端无校验                               | apply 时校验 `0 ≤ start ≤ end ≤ doc.rawContent.length`                                          |
| G-9  | cron lint 资源滥用                                      | KB 级开关 `cronLintEnabled` + 每日预算 `cronLintDailyBudgetCalls=50`                            |
| G-10 | PII 泄露给 BYOK 第三方模型无告知                        | UI 一次性合规告知（GDPR Art.13/14）                                                             |
| G-11 | apply 时 dirty write（其他人改了同页）                  | `baselineHash` 乐观锁 + `WikiDiffStatus.CONFLICTED` 状态                                        |

### H. 测试守门（tester P1）

| 编号 | 建议                                                                          | 修订                                                 |
| ---- | ----------------------------------------------------------------------------- | ---------------------------------------------------- |
| H-1  | wiki/ 子目录无 coverageThreshold                                              | 加 `branches:70/functions:80/lines:80/statements:80` |
| H-2  | ingest skill prompt 无 snapshot 测                                            | 加 `prompt 包含 prefer-update-over-create` 断言 spec |
| H-3  | 漏掉边缘场景：wikiEnabled=false / dirty write / oneLiner 超长 / cron+手动并发 | 全部明示规则到 §9 风险表                             |
| H-4  | 可观测性：日志结构未提                                                        | 新增 §12 章列 8 类关键路径日志结构                   |

---

## 4. 元教训

1. **设计文档第一责任是与代码库实状对齐**：v1.0 7 处虚构（`fact-extraction.service` / `EmbeddingChunk` / `KnowledgeBaseGuard` / `Note` 挂 KB / `WikiSkillTokens` / `WikiDiff` 漏建表 / `pgvector` 误设），Read 一次 schema + 一次 facade + 一次同领域 module.ts 就能避免。这正是 CLAUDE.md "分析先行，禁止猜测" 红线要防的。
2. **Karpathy 哲学的底层是"raw 是文档不是笔记"**：从 gist 翻译到 GenesisPod 时，我们把 Note（用户笔记）当成 raw 是最关键语义错位。raw 应是 `KnowledgeBaseDocument`。
3. **engine facade 已足够丰富**：EmbeddingService / VectorService / SkillRegistry / AiChatService / sanitizeMarkdownBody / parseJsonFence / PromptSkillBridge / wrapExternalContent 全部 export，wiki 子模块**不需要新增 facade re-export**。
4. **"非目标"和"管线"必须自洽**：v1.0 §1.5 写"不做版本史"但 §5.3 stale lint 又依赖历史快照——同一文档两节互相否定。设计自审时要专门交叉验证。
5. **强成功标准 = 命令级**：v1.0 P2 写 "≥20% precision" 看似量化实际不可测；改为 spec 命令级才能"独立循环"（CLAUDE.md §强成功标准）。
6. **简化优先于"未来扩展"**：v1.0 砍掉 4 个无消费方字段/服务/log 类型后文档反而更清晰。

---

## 5. v1.1 修订清单（共 40 条）

详见 [llm-wiki.md](./llm-wiki.md) 顶部"v1.1 vs v1.0"表与 §2.2 新增决策表。
