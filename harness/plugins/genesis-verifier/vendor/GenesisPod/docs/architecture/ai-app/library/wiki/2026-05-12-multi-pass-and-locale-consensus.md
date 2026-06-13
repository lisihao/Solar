# LLM Wiki 多 Pass 编排 + 多语言并存集体审视共识

> **评审对象**：LLM Wiki 内容增强方案 v2（在 v1.5.3 已上线基础上引入多 pass 编排 + 多语言并存）
> **评审形式**：4 路 subagent 并行集体审视（reviewer 视角分别为 架构边界 / token-失败回退 / schema-migration / spec-可验证目标）
> **评审日期**：2026-05-12
> **触发上下文**：用户反馈"LLM 生成的 WIKI 内容相对简陋"+ 希望支持多语言；用户答案锁定为单页太短 / 扁平 / 缺交叉引用 / 漏概念（四项全选）+ 单页多语言版本并存 + 多轮编排预算
> **评审结论**：4/4 CONDITIONAL APPROVE — 0 P0（无方向性阻塞），10 项 BLOCKER 必改 + 15 项 P1 整改 + 3 个剩余决策点（用户已确认）
> **后续动作**：归档本共识 → P0 前置（TaskProfile cap 独立 PR） → P1 / P2 / P3 共 16 commit 实施 → P4 端到端守门

---

## 1. 评审范围与背景

### 1.1 现状基线

- 当前 wiki 由 `WikiIngestService.ingestInternal()`（`backend/src/modules/ai-app/library/wiki/wiki-ingest.service.ts:138`）走单轮 chat + JSON 输出，`taskProfile: deterministic + long`（=8000 maxTokens）
- `wiki-ingest.skill.md` 已有 LANGUAGE RULE 让 wiki 跟随源文档语言（commit `3952c84e7`），但只能单语
- 端到端 product funnel 已闭环（参考 [llm-wiki.md](llm-wiki.md) v1.5.3 + [项目实施记录]）

### 1.2 改造目标

| 痛点形态                                                      | 改造方向                                 |
| ------------------------------------------------------------- | ---------------------------------------- |
| 单页篇幅短（受 `outputLength: 'long'` = 8000 maxTokens 钉死） | 多轮编排 + 章节级生成                    |
| 章节结构扁平、缺 H2/H3 骨架                                   | 章节结构 prompt + STRUCTURE RULE         |
| `[[link]]` 交叉引用稀疏                                       | 独立 cross-link pass 注入位点            |
| 源文档命名实体覆盖率漏                                        | outline pass 显式 coverageMap            |
| 单语锁定（zh / en 源不能并存）                                | `WikiPage.locale` + `translationGroupId` |

### 1.3 用户答案锁定

- 简陋形态：单页太短 + 扁平 + 缺交叉引用 + 漏概念（全选）
- 多语言模式：单页多语言版本并存（同概念 zh / en 各一份 page，translation 关系显式维护）
- 改造预算：多轮编排 + 章节级生成（接受 schema 微调）

---

## 2. 评审结论汇总

| 评审角色                        | VERDICT             | BLOCKER       | P1 整改       | 关键发现                                                                                         |
| ------------------------------- | ------------------- | ------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| **A** 架构边界                  | CONDITIONAL APPROVE | 0             | 3             | `wiki-lint.service.ts:234-370` 已有同构 3-pass 编排先例，verify:arch 92/92 已绿 — P2 不破 MECE   |
| **B** token / 失败回退 / BYOK   | CONDITIONAL APPROVE | 7             | —             | Token 倍数被 plan v1 低估，未缓存 ×20-30，必须 cache + partial progress + 并发节流 + budget 拆分 |
| **C** schema / migration / 并发 | CONDITIONAL PASS    | 6             | —             | `WikiDiff.affectedSlugs` 与 `WikiPageLink.toSlug` 必须升级，否则跨 locale 假阴性 / 锁污染        |
| **D** spec / 可验证目标         | CONDITIONAL APPROVE | 1             | 6             | 4 条退场条件全是弱标准，必须 fixture + golden + 概念覆盖断言；mock 模式 by-operationName 路由    |
| **合计**                        | **4/4 CONDITIONAL** | **10 唯一项** | **15 唯一项** | 0 方向性 P0 — 方案在正确轨道，缺口集中在工程纪律层                                               |

