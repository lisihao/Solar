# LLM Wiki Round 3 + Round 4 集体评审纪要

**评审对象**：[llm-wiki.md](./llm-wiki.md) v1.2 → v1.2.1
**评审日期**：2026-05-08
**评审方式**：4 路并行独立审查（architect / tester 复核 v1.2 + reviewer / security 复核 v1.2 → v1.2.1 二轮）
**最终结果**：✅ **4/4 APPROVED-FOR-IMPLEMENTATION**

---

## 1. R3 总览（4 路对 v1.2）

| 路径             | 结论                               | 主要发现                                                                                                                                                               |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| architect        | **APPROVED-FOR-IMPLEMENTATION** ✅ | R2 APPROVED 仍成立；3 处 doc-drift（§3.1 "7" / §6 "12" / §14 索引）建议 R3 一次性补完不发 v1.3；建议补 P2034 重试策略 + WikiPageEmbedding.model 写入约束               |
| tester           | **APPROVED-FOR-IMPLEMENTATION** ✅ | R2 三条 spec 建议全收入 §8 P1；v1.2 4 项新机制 spec 一一对应；2 个观察（Jest 模拟 SELECT FOR UPDATE / wikiEnabled spec 应在 service 层）属实施细节                     |
| reviewer         | NEEDS-CHANGES ❌                   | R2 9 个问题 7 FIXED + 2 PARTIALLY-FIXED：§3.1 残留 "7 张" / §6 标题残留 "12 个"；P2/P3 设计澄清 3 项                                                                   |
| security-auditor | NEEDS-CHANGES ❌                   | R2 P1/P2 大部分 FIXED；发现 v1.2 引入 1 个 P1（`deletes` 数组完全没参与冲突保护）+ 3 个 P2（Step C 半修复 / Serializable 缺重试 / WikiDiffItemsSchema 字段约束未定义） |

**R3 计票**：2 APPROVED + 2 NEEDS-CHANGES → v1.2.1 修订

---

## 2. v1.2.1 修订清单（吸收 R3 reviewer + security 共 8 项）

### A. 安全 P1（security R3 — 真问题，v1.2 自身引入）

| 编号 | 问题                                           | v1.2.1 修订                                                                                  |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A-1  | `affectedSlugs` 重算公式遗漏 `items.deletes[]` | §5.1 Step B 公式补 `∪ items.deletes[]`                                                       |
| A-2  | Step D `SELECT FOR UPDATE` 不锁 deletes 涉及页 | Step D 显式标注"含 creates/updates/deletes 三类全部 slug"                                    |
| A-3  | apply 流程缺 delete WikiPage 操作              | Step G2 新增 `delete WikiPage WHERE slug IN items.deletes[]`（FK Cascade 自动清下游 5 张表） |

### B. 安全 P2（security R3 — 设计澄清）

| 编号 | 问题                                                              | v1.2.1 修订                                                                                                                                        |
| ---- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| B-1  | Step C 仍读其他 PENDING diff 的 DB 预存 `affectedSlugs`（半修复） | Step C 改为对每个 `other_diff` 也实时重算 `other_affectedSlugs from other_diff.items`，完全不读 DB 预存                                            |
| B-2  | Serializable 缺 P2034 (serialization_failure) 重试策略            | §5.1 加事务异常处理：捕获 `P2034` → 1 次自动重试 → 仍失败 → 409 CONFLICTED；§11 checklist 同步登记                                                 |
| B-3  | `WikiDiffItemsSchema` 字段约束未定义（含 deletes 上限）           | §11.1 新增完整 zod 骨架：slug 正则 / body ≤200K / oneLiner ≤280 / sources 单页 ≤50 / creates+updates 各 ≤100 / deletes ≤20 / span 非负 + start≤end |

### C. Doc-drift（reviewer R3 + architect R3）

| 编号 | 问题                                                                  | v1.2.1 修订                       |
| ---- | --------------------------------------------------------------------- | --------------------------------- |
| C-1  | §3.1 line 203 "★ 7 张新表"（v1.2 §4.1 已改 10 张但 §3.1 漏带）        | line 203 "10 张新表"              |
| C-2  | §6 标题 line 712 "已合并到 12 个"（v1.2 §2.2 已改 13 但 §6 标题漏带） | "13 个 endpoint，含 export"       |
| C-3  | §14 评审纪要索引未更新到 R2 已完成                                    | §14 完整链接 R1/R2/R3+R4 三份纪要 |

### D. 实施约束（architect R3 P2）

| 编号 | 问题                                                                           | v1.2.1 修订                                                                                         |
| ---- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| D-1  | `WikiPageEmbedding.model @default("")` 写入侧无非空约束（避免 query 维度漂移） | §11 checklist 加 "EmbeddingService 写入时必须填非空 model 名 + spec 加 'model 字段为空时拒写' 断言" |

---

