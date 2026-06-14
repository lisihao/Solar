# LLM Wiki Round 2 集体评审纪要

**评审对象**：[llm-wiki.md](./llm-wiki.md) v1.1
**评审日期**：2026-05-08
**评审方式**：4 路并行独立审查（architect / reviewer / security-auditor / tester）
**结果**：**2 APPROVED + 2 NEEDS-CHANGES** → v1.2 修订 → 进 R3

---

## 1. 总体结论

| 路径             | 结论                               | 主要发现                                                                                                   |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| architect        | **APPROVED-FOR-IMPLEMENTATION** ✅ | R1 全部 3 BLOCKER + 10 P0/P1 全 FIXED；3 项非阻塞观察（KB 行号 typo / GIN 索引建议 / 历史注释 / ADR 落盘） |
| tester           | **APPROVED-FOR-IMPLEMENTATION** ✅ | R1 全部 BLOCKER + P0 全 FIXED；3 条 P1 spec 建议（不阻塞）                                                 |
| reviewer         | NEEDS-CHANGES ❌                   | R1 全部修复，但发现 v1.1 自身引入 9 个新问题（schema 关系缺声明、硬编码模型、表数量声明错误、阶段交叉等）  |
| security-auditor | NEEDS-CHANGES ❌                   | R1 全部修复，发现 v1.1 引入 2 项新 P1（revert 跨页 IDOR / affectedSlugs 信任）+ 4 项 P2                    |

---

## 2. v1.2 修订清单（共 21 条，按主题分组）

### A. Schema 关系补声明（reviewer R2 P1 #3-#5）

| 编号 | 问题（v1.1 引入）                                   | v1.2 修订                                                                                                                                   |
| ---- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A-1  | `WikiPageRevision.opId` 无 Prisma `@relation` 声明  | 加 `op WikiOperationLog? @relation(fields:[opId], references:[id], onDelete:SetNull)` + `@@index([opId])`                                   |
| A-2  | `WikiLintFinding.pageId` 无 FK，page 删除后变孤记录 | 加 `page WikiPage? @relation(fields:[pageId], references:[id], onDelete:SetNull)` + `@@index([pageId])`                                     |
| A-3  | `WikiOperationLogPage.pageId` 无 FK                 | 加 `page WikiPage? @relation onDelete:SetNull` + nullable pageId（保留历史）+ 用独立 id PK + 部分唯一约束（Prisma 复合主键不允许 nullable） |
| A-4  | `WikiPage` 缺反向关系 `opLogPages` / `lintFindings` | 同步加上                                                                                                                                    |
| A-5  | `WikiOperationLog` 缺反向关系 `revisions`           | 同步加上                                                                                                                                    |

### B. Schema 硬编码 + YAGNI（reviewer R2 P1 #2 / #8）

| 编号 | 问题                                                                                         | v1.2 修订                                                                                   |
| ---- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| B-1  | `WikiPageEmbedding.model @default("text-embedding-3-small")` 违反 CLAUDE.md 反硬编码模型规则 | 改 `@default("")`，由 EmbeddingService 写入时填实际 model（同步 §13 项目规范对齐 + 元教训） |
| B-2  | `WikiPageSource.weight Float @default(1.0)` 无消费方                                         | 砍掉（YAGNI）                                                                               |

### C. 安全 P1（security R2 新 P1）

| 编号 | 问题（v1.1 引入）                                                                         | v1.2 修订                                                                                                                                          |
| ---- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1  | revert 跨页 IDOR：`toRevisionId` 未校验 `revision.pageId === page.id`                     | §6 加 service 层强校验 + §11 checklist 补 + §8 P1 spec 加跨页 revert 403 测试                                                                      |
| C-2  | `affectedSlugs` 信任问题：apply 信任 DB 预存值，恶意/有缺陷 ingest 写空数组可绕过冲突判定 | §5.1 apply 流程加 Step B：实时从 `diff.items.creates[].slug ∪ updates[].slug` 重算；§11 checklist 补；§8 P1 spec 加"DB 字段被改空仍能挡冲突"测试   |
| C-3  | `WikiDiff.items` JSON 在 apply 前未 schema 校验                                           | §5.1 apply 流程加 Step A：`WikiDiffItemsSchema.parse(diff.items)` 强校验失败 400；§11 checklist 补；§13 反硬编码列对齐 feedback_no_lying_assertion |

### D. 安全 P2（security R2 新 P2 → 提到 P1 同步修）

| 编号 | 问题                                                              | v1.2 修订                                                                                                                    |
| ---- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| D-1  | `wrapExternalContent` 默认 maxLength=2000 字符 与 80K tokens 矛盾 | §5.1 Step 1 改为按"剩余 token budget × 4 / N 篇 doc"显式传 maxLength                                                         |
| D-2  | `baselineHash` 乐观锁 TOCTOU 隔离级别未明                         | §5.1 apply 改 `isolationLevel: 'Serializable'` + 首步 `SELECT FOR UPDATE` 锁 affectedSlugs 涉及的所有 page；§11 checklist 补 |
| D-3  | VIEWER 触发 export 内容边界未明                                   | §6 export 鉴权语义明示"VIEWER 与 EDITOR 看到内容相同"（KB 设计本意）+ 前端 UI 加导出范围提示                                 |
| D-4  | embedding upsert "异步排队也可" 与 atomic transaction 矛盾        | §5.1 Step I 明示**必须在事务内**，删除"异步排队也可"括号                                                                     |

### E. 文档对齐（reviewer R2 P1 #1 / #6 / #7 / 架构师 R2 #1）