---

## 3. 主对话独立复核（按 feedback_verify_agent_assertions 100% 复核架构性正向断言）

| 断言                                                                     | 来源         | 复核结果                                                                                                                                                                                                    | 影响                                                                                                        |
| ------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `wiki-lint.service.ts:234-370` 三 LLM pass 独立 `chat.chat()` 串行编排   | A            | ✅ 准确：STALE / CONTRADICTION / DATA_GAP 三段分别走 `operationName: library-wiki-lint-{stale\|contradiction\|data-gap}`，每段 try/catch + logger.warn                                                      | 为 P2 多 pass 编排提供直接同构先例，**MECE rule 1 不破**                                                    |
| wiki-lint pass `fail-tolerant`（每 pass `logger.warn` 不阻塞其他 pass）  | 主对话新发现 | ✅ `wiki-lint.service.ts:271-275, 317-321, 365-369`                                                                                                                                                         | 与 plan v1 "任一 pass fail 整 diff 拒绝"（fail-closed）冲突 → 印证 B 的 partial-progress 建议有架构先例对齐 |
| `wiki-diff.service.ts:157-194` collision detection 用纯 `Set<slug>` 比对 | C            | ✅ `:157-161` `new Set<string>([...creates.map(c => c.slug), ...updates.map(u => u.slug), ...deletes])`；`:189-192` `otherSlugs` 同；`:194` `intersection = [...myAffected].filter(s => otherSlugs.has(s))` | P3 跨 locale 同 slug 必假阴性/反锁 — BLOCKER 论证铁证                                                       |
| `wiki-diff.service.ts:264-269` `FOR UPDATE` raw query 按 slug            | C            | ✅ `SELECT id FROM "wiki_pages" WHERE "knowledge_base_id" = ${kbId} AND "slug" = ANY(${affectedSlugs}::text[]) FOR UPDATE`                                                                                  | 同上 — P3 跨 locale 必反锁                                                                                  |
| `WikiPage @@unique([knowledgeBaseId, slug])`                             | C 提供       | ✅ `wiki.prisma:39`                                                                                                                                                                                         | P3 必须升级为 `(kbId, slug, locale)`                                                                        |
| `WikiPageLink @@id([fromPageId, toSlug])`                                | C 提供       | ✅ `wiki.prisma:106`                                                                                                                                                                                        | P3 必须 PK 加 `toLocale?`，null = "任意 locale" fallback                                                    |
| `WikiPageEmbedding @@unique([pageId, resolution])`                       | C 提供       | ✅ `wiki.prisma:149`                                                                                                                                                                                        | 每 locale page 独立 pageId，约束自动 OK 无需改                                                              |
| `SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/`                      | D / C        | ✅ `wiki-diff-items.schema.ts:20`                                                                                                                                                                           | P3 slug 仍 ASCII，不动                                                                                      |
| outputLength `extended: 16000` 在 BYOK 4 主流 provider 必 400            | B            | ⚠️ 方向正确（主流 max output ≤ 8192），具体数字需在 P0 前置 PR 里复核模型规格表                                                                                                                             | P1 outputLength 保持 'long' 8K，待 P0 cap 后再升档                                                          |

---

## 4. BLOCKER 必改清单（10 项）

> 来源标注：A/B/C/D 后接 reviewer 内部编号。每项给出"问题 → 修订"对。

### B1 — outputLength='extended' (16K) 跨 provider 必 400

- **问题**：OpenAI gpt-4o / Claude Sonnet 4.5（thinking 关）/ Grok-2 max output 均 ≤ 8192；plan v1 直接升 'extended' 16K 会让 BYOK 走这三家的用户 400
- **修订**：
  - P1 outputLength **保持 `'long'`** （8000 maxTokens）
  - P2 章节级单 page 也用 `'long'`
  - P0 前置独立子 PR：`ai-engine/llm/` TaskProfile 解析层加 `Math.min(profile.maxTokens, model.maxOutputTokens)` cap
  - 模型规格表（OpenAI gpt-4o 8192 / Claude Sonnet 4.5 8192 thinking 关 / Grok-2 8192 / gpt-4o-mini 16384）

### B2 — section-fill 部分失败 fail-closed 不可接受