## 3. R4 复核（仅 reviewer + security 两路对 v1.2.1）

| 路径             | 结论                               | 核对                                                                                                                                                                    |
| ---------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| reviewer         | **APPROVED-FOR-IMPLEMENTATION** ✅ | §3.1 "10 张" 与 §6 "13 个" 均 FIXED；R3 P2/P3 非阻塞项实施集成测试覆盖即可                                                                                              |
| security-auditor | **APPROVED-FOR-IMPLEMENTATION** ✅ | R3 P1 三项（deletes 重算 + Step D 锁 + Step G2 删页）全 FIXED；R3 P2 三项（Step C 实时重算 + P2034 重试 + WikiDiffItemsSchema deletes ≤20）全 FIXED；OWASP 维度无新遗漏 |

---

## 4. 跨 4 轮最终计票

| 维度      | R1 (v1.0)                 | R2 (v1.1)              | R3 (v1.2)                   | R4 (v1.2.1) | 终态 |
| --------- | ------------------------- | ---------------------- | --------------------------- | ----------- | ---- |
| architect | NEEDS-CHANGES (3 BLOCKER) | APPROVED ✅            | APPROVED ✅ (R3 复核)       | -           | ✅   |
| reviewer  | NEEDS-CHANGES (3 P0)      | NEEDS-CHANGES (9 新项) | NEEDS-CHANGES (2 doc-drift) | APPROVED ✅ | ✅   |
| security  | NEEDS-CHANGES (2 P0)      | NEEDS-CHANGES (2 P1)   | NEEDS-CHANGES (1 P1+3 P2)   | APPROVED ✅ | ✅   |
| tester    | NEEDS-CHANGES (1 BLOCKER) | APPROVED ✅            | APPROVED ✅ (R3 复核)       | -           | ✅   |

**4/4 APPROVED-FOR-IMPLEMENTATION** 共识达成于 R4。

---

## 5. 元教训（4 轮 + 总迭代）

1. **设计文档与代码库实状对齐是第一责任**：v1.0 → v1.1 修订主因（3 BLOCKER 全是虚构 entity），grep 一次 schema/facade 就能避免。
2. **新增 schema 字段必须立即写 Prisma `@relation`**：v1.1 → v1.2 修订主因（5 处缺 FK 关系声明）。
3. **数字一致性是文档自洽的低 hanging fruit**：v1.0/v1.1/v1.2 各有数字漂移（7/10、12/13），每次都是"修了一处漏一处"。R3 reviewer 把它形式化为 "PARTIALLY-FIXED" 类别。
4. **新增机制必带新攻击面，安全审查每轮都要重做**：v1.1 引入 baselineHash + affectedSlugs，security 立即指出 IDOR + 信任问题；v1.2 引入 deletes 数组，security 立即指出 Step B 漏 + Step D 锁不全 + Step G 缺。**"上次过了就不管"是安全审查的反模式**。
5. **4 路评审的真实价值**：单 reviewer 找不到 schema 关系缺漏，单 security 找不到表数量漂移，单 architect 找不到 spec 可测性盲区。**多路并行独立**（不串通）才能覆盖 12 维度。
6. **APPROVED 不是终点 — 跨轮 APPROVED 才是**：architect 在 R2 就 APPROVED，但 R3 又找出 5 项小补充（doc-drift + P2034 + model 写入约束）。**最终共识必须是同时 APPROVED 才算**，错峰 APPROVED 不算。
7. **小修不另起 v1.3 而合入 v1.2.1**：R3 reviewer 的 2 处 doc-drift + security 的 P1+P2，体量适合在 v1.2 上做 patch（不大改），新版本号用 ".1" 表示 patch level，节省一轮全文审查时间。

---

## 6. 实施前最后建议（实施时按 P0 phase 执行）

1. P0 SQL migration 包括：10 张表 + 5 处 FK SetNull + `wiki_diffs.affected_slugs` GIN partial index + KnowledgeBase.wikiEnabled + ExportSourceType.WIKI + ExportFormat.TARBALL + KnowledgeBase 行号校验
2. P0 同步落盘：`docs/architecture/decisions/ADR-XXX-wiki-vs-graph-coexistence.md`
3. P1 必测 spec 文件（13 个，含跨 KB IDOR / wikiEnabled gate / SELECT FOR UPDATE 串行 / WikiDiffItemsSchema zod parse / affectedSlugs 实时重算 / baselineHash 确定性 / PATCH edit 写 revision / revert 跨页 IDOR / link-parser 10 条边界 / slug-normalize / model 字段非空写入 / cron+手动 lint 并发 / wiki-query Branch B 不加载非 top-K）
4. 实施集成测试（非 Jest 单元）：`SELECT FOR UPDATE` 行锁争抢实测、Prisma `P2034` 重试触发实测
5. wiki/ 子目录加入 `jest.config.js` coverageThreshold（branches:70/functions:80/lines:80/statements:80）