| 编号 | 问题                                              | v1.2 修订                                       |
| ---- | ------------------------------------------------- | ----------------------------------------------- |
| E-1  | §4.1 标题"7 张新表" → 实际 10 张                  | 改"10 张新表"+ 列出 10 个 model 名              |
| E-2  | §2.2 决策表 "合并到 12" vs §6 实际 13 个 endpoint | 改"合并到 13（含 export）"                      |
| E-3  | §1.2 KB 行号 4150 → 4098                          | 已修                                            |
| E-4  | WikiDiff schema 注释残留废弃 partial unique index | 删除废弃文字，改为只保留 GIN partial index 说明 |

### F. 阶段对齐（reviewer R2 P1 #9）

| 编号 | 问题                                                                                      | v1.2 修订                                                                         |
| ---- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| F-1  | `WikiKnowledgeBaseConfig` 在 P2 才建，但 P1 ingest 80K hardcode 依赖                      | 提到 P0 一起建 + 加 `ingestMaxTokens Int @default(80_000)` 字段；P1 直接读 Config |
| F-2  | P0 范围 7 张表 → 10 张 + ADR + GIN 索引                                                   | §8 P0 phase 范围扩展，验证标准包含 SetNull 行为                                   |
| F-3  | P0 SQL migration 加 `wiki_diffs(affected_slugs) GIN partial index WHERE status='PENDING'` | §8 P0 phase 列入                                                                  |
| F-4  | ADR-XXX-wiki-vs-graph-coexistence 落盘                                                    | §8 P0 phase 列入                                                                  |

### G. 测试补充（tester R2 边缘 #1 / #3 + 5 / 4）

| 编号 | 建议                                              | v1.2 修订                                                                                            |
| ---- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| G-1  | `wikiEnabled=false` API 层无 gate spec            | §6 写操作鉴权后加 `kb.wikiEnabled` 校验 + §8 P1 spec 加 wikiEnabled=false POST/PATCH/DELETE 返回 400 |
| G-2  | PATCH edit 路径写 WikiPageRevision 未列入 P1 必测 | §8 P1 spec 加 `wiki-page.service.spec.ts` PATCH edit 路径写 revision                                 |
| G-3  | baselineHash 计算确定性测试缺失                   | §8 P1 spec 加 `wiki-ingest.service.spec.ts` "相同 index 两次 hash 相等"                              |

### H. R2 自洽（架构师 R2 P3 修）

| 编号 | 建议                                   | v1.2 修订                                   |
| ---- | -------------------------------------- | ------------------------------------------- |
| H-1  | 元教训：v1.1 引入 9 个 schema 关系缺漏 | v1.2 顶部加 21 条修订表 + R2 评审纪要本文件 |

---

## 3. APPROVED 路径的非阻塞建议（architect / tester R2，记录但不强修）

- (architect 观察 #2) `WikiDiff.affectedSlugs String[]` 上无 GIN 索引（已收入 v1.2 F-3）
- (architect 观察 #1) §1.2 KB 行号 4150 → 4098（已收入 v1.2 E-3）
- (architect P3 修) ADR 落盘（已收入 v1.2 F-4）
- (tester 建议 #1-3) 4 项 spec 建议（已收入 v1.2 G-1/G-2/G-3 + C-1）
- (tester 边缘 #2 / #4 / #6) 实现细节，P1 code review 阶段处理

---

## 4. 元教训

1. **设计文档新增表/字段时必须立即写 Prisma `@relation`**：v1.1 加了 3 处 nullable FK（opId / pageId / pageId）但都没写关系声明。Prisma 不会校验，运行时无 FK，service 层无法 join。这是 reviewer R2 集中发现的"v1.1 自带新缺口"。
2. **Schema 默认值要查 CLAUDE.md 反硬编码规则**：v1.1 写 `@default("text-embedding-3-small")` 直接命中红线。模型名/价格表/任何 provider-specific 字符串都该 `""` 或 enum。
3. **数字一致性是文档自洽的低 hanging fruit**：v1.1 §4.1 "7 张表"、§2.2 "12 个 endpoint" 都与 schema/§6 实际数量不符。审稿时 grep `^model ` 和数 endpoint 表行数即可发现。
4. **新增机制必带新攻击面**：v1.1 引入 baselineHash + affectedSlugs + WikiPageRevision + CONFLICTED 状态，看似严密；security R2 立即指出 toRevisionId 跨页 IDOR + affectedSlugs 信任问题。**安全审查在每轮迭代都要重做，不能"上次过了就不管"**。
5. **跨阶段配置依赖必须明示**：v1.1 P1 用 80K hardcode、P2 才建 Config，开发者会困惑"P1 时哪个生效"。把 Config 提 P0、ingestMaxTokens 加进 Config，所有阶段读同一处。

---

## 5. 4 路 R2 完整评分回顾

| 维度             | architect           | reviewer                | security          | tester            |
| ---------------- | ------------------- | ----------------------- | ----------------- | ----------------- |
| R1 P0 修复完整性 | ✅                  | ✅                      | ✅                | ✅                |
| 文档自洽         | ⚠️（行号/历史注释） | ❌（数字 + 9 处自带）   | ✅                | ✅                |
| 安全新攻击面     | ✅                  | N/A                     | ❌（2 P1 + 4 P2） | ⚠️（4 spec 建议） |
| 可实施性         | ✅                  | ❌（schema 关系缺声明） | N/A               | ✅                |
| **结论**         | APPROVED            | NEEDS-CHANGES           | NEEDS-CHANGES     | APPROVED          |

→ R3 期望：4/4 APPROVED-FOR-IMPLEMENTATION