- **问题**：N=30 跑到 25 fail 时，BYOK 用户已付 $10，零产出
- **修订**：
  - 引入 `WikiIngestDraft` 临时表（partial-progress checkpoint）：每 page 成功 → upsert
  - 新增 `WikiKnowledgeBaseConfig.ingestSectionFailureToleranceRatio Float @default(0.2)`
  - 失败比例 ≤ 0.2 → 部分 PENDING + `partial=true` 标记
  - 失败比例 > 0.2 → 整体拒绝，WikiIngestDraft 残留可恢复
  - outline / crosslink fail 仍 fail-closed（fail-tolerant 只针对 section）

### B3 — section-fill 串行 30 次必触 TPM/RPM throttle

- **问题**：单次 ingest 撒 2.4M TPM，30 秒内必触 throttle；纯并发更糟
- **修订**：
  - 新增 `WikiKnowledgeBaseConfig.ingestSectionConcurrency Int @default(3)`
  - service 层主动 throttle：读现有 RPM/TPM budget，超 80% 插入 backoff
  - 不让 LLM 层抛错回到我们这

### B4 — cron MULTI 模式 daily budget 计数失控

- **问题**：现 `autoIngestDailyBudgetCalls=20` 按 1 ingest = 1 call 计数；MULTI 下 1 ingest = N+2 calls，真实 chat 量 20×32=640 次，BYOK 账单失控
- **修订**：
  - 拆 `WikiKnowledgeBaseConfig.autoIngestDailyChatCallBudget Int @default(50)` 单独记账 chat.chat 次数
  - `auto-ingest-daily-budget.service` 同 commit 同步改

### B5 — Prompt cache 命中率塌

- **问题**：三个新 skill markdown 是三个不同 system prompt，各 1-3K tokens；Anthropic prompt cache 按 prefix 完全匹配；切换 system prompt = 整个 prefix cache miss + cache-write（$3.75/1M 高费率）
- **修订**：
  - 抽离 `WIKI_INGEST_COMMON_HEADER`（≥ 1024 tokens，含 LANGUAGE / 格式契约 / source 规则 / 安全约束）
  - 三个 skill 顶部嵌入相同 prefix（通过 `{{include}}` 或拷贝）
  - 用 `cache_control: ephemeral` 标记 cacheable
  - 退场指标：`cache_read_input_tokens / total_input_tokens ≥ 0.7`

### C2 — `WikiDiff.affectedSlugs` 跨 locale 假阴性 / 反锁

- **问题**：现 `wiki-diff.service.ts:157-194` collision 按纯 slug Set 比对、`:264-269` FOR UPDATE 按 slug；P3 后两条 diff 改 `slug=auth,locale={zh,en}` 时假阴性放行（应阻止反锁住）；同 locale 同 slug 双 update 仍正确
- **修订**：
  - `WikiDiff.affectedSlugs String[]` → `affectedKeys String[]`（format: `slug:locale`）
  - collision 改按 `affectedKeys` Set 比对
  - FOR UPDATE raw query 改为 row-value `(slug, locale) IN (VALUES ...)` 形式
  - 数据 migration `UPDATE "wiki_diffs" SET "affected_keys" = ARRAY(SELECT s || ':zh' FROM unnest("affected_keys") AS s) WHERE status = 'PENDING'`

### C3 — `WikiPageLink (fromPageId, toSlug)` 跨 locale 链接污染

- **问题**：toSlug 不带 locale，等于"一个 fromPage 链到任意 locale 的 toSlug"，同 fromPage 改 locale 后旧 link 残留
- **修订**：
  - PK 改 `@@id([fromPageId, toSlug, toLocale])`
  - 新增 `toLocale String? @db.VarChar(8)`，null = "任意 locale" fallback
  - 现存 link backfill `to_locale = 'zh'` 后再加 PK 约束（migration 三步走）

### C6 — 旧 PENDING WikiDiff items JSON 无 locale 字段

- **问题**：P3 部署瞬间，库里可能有 status=PENDING 的旧 WikiDiff；items JSON 没 locale；apply 路径 zod parse 会 reject
- **修订**：
  - 所有 P3 新增字段必须 `.default('zh')` 或 `.optional()`，绝不 required
  - service 层在 build creates 时显式归一化
  - **禁止** 写一次性 in-place JSONB data migration（高风险无必要，zod default 就够）

### C7 — LLM hallucinate translationGroupId 撞已有 UUID

- **问题**：plan v1 让 outline pass 输出 `translationGroupId`；LLM 几乎肯定会重复使用前文见过的 UUID、或输出非 UUIDv4 串
- **修订**：
  - skill prompt 让 LLM 输出 `groupLabel: string`（任意标签，比如 concept 英文名）
  - service 在 `passOutline()` 返回后**忽略**任何 UUID，按 `(kb-context, groupLabel)` 在本轮 outline 内 dedupe → `crypto.randomUUID()` 重生
  - zod schema **不接收** `translationGroupId` 字段
  - collision 风险归零

### D3 — wiki-spec-followup 4-commit 零 spec 缺口未处理

- **问题**：[[wiki-spec-followup-2026-05-12]] 已声明 P0 blocker：commit 3952c84e / 6e0457e8 / 4b0a50d9 / 74383da3 这 4 个主线 commit +112 行零 spec；74383da3 的 `truncatedOneLiners` 软兜底逻辑（`wiki-ingest.service.ts:336-362`）与 P1 退场条件"oneLiner trim 退化率不增"直接相关，**没有锁定测试，P1 退场条件本身无法验证**
- **修订**：
  - **P1 commit 1 强制前置补 4 spec**（test commit + lock 现有行为）
  - 74383da3 的 `truncatedOneLiners` 计数器顺手 expose 为可观测 metric（返回值 `{diff, metrics}` 或 service 上挂 `lastIngestMetrics`）

---

## 5. P1 整改清单（15 项，非 BLOCKER 但纳入修订）

> 每项 reviewer 都标注了来源；下表为 plan v2 最终决定的修订形态。

### A 来源（架构边界 — 3 项）

| #      | 项                                                                                                  | 修订                                                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1     | `computeMissingXrefs` 纯 SQL JOIN `tp.slug = l.to_slug` 不带 locale → MISSING_XREF 语义稀释         | P3 同 commit 修 SQL 加 locale 谓词或 fallback 显式注释；linke 语义在 plan 显式决策                                                                                                     |
| A2     | P3 实际改 4 处 `findUnique({where: {knowledgeBaseId_slug: ...}})` 复合 key 不是 `findFirst({slug})` | plan §P3 改为"4 处 `knowledgeBaseId_slug` 复合 key 改为 `knowledgeBaseId_slug_locale`"；调用点 `wiki-page.service.ts:69/155/174 + wiki-diff.service.ts:342`；新 client 类型 break 修复 |
| A3     | 既有 wiki-page / wiki-diff spec 13+ 处 mock fixture 漏算补 `locale: 'zh'` 修复量                    | P3 commit 1 显式工程量条目                                                                                                                                                             |
| A 观察 | `ingestPassMode` 默认值文本矛盾（schema `@default(SINGLE)` vs "新建 KB 默认 MULTI"）                | schema `@default(SINGLE)` 兜底；KB-create service 层覆写 MULTI（双层语义消歧）                                                                                                         |

### B 来源（token / 失败回退 — 反向洞察类 3 项）

| #                | 项                                                           | 修订                                                                                                                                                                           |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B6               | 缺 pass 级独立 circuit breaker                               | `WikiIngestCircuitBreaker` 私有类，per-ingest-session 状态（per-pass counter），不写 module-level state（[claude-code-build 反向洞察 #8](../../../../.claude/CLAUDE.md#L197)） |
| B 反洞察 #3      | section pass 复用 wrappedDocs 数组，禁止 mutate 否则破 cache | per-pass clone wrappedDocs 引用                                                                                                                                                |
| B 反洞察 #4 / #6 | 多 pass 后某 pass 抛错时前序 pass 的 token 已记账            | 在 `auto-ingest-daily-budget.service` 显式累加 partial usage（不只 success path）；P2 各 pass 关闭 thinking                                                                    |

### C 来源（schema / migration — 4 项）

| #   | 项                                                                                   | 修订                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | migration 锁表风险（`DROP CONSTRAINT + ADD CONSTRAINT UNIQUE` 全表 rebuild）         | 拆 3 commit：(i) `ADD COLUMN` (ii) `CREATE UNIQUE INDEX CONCURRENTLY` 单 statement 非事务 (iii) `DROP CONSTRAINT, ADD CONSTRAINT USING INDEX` |
| C5  | WikiPageEmbedding silent skip 隐患（EmbeddingService 写入侧尚未在 ingest path 调用） | plan 明文"P3 不在 ingest 接通 EmbeddingService 写入；en/zh page 均无 embedding，统一推迟到 P3a 后续 sub-iteration"；避免范围外膨胀            |
| C8  | P2/P3 各一个 migration 文件 + schema.spec.ts 扩展 default 断言                       | 1 commit 1 migration；`__tests__/schema.spec.ts` 加 default 值断言                                                                            |
| C10 | P3 不依赖 P2 可独立 ship                                                             | plan 明文：SINGLE 模式下 ingest 也能产单 locale page，P3 落地后只是 enabledLocales 决定该 KB 是否走多 locale                                  |

### D 来源（spec / 可验证目标 — 4 项）

| #   | 项                                                                                                                 | 修订                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 退场条件 4/4 弱标准                                                                                                | 建立 `__tests__/fixtures/ingest-baseline/` + `baseline.golden.json` + `expected-concepts.json`；退场断言全部可机器判定                   |
| D2  | spec 矩阵缺关键路径（section 部分失败、outline 截断策略、translationGroupId 碰撞、跨 locale link fallback 三路径） | spec 矩阵补 it（与 BLOCKER #2 / #9 / #7 协同）                                                                                           |
| D4  | mock 模式 `mockResolvedValueOnce` 链脆弱                                                                           | **by-operationName 路由 mock**：`jest.fn().mockImplementation(({operationName}) => map[operationName] ?? throw)`，写入 plan §P2 强制规范 |
| D6  | `layer-boundaries.spec.ts` 守护 skill md（PromptSkillBridge fs 读盘逃出 import 网）                                | 新增 1 it：ai-engine 不得 `fs.readFileSync` 命中 `modules/ai-app/library/wiki/skills/`                                                   |

---

## 6. 用户已确认决策

| 决策点                       | 选项                            | 理由                                                                          |
| ---------------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| TaskProfile cap 前置时机     | ✅ 独立子 PR 先行               | 全局受益（不仅 wiki，所有 ai-app LLM 调用都被这个 cap 保护）；review 责任面小 |
| P3 前端 locale chip 测试覆盖 | ✅ 新建 Playwright E2E（+1 天） | 跨浏览器验证 + 未来可回归；P3 新增 commit 6                                   |
| P2 commit 切片粒度           | ✅ 6 commit 保持                | 严格一事一议；4 路 reviewer 逐 commit diff 对齐最顺                           |

---

## 7. 实施切片（共 17 commit）

```
归档（实施第 1 commit）
└─ docs(library/wiki): archive 2026-05-12 multi pass and locale consensus from 4 way collective review

P0 前置（独立子 PR）
└─ feat(ai-engine/llm): cap profile maxtokens to model max output to prevent byok 400

P1 单页扩容 + 章节结构（3 commit，worktree wiki-spec-followup + wiki-p1-expand）
├─ test(library/wiki): lock spec for oneLiner trim + lang rule + lint modelType + batch lint
├─ test(library/wiki): seed ingest baseline fixtures and expected concepts golden
└─ feat(library/wiki): expand body and add H2 H3 structure with coverage self check in ingest skill

P2 多轮编排（6 commit，worktree wiki-p2-multi-pass）
├─ feat(library/wiki): add wiki ingest pass mode and ingest draft table for multi pass
├─ feat(library/wiki): split wiki ingest skill into outline section crosslink with shared header
├─ feat(library/wiki): add zod schemas for outline section crosslink pass outputs
├─ feat(library/wiki): implement outline and section fill passes with partial progress
├─ feat(library/wiki): implement crosslink pass and merge multi pass into final diff
└─ test(library/wiki): cover multi pass orchestration with by op mock routing

P3 多语言并存（6 commit，worktree wiki-p3-locale，与 P2 独立）
├─ feat(library/wiki): add locale and translation group columns to wiki page
├─ feat(library/wiki): create unique index for kb slug locale concurrently
├─ feat(library/wiki): swap unique constraint to use locale aware index and upgrade affected keys
├─ feat(library/wiki): wire wiki page services for locale aware lookups and group fallback
├─ feat(library/wiki): add locale chip and url state to wiki reader
└─ test(library/wiki): e2e playwright for locale chip and cross-locale link fallback
```

每条均 < 100 chars / 小写 type / `library/wiki` scope / 无句号 / Co-Authored-By 行附加。

---

## 8. 不做范围（明确排除）

- 不接 Branch B（query fallback 由 [llm-wiki.md](llm-wiki.md) §"剩余打磨项"覆盖）
- 不拆 WikiTab.tsx 单文件 2212 行（P3a 后续 sub-iteration 跟）
- 不动 P3b 真实 userHash from useAuth session
- 不引入 i18next / next-intl 等 UI i18n 框架（`useTranslation()` 已存在）
- 不做全量自动翻译镜像（用户答案已排除）
- 不做 lint batch 数量上限（[[wiki-spec-followup-2026-05-12]] 已决策 P2 不修）
- 不在 P3 接 EmbeddingService 写入侧（C5）
- 不在 ingest path 直接 mutate wrappedDocs（B 反洞察 #3）

---

## 9. 退场条件（可机器判定）

### P1 退场

- `pages.filter(p => /^## /m.test(p.body)).length / pages.length ≥ 0.8`
- `avg(p1.bodyLen) / avg(baseline.bodyLen) ≥ 1.5`
- `metrics.truncatedOneLiners <= baseline.truncatedOneLiners`
- baseline 来源：`backend/src/modules/ai-app/library/wiki/__tests__/fixtures/ingest-baseline/baseline.golden.json`

### P2 退场（相对 P1 baseline）

- page 数 ≥ SINGLE 模式
- 平均 body 长度 ≥ 1.5× SINGLE
- `[[link]]` 出现次数 ≥ 3× SINGLE
- `intersection(extractedSlugs, expectedConcepts).size / expectedConcepts.size ≥ 0.8`
- `cache_read_input_tokens / total_input_tokens ≥ 0.7`（验证 prompt cache 命中）

### P3 退场

- `npx prisma validate` + `npx prisma generate` 合法
- 测试 DB `npx prisma migrate deploy` 3 个 migration 全过
- 同 translationGroupId 内 zh / en 各产一 page
- URL `?locale=en` 切换 reader pane 内容（Playwright E2E 断言）
- 跨 locale `[[link]]` 精确命中 / 同 group fallback / 全部 miss 三路径正确

### P4 守门

- `npm run verify:arch` 92+/92+ 三次（P1 后 / P2 后 / P3 后）
- `npm run verify:full` 在主分支跑通
- 每个 commit 过 `.husky/pre-commit` + `commit-msg`
- 2 verifier APPROVE 才 cherry-pick to main

---

## 10. 工作流

- **P0 前置** 直接在 worktree `wiki-p0-task-profile-cap`
- **P1 commit 1 / 2 / 3** 在 worktree `wiki-spec-followup`（前置 spec 缺口）+ `wiki-p1-expand`
- **P2 commit 1-6** 独立 worktree `wiki-p2-multi-pass`
- **P3 commit 1-6** 独立 worktree `wiki-p3-locale`（与 P2 独立）
- 每 worktree 完成后 4 路 reviewer 共识 → 整改 → 2 verifier APPROVE → cherry-pick to main
- Sub-agent 委派必须含白名单 + 附 Prisma model + 附 DTO 类型（`.claude/CLAUDE.md` L248-249）
- 不用 `git checkout -- .` / `git reset --hard` / `--no-verify`（`.claude/CLAUDE.md` L251）

---

## 11. 相关文档

- 方案主文档：[llm-wiki.md](llm-wiki.md) v1.5.3
- 历史评审：[r1](llm-wiki-review-r1.md) / [r2](llm-wiki-review-r2.md) / [r3-r4](llm-wiki-review-r3-r4.md) / [r5-r6](llm-wiki-review-r5-r6.md) / [r7](llm-wiki-review-r7.md)
- 项目铁规：[.claude/CLAUDE.md](../../../../.claude/CLAUDE.md)
- ai-engine 规则：[.claude/rules/ai-engine.md](../../../../.claude/rules/ai-engine.md)
- 二轮审视前置缺口：memory `wiki-spec-followup-2026-05-12`

---

**最后更新**：2026-05-12
**评审结论**：4/4 CONDITIONAL APPROVE — 10 BLOCKER + 15 P1 已全部纳入 plan v2 实施切片
**版本**：v1.0
