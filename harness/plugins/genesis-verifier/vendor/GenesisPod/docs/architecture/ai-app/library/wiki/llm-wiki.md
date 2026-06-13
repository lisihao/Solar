# Library - LLM Wiki 设计方案

> 在现有 `ai-app/library` 之上引入 Karpathy 在 2026-04-04 提出的 LLM Wiki 模式，让知识库从"每次 query 重 derive"升级为"持续编译的 markdown wiki"，与现有 `KnowledgeBase` / `KnowledgeBaseDocument` / RAG 共存且不双源。

> ⚡ **v2.0 重塑补丁 (2026-05-12 进行中)**：v1.5.3 落地后用户反馈 5 类质量差距（仅产 SOURCE 类 / 内容稀疏 / 无图 / 无多语 / 无法硬删 / 未接 agent 查询）。**v2.0 增量改造方案**详见 **[llm-wiki-v2-rebuild-plan.md](./llm-wiki-v2-rebuild-plan.md)** — 5 个 PR (W1-W5) 复用 Harness/Engine primitives，**不重写 v1.5.3 已落 schema/service/UI**，仅增量补：预解析管线 / 多 pass ingest / 多语言 / ToolRegistry 接入 / 硬删除。本文档（v1.5.3）继续作为基础架构真源，v2.0 改造点在补丁文档逐项 cross-reference 本文档章节。

**最后更新**：2026-05-09（v1.5.3，v2.0 补丁见上方链接）
**版本**：v1.5.3（R7.2 reviewer + architect 同时指出 5 处文档自相矛盾——追溯修订声明未真正落到正文，v1.5.3 完成穿透替换达成 4/4 共识）
**状态**：✅ **APPROVED-FOR-IMPLEMENTATION**（R7.3 第四轮共识：reviewer/architect/security/tester 4/4 APPROVED，进入 P0a 实施）
**总工程量**：13 天（v1.4→v1.5→v1.5.1 累计调整：P0a 1.5→2→2.5 天 + P3 4→5 天拆 P3a/P3b，合计 12→13 天）
**对应代码区域**：`backend/src/modules/ai-app/library/wiki/`、`backend/src/modules/ai-engine/content/markdown/`、`backend/src/modules/ai-engine/knowledge/synthesis/`（增低级 API）、`backend/src/modules/ai-engine/knowledge/consistency/`（新建仅 stale-detector）、`frontend/app/library/wiki/`
**外部参考**：

- Karpathy 原 gist：<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>
- 引用实现 1：<https://github.com/lucasastorian/llmwiki>（FastAPI + Next.js + MCP，文件 SoT + SQLite FTS5）
- 引用实现 2：<https://github.com/Astro-Han/karpathy-llm-wiki>（Agent Skill 形态）
- R1 评审纪要：[llm-wiki-review-r1.md](./llm-wiki-review-r1.md)
- R2 评审纪要：[llm-wiki-review-r2.md](./llm-wiki-review-r2.md)

> **v1.5.3 vs v1.5.2 主要变更**（吸收 R7.2 reviewer + architect 双重阻塞，完成 7 处穿透替换）：
>
> | 类型                                             | 修订点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
> | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 穿透替换（reviewer P1）                          | v1.5.2 §7.3 + 顶部 changelog 声明"追溯修订所有跨 KB IDOR 为 404"，但 §6 / §11 / 顶部 changelog 累积条款 7 处字面仍 `ForbiddenException` / "403"。v1.5.3 全部就地替换 + 加 "(v1.5.x 改 NotFound 消 oracle)" 标注：(1) 顶部 changelog v1.5.1 表 "(c) IDOR 仍 403"；(2) §2.3 R2 决策表 revert 跨页归属校验；(3) §6 diffId IDOR 防护代码块；(4) §6 revert 跨页 IDOR 代码块（throw 行）；(5) §11 wiki-diff.service apply/dismiss 入口；(6) §11 v1.2 revert 跨页校验；(7) §11 v1.5.1 `?kb=<kbId>` URL 加载条款 |
> | timing oracle 收尾（security P2）                | §11 加 "404 路径 timing oracle 列入 accepted risk 不缓解"——三种 404 路径（hasAccess fail / resource.kbId mismatch / wikiEnabled=false）响应时延略有差异（多/少 1 次 DB 查询），但 timing 攻击对外网 SaaS 场景实际可利用性低（jitter 高 + rate limit 60/min），强制 constant-time 收益不抵成本；显式声明并记录                                                                                                                                                                                            |
> | i18n regex 限制（security P2）                   | §6 search endpoint zod regex `/^[\w\s\-一-龥]+$/` 仅覆盖 CJK 基础区，不含日文假名 / 韩文 / emoji / 希腊字母——非安全风险但 i18n UX 缺口；v1.5.3 改用 Unicode property `/^[\p{L}\p{N}\p{M}\s\-]+$/u`（regex `u` flag），支持全 Unicode letter/number/mark；ReDoS 安全性不变（线性匹配）                                                                                                                                                                                                                    |
> | list endpoint 越权数组长度 oracle（security P2） | §11 第 2 项扩：所有 list endpoint（pages / backlinks / lint findings / log entries）当 hasAccess fail 时统一返 **404 而非空数组**；切断"返回数组长度=0 vs 404"的间接探测路径                                                                                                                                                                                                                                                                                                                             |
> | configCreated 断言（tester P2）                  | §11 第 (7) 项 wiki-enable-toggle spec 显式补 1 条 "首次启用断言 `configCreated=true` + WikiKnowledgeBaseConfig 行被 upsert"                                                                                                                                                                                                                                                                                                                                                                              |
>
> **R7.2 元教训**：v1.5.2 的"追溯修订"声明在顶部 changelog + §7.3 表 + §11 末尾共 3 处出现，但**累积条款的字面文本散落在 §6 / §11 / §2.3 共 7 处未就地修订**，reviewer + architect 同时阻塞。教训：**doc 级"追溯修订"声明不可替代正文穿透替换**——作者声明"v1.5.x 起此处改为 X"，工程师按邻近条款字面照抄会写错。下次类似修订**必须做 grep 全文穿透替换 + 加 inline 标注 + 评审前自检"已替换 / 未替换"差异**。
>
> **v1.5.2 vs v1.5.1 主要变更**（吸收 R7.1 security 残留 P1 + 文档一致性修订）：
>
> | 类型                          | 修订点                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
> | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | security 残留 P1（消 oracle） | §7.3 失败语义对照表合并 IDOR / page 不存在为统一 404：跨 KB IDOR（`/diffs/:diffId`、`/pages/:slug` 等）service 层校验 `resource.knowledgeBaseId !== kbId` 时返 **404 Not Found**（不返 403），与"合法 KB 内不存在"统一响应；切断 page slug / diff id 的存在性 oracle（攻击者无法时间差区分"slug 存在但跨 KB" vs "slug 不存在"）                                                                                                                                                                                      |
> | security 残留 P1（API 落码）  | §6 API 表追加 `GET /library/wiki/kbs/:kbId/pages/search` endpoint（VIEWER 及以上 + zod schema：`q.string().min(1).max(200).regex` 防 ReDoS + 返回字段白名单 DTO 仅 slug/oneLiner/title/category）；登出钩子覆盖 4 类路径（主动登出 / 401 自动登出 / token 过期 / 多 tab 同步登出）统一调 `clearWikiLocalStorage()`                                                                                                                                                                                                   |
> | wikiEnabled 设置权语义        | §7.5 补充：`wikiEnabled=true` 后 KB EDITOR 可正常使用 wiki（创建/编辑页 / ingest / lint / query），**设置权（toggle wikiEnabled，OWNER/ADMIN）** 与 **使用权（wiki 操作，EDITOR）** 解耦；避免 P3 落码时混淆角色矩阵                                                                                                                                                                                                                                                                                                 |
> | tester P2 测试用例补          | §11 第 8 项扩充：(6) `library-header.spec.tsx` 数据流隔离（断言 `searchQuery` 不变 / `wikiSearchQuery` 变化 / fetch 走专用 endpoint）；(7) `wiki-enable-toggle.spec.tsx` 三角色矩阵（OWNER/ADMIN 通过 / EDITOR 按钮 disabled + 强发请求 403 / VIEWER 整行 disabled）；(8) `url-state-reducer.spec.ts` 文件名级落点；(9) `hasAccess` spy 模板（每 service spec 强制 `jest.spyOn(kbService, 'hasAccess')` 调用次数断言）；(10) `slug-normalize.util.spec.ts` 加 NFKD / 变音符回归 fixture（捕获 4 处 inline 实现差异） |
> | doc drift（reviewer P3）      | §13 第 3 条 "§2.2 共 15 条" 改为"§2.1–2.4 累计决策"不计具体数；§15 标题去版本号 "（不阻塞 R2）"→"（不阻塞 R7.2）"；§3.1 + §13 "engine 能力共 7 项" 标注一致                                                                                                                                                                                                                                                                                                                                                          |
> | architect P2                  | §3.1 末行 "engine 能力共 7 项" 与 §13 v1.5.1 第 1 条 7 项枚举对齐                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
>
> **R7.1 元教训**：第二轮共识达 3.5/4（reviewer / architect / tester APPROVED；security NEEDS-CHANGES 2 项 P1）。残留的 2 项 security P1 都属于"v1.5.1 修订不彻底"——P0-6 redirect/403 语义统一时只考虑了 KB 层面的 oracle，未审视 page/diff 资源层面的 403 vs 404 时间差；落码级 search endpoint 在 §11 描述但漏登记 §6 API 表。**下次设计任务的 security prompt 应明文要求"枚举所有可能的存在性 oracle 路径并统一响应"**，而非按 endpoint 单独修。
>
> **v1.5.1 vs v1.5 主要变更**（吸收 R7 4 路评审反馈）：
>
> | 类型                                                  | 修订点                                                                                                                                                                                                                                                                                                                |
> | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 事实校准（reviewer P0）                               | §7.1 修正实测：activeTab 现状默认 `'data-sources'`（非 `'personal-kb'`），union 含第 4 值 `'graph'`（不在 LibraryTabs 数组，渲染分支独立）；v1.5.1 在 libraryTabs 数组首插入 wiki，graph 分支不动，activeTab 默认值 `'data-sources'`→`'wiki'`                                                                         |
> | 数据流隔离（reviewer P0）                             | §7.2 wiki tab 下 LibraryHeader 不复用全局 `searchQuery` state；新增 `wikiSearchQuery` 独立 state（仅 wiki tab 内有效），placeholder 切换 + 数据流彻底隔离防跨 KB 资源过滤泄露                                                                                                                                         |
> | ai-harness 层声明（architect P0）                     | §3.1 分层图补 L2.5 ai-harness 节点；§5.1 Step 3 明示 wiki-ingest 调用路径——`PromptSkillBridge` 从 `@/modules/ai-harness/facade` 导入（项目惯例，与 research / topic-insights / writing 一致），engine 能力（link-parser / slug / StaleDetector / sanitizeMarkdownBody）从 `@/modules/ai-engine/facade` 导入           |
> | 维度并存声明（architect P0）                          | §1.4 + §2.4 显式说明：v1.5 后 LibraryTabs 跨 2 个语义维度并存——"产品形态维度"（Wiki = LLM 编译知识沉淀）+ "资源容器维度"（personal-kb / team-kb / data-sources）。这是有意识的产品决策，wiki 入口不可被资源容器维度收编（与 KB 是 N:1 关系）                                                                          |
> | wikiEnabled toggle 角色（security P0）                | §7.5 + §11：0 wikiEnabled 空态卡片"启用 Wiki"按钮 + KB 设置区 toggle，**强制 KB ADMIN/OWNER 角色**；EDITOR 路径返回 403；防止 EDITOR 单方面打开 wiki 引入 ingest 暴露面                                                                                                                                               |
> | redirect/404 语义统一（security P0，v1.5.2 追溯修订） | §7.3 + §11 + §6：失败语义分三类——(a) 无 VIEWER access → 通用 redirect 引导态且不带原 kbId（避免 KB 存在性 oracle）；(b) 有 access 但 wikiEnabled=false → 显式空态 §7.5；(c) **IDOR（diff/page/revision/lint finding 跨 KB）→ 404 NotFound**（v1.5.2 追溯修订，与"资源不存在"统一响应切断存在性 oracle，详见 §7.3 表） |
> | P0a 工程量 + 明细（reviewer P1）                      | §3.1 / §8 P0a：工程量 2→2.5 天；附录 §16 列全 16 处 slugify 替换的 `path:line:functionName` 明细，落码 reviewer 可逐项 diff 验证                                                                                                                                                                                      |
> | P3 拆分（tester P0）                                  | §8 P3 拆为 P3a UI 主路径（3 天，wiki sub-header / 三栏 / Diff 审阅）+ P3b 空态/onboarding/老用户兼容（2 天，三态 funnel + KB selector 5 级降级 + What's new toast + URL 状态机）；合计 4→5 天                                                                                                                         |
> | KB selector 过滤范围（security P1）                   | §11 第 2 项扩充：所有返回 KB / page slug 的 endpoint（list / backlinks / lint findings / log entries / search）统一过滤 `wikiEnabled+hasAccess`                                                                                                                                                                       |
> | localStorage 安全（security P1）                      | §7.1 + §11 新增：(1) localStorage key 加 `<userId-hash>` 前缀防共享浏览器跨用户残留；(2) 登出钩子清 wiki 相关 localStorage；(3) localStorage 读 activeTab 后 enum 白名单匹配，未命中回 default（防 open redirect）                                                                                                    |
> | search endpoint 落码级（security P1）                 | §11 第 1 项扩充：wiki tab 下搜索调专用 `GET /library/wiki/kbs/:kbId/pages/search`（kbId 路径段强制 + service 层 hasAccess + 仅返 slug+oneLiner+title），禁路由到全局 `/library/search`                                                                                                                                |
> | onboarding 双源消除（architect P1）                   | §7.5 第二态"0 wikiEnabled KB"列表走通用 KB list endpoint（同 personal-kb tab 用的 endpoint），不在 wiki 模块内复制                                                                                                                                                                                                    |
> | hasAccess 不可缓存（security P2）                     | §11 显式 "service 层 hasAccess 每请求独立查询，禁 Redis / 内存跨请求缓存"，避免权限撤销窗口期放行                                                                                                                                                                                                                     |
> | URL 状态机（tester P1）                               | §7.7 加状态机表：drawer 类（lint / log）可叠加，diff 是 modal 路由独占；同时带 `?lint=1&log=1` 默认右栏 lint 优先；`?diff=X` 进 modal 后 lint/log 自动 dismiss                                                                                                                                                        |
> | default KB 定义（reviewer P1）                        | §7.3 KB selector 解析链第 4 步显式定义："default KB = `WikiPage.updatedAt desc` 第一条 wikiEnabled KB；若 0 个 wikiEnabled，跳过此级到引导态"                                                                                                                                                                         |
> | 测试用例补全（tester P0/P1）                          | §8 各 phase 补：`kb-resolver.spec.ts` 5 级降级 / 三态空态 4 组 fixture / KB selector 服务端过滤 3 条 fixture / CONFLICTED 端到端 / What's new toast 仅一次 + localStorage 解析优先级                                                                                                                                  |
> | 措辞 / DRY（reviewer P2）                             | §1.4 "主形态"行精简至 1 句 + 链 §2.4；changelog 与 §15 第 6 项去重；§13 v1.5 项拆 3 个 bullet；§3.1 与 §8 slugify 列表 DRY 化（仅 §16 附录列明细，正文链过去）                                                                                                                                                        |
> | §15 关闭项（architect P1）                            | 第 6 项 localStorage 跨设备问题：决定 localStorage-only，永不入 DB；接受跨设备首次仍弹 toast 是 acceptable trade-off                                                                                                                                                                                                  |
>
> **R7 元教训**：v1.5 修订一次性引入 8 处变更点（顶部 changelog / §1.4 / §2.4 / §3.1 / §7 / §8 / §11 / §13 / §15），但 4 路评审仍发现 7 项 P0——其中 4 项是"未对照实际代码事实"（reviewer P0 的 activeTab 默认值 + LibraryHeader 数据流 + §11 与 §6 红线一致性 + ai-harness facade 惯例），3 项是"安全细节止于声明未到落码级"（toggle 角色 / redirect 语义 / search endpoint）。**下次设计任务前置 grep 实测覆盖率应达 90% 以上：每条引用现有代码的描述都必须有对应 file:line 引用**，本次只做了路径级核查，未到 line 级。
>
> **v1.5 vs v1.4 主要变更**（产品定位升级 + 实施前现实校准）：
>
> | 类型                        | 修订点                                                                                                                                                                                                                                                                                                    |
> | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 产品定位升级（§1.4 + §2.4） | Wiki 从"KB 内可选子功能"升级为"Library 主形态"——`/library` 默认 tab + LibraryTabs 第一位；Karpathy 原意"the wiki is the primary artifact"在产品入口层面兑现                                                                                                                                               |
> | UI 入口重构（§7）           | 入口由"KB 详情页 + `wikiEnabled=true` 才展示"改为"Library 顶层永远在 + 进入后处理 KB context"；新增 wiki sub-header（KB selector + toolbar）；KB selector 解析顺序 URL `?kb=` → `localStorage.lastWikiKbId` → 唯一 wikiEnabled KB → default KB → 引导态；URL 状态标准化 `?tab=wiki&kb=<kbId>&page=<slug>` |
> | 三态 onboarding（§7）       | 0 KB / 0 wikiEnabled KB / 0 page 三种空态明确 funnel：建 KB → 启 wiki（一键 toggle，不跳设置页）→ ingest 引导（picker + token 估算 + ingestMaxTokens 约束）。这是产品成败的关键路径，方案 v1.4 仅一句"展示 LibraryTabs 项"未覆盖                                                                          |
> | P0a 范围更新（§3.1 + §8）   | "替换全项目 5+ 处 ad-hoc slugify"修订为"≥ 16 处"——实测 grep 结果含 admin / a2a-team-member-adapter / entity-memory / topic-insights/report-assembler / image/infographic / agent-playground / common/export/renderers 等。P0a 工程量从 1.5 天上调到 2 天                                                  |
> | onboarding 兼容（§7 + §11） | 老用户进 Library 默认 tab 由 personal-kb 变 wiki，新增一次性"What's new" toast + "切回旧默认"个人偏好（localStorage，不存 DB）；顶部全局搜索框在 wiki tab 下语义切换为"在当前 wiki 中搜索"，placeholder 联动                                                                                              |
> | 安全 checklist 加项（§11）  | (1) Library 顶层搜索框语义切换防跨 KB 信息泄露（wiki tab 下仅搜当前 KB）<br>(2) KB selector 列表必须经 `kbService.hasAccess(userId, kbId, VIEWER)` 过滤，仅显示用户有权访问的 wikiEnabled KB<br>(3) `?kb=<kbId>` URL 参数加载时 service 层强制 hasAccess 校验，否则 redirect 引导态                       |
> | 与项目规范对齐（§13）       | UI 入口与现有 LibraryTabs pattern 完全一致（中性灰底 + 紫色 violet-500 indicator + LucideIcon），不引入新组件库；Wiki tab `icon: BookOpen` 复用 lucide-react；空态卡片复用现有 LibraryHeader / 通用 EmptyState 组件                                                                                       |
> | 关闭开放问题（§15）         | 第 4 项 "wikiEnabled=false 的 KB UI" 决定：从 LibraryTabs 入口的 KB selector 列表过滤掉，启用引导走 KB 设置区一键 toggle；不再以"tab 隐藏"作为 KB 级条件                                                                                                                                                  |
>
> **R7 4 路 review 已达共识**（reviewer / architect / security / tester）：详见 [llm-wiki-review-r7.md](./llm-wiki-review-r7.md)。
>
> **v1.5 元教训**：v1.0–v1.4 历经 6 轮技术评审达成 4/4 APPROVED，但 4 路 reviewer 集体盯架构合规 / 安全 / 测试 / 简洁度，**漏掉了"产品入口位置"这一维度的审视**——entry surface 决定了 onboarding funnel 与 thesis 兑现度，理应在 §1.4 设计目标定型时与"忠实 Karpathy"并列质询。**下次设计任务的 4 路 prompt 中，reviewer 必须显式审视"用户从 zero-state 到看到核心价值的步数"维度**。
>
> **v1.4 vs v1.3 主要变更**（吸收 R5 architect 真问题）：
>
> | 类型                       | 修订点                                                                                                                                                                                                                                                                                                   |
> | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 砍过度抽象（BLOCKER）      | 删除 `MultiResolutionSearchService`（单一消费方 + 现有 `EmbeddingService` + `VectorService.similaritySearch({filter, topK})` 两步直接表达）；wiki-query 直调                                                                                                                                             |
> | 消除概念双源（BLOCKER）    | `consistency/` 子目录只留 `StaleDetectorService`（quote vs raw hash 是独有语义）；CONTRADICTION/DATA_GAP **折叠为 `CrossCuttingSynthesisService` 低级 API** —— 给现有 service 加 `detectContradictions(documents)` / `detectDataGaps(documents, opts)` 两个公共方法（既不重抄 LLM 编排也不另起 service） |
> | 上提同时清旧双源（非阻塞） | `slug-normalize` 上提同时把现有 5+ 处 ad-hoc slugify（report-artifact-assembler / structural-report-assembler / ai-model-discovery / secret-name.catalog / custom-agent.dto）替换为单一 source；P0a 落地必须包含此清理                                                                                   |
> | facade export 简化         | 砍至 3 项（去 token，与 facade 现有 class 直接 export 模式一致）：`parseMarkdownWikiLinks` (function) / `normalizeMarkdownSlug` (function) / `StaleDetectorService` (class)                                                                                                                              |
> | 加复用 sanitizer           | wiki-page service body 入库前一律走 engine `sanitizeMarkdownBody`（§5.1 Step G + §11 checklist 加项），与 frontend rehype-sanitize 双层防护                                                                                                                                                              |
>
> **R5 元教训（双倍打脸）**：上一轮（v1.3）我说"4 路 reviewer 漏能力归属维度"，本轮 architect 立即把 v1.3 的"上提"找出 1 项 OVER-LIFTED + 1 项 UNDER-LIFTED 与既有 service 重叠。**架构归属审查应该 3 维度问：①是否穿透 facade ②是否过度集中 app（漏上提）③是否过度抽象/与既有重叠（错上提）**，下次设计任务的 architect prompt 必须明文列三项。
>
> **v1.3 vs v1.2.1 主要变更**（按 CLAUDE.md 能力归属判断："能复用 → AI Engine"）：
>
> | 上提项                                                                                                                                        | 旧位置                                 | 新位置                                                                                    | 复用场景                                                          |
> | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
> | `link-parser.ts`（remark AST 抽 [[slug]]）                                                                                                    | ai-app/library/wiki/                   | **ai-engine/content/markdown/wiki-link-parser.util.ts**                                   | writing/research/topic-insights 长文都可能用 wiki-style 跨引用    |
> | `slug-normalize.ts`（title→kebab-case）                                                                                                       | ai-app/library/wiki/                   | **ai-engine/content/markdown/slug-normalize.util.ts**                                     | 通用 slug 规范化（office/research 文档锚点也用）                  |
> | 多分辨率 page embedding 检索能力                                                                                                              | ai-app/library/wiki/wiki-query.service | **ai-engine/rag/multi-resolution-search.service.ts**（新增）                              | 任何"对同一 entity 多 resolution 检索"场景；本 wiki 仅是消费方    |
> | wiki-lint 三类（CONTRADICTION/STALE/DATA_GAP）                                                                                                | ai-app/library/wiki/wiki-lint.service  | **ai-engine/knowledge/consistency/**（新建子目录，与 evidence/extraction/synthesis 同层） | research 报告 / writing 长文跨段落一致性检测                      |
> | wiki-lint 两类（ORPHAN/MISSING_XREF）                                                                                                         | 留 ai-app/library/wiki/                | 留 ai-app/library/wiki/                                                                   | 依赖 `WikiPageLink` 表，wiki 专属，**不上提**                     |
> | `WikiPageEmbedding` 表 + 写入侧                                                                                                               | 留 ai-app/library/wiki/                | 留 ai-app/library/wiki/                                                                   | 表结构是 wiki-specific schema；写入复用 `EmbeddingService` 已合规 |
> | wiki-ingest / wiki-diff / wiki-page / wiki-revision / WikiDiffItemsSchema / baselineHash + affectedSlugs / WikiPageLink 解析后的 service 处理 | 留 ai-app/library/wiki/                | 留 ai-app/library/wiki/                                                                   | wiki 专属业务，无复用                                             |
>
> **facade 影响**：`ai-engine/facade/index.ts` 新增 4 个 export（2 markdown util + 1 rag service token + 1 consistency service token）；wiki 子模块通过 `import { ... } from '@/modules/ai-engine/facade'` 消费，单向依赖 L3→L2 不变。
>
> **元教训**：v1.0/v1.1/v1.2 设计审查时 4 路 reviewer 全部漏掉了"能力归属"维度——架构师 R1/R2 关注分层合规但只查"是否穿透 facade"，没查"是否过度集中在 app 层"。**架构原则审查的两个独立维度（依赖方向 / 能力归属）应该分别提问**，下次设计任务必须明文列入 architect prompt。
>
> **v1.2.1 vs v1.2 主要变更**（对应 R3 reviewer + security 共 8 项）：
>
> | 类型                                 | 修订点                                                                                                                       |
> | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
> | 安全 P1（security R3）               | §5.1 Step B `affectedSlugs` 重算公式补 `∪ items.deletes[]`；Step D SELECT FOR UPDATE 锁全集；Step G2 补 delete WikiPage 流程 |
> | 安全 P2（security R3）               | §5.1 Step C 对其他 PENDING diff 也实时重算 `affectedSlugs`，不读 DB 预存值                                                   |
> | 安全 P2（security R3）               | §5.1 加 Prisma `P2034` (serialization_failure) 1 次重试 → 仍失败 409；§11 checklist 同步登记                                 |
> | 安全 P2（security R3）               | §11.1 新增 `WikiDiffItemsSchema` 完整 zod 骨架（slug 正则 / body 上限 200K / creates/updates ≤100 / deletes ≤20）            |
> | Doc drift（reviewer + architect R3） | §3.1 "7 张" → "10 张"；§6 标题 "12 个" → "13 个"；§14 评审索引补 R2 已完成                                                   |
> | 实施细节（architect R3）             | §11 加 "WikiPageEmbedding.model 写入侧必须填非空 model 名" 约束（避免 query 维度漂移）                                       |
>
> **v1.2 vs v1.1 主要变更**（对应 R2 必修 21 条）：
>
> | 类型        | 修订点                                                                                                                                         |
> | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
> | Schema 关系 | `WikiPageRevision.opId` / `WikiLintFinding.pageId` / `WikiOperationLogPage.pageId` 三处补 Prisma `@relation` 声明（onDelete: SetNull/Cascade） |
> | Schema 关系 | `WikiPageEmbedding.model` 改 `@default("")` 不再硬编码 `text-embedding-3-small`（CLAUDE.md 反硬编码模型规则）                                  |
> | Schema 简化 | 砍 `WikiPageSource.weight`（YAGNI 无消费方）                                                                                                   |
> | 安全 P1     | `revert` 子动作 service 层强制校验 `revision.pageId === page.id`（防跨页 IDOR）                                                                |
> | 安全 P1     | apply 时**实时从 `diff.items` 重算 `affectedSlugs`**，不信任预存值（防恶意 ingest 写空数组绕过冲突判定）                                       |
> | 安全 P1     | apply 进事务前 `WikiDiff.items` 必须 zod parse（防 LLM 输出非法字段进库）                                                                      |
> | 安全 P2     | `wrapExternalContent` 按"剩余 token budget"显式传 maxLength；`baselineHash` 事务用 `SELECT FOR UPDATE` 防 TOCTOU；export VIEWER 边界明示       |
> | 文档对齐    | §4.1 标题"7 张新表" → "10 张新表"；§2.2 "12 个 endpoint" → "13 个"；§1.2 KB 行号 4150 → 4098                                                   |
> | 文档对齐    | WikiDiff schema 注释清掉废弃 partial unique index 文字                                                                                         |
> | 阶段对齐    | `WikiKnowledgeBaseConfig` 提到 P0 一起建（含 `ingestMaxTokens=80_000`），P1 即可读取，避免 P1/P2 hardcode→Config 切换歧义                      |
> | 反硬编码    | 80K token 上限改为从 `WikiKnowledgeBaseConfig.ingestMaxTokens` 读取                                                                            |
> | 测试补充    | P1 spec 加 wikiEnabled=false API gate / PATCH edit 写 revision / baselineHash 确定性 / revert 跨页 IDOR 共 4 项                                |
> | Migration   | P0 SQL 加 `WikiDiff.affectedSlugs` GIN 索引（partial WHERE status='PENDING'）                                                                  |
> | ADR         | P0 落盘 `docs/architecture/decisions/ADR-XXX-wiki-vs-graph-coexistence.md`（KG 冻结边界）                                                      |
>
> **v1.1 vs v1.0 主要变更**（对应 R1 P0/BLOCKER）：
>
> | 类型     | 修订点                                                                                                                                            |
> | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 现实校准 | raw 改为 `KnowledgeBaseDocument`（不是 Note）；删 `WikiSkillTokens` / `fact-extraction.service` / `KnowledgeBaseGuard` 虚构提及                   |
> | 现实校准 | 大库分支 RAG 不复用 `ChildEmbedding`，新建独立 `WikiPageEmbedding` 表（embedding 字段为 Json，与 `ChildEmbedding` 一致——Railway 不支持 pgvector） |
> | 数据完整 | 新建 `WikiDiff` 表（v1.0 漏建）+ `WikiPageRevision` 历史快照表（解决 revert + stale lint）                                                        |
> | 数据完整 | `sourceRefs` JSON 拆为 `WikiPageSource` 关系表（FK to `KnowledgeBaseDocument`）                                                                   |
> | 数据完整 | `WikiOperationLog.pageIds` 数组拆为 `WikiOperationLogPage` 关系表                                                                                 |
> | 安全     | slug DTO `@Matches` + export 二次校验 + wiki-ingest 强制走 `wrapExternalContent` + diffId IDOR 校验                                               |
> | 验收     | P2 "≥20% precision" 撤掉，所有 Phase gate 改为 `npm test --testPathPattern=wiki` 命令级                                                           |
> | 简化     | 砍 `WikiOp.QUERY` / 合并 `PATCH /diffs/:id` 与 `PATCH /lint-findings/:id` / export 走 `ExportJob` 复用                                            |
> | 实现细节 | propose_update_page 选定为**全量替换**；link-parser 用 **remark AST** 不用正则                                                                    |
> | 自洽     | 删除"不做版本史"非目标（与 stale lint 矛盾），明示 `WikiPageRevision` 是版本史最小化形式                                                          |

---

## 1. 背景与目标

### 1.1 Karpathy 原文要点（不是我们的发挥）

3 层结构：

```
raw/                # 不可变源材料（PDF / URL / 文章），LLM 只读不改
wiki/               # LLM 编译产物：summary / entity / concept 页，markdown
  index.md          # 全局目录：entities / concepts / sources，每条带 one-line + 元数据
  log.md            # append-only：## [2026-04-02] ingest | Article Title
```

3 个核心操作：

- **Ingest**：LLM 读 raw → 与用户讨论要点 → 写 summary page → 更新 index → 跨页刷新相关 entity / concept → append log
- **Query**：检索 wiki 而不是 raw，合成带引用的回答；好答案能反向 file 回 wiki
- **Lint**（健康检查）：找 contradictions / stale claims / orphan pages / 缺 cross-ref / data gaps

哲学要点：

- "the wiki is a persistent, compounding artifact" — 预编译 > 每次重 derive
- ≤ 100 文章 / ≤ 400K 字时直接长 context 喂；fancy RAG 只增加 latency 和 retrieval noise
- 文件是 source of truth，索引是派生
- markdown + `[[wiki-link]]`，不是 vector + frontmatter

### 1.2 现状（已经过 schema/代码核对）

| 模块                                                       | 角色                                                                     | 真实文件                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Prisma `KnowledgeBase`                                     | 知识库 scope（含 `KnowledgeBaseMember` 角色：OWNER/ADMIN/EDITOR/VIEWER） | `models.prisma` l.4098                                                      |
| Prisma `KnowledgeBaseDocument`                             | KB 内的 raw 文档（含 `rawContent` / `sourceType` / chunking 状态）       | `models.prisma` l.4181                                                      |
| Prisma `ParentChunk` / `ChildChunk` / `ChildEmbedding`     | 现有 RAG 5 层管道（embedding 字段 = Json，Railway 不支持 pgvector）      | `models.prisma` l.4218 / 4247 / 4273                                        |
| Prisma `Note`                                              | **用户笔记**（`userId` + 可选 `resourceId`，**没挂 KB**）                | `models.prisma` l.599                                                       |
| `KnowledgeBaseService.hasAccess()`                         | KB 角色访问校验（service 层，无独立 Guard）                              | `library/rag/services/knowledge-base.service.ts` l.874                      |
| `PromptSkillBridge.registerDomain()`                       | 域级 prompt skill 注册（writing/research/topic-insights 都用）           | `ai-engine/skills/runtime/registration/...service.ts` l.83                  |
| `wrapExternalContent()` + `EXTERNAL_CONTENT_SYSTEM_NOTICE` | prompt injection 防护基础设施                                            | `ai-engine/safety/security/llm-injection/external-content-wrapper.utils.ts` |
| Prisma `ExportJob` + `ExportSourceType` enum               | 异步导出系统（已支持 RESEARCH/MISSION/WRITING 等）                       | `models.prisma` l.3803 / 3841                                               |

> **关键概念校准**（v1.0 错位）：
>
> - `Note` ≠ raw。Note 是用户笔记，raw 在 KB 上下文里是 `KnowledgeBaseDocument`。本设计 v1.1 把 raw 全部对齐为 `KnowledgeBaseDocument`。
> - `EmbeddingChunk` 表不存在，真实表是 `ChildEmbedding`。wiki 的 embedding 走**新建独立表**，不侵入现有 5 层 chunking。
> - `KnowledgeBaseGuard` 不存在；本期沿用 service 层 `hasAccess()` 模式，不创新 Guard，避免 scope 蔓延。
> - `fact-extraction.service.ts` 不存在；wiki-ingest 自己编排 LLM。

### 1.3 用户需求

> "Karpathy 提出来的 LLM WIKI，我想用在我的知识库上面，请帮我设计系统的方案"

### 1.4 设计目标

| 目标           | 说明                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------- |
| **忠实**       | 3 层 / 3 操作 / markdown-as-truth / `[[link]]` 语法 / index + log，与 Karpathy gist 同形                        |
| **主形态**     | (v1.5) Wiki 是 Library 的默认主形态——`/library` 顶层 tab 第一位 + 默认 active（详见 §2.4 决策 + §7.1 入口形态） |
| **不双源**     | wiki 直接挂 `KnowledgeBase`；raw 直接复用 `KnowledgeBaseDocument`，不新建一套                                   |
| **多租户**     | 多租户 SaaS 上文件 SoT 不可行，DB 是 SoT 但保留一键 export 成 raw/+wiki/ 目录的 portability                     |
| **默认无 RAG** | 体量 ≤ 阈值直接长 context；> 阈值仅对 oneLiner+index 检索选页，选中页仍长 context 喂                            |
| **可逃生**     | 现有 RAG / chunking 不删，作为大体量兜底；用户也能在大库上手动启 RAG 模式                                       |
| **可控**       | ingest 走 diff 模式：LLM 提议要改的页 + diff，用户逐项 accept/dismiss，不允许 LLM 直写入库                      |
| **可回溯**     | 每次 apply 写 `WikiPageRevision` 快照；revert + stale lint 都依赖快照，不再"无历史 lint stale"自相矛盾          |
| **合规**       | 单向依赖 L3 → L2 → L1；所有 ai-engine 调用经 facade；`verify:arch` 全绿                                         |

### 1.5 非目标

- 不替换 `Note` / `Collection` / `KnowledgeGraph` / 现有 RAG 路径：保留全部现有数据与路径
- 不做协作编辑（多人同时编同一 wiki page，OT/CRDT）：本期单写者 + diff 列队
- 不做"自我推进"：所有 ingest / lint 由用户触发，cron 仅做轻量 lint 巡检
- 不实现 Obsidian 兼容（dataview 查询、graph view）：本期纯 markdown + 我们自己的 backlink 视图
- 不做"完整版本史"：仅保留 `WikiPageRevision` 最小快照（pageId + body + opId），不做 diff 链 / branch / merge

---

## 2. 核心设计决策

### 2.1 用户已选定（v1.0 即定）

| 决策              | 选项                                                           | 选定  |
| ----------------- | -------------------------------------------------------------- | ----- |
| **Wiki 范围归属** | A 复用 KnowledgeBase / B 平行起 Wiki 资源                      | **A** |
| **RAG 态度**      | A 默认不走 RAG (Karpathy 原意) / B RAG 主 wiki 辅 / C 用户可选 | **A** |
| **Ingest 自主度** | A LLM 提议 diff 用户接受 / B LLM 直写 / C 混合                 | **A** |
| **交付顺序**      | A 按序 P0→P1→P2→P3 / B P0+P1+UI 同步 / C 只先 P0+P1            | **A** |

### 2.2 R1 评审后新增决策

| 决策                                   | 选项                                                  | 选定 + 理由                                                                                                    |
| -------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **raw 实体的本体**                     | Note / KnowledgeBaseDocument                          | **KnowledgeBaseDocument**（架构师 P0：Note 没挂 KB；KBD 才是 KB 内 raw 单位且自带 chunking）                   |
| **大库分支的 embedding 表**            | 复用 ChildEmbedding 加多态列 / 新建 WikiPageEmbedding | **新建 WikiPageEmbedding**（架构师 P0：ChildEmbedding 强 FK 挂 ChildChunk，wiki 不要 chunk 要整页 embed）      |
| **propose_update_page 的 diff 格式**   | 全量替换 newBody / unified diff / 块替换              | **全量替换 newBody**（reviewer P0：apply 简单 + 客户端可算 git-style diff 视图，LLM 友好）                     |
| **apply 的原子性**                     | 全选项一个事务 / 逐项独立                             | **全选项一个 Prisma `$transaction`**（reviewer + tester P0：避免部分写入；invariant lint 在事务外）            |
| **revert 数据存储**                    | WikiDiff.previousBodies JSON / WikiPageRevision 表    | **WikiPageRevision 表**（架构师 P1 + reviewer P0：兼容 stale lint 历史比对，且为未来扩展留口）                 |
| **link-parser 实现**                   | 正则 / remark AST                                     | **remark AST**（reviewer + tester P1：正则在代码块/转义/反引号失效，前端已用 remark/rehype 系列）              |
| **slug 规范化**                        | 严格小写连字符 / 允许大小写空格 / 自由                | **lowercase + kebab-case**：`Machine Learning` → `machine-learning`；DTO 加 `@Matches`，详见 §4.4              |
| **markdown 外链限制**                  | 严禁 / 允许标准 `[text](url)` 仅强约束跨 wiki         | **允许标准外链**（架构师 P1：Karpathy 原意未禁；只强约束 wiki-internal 必须 `[[slug]]`）                       |
| **diff 并发**                          | 全 KB 单 PENDING / 按 slug 集合冲突                   | **slug 集合冲突**（架构师 P1：团队 KB 多人协作，全局单 PENDING 串行化太严）                                    |
| **lint 时机**                          | 每次 ingest 后自动 / 用户主动触发 / 后台 cron / 三者  | **用户主动 + 后台 cron 每日（可关）+ ingest 后跑 invariant**：前两者跑 5 类全量；后者只跑 ORPHAN/MISSING_XREF  |
| **export 实现路径**                    | 自己起 endpoint / 复用 ExportJob                      | **复用 ExportJob**（架构师 P1：扩 `ExportSourceType.WIKI` + `ExportFormat.TARBALL`，沿用进度/下载/过期协议）   |
| **体量阈值持久化**                     | hardcode + env / WikiKnowledgeBaseConfig 表           | **WikiKnowledgeBaseConfig 表**（架构师 P1：每 KB 独立配，admin UI 后期可暴露）                                 |
| **WikiOp.QUERY**                       | 保留 / 砍掉                                           | **砍掉**（reviewer 简化建议：无消费方，每 query 写 DB 是纯开销）                                               |
| **API endpoint 合并**                  | 保留 14 / 合并 PATCH                                  | **合并到 13**（含 export）：`PATCH /diffs/:id` 含 apply/dismiss；`PATCH /lint-findings/:id` 含 resolve/dismiss |
| **`WikiLintFinding.resolvedByUserId`** | 保留 / 砍                                             | **砍**（reviewer 简化：本期单写者，无消费方，YAGNI）                                                           |

### 2.3 R2 评审后追加决策

| 决策                                   | 选项                                                   | 选定 + 理由                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **WikiPageRevision 写时机**            | 仅 apply / apply+edit / apply+edit+revert              | **三处都写**（reviewer R2 P1 #3 + tester R2 边缘 #3）：apply 前快照、用户 edit 前快照、revert 时把目标快照"复活"也写一条新 revision 标记                                                   |
| **affectedSlugs 信任**                 | 信任 ingest 写入值 / apply 时实时重算                  | **apply 实时重算**（security R2 P1）：从 `diff.items.creates[].slug ∪ updates[].slug` 重新计算，不读 DB 字段做冲突判定                                                                     |
| **`WikiDiff.items` apply 前 zod 校验** | 信任 / 强制 zod parse                                  | **强制 zod parse**（security R2 P2，提到 P1 必须）：apply 入事务前用 `WikiDiffItemsSchema` 校验，失败 400                                                                                  |
| **revert 跨页归属校验**                | 默认信任 toRevisionId / service 强校验                 | **强校验**（security R2 P1，v1.5.2 改 NotFound 消 oracle）：service 层 `if (revision.pageId !== page.id) throw new NotFoundException("Revision not found")` —— 与"revision 不存在"统一响应 |
| **`baselineHash` 事务隔离**            | 默认 read-committed / SELECT FOR UPDATE / SERIALIZABLE | **`SELECT ... FOR UPDATE` 锁所有 affectedSlugs 对应 page 行**（security R2 P2）：apply 事务首步对涉及页加行锁，再校验 baselineHash                                                         |
| **`wrapExternalContent.maxLength`**    | 默认 2000 / 显式按 budget 传                           | **按"剩余 token budget / N 篇 doc"显式传**（security R2 P2）：避免默认 2000 字符截断与 80K tokens 矛盾                                                                                     |
| **VIEWER 触发 export 边界**            | VIEWER 看不到 export / 与 EDITOR 看到内容相同          | **与 EDITOR 看到内容相同**（security R2 P2）：KB 设计本意 VIEWER 可读全部内容，export 不另设权限墙；文档明示                                                                               |
| **`ingestMaxTokens` 配置位置**         | hardcode / `WikiKnowledgeBaseConfig` 字段              | **`WikiKnowledgeBaseConfig.ingestMaxTokens` 默认 80_000**（reviewer R2 P1 #9）：避免 P1 hardcode→P2 切 Config 的实施歧义；P0 一起建表                                                      |
| **架构师 R2 后续待办**（非阻塞）       | -                                                      | (1) Migration 加 `wiki_diffs(affected_slugs) GIN partial index`；(2) ADR-XXX-wiki-vs-graph-coexistence 落盘；(3) WikiDiff schema 注释清掉废弃 partial unique 文字                          |

### 2.4 v1.5 评审后追加决策（产品定位升级）

| 决策                     | 选项                                                                                                  | 选定 + 理由                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **UI 入口位置**          | A. KB 详情页内 tab（v1.4 §7 原案）<br>B. Library 顶层 tab 末位<br>C. Library 顶层 tab **首位 + 默认** | **C**（产品决策升级）：Karpathy 原意 "the wiki is the primary artifact" 应在产品入口层兑现。**架构师 R7 P0 提出"双维度并存破坏 tab 同层语义"——v1.5.1 显式承认并定型为有意决策**：v1.5 后 LibraryTabs 跨 2 个语义维度——`Wiki` 是"产品形态维度"（LLM 编译知识沉淀），`personal-kb / team-kb / data-sources` 是"资源容器维度"。两维度**不可被互相收编**：Wiki 与 KB 是 N:1 关系（一个 wiki 仅展示一个 KB 的内容，但用户可有多 KB），把 wiki 收进 personal-kb 内 sub-tab 会让 KB 列表与 wiki 主形态争夺中栏。代价是 tab 语义维度混杂，但产品价值（默认看到知识沉淀）压过架构纯粹性 |
| **KB context 解析**      | URL 参数必传 / localStorage 记忆 / 全局唯一 wiki                                                      | **多源解析链**：URL `?kb=` → `localStorage.lastWikiKbId` → 用户唯一 wikiEnabled KB → default KB → 引导态。回头用户秒进熟悉库；新用户走引导；多 KB 用户用 selector 切换                                                                                                                                                                                                                                                                                                                                                                                                         |
| **空态 onboarding 步数** | 无引导 / 简单提示 / 三态 funnel                                                                       | **三态 funnel**（0 KB / 0 wikiEnabled KB / 0 page）：每态都有清晰 CTA + 逃生路径（"先去其他 tab"）；启用 wiki 是一键 toggle 不跳设置页                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **老用户兼容**           | 静默切换 / What's new toast / 强引导                                                                  | **What's new toast + localStorage 个人偏好**：一次性提示 tab 变化 + "切回旧默认（personal-kb）"快捷开关；偏好不存 DB 仅 localStorage（避免 schema 又加一字段）                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **顶部搜索框语义**       | 始终全局搜索 / wiki tab 下切换为 wiki 内搜索                                                          | **wiki tab 下切换**（安全 + UX 双胜）：placeholder 联动；防止跨 KB 搜索结果在 sub-header 暴露其他 KB 的 page slug；保留"在所有资源中搜"次要按钮                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **KB selector 列表过滤** | 显示全部 KB / 仅 wikiEnabled / hasAccess 过滤                                                         | **仅 wikiEnabled + hasAccess(VIEWER) 双过滤**（security 强约束）：列表请求服务端过滤，前端不做兜底；列表 footer "管理 wiki 启用状态 →" 跳 KB 设置区                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 3. 架构总览

### 3.1 分层定位（v1.3 按能力归属重构）

```
L3 ai-app/library                              ★ wiki 业务专属
  ├─ wiki/                                     ★ 新增子模块（瘦身后）
  │   ├─ wiki-page.service.ts                  CRUD + body 解析（engine link-parser）+ body 入库前调 engine sanitizeMarkdownBody + export tarball
  │   ├─ wiki-page.controller.ts               REST
  │   ├─ wiki-ingest.service.ts                ingest LLM 编排（产 diff）
  │   ├─ wiki-diff.service.ts                  diff apply / revert + zod parse + 乐观锁
  │   ├─ wiki-query.service.ts                 query 路由（Branch A 长 context；Branch B 直调 engine EmbeddingService.embed + VectorService.similaritySearch）
  │   ├─ wiki-lint.service.ts                  lint 编排：ORPHAN/MISSING_XREF 自做（依赖 WikiPageLink）+
  │   │                                          STALE 调 StaleDetectorService；CONTRADICTION/DATA_GAP 调 CrossCuttingSynthesisService.detect*
  │   ├─ wiki-revision.service.ts              快照写入（apply/edit/revert 三处）
  │   ├─ skills/                               LLM prompt skills（domain="library"）
  │   │   ├─ wiki-ingest.skill.md
  │   │   ├─ wiki-stale-check.skill.md         ← 调 engine consistency primitive
  │   │   └─ wiki-contradiction.skill.md       ← 同上
  │   ├─ dto/                                  WikiDiffItemsSchema (zod)
  │   ├─ wiki.module.ts                        onModuleInit 调 PromptSkillBridge.registerDomain("library")
  │   └─ __tests__/
  └─ library.module.ts                         imports WikiModule

L2 ai-engine                                   ★ v1.4 通用能力（精简后）
  ├─ content/markdown/                         （已存在 markdown-sanitizer）
  │   ├─ wiki-link-parser.util.ts              ★ 新增：remark AST 抽 [[slug]]，纯函数
  │   ├─ slug-normalize.util.ts                ★ 新增：title → kebab-case，纯函数
  │   │                                           + 同 PR 替换现有 ≥ 16 处 ad-hoc slugify 实现
  │   │                                           （v1.5 实测 grep：admin / a2a-team-member-adapter /
  │   │                                            entity-memory / topic-insights/report-assembler /
  │   │                                            image/infographic / agent-playground /
  │   │                                            common/export/renderers / report-artifact-assembler /
  │   │                                            structural-report-assembler 等）
  │   └─ __tests__/                            10 条 link-parser 边界 + slug 规范化用例
  ├─ rag/                                      ★ v1.4 不新增任何 service
  │                                              （wiki-query Branch B 直调 EmbeddingService.embed +
  │                                               VectorService.similaritySearch({filter, topK})
  │                                               两步组合，不抽象 MultiResolutionSearchService）
  ├─ knowledge/synthesis/                      （已有 cross-cutting-synthesis.service.ts）
  │   └─ cross-cutting-synthesis.service.ts    ★ 加 2 个低级 public API：
  │                                                - detectContradictions(documents): Contradiction[]
  │                                                - detectDataGaps(documents, opts): DataGap[]
  │                                              （wiki-lint + topic-insights 两路调用方共用单一源）
  ├─ knowledge/consistency/                    ★ v1.4 新建子目录（仅 1 个 service）
  │   ├─ stale-detector.service.ts             对每条文档的 source quote vs 当前 raw hash 跑 LLM 判陈旧
  │   │                                          （quote-vs-current-text 语义独有，无既有对应物）
  │   ├─ abstractions/stale-detector.interface.ts
  │   ├─ consistency.module.ts                 仅注册 StaleDetectorService
  │   └─ __tests__/                            stale-detector fixture（mock ChatFacade）
  └─ facade/                                   ★ 新增 3 个 export（v1.4 砍至 3，与既有 class export 模式一致）：
                                                   - parseMarkdownWikiLinks (function)
                                                   - normalizeMarkdownSlug (function)
                                                   - StaleDetectorService (class)
                                                  现有 CrossCuttingSynthesisService export 不变（其新增的两个 public API 通过同一类访问）。

L2.5 ai-harness                                ★ v1.5.1 显式声明（wiki 仅消费 PromptSkillBridge）
  └─ facade/                                    （已存在）
      └─ PromptSkillBridge                      re-exports from ai-engine/skills/runtime
                                                  wiki 模块通过 `@/modules/ai-harness/facade` 导入（项目惯例，
                                                  与 research / topic-insights / writing 一致）
                                                  注：wiki-ingest 是单轮 LLM call + tool calling（无 agent loop），
                                                  不走 harness/runner；其余 harness 能力（teams/handoffs/memory 等）wiki 不消费

L1 Prisma                                      schema 不变（v1.2.1 的 10 张表保留）
  └─ schema/models.prisma                      ★ 10 张新表 + KnowledgeBase.wikiEnabled +
                                                       ExportSourceType +1 + ExportFormat +1
```

> **依赖方向**：wiki 子模块 `imports: [PrismaModule, AiEngineModule, AiHarnessModule]`，沿用 NotesModule / RAGModule pattern。engine 能力通过 `@/modules/ai-engine/facade` 消费（link-parser / slug / sanitizer / embedding / vector / synthesis / consistency 共 7 项），harness 能力仅 `PromptSkillBridge` 通过 `@/modules/ai-harness/facade` 消费；单向依赖 L3 → L2.5 / L2 不变，verify:arch 全绿。
>
> **能力归属判断**（CLAUDE.md `.claude/rules/ai-engine.md`）：**"如果明天做一个完全不同的 AI App，这个能力还能复用吗？"** — 上提的 4 项均答 YES（writing 长文跨引用 / office 文档锚点 / research 报告内一致性检测 / 任何多分辨率检索）。留在 wiki/ 的 6 项（wiki-page/ingest/diff/revision/query 路由/ORPHAN+MISSING_XREF lint）均答 NO（依赖 WikiPage / WikiDiff / WikiPageLink 等 wiki-specific schema）。

### 3.2 与现有模块的边界（避免双源）

| 现有概念                                                                     | 在 LLM Wiki 中的角色                                                                                                                                |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `KnowledgeBase`                                                              | wiki 的 scope 单位（即 Karpathy 的 "a wiki"）；加 `wikiEnabled` 布尔字段开启                                                                        |
| `KnowledgeBaseDocument`                                                      | **raw 的本体**；wiki ingest 的输入；`WikiPageSource.documentId` 指它                                                                                |
| `ParentChunk` / `ChildChunk` / `ChildEmbedding`                              | 现有 RAG 5 层管道——**wiki 不复用**，wiki 走自己的 `WikiPageEmbedding`（独立表）                                                                     |
| `Note`                                                                       | 用户笔记，**与 wiki 无关**；本期 wiki 不读 Note                                                                                                     |
| `Collection`                                                                 | 笔记分组——**与 wiki 无关**                                                                                                                          |
| `KnowledgeGraph` (Note.graphNodes JSON / Resource graph JSON / GraphService) | **冻结状态**：wiki 不写 graphNodes 也不读；wiki entity 关系仅用 `[[slug]]` 表达。配套 ADR：[ADR-XXX-wiki-vs-graph-coexistence](../../../decisions/) |
| `library-rag.service`                                                        | 仅服务旧 chunk-search 路径；wiki query 不复用，避免逻辑混叠                                                                                         |
| `ExportJob` / `ExportSourceType` / `ExportFormat`                            | wiki 导出复用本系统：扩 `ExportSourceType.WIKI` + `ExportFormat.TARBALL`                                                                            |
| **(v1.4) `ai-engine/content/markdown/wiki-link-parser`**                     | wiki body `[[slug]]` 解析消费方；writing/research/office 跨引用解析也复用                                                                           |
| **(v1.4) `ai-engine/content/markdown/slug-normalize`**                       | wiki title→slug 规范化消费方；同 PR 替换全项目 5+ 处 ad-hoc slugify（消除既有双源）                                                                 |
| **(v1.4) `ai-engine/content/markdown/markdown-sanitizer`**                   | wiki-page.service body 入库前必调；与 frontend rehype-sanitize 形成双层防护                                                                         |
| **(v1.4) `ai-engine/rag/{EmbeddingService, VectorService}`**                 | wiki-query Branch B 直调（v1.4 砍掉 MultiResolutionSearchService 过度抽象，wiki 用现有 RAG 基元两步组合）                                           |
| **(v1.4) `ai-engine/knowledge/synthesis/CrossCuttingSynthesisService`**      | wiki-lint CONTRADICTION + DATA_GAP 调用方（消费新加的 `detectContradictions` / `detectDataGaps` 公共 API，与 topic-insights 共用单源）              |
| **(v1.4) `ai-engine/knowledge/consistency/StaleDetectorService`**            | wiki-lint STALE 调用方（quote vs raw hash 是 wiki+research+writing 共需的独有语义，无既有对应物）                                                   |

---

## 4. 数据模型（已修正 v1.0 错误）

### 4.1 Prisma 新增表（10 张）

> 10 张：`WikiPage` / `WikiPageSource` / `WikiPageLink` / `WikiPageRevision` / `WikiPageEmbedding` / `WikiDiff` / `WikiOperationLog` / `WikiOperationLogPage` / `WikiLintFinding` / `WikiKnowledgeBaseConfig`

```prisma
// 在 KnowledgeBase 上加开关
model KnowledgeBase {
  // ... existing fields ...
  wikiEnabled Boolean              @default(false) @map("wiki_enabled")
  wikiPages   WikiPage[]
  wikiDiffs   WikiDiff[]
  wikiOps     WikiOperationLog[]
  wikiFinds   WikiLintFinding[]
  wikiConfig  WikiKnowledgeBaseConfig?
}

// 一页 wiki：markdown 是唯一权威
model WikiPage {
  id              String   @id @default(uuid())
  knowledgeBaseId String   @map("knowledge_base_id")
  slug            String   @db.VarChar(200)              // canonical-name (DTO 强约束 a-z0-9-)
  title           String   @db.VarChar(500)
  category        WikiPageCategory
  body            String   @db.Text                      // 完整 markdown
  oneLiner        String   @db.VarChar(280)              // index.md 用；<= 280 char
  contentHash     String   @db.VarChar(64) @map("content_hash") // sha256(body)
  lastEditedBy    WikiPageEditedBy @map("last_edited_by")  // USER | LLM | IMPORT

  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  knowledgeBase   KnowledgeBase    @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  outboundLinks   WikiPageLink[]   @relation("FromPage")
  sources         WikiPageSource[]
  revisions       WikiPageRevision[]
  embeddings      WikiPageEmbedding[]
  opLogPages      WikiOperationLogPage[]
  lintFindings    WikiLintFinding[]

  @@unique([knowledgeBaseId, slug])
  @@index([knowledgeBaseId, category])
  @@index([knowledgeBaseId, updatedAt])
  @@map("wiki_pages")
}

enum WikiPageCategory {
  ENTITY
  CONCEPT
  SUMMARY
  SOURCE
}

enum WikiPageEditedBy {
  USER
  LLM
  IMPORT
}

// page → KnowledgeBaseDocument 的可验证 citation
// （v1.0 嵌在 sourceRefs JSON 里，引用完整性丢失，已拆出）
// v1.2: 砍 weight 字段（reviewer R2 P1 #8：YAGNI 无消费方）
model WikiPageSource {
  id          String   @id @default(uuid())
  pageId      String   @map("page_id")
  documentId  String   @map("document_id")              // → KnowledgeBaseDocument
  spanStart   Int      @map("span_start")
  spanEnd     Int      @map("span_end")
  quote       String   @db.Text                          // 冗余存原文片段（防 doc rawContent 改导致溯源失效）

  page        WikiPage              @relation(fields: [pageId], references: [id], onDelete: Cascade)
  document    KnowledgeBaseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@unique([pageId, documentId, spanStart])
  @@index([documentId])
  @@map("wiki_page_sources")
}

// [[slug]] 解析结果。toSlug 软引用，目标可能尚不存在 → lint 报 missing_xref
model WikiPageLink {
  fromPageId String  @map("from_page_id")
  toSlug     String  @map("to_slug") @db.VarChar(200)

  fromPage   WikiPage @relation("FromPage", fields: [fromPageId], references: [id], onDelete: Cascade)

  @@id([fromPageId, toSlug])
  @@index([toSlug])  // backlinks 反查
  @@map("wiki_page_links")
}

// apply 前的 body 快照（解决 revert + stale lint 历史比对）
// 简化版本史：只 (pageId, body, contentHash, opId)，不存 diff 链
// v1.2: opId 补 Prisma @relation 声明（reviewer R2 P1 #3）
model WikiPageRevision {
  id          String   @id @default(uuid())
  pageId      String   @map("page_id")
  body        String   @db.Text                          // 快照时刻的完整 markdown
  contentHash String   @db.VarChar(64) @map("content_hash")
  opId        String?  @map("op_id")                     // 关联 WikiOperationLog（nullable for backfill）
  createdAt   DateTime @default(now()) @map("created_at")

  page        WikiPage          @relation(fields: [pageId], references: [id], onDelete: Cascade)
  op          WikiOperationLog? @relation(fields: [opId], references: [id], onDelete: SetNull)

  @@index([pageId, createdAt(sort: Desc)])
  @@index([opId])
  @@map("wiki_page_revisions")
}

// 大库分支：wiki page 整页 embedding（独立于 ChildEmbedding，不走 chunk 管道）
// 一个 page 至多两条：oneLiner + body
// v1.2: model `@default("")` 不再硬编码 provider 模型名（reviewer R2 P1 #2 + CLAUDE.md 反硬编码）
//       写入时由 EmbeddingService 提供实际 model 名（与 query 时使用的 model 一致避免维度漂移）
model WikiPageEmbedding {
  id         String   @id @default(uuid())
  pageId     String   @map("page_id")
  resolution WikiPageEmbedResolution                      // ONELINER | BODY
  embedding  Json                                         // Railway 不支持 pgvector，与 ChildEmbedding 一致用 Json
  model      String   @default("")                        // 由 EmbeddingService 写入时填实际 model
  dimensions Int      @default(1536)
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  page       WikiPage @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([pageId, resolution])
  @@map("wiki_page_embeddings")
}

enum WikiPageEmbedResolution {
  ONELINER
  BODY
}

// ingest 提出的 diff（用户审阅后 apply 或 dismiss）
// 整个 ingest 管线靠它存活
model WikiDiff {
  id              String   @id @default(uuid())
  knowledgeBaseId String   @map("knowledge_base_id")
  status          WikiDiffStatus @default(PENDING)
  // items: { creates: [{slug, title, category, body, oneLiner, sources}], updates: [{slug, newBody, newOneLiner?, sources?}], deletes: [slug] }
  items           Json
  // ingest 时 LLM 看到的现有 wiki 状态指纹（apply 时用于乐观锁：现有 wiki 已变即冲突）
  baselineHash    String   @db.VarChar(64) @map("baseline_hash")
  // diff 涉及的 slug 集合（用于"slug 集合冲突"并发判定）
  affectedSlugs   String[] @map("affected_slugs")
  createdByUserId String   @map("created_by_user_id")
  createdAt       DateTime @default(now()) @map("created_at")
  appliedAt       DateTime? @map("applied_at")
  dismissedAt     DateTime? @map("dismissed_at")

  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)

  @@index([knowledgeBaseId, status])
  @@map("wiki_diffs")
  // 多 PENDING diff 允许并存，service 层用 affectedSlugs 交集判冲突（§2.2 决策）
  // 配套 GIN partial index 在手写 SQL migration 中追加（不在 Prisma schema DSL 内可声明）：
  //   CREATE INDEX wiki_diffs_affected_slugs_gin
  //     ON wiki_diffs USING GIN (affected_slugs)
  //     WHERE status = 'PENDING';
}

enum WikiDiffStatus {
  PENDING
  APPLIED
  DISMISSED
  CONFLICTED   // 提交 apply 时检测到 baselineHash 不匹配
}

// log.md 的 DB 形态（append-only）
// pageIds 改为 WikiOperationLogPage 关系表，便于 join 查询
// v1.2: 加 revisions 反向关系（WikiPageRevision.opId 补 FK）
model WikiOperationLog {
  id              String   @id @default(uuid())
  knowledgeBaseId String   @map("knowledge_base_id")
  op              WikiOp
  title           String   @db.VarChar(500)
  meta            Json     @default("{}")
  actorUserId     String?  @map("actor_user_id")
  createdAt       DateTime @default(now()) @map("created_at")

  knowledgeBase   KnowledgeBase           @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  pages           WikiOperationLogPage[]
  revisions       WikiPageRevision[]

  @@index([knowledgeBaseId, createdAt(sort: Desc)])
  @@map("wiki_operation_logs")
}

enum WikiOp {
  INGEST
  LINT
  EDIT
  REVERT
  // QUERY 砍掉（reviewer 简化建议：无消费方）
}

// v1.2: pageId 补 Prisma @relation（reviewer R2 P1 #5）
//       onDelete: SetNull + nullable pageId — 页面删除后 log 条目保留历史，pageId 置空
//       Prisma 复合主键不允许 nullable 字段 → 用独立 id PK + partial unique 兼容
model WikiOperationLogPage {
  id     String  @id @default(uuid())
  opId   String  @map("op_id")
  pageId String? @map("page_id")
  role   WikiOpPageRole              // CREATED | UPDATED | DELETED | AFFECTED

  op     WikiOperationLog @relation(fields: [opId], references: [id], onDelete: Cascade)
  page   WikiPage?        @relation(fields: [pageId], references: [id], onDelete: SetNull)

  @@unique([opId, pageId, role])  // 仅当 pageId 非空时（pageId=null 行罕见，是 page 删除后的孤立历史）
  @@index([pageId, opId])
  @@map("wiki_operation_log_pages")
}

enum WikiOpPageRole {
  CREATED
  UPDATED
  DELETED
  AFFECTED
}

// lint 找到的问题（5 类 + 解决标记）
// v1.2: pageId 补 Prisma @relation（reviewer R2 P1 #4）
//       onDelete: SetNull — page 删除后 finding 不连带删（保留历史），pageId 置空
//       service 层查询时按需过滤 pageId IS NOT NULL（ORPHAN/MISSING_XREF 类本来就允许 null）
model WikiLintFinding {
  id              String   @id @default(uuid())
  knowledgeBaseId String   @map("knowledge_base_id")
  type            WikiLintType
  pageId          String?  @map("page_id")
  detail          Json
  resolvedAt      DateTime? @map("resolved_at")
  // resolvedByUserId 已砍（reviewer 简化：YAGNI，单写者无消费方）
  createdAt       DateTime @default(now()) @map("created_at")

  knowledgeBase   KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)
  page            WikiPage?     @relation(fields: [pageId], references: [id], onDelete: SetNull)

  @@index([knowledgeBaseId, resolvedAt, type])
  @@index([pageId])
  @@map("wiki_lint_findings")
}

enum WikiLintType {
  CONTRADICTION
  STALE
  ORPHAN
  MISSING_XREF
  DATA_GAP
}

// 阈值持久化（每 KB 独立配，admin UI 后期可暴露）
// v1.2: 加 ingestMaxTokens（reviewer R2 P1 #9：避免 P1 hardcode→P2 切 Config 歧义）
//       表 P0 一起建，P1 即可读取
model WikiKnowledgeBaseConfig {
  knowledgeBaseId    String  @id @map("knowledge_base_id")
  inlinePageCount    Int     @default(200) @map("inline_page_count")
  inlineTokenBudget  Int     @default(500_000) @map("inline_token_budget")
  ingestMaxTokens    Int     @default(80_000) @map("ingest_max_tokens")        // ingest 单批 raw 输入上限
  cronLintEnabled    Boolean @default(true) @map("cron_lint_enabled")
  cronLintDailyBudgetCalls Int @default(50) @map("cron_lint_daily_budget_calls")  // CONTRADICTION/DATA_GAP LLM 调用上限
  updatedAt          DateTime @updatedAt @map("updated_at")

  knowledgeBase      KnowledgeBase @relation(fields: [knowledgeBaseId], references: [id], onDelete: Cascade)

  @@map("wiki_knowledge_base_configs")
}

// 修改 ExportSourceType + ExportFormat
enum ExportSourceType {
  // ... existing ...
  WIKI            // ★ 新增
}
enum ExportFormat {
  // ... existing ...
  TARBALL         // ★ 新增（可命名为 TAR_GZ）
}
```

### 4.2 schema 关键约束

- **partial unique**：v1.0 想要"同 KB 同时只一个 PENDING diff"，v1.1 改为 service 层 affectedSlugs 交集判定（架构师 P1）
- **FK onDelete: Cascade**：KB 删 → wiki 全链清；page 删 → revision/source/embedding/link 全清
- **`WikiPageSource` 改 FK to `KnowledgeBaseDocument`**：document 删除 → source 自动清，引用完整性
- **partial unique 仍要：`@@unique([pageId, resolution])`**：每页每 resolution 至多一条 embedding

### 4.3 体量阈值

```
DEFAULT (写在 WikiKnowledgeBaseConfig.default 行 / WikiConfig consts):
  inlinePageCount        = 200
  inlineTokenBudget      = 500_000  // 约等于 GPT-5 / Claude 4 半窗
```

KB 超过任一阈值时 query 路由切"RAG 选页 + 长 context"分支。每 KB 可独立调（写入 `WikiKnowledgeBaseConfig` 行），无 config 行的 KB 用全局默认。

### 4.4 slug 规范化（reviewer + tester P0）

**纯函数 `normalizeSlug(title)`**：

```typescript
function normalizeSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD") // unicode 拆解
    .replace(/[̀-ͯ]/g, "") // 删变音符
    .replace(/[^a-z0-9]+/g, "-") // 非 ascii alnum → -
    .replace(/^-+|-+$/g, "") // 头尾 -
    .slice(0, 200);
}
```

**DTO 校验**：

```typescript
@IsString()
@Matches(/^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/, {
  message: 'slug must be kebab-case (a-z, 0-9, hyphens), 2-200 chars, no leading/trailing hyphens',
})
slug: string;
```

**例**：

| 输入               | 输出                                                                            |
| ------------------ | ------------------------------------------------------------------------------- |
| `Machine Learning` | `machine-learning`                                                              |
| `OpenAI's GPT-4`   | `openai-s-gpt-4`                                                                |
| `   spaces   `     | `spaces`                                                                        |
| `数据科学`         | `''`（NFKD 后非 ASCII 全被剥除→empty string；DTO 因 len<2 拒；P0a-1 R7.1 修订） |
| `[[evil]]`         | `evil`                                                                          |
| `../etc/passwd`    | `etc-passwd`（不会有路径穿越）                                                  |

> **本期 slug 仅 ASCII**；i18n（中文/日文等 non-ASCII slug 渲染）后续单独 ADR。

---

## 5. 关键管线

### 5.1 Ingest（用户主动触发，产出 diff）

```
Trigger:    POST /api/v1/library/wiki/:kbId/ingest
Input:      { documentIds: string[] }   // 必须是 KnowledgeBaseDocument id
↓
Step 1:     load documents (验证 documentId 属于 kbId) →
            读 WikiKnowledgeBaseConfig(kbId).ingestMaxTokens (默认 80_000) →
            assemble raw context（按 token counter 截断到 ingestMaxTokens 上限）
            ↓ 安全：每篇 doc rawContent 经 wrapExternalContent({
                       source: 'kb_document',
                       title,
                       maxLength: Math.floor((remainingTokenBudget × 4) / docCount),  // ★ 显式按剩余预算分配
                     }) 包裹（v1.2 security R2 P2：避免默认 maxLength=2000 与 ingestMaxTokens 矛盾）
Step 2:     load 当前 KB 全 wiki index 视图（pageId/slug/oneLiner/category/contentHash）→
            计算 baselineHash = sha256(JSON.stringify(index sorted))
Step 3:     skill `wiki-ingest`
              注册：通过 `PromptSkillBridge.registerDomain("library")` 注册，
                   PromptSkillBridge 从 `@/modules/ai-harness/facade` 导入
                   （v1.5.1 architect P0：项目惯例，与 research/topic-insights/writing 一致；
                    实现位于 ai-engine/skills/runtime/，由 ai-harness/facade 公开）
              调用：单轮 LLM call + tool calling（无 multi-turn agent loop），
                   走 engine `AiChatService.chat()` 直接发起，
                   不走 harness/runner（按 MECE 原则 1：无 agent/mission 状态）
              system: gist 节选 + 当前 wiki shape + EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH
              user:   wrapExternalContent(raw) + 当前 index
              tools:  [propose_create_page, propose_update_page, propose_link]
              输出:  WikiDiff.items = { creates, updates }
                       creates: [{slug, title, category, body, oneLiner, sources}]
                       updates: [{slug, newBody, newOneLiner?, sources?}]    ← 全量替换
Step 4:     parse [[slug]] in proposed bodies (remark AST) → 检查目标存在性
Step 5:     persist WikiDiff (status=PENDING, baselineHash, affectedSlugs, createdByUserId)
            → 返回 diffId
↓
User UI:    /library/wiki/[kbId]/diff/[diffId] 列出 N 项变更，用户 accept/dismiss/edit
↓
On accept:  PATCH /diffs/:diffId  body={action:'apply', selectedItemIds?:[]}
            ↓
            ★ Step A: zod parse `WikiDiff.items`（v1.2 security R2 P2：LLM 输出可能含
                      非法字段；用 WikiDiffItemsSchema 强校验失败 400 - schema 定义见 §11）
            ★ Step B: 实时重算 affectedSlugs =
                        items.creates[].slug ∪ items.updates[].slug ∪ items.deletes[]
                      （v1.2 security R2 P1 + v1.2.1 security R3 P1：不信任 DB 预存值，
                      且必须包含 deletes 否则删除路径无 TOCTOU / 冲突防护）
            Step C:   并发判定：扫其他 status=PENDING 的 diff，对每个 other_diff
                      **同样实时重算 other_affectedSlugs from other_diff.items**
                      （v1.2.1 security R3 P2：不读其他 diff 的 DB 预存 affectedSlugs
                      字段，避免恶意/有缺陷 ingest 写空数组让本 diff 的冲突判定失效）
                      若交集非空 → 409 + 提示冲突 diffId
            ↓
            atomic Prisma $transaction(isolationLevel: 'Serializable'):
              ★ Step D: SELECT ... FROM wiki_pages WHERE knowledgeBaseId=$1
                        AND slug IN ($affectedSlugs) FOR UPDATE
                        （含 creates/updates/deletes 三类全部 slug；creates 的 slug
                        命中 0 行行锁是正常的，事务内 INSERT 后由 baselineHash 兜底）
              Step E:   重算锁定后的 baselineHash → 与 diff.baselineHash 比；
                        不一致：rollback + status=CONFLICTED + 返回 409
              Step F:   for each WikiPage to be updated OR deleted:
                          insert WikiPageRevision (snapshot before, opId=null 占位)
              Step G:   upsert WikiPage × creates+updates
              Step G2:  delete WikiPage WHERE slug IN items.deletes[]
                        （v1.2.1：补 v1.2 漏写的 delete 操作；Cascade 自动清
                        WikiPageRevision/Source/Embedding/Link 等）
              Step H:   delete + insert WikiPageLink (重 parse [[slug]])
              Step I:   upsert WikiPageEmbedding × 2N (oneLiner + body)
                        ★ 必须在事务内（v1.2 修正 v1.1 注释"异步排队也可"的矛盾）
              Step J:   insert WikiOperationLog (op=INGEST) → 拿到 opId
              Step K:   update WikiPageRevision.opId for 本次新写的 revision
              Step L:   insert WikiOperationLogPage × N
                        (role=CREATED|UPDATED|DELETED)
              Step M:   update WikiDiff.status = APPLIED, appliedAt
            ↓
            事务异常处理（v1.2.1 security R3 + architect R3）：
              - 捕获 Prisma `P2034` (serialization_failure)：
                自动重试 1 次（Serializable + 高并发下常见）；
                第 2 次仍失败 → 返回 409 CONFLICTED + 提示用户重跑 ingest
              - 其他错误 → 5xx + 完整 rollback
            ↓
            after commit (best-effort, 不回滚):
              run invariant lint (ORPHAN + MISSING_XREF only) → insert WikiLintFinding
              如失败：append WikiOperationLog (op=LINT, meta={error}) 不影响 apply 结果
```

> **关键不变**：
>
> - Skill 输出的 markdown 中**跨 wiki 链接必须用 `[[slug]]`**；外部 URL 用标准 `[text](url)` 允许（Karpathy 原意未禁，架构师 P1 修正 v1.0 过严）
> - `[[slug]]` 的 slug 必须经 `normalizeSlug` 校验；不合法 slug 的 diff 项整体被 apply 服务层拒
> - 同一时刻**允许多个 PENDING diff 并存**，但 affectedSlugs 有交集时第二个 apply 必败

### 5.2 Query（默认长 context；超阈值切 RAG 选页）

```
Trigger:    POST /api/v1/library/wiki/:kbId/query
Input:      { question, history?, mode?: 'inline'|'rag'|'auto' }   // mode 默认 'auto'
↓
Resolve config: load WikiKnowledgeBaseConfig(kbId) || DEFAULTS
              → inlinePageCount, inlineTokenBudget
↓
Branch resolution:
  - mode='inline' or (mode='auto' && pageCount ≤ inlinePageCount && totalTokens ≤ inlineTokenBudget)
    → Branch A
  - mode='rag' or 阈值超
    → Branch B

Branch A (inline 长 context):
  Step 1:   load all WikiPage where kbId（slug + oneLiner 全量 + body 后续按需）
  Step 2:   组装 context：
              先 index 视图（slug + oneLiner，~60 tok/page × pageCount）
              然后 body：先按 BM25 / pg_trgm 对 question 排序（不需要 embedding），
                         按相关性顺序装直到 totalTokens 上限
                         （reviewer P1：避免"按 updatedAt desc 装"造成旧知识盲区）
  Step 3:   skill `wiki-query`：合成回答 + citation slug 数组
  Step 4:   不写 WikiOperationLog（QUERY op 已砍）

Branch B (RAG 选页，v1.4 直调 engine 基元两步组合，不抽象 service):
  Step 1:   const qVec = await engineFacade.embeddingService.embed(question);
            const hits = await engineFacade.vectorService.similaritySearch(qVec, {
              filter: { sourceTable: 'wiki_page_embeddings', kbId, resolution: 'ONELINER' },
              topK: 15,
            });   // → [{ pageId, score }]
            （v1.4：撤回 v1.3 MultiResolutionSearchService 过度抽象，wiki 单消费方
            不构成抽象触发条件——CLAUDE.md "3 处使用再考虑抽象"）
  Step 2:   load 选中页全文 → 按 totalTokens 装 context
  Step 3-4: 同 A
↓
Output:   { answer: string, citations: [{slug}], usedPageIds: string[] }
```

### 5.3 Lint（v1.4 修订：CONTRADICTION/DATA_GAP 折叠到现有 CrossCuttingSynthesisService）

```
ORPHAN          (纯 SQL，wiki 专属):  WikiPage 没有 inbound WikiPageLink + category != SOURCE
MISSING_XREF    (纯 SQL，wiki 专属):  WikiPageLink.toSlug 不存在于 WikiPage

下三类 wiki-lint.service 装好数据后调 engine 既有/新增 primitives：

STALE           (LLM):  调 engine `StaleDetectorService.detect({
                          entries: pages.map(p => ({
                            id: p.id,
                            sources: p.sources.map(s => ({
                              referenceText: s.quote,                       // 旧 quote
                              currentText: s.document.rawContent.slice(s.spanStart, s.spanEnd),  // 当前 raw
                            })),
                          })),
                          taskProfile: { creativity: 'deterministic' },
                        })` → 每条 entry 是否 stale + 偏移度
                        wiki-lint 把 stale=true 的 entry 写入 WikiLintFinding (type=STALE)

CONTRADICTION   (LLM):  调 engine `CrossCuttingSynthesisService.detectContradictions({
                          documents: pagesGroupedByCategory.flatMap(...),  // 按 category 分组的 markdown 数组
                          samplingLimit: config.cronLintDailyBudgetCalls,   // 抽样上限
                          preferRecent: { sinceHours: 168 },                // 7d 内变动页优先
                          taskProfile: { creativity: 'deterministic' },
                        })` → Contradiction[]（与 topic-insights 共用同一服务+同一类型）
                        wiki-lint 写入 WikiLintFinding (type=CONTRADICTION, detail={pageA, pageB, reason})

DATA_GAP        (LLM):  调 engine `CrossCuttingSynthesisService.detectDataGaps({
                          documents: pages,
                          minMentions: 3,
                          existingEntityIds: pages.filter(p => p.category=='ENTITY').map(p => p.slug),
                          taskProfile: { creativity: 'deterministic' },
                        })` → DataGap[]（与 ResearchGap 复用同概念）
                        wiki-lint 写入 WikiLintFinding (type=DATA_GAP)
```

> **能力归属（v1.4 修订）**：CONTRADICTION/DATA_GAP 不另起 service——`CrossCuttingSynthesisService` 已在 topic-insights 跑同概念检测（已 export Contradiction/ResearchGap 类型），违反"同名概念全项目唯一"红线；改为给现有 service **加 2 个公共低级 API**，wiki/topic-insights/research/writing 都用同一个服务的不同方法。STALE 是独有语义（quote vs current text），单独留 `StaleDetectorService` 在新建 `consistency/` 子目录。

**触发时机**：

| 触发                           | 范围                                             |
| ------------------------------ | ------------------------------------------------ |
| ingest apply 后（事务外）      | ORPHAN + MISSING_XREF（纯 SQL，零 LLM 成本）     |
| 用户主动 `POST /lint`          | 5 类全跑                                         |
| cron daily（KB 级开关 + 预算） | 5 类全跑，但 LLM 类 ≤ `cronLintDailyBudgetCalls` |

**并发**：cron 与用户主动同时触发时——service 层用 `WikiOperationLog where op=LINT and createdAt > now-1m` 探测是否在跑，跑中则第二个直接返回最近 finding 集（不重跑）。

> **TaskProfile**: STALE / CONTRADICTION 用 `creativity=deterministic` (T=0.1) 避免幻觉过 lint。

### 5.4 Export（复用 ExportJob）

```
Trigger:    POST /api/v1/library/wiki/:kbId/export
            body: { format: 'TARBALL' }
↓
Service:    创建 ExportJob 行 (sourceType=WIKI, sourceId=kbId, format=TARBALL, status=QUEUED)
            返回 jobId（同 office/research export 协议）
↓
Worker:     for await page of streamPages(kbId):
              tar.entry({name: `wiki/${page.category.toLowerCase()}/${safeSlug(page.slug)}.md`}, page.body)
            tar.entry({name: 'wiki/index.md'}, generateIndex(pages))
            tar.entry({name: 'wiki/log.md'}, generateLog(opLogs))
            for await doc of streamDocuments(kbId):
              tar.entry({name: `raw/${doc.id}.md`}, doc.rawContent)
            ↓
            上传到对象存储 → 生成签名 URL → ExportJob.status=COMPLETED + downloadUrl
↓
Frontend:   轮询 ExportJob 状态（同现有模式）
```

> **安全**：tarball 路径生成时 slug 做二次过滤 `safeSlug(s) = s.replace(/[^a-z0-9-]/g, '_')`，即使 DB 里有非法字符（理论不会，DTO + normalizeSlug 兜底）也阻断路径穿越。

---

## 6. API 设计（v1.5.2 共 16 个 endpoint，含 export / search / wiki-enabled toggle / KB selector list）

| Method | Path                                    | 用途                                                | 鉴权               |
| ------ | --------------------------------------- | --------------------------------------------------- | ------------------ |
| GET    | `/library/wiki/:kbId/pages`             | 列页（可 ?category= ）                              | KB VIEWER 及以上   |
| GET    | `/library/wiki/:kbId/pages/:slug`       | 单页 body + outboundLinks + backlinks               | KB VIEWER 及以上   |
| POST   | `/library/wiki/:kbId/pages`             | 用户手动建页                                        | KB EDITOR 及以上   |
| PATCH  | `/library/wiki/:kbId/pages/:slug`       | 用户手动改页（写 revision）                         | KB EDITOR 及以上   |
| DELETE | `/library/wiki/:kbId/pages/:slug`       | 用户删页                                            | KB EDITOR 及以上   |
| POST   | `/library/wiki/:kbId/ingest`            | 触发 ingest，返回 diffId                            | KB EDITOR 及以上   |
| GET    | `/library/wiki/:kbId/diffs/:diffId`     | 取 diff 详情                                        | KB EDITOR 及以上   |
| PATCH  | `/library/wiki/:kbId/diffs/:diffId`     | apply 或 dismiss（合并 v1.0 两个 endpoint）         | KB EDITOR 及以上   |
| POST   | `/library/wiki/:kbId/query`             | 提问（带路由）                                      | KB VIEWER 及以上   |
| POST   | `/library/wiki/:kbId/lint`              | 触发 lint                                           | KB EDITOR 及以上   |
| GET    | `/library/wiki/:kbId/lint-findings`     | 列 lint 发现                                        | KB VIEWER 及以上   |
| PATCH  | `/library/wiki/:kbId/lint-findings/:id` | resolve 或 dismiss（合并 v1.0 两个 endpoint）       | KB EDITOR 及以上   |
| POST   | `/library/wiki/:kbId/export`            | 触发 export job（走 ExportJob）                     | KB VIEWER 及以上   |
| GET    | `/library/wiki/kbs/:kbId/pages/search`  | wiki 内全文搜索（v1.5.2 落码级新增）                | KB VIEWER 及以上   |
| PATCH  | `/library/kbs/:kbId/wiki-enabled`       | 启用/关闭 wiki（v1.5.2 角色门槛）                   | **KB ADMIN/OWNER** |
| GET    | `/library/wiki/kbs`                     | 获取用户可访问的 wikiEnabled KB 列表（KB selector） | 已认证用户         |

**鉴权实现**：所有路由 `@UseGuards(JwtAuthGuard)` + service 层第一行 `await this.kbService.hasAccess(userId, kbId, RequiredRole)` 校验，与 `RAGController` / `NotesController` 一致。**不创新 KnowledgeBaseGuard**（v1.0 虚构）。

**`GET /library/wiki/kbs/:kbId/pages/search` 详细规格**（v1.5.2 落码级）：

```typescript
// DTO
class WikiPageSearchDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/^[\p{L}\p{N}\p{M}\s\-]+$/u, { message: 'q must be unicode letter / number / mark / hyphen / space' })  // v1.5.3 改 Unicode property，支持全语种（日文/韩文/emoji/希腊字母等）；u flag 启用 Unicode 模式；线性匹配无 ReDoS
  q: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 20;
}

// Response（字段白名单 DTO，禁返 body / contentHash / sourceRefs 等）
class WikiPageSearchResultDto {
  slug: string;
  title: string;
  oneLiner: string;
  category: WikiPageCategory;
  // 不含 body / sources / lastEditedBy 等敏感/大字段
}

// service 层实现要点
- 第一行 hasAccess(userId, kbId, VIEWER)
- 第二行 wikiEnabled 校验（false → 404 Not Found，与"KB 不存在"统一）
- 搜索范围限当前 kbId（路径段强制，service 层不接受 query 参数中的 kbId）
- 实现：PostgreSQL full-text search on (slug || ' ' || title || ' ' || oneLiner)，ILIKE fallback；不读 body 减小 latency 与泄露面
- rate limit：与现有 RAGController 一致（每用户 60 req/min）
```

**`PATCH /library/kbs/:kbId/wiki-enabled` 详细规格**（v1.5.2 角色门槛）：

```typescript
// DTO
class ToggleWikiEnabledDto {
  @IsBoolean()
  enabled: boolean;
}

// service 层
- 第一行 hasAccess(userId, kbId, ADMIN)  // 强制 ADMIN/OWNER
- enabled=true：wikiEnabled true 写入；首次启用时 upsert WikiKnowledgeBaseConfig 默认行（inlinePageCount=200 / inlineTokenBudget=500_000 / ingestMaxTokens=80_000 等）
- enabled=false：wikiEnabled false 写入；保留现有 WikiPage 数据不删（用户随时可重启用）；前端 KB selector 列表自动剔除
- 写 WikiOperationLog (op=EDIT, meta={action:'toggle_wiki_enabled', enabled})
- 返回 { kbId, wikiEnabled, configCreated: boolean }
```

**`wikiEnabled=false` 守门**（tester R2 边缘 #1）：所有写操作 endpoint（POST/PATCH/DELETE）service 层 hasAccess 后第二步：

```typescript
const kb = await this.prisma.knowledgeBase.findUnique({ where: { id: kbId } });
if (!kb.wikiEnabled)
  throw new BadRequestException("Wiki not enabled for this KB");
```

读操作（GET）允许在 `wikiEnabled=false` 的 KB 上调用以查看历史数据，但前端 UI 隐藏入口（§7）。

**diffId IDOR 防护**（security R1 P1，v1.5.2 改 NotFound 消 oracle）：所有 `/diffs/:diffId/...` service 层第一行 `if (!diff || diff.knowledgeBaseId !== kbId) throw new NotFoundException("Diff not found")` —— 跨 KB 越权与"diff 不存在"统一返 404，切断 diffId 存在性 oracle。同适用 `/lint-findings/:id`、`/revisions/:id`、`/pages/:slug` 跨 KB / 跨 page 的全部 IDOR 路径（详见 §7.3 失败语义对照表）。

**revert**：作为 `PATCH /pages/:slug` 的子动作 `body={action:'revert', toRevisionId}`，不单独 endpoint；写 `WikiOp.REVERT` log。

**revert 跨页 IDOR 防护**（v1.2 security R2 P1，v1.5.2 改 NotFound 消 oracle）：service 层强制校验 `revision.pageId === currentPage.id`：

```typescript
const revision = await this.prisma.wikiPageRevision.findUnique({
  where: { id: toRevisionId },
});
if (!revision || revision.pageId !== currentPage.id) {
  throw new NotFoundException("Revision not found"); // v1.5.2: 与"revision 不存在"统一响应
}
```

防 EDITOR 用别页面的 revisionId 替换当前页内容；与"revision 真不存在"返同样 404，攻击者无法通过响应区分"revisionId 在他 page 存在" vs "revisionId 不存在"。

---

## 7. UI 设计（P3，v1.5 重构）

### 7.1 入口与 Tab 形态

`/library` 顶层 LibraryTabs 在 v1.5 提升为 4 项，Wiki 置首位且为默认 active：

```
[Wiki ▌] 个人知识库  团队知识库  数据源
  ↑
  默认 active；icon: BookOpen (lucide-react)；indicator violet-500
```

**实施细节**（v1.5.1 按 reviewer R7 P0 实测校准）：

- 现状（`frontend/app/library/page.tsx`）：
  - L219-220 `activeTab` union 含 4 个值：`'personal-kb' | 'team-kb' | 'data-sources' | 'graph'`
  - L241 默认值 `'data-sources'`（非 `'personal-kb'`，方案 v1.5 描述错误）
  - L1693-1709 `libraryTabs` 数组仅 3 项（不含 `'graph'`）；`'graph'` 是渲染分支但不出现在 LibraryTabs，via L1892 条件渲染独立处理
- 修改：
  - L219-220 union 首位增加 `'wiki'` → `'wiki' | 'personal-kb' | 'team-kb' | 'data-sources' | 'graph'`
  - L241 默认值由 `'data-sources'` 改为 `'wiki'`
  - L1693 `libraryTabs` 首位插入 `{ id: 'wiki', label: t('library.wiki.title'), icon: BookOpen }`
  - graph 渲染分支 **不动**（保留 KB 详情页的 graph 视图入口，与 wiki 解耦）
- **主 Agent 手动改**（CLAUDE.md 入口文件红线，禁 Sub-Agent 修改 page.tsx）

**LibraryHeader 数据流隔离**（reviewer R7 P0）：

现状 LibraryHeader 的 `searchQuery` / `onSearchChange` 通过 page.tsx L286 `setSearchQuery` 驱动**资源**过滤（feeds personal-kb / team-kb / data-sources 三个 tab 内部资源 list filter）。wiki tab 下若复用同一 state 会导致：用户输入跨 KB 搜索 wiki 内容时，仍按资源过滤逻辑发起 API 请求 → 跨 KB slug 通过 devtools 网络面板泄露。

v1.5.1 强制隔离：

- 新增 `wikiSearchQuery` 独立 state（仅 wiki tab 内有效），与 `searchQuery` 完全解耦
- LibraryHeader 在 wiki tab 下 **不渲染默认 search input**——改为渲染 wiki 自带的搜索框（Wiki sub-header 内置或左 Sidebar 顶部）；或 LibraryHeader 接受 `searchMode: 'global' | 'wiki'` prop，wiki 模式下 placeholder 切换 + onChange 派发 `wikiSearchQuery` setter（具体由 P3a 实施时定夺）
- 全局 `searchQuery` 在 wiki tab mount 时不重置（用户切回 personal-kb 应保留之前的资源 query）

**老用户兼容**（v1.5.1 安全增强）：

- 首次见到 Wiki tab 时弹一次性 toast "Library 已升级，Wiki 是默认形态。[切回旧默认]"
- 点击 "切回旧默认"：写 `localStorage.libraryDefaultTab:<userId-hash>='data-sources'`（key 加 userId 前缀防共享浏览器跨用户残留），下次进入 `activeTab` 解析链多一级 localStorage 检查
- 读出 localStorage 值后**强制 enum 白名单匹配**：仅接受 `'wiki' | 'personal-kb' | 'team-kb' | 'data-sources'`（不含 graph，graph 不允许做默认 tab），未命中回 default `'wiki'` —— 防 open redirect / XSS 注入修改 localStorage 后的提权
- 登出钩子（auth flow logout 时）清除：`libraryDefaultTab:<userId-hash>` / `lastWikiKbId:<userId-hash>` / 一次性 toast sentinel
- localStorage 跨设备不一致是已知 trade-off（详见 §15 第 6 项），v1.5.1 决定 localStorage-only，永不入 DB

### 7.2 Wiki Tab 内布局

```
┌─ LibraryHeader (标题 + 全局搜索框，wiki tab 下 placeholder = "在当前 wiki 中搜索…") ─┐
├─ LibraryTabs:  [Wiki ▌]  个人知识库  团队知识库  数据源 ─────────────────────────┤
├─ Wiki sub-header (粘性):                                                       │
│   📚 KB: [我的研究库 ▾]  · 218 页 · 上次 ingest 2h ago                          │
│              [+New Page] [Ingest] [Lint] [Export] [Query]    Log ▾  Settings ⚙ │
├──────────────┬──────────────────────────────────────┬─────────────────────────┤
│ Search…       │  # Machine Learning      [CONCEPT]   │ One-liner               │
│ ▾ Entities    │  Last edited by LLM · 2h ago         │  概要可编辑              │
│   • OpenAI    │  ─────────────────────────────────   │                         │
│   • GPT-4     │  本页 markdown 渲染（rehype-sanitize │ Sources (3)             │
│ ▾ Concepts    │  + katexAwareSchema 复用既有）。      │  → doc-A p12            │
│   • ML        │  跨链 [[supervised-learning]] 蓝色;   │  → doc-B p7             │
│   • RLHF      │  缺页 [[reinforcement]] 红色虚线 →   │                         │
│ ▾ Summaries   │  点击触发"建空页"快捷流。              │ Backlinks (5)           │
│ ▾ Sources     │                                       │  ← gpt-4                │
│              │  [Edit] [History ▾]                   │  ← rlhf                 │
│              │                                       │ Lint (1) ⚠ STALE        │
└──────────────┴──────────────────────────────────────┴─────────────────────────┘
```

| 区域            | 宽度 | 职责                                                                                                      |
| --------------- | ---- | --------------------------------------------------------------------------------------------------------- |
| Wiki sub-header | 全宽 | 粘性顶部：KB selector（下拉）+ 元数据（页数 / 上次 ingest）+ Toolbar 五按钮 + Log 抽屉 + Settings         |
| 左 Sidebar      | 30%  | 顶部 wiki 内搜索框（slug + oneLiner，前端 fuzzy；KB ≤ 阈值时全量装客户端）+ 4 段可折叠 category 树        |
| 中 Main         | 50%  | 当前 page markdown 渲染 + `[[link]]` chip（蓝/红虚线）+ Edit 切换 markdown 编辑器 + History timeline 折叠 |
| 右 Inspector    | 20%  | oneLiner 行内编辑 + Sources（链回 KnowledgeBaseDocument）+ Backlinks（`toSlug` 反查）+ 本页 lint findings |
| 移动端          | -    | 左 Sidebar 折抽屉 / 右 Inspector 折底部 sheet / Wiki sub-header 紧凑（仅 KB 名 ▾ + Toolbar 折叠菜单）     |

### 7.3 KB Selector

```
┌─────────────────────────────────────────────┐
│ 切换到知识库:                                │
│  ✓ 我的研究库         218 页 · 启用中        │
│    GTM 团队           45 页  · 启用中        │
│    Marketing          0 页   · 启用中        │
│    ─────────────────────────────────         │
│    管理 wiki 启用状态 →                      │
└─────────────────────────────────────────────┘
```

KB selector 解析顺序（首次进入 Wiki tab 时执行，v1.5.1 安全语义统一）：

1. **URL `?kb=<kbId>` 显式指定** → 双校验：(a) `kbService.hasAccess(userId, kbId, VIEWER)` 失败 → 通用 redirect `/library?tab=wiki`（**不带原 kbId**，避免 KB 存在性 oracle）；(b) hasAccess 通过但 `wikiEnabled=false` → 显式空态卡片（§7.5 第二态，提示"该 KB 未启用 Wiki"）；(c) 双校验通过 → 进入指定 KB
2. **`localStorage.lastWikiKbId:<userId-hash>`**（key 加 userId 前缀，登出时清）→ 校验仍有 VIEWER access + 仍 wikiEnabled，任一不满足跳到 step 3
3. **用户唯一开启 wikiEnabled 的 KB** → 直接进入
4. **default KB**（v1.5.1 显式定义）：用户 KB 列表中按 `WikiPage.updatedAt desc` 取第一条 wikiEnabled KB（即"最近使用过 wiki 的 KB"）；若 0 个 wikiEnabled，跳过此级到 step 5
5. **引导态**（§7.5 三态 funnel：根据用户 KB 数量与 wikiEnabled 状态分别渲染 0 KB / 0 wikiEnabled / 0 page 的引导卡片）

**失败语义对照表**（v1.5.2 security R7.1 P1 消 oracle 修订）：

| 场景                                      | 处理                                   | 理由                                                                                                        |
| ----------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `?kb=<X>` 无 VIEWER access                | redirect `/library?tab=wiki`（不带 X） | 避免 KB 存在性 oracle（攻击者枚举 kbId 时无法区分"KB 不存在" vs "KB 存在但无权访问"）                       |
| `?kb=<X>` 有 access 但 wikiEnabled=false  | 显式空态 §7.5 + 启用引导               | 用户合法访问，应得明确反馈                                                                                  |
| `/diffs/:diffId` 跨 KB（IDOR）            | **404 NotFound**（v1.5.2 修订）        | service 层校验 `diff.knowledgeBaseId !== kbId` 时返 404，与"diff 不存在"统一响应；切断 diffId 存在性 oracle |
| `/pages/:slug` 跨 KB（旧 URL 残留）       | **404 NotFound**（v1.5.2 修订）        | 同上：service 层校验 `page.knowledgeBaseId !== kbId` 时返 404；与"slug 在合法 KB 内不存在"统一响应          |
| `/pages/:slug` 在合法 KB 但 page 不存在   | 404 NotFound                           | 标准 REST 语义                                                                                              |
| `/lint-findings/:id` 跨 KB                | **404 NotFound**                       | 同 IDOR 路径处理                                                                                            |
| `/revisions/:id` 跨 page                  | **404 NotFound**                       | 同上                                                                                                        |
| controller 层无任何 KB access（root URL） | 401 Unauthorized                       | 标准鉴权流程                                                                                                |

> **v1.5.2 修订要点**：v1.0–v1.4 / v1.5.1 此前所有"跨 KB IDOR 返 403"的描述（§6 / §11 v1.0–v1.4 累积条款）均**追溯修订为 404**。403 仅用于"角色不足"场景（VIEWER 调写操作 / EDITOR 调 wikiEnabled toggle）；"资源跨 KB 越权"统一 404，与"资源不存在"不可区分，杜绝存在性 oracle。

每次切换 KB 写 `localStorage.lastWikiKbId:<userId-hash>` + URL `?kb=` 同步，刷新页面保留 context。selector 列表服务端过滤：仅返回 `wikiEnabled=true && hasAccess(userId, VIEWER)` 的 KB；前端不做兜底过滤；**所有返回 KB / page slug 的 endpoint**（list / backlinks / lint findings / log entries / search）统一走相同过滤（详见 §11 v1.5.1 加项）。

### 7.4 Diff 审阅页（产品价值兑现点）

```
┌─ Wiki diff · 5 项变更 · PENDING ─────────────  [Apply 3] [Dismiss all] ┐
│                                                                       │
│ ⚠ 状态条：如 wiki 在审阅期间被改动，本 diff 进入 CONFLICTED 状态        │
│                                                                       │
│ ─[ ✓ ] CREATE · supervised-learning [CONCEPT] ───────────  ▼ expand ┐ │
│       new oneLiner: 监督学习是给定带标签数据训练映射函数的范式…       │ │
│       sources: doc-A p.12-18, doc-C p.3-9                             │ │
│ ──────────────────────────────────────────────────────────────────── ┘ │
│                                                                       │
│ ─[ ✓ ] UPDATE · machine-learning ─────────────────────────  ▼ expand ┐ │
│       展开后是左旧右新的 split diff（react-diff-viewer-continued）    │ │
│       │ ## 监督学习       │ ## 监督学习                              │ │
│       │ 见 supervised-…  │ 见 [[supervised-learning]] 一文          │ │
│       │ -                │ + 增加段落 about RLHF                     │ │
│ ──────────────────────────────────────────────────────────────────── ┘ │
│                                                                       │
│ ─[   ] DELETE · old-stub ─────────────────────────────────  ▼ expand ┐ │
│       当前 body 预览（删除前一眼审）                                  │ │
│ ──────────────────────────────────────────────────────────────────── ┘ │
└───────────────────────────────────────────────────────────────────────┘
```

关键交互：

- 三色边框区分类型（creates 蓝 / updates 黄 / deletes 红），50+ 项大 diff 一眼可扫
- 每张卡片左上 checkbox，默认全选；提交走 `PATCH /diffs/:diffId body={action:'apply', selectedItemIds}`
- updates 必须 split diff（左旧右新），不允许 inline——LLM 全量替换 newBody 时整段重排，inline 噪声爆炸
- CONFLICTED 状态：红色横幅"wiki 已被他人修改，此 diff 失效"+ "重跑 ingest"快捷按钮，所有 apply 按钮置灰
- 提交后 toast "已应用 X 项 / 跳过 Y 项"，主视图侧栏自动更新；新建 page 高亮 2 秒淡出

### 7.5 三种空态（onboarding funnel，v1.5.1 角色与数据源校准）

| 态                | 触发条件                            | 中栏内容 + 关键安全约束                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0 KB**          | 用户名下 0 个 KB                    | 引导卡："Wiki 是你的 LLM 编译知识库。先建一个知识库。" + 主 CTA "新建知识库" + 次要文字 "或先去 [个人知识库] 看看"                                                                                                                                                                                                                                                                                                                                                                                      |
| **0 wikiEnabled** | 有 KB 但 0 个开启 wikiEnabled       | 列表卡："选一个知识库启用 Wiki" + 用户的 KB 列表。**(v1.5.1 安全 P0)** 每条 KB 显示文档数 + "启用 Wiki"按钮，按钮**仅当 user 是该 KB 的 OWNER/ADMIN 时启用**；EDITOR 看到按钮 disabled + tooltip "需要 OWNER/ADMIN 权限"；VIEWER 整行 disabled。点击触发 `PATCH /library/kbs/:kbId/wiki-enabled body={enabled:true}` service 层强制 OWNER/ADMIN 校验，EDITOR 路径返回 403。**(v1.5.1 架构师 P1)** KB 列表数据走通用 KB list endpoint（与 personal-kb tab 复用同 endpoint），不在 wiki 模块新建 endpoint |
| **0 page**        | KB 已选定 + wikiEnabled=true + 0 页 | Karpathy ingest 引导：中栏内嵌文档 picker（多选当前 KB 的 KnowledgeBaseDocument）+ 右侧实时估算 token 数 + ingestMaxTokens 上限 + "[Run Ingest] / [手动建第一页]"。Run Ingest 走 `POST /library/wiki/:kbId/ingest`（KB EDITOR 及以上）                                                                                                                                                                                                                                                                  |
| **正常态**        | 上述都满足                          | 自动选最近编辑页（按 `WikiPage.updatedAt desc` + `category=SUMMARY` 优先级双排序；SUMMARY 优先于 ENTITY/CONCEPT，便于用户先看到"主页面"概览）；左 Sidebar Entities 段展开                                                                                                                                                                                                                                                                                                                               |

> **设置权 vs 使用权解耦**（v1.5.2 security 角色矩阵清晰化）：
>
> - **设置权**（toggle `wikiEnabled` 开关、修改 `WikiKnowledgeBaseConfig`）：仅 KB **OWNER / ADMIN**；EDITOR / VIEWER 路径返回 403
> - **使用权**（一旦 wikiEnabled=true，wiki 业务操作）：与现有 KB 角色矩阵一致——
>   - VIEWER：读所有 wiki 内容（页 / lint findings / log entries / export）+ query
>   - EDITOR：读 + 创建/编辑 page + 触发 ingest + 触发 lint + apply diff + revert
>   - ADMIN / OWNER：以上全部 + 设置权
> - 这避免 P3 落码时混淆：EDITOR 是 wiki 的核心使用者，不应因"EDITOR 不能开 wiki"被误读为"EDITOR 不能用 wiki"
> - 前端实现：toggle 按钮按 `currentUserRole >= ADMIN` 判定 disabled；wiki 内的 ingest / edit / apply 等按钮按 `currentUserRole >= EDITOR` 判定 disabled；服务端按对应角色 hasAccess 校验

### 7.6 Lint Drawer / Log Drawer / Query Panel

| 入口          | 形态                      | 内容                                                                                                                                   |
| ------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `[Lint]` 按钮 | 右侧 Drawer，不阻塞主视图 | 顶部 5 type tabs（CONTRADICTION / STALE / ORPHAN / MISSING_XREF / DATA_GAP），每条 finding 一行 + 跳转到对应页 + `[resolve] [dismiss]` |
| `Log ▾`       | 右侧 Drawer，时间倒序     | 每条 entry：`[2026-05-09 14:30] ingest · 创建 3 / 更新 2 · by user@x` + 点击展开具体页跳转。这是 Karpathy log.md 的 UI 形态            |
| `[Query]`     | 右下角浮动 chat panel     | 流式渲染 answer + `[[slug]]` chip 可点跳转 + 底部小字 "本次走 inline 模式 (A 路径)" 或 "本次走 RAG 选页 (B 路径，命中 X 页)"           |

### 7.7 URL 状态结构与互斥规则（v1.5.1 tester P1 状态机定型）

```
/library?tab=wiki                                  Wiki tab + KB selector 默认解析
/library?tab=wiki&kb=<kbId>                        指定 KB
/library?tab=wiki&kb=<kbId>&page=<slug>            指定 page
/library?tab=wiki&kb=<kbId>&diff=<diffId>          Diff 审阅页（modal）
/library?tab=wiki&kb=<kbId>&log=1                  Log drawer 打开
/library?tab=wiki&kb=<kbId>&lint=1                 Lint drawer 打开
```

**互斥/叠加规则**：

| 同时出现的参数                  | 行为                                                                                                            |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `?diff=X` 单独                  | 进入 Diff 审阅 modal，背景仍为 wiki 主视图（kbId 必备，缺则 redirect 引导）                                     |
| `?lint=1&log=1`                 | 两个 drawer 都打开是不允许的（视觉冲突）；右栏统一渲染 lint drawer，log 自动 dismiss + URL 自动重写为 `?lint=1` |
| `?diff=X&lint=1`                | diff modal 优先（modal > drawer），lint drawer 自动 dismiss + URL 自动重写为 `?diff=X`                          |
| `?diff=X&log=1`                 | 同上：diff 优先，log dismiss                                                                                    |
| `?diff=X&page=Y`                | diff modal 在 page=Y 上下文中打开（背景 page 为 Y）                                                             |
| `?lint=1&page=Y`                | 允许叠加：page=Y 中栏 + lint drawer 右栏                                                                        |
| `?log=1&page=Y`                 | 同上                                                                                                            |
| `?kb=X&page=Y` 但 page 不属于 X | service 层 404（page 在 kb 内不存在）                                                                           |

URL 状态完整可分享、可书签；三级 query parameter 而非 path segment，简化 Next.js app router 嵌套深度。互斥规则在前端 URL handler 中作为 reducer 实现（接收 query params → 输出标准化的 view state），保证刷新与分享行为一致。

### 7.8 实施红线

- 入口文件 `frontend/app/library/page.tsx`（CLAUDE.md 红线）：**主 Agent 手动加 wiki tab + activeTab 默认值修改**，禁 Sub-Agent 写
- Wiki sub-header / KB selector / Diff 审阅页 / 三态空态：sub-component 形式实现，放 `frontend/components/library/wiki/`
- 所有 wiki 相关组件复用现有设计 token：中性灰底 `bg-gray-50` + 紫色 indicator `violet-500` + LucideIcon + LibraryHeader pattern
- markdown 渲染复用 `frontend/lib/utils/sanitize.ts` 的 `rehype-sanitize` + `katexAwareSchema`
- 不引入新组件库（无 shadcn / radix-ui 新依赖）；所有交互 primitive 复用 `frontend/components/common/`

---

## 8. 落地路径

| Phase                                           | 范围                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 周期      | 验证标准（命令级，可独立循环）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **P0a engine 通用能力（v1.5.1 工程量上调）**    | (1) `ai-engine/content/markdown/wiki-link-parser.util.ts` + `slug-normalize.util.ts`，**同 PR 替换全项目 ≥ 16 处 ad-hoc slugify**（明细见 §16 附录，落码 reviewer 可逐项 diff）<br>(2) `ai-engine/knowledge/synthesis/cross-cutting-synthesis.service.ts` 加 2 个低级 public API：`detectContradictions(documents)` / `detectDataGaps(documents, opts)`（既不复制 prompt 也不另起 service）<br>(3) `ai-engine/knowledge/consistency/stale-detector.service.ts` + `consistency.module.ts`（**仅** 1 个 service）<br>(4) facade 加 3 export：`parseMarkdownWikiLinks` / `normalizeMarkdownSlug` / `StaleDetectorService` | 2.5 天    | `npm test --testPathPattern='ai-engine/(content/markdown\|knowledge/(synthesis\|consistency))'` 全绿；`verify:arch` 全绿；§16 附录 16 处 ad-hoc slugify 替换后所有原调用方测试仍绿（逐项 diff 验证完整性）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **P0b schema + ADR**                            | 10 张新表（含 `WikiKnowledgeBaseConfig`，从 P2 提到 P0）+ `KnowledgeBase.wikiEnabled` + `ExportSourceType.WIKI` + `ExportFormat.TARBALL` + 手写 SQL migration（IF NOT EXISTS 幂等 + `wiki_diffs.affected_slugs` GIN partial index + 5 处 SetNull onDelete）+ `docs/architecture/decisions/ADR-XXX-wiki-vs-graph-coexistence.md` 落盘                                                                                                                                                                                                                                                                                   | 1 天      | `npm test --testPathPattern=wiki/__tests__/schema` 全绿（CRUD + uniq + FK cascade + SetNull 行为）<br>migration 在 Railway 跑两次第二次不报错                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **P1 ingest + edit + log**                      | 全部 wiki service + DTO + controller + skills/wiki-ingest.skill.md + WikiPageRevision 写入 + invariant lint + diff apply 事务（消费 P0a 的 engine 能力）                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 4 天      | engine 侧（P0a 已建）：<br>- `wiki-link-parser.util.spec.ts` 10 条边界用例（见 §10）<br>- `slug-normalize.util.spec.ts`<br>wiki app 侧：<br>- `wiki-page.service.spec.ts`（CRUD + slug uniq + **PATCH edit 路径写 WikiPageRevision** + **revert 跨页 revisionId 返回 403**；调 engine `parseMarkdownWikiLinks` + `sanitizeMarkdownBody` mock）<br>- `wiki-diff.service.spec.ts`（事务：第 N+1 项失败前 N 不提交；CONFLICTED 路径；revert 写 revision；**WikiDiffItemsSchema zod parse 失败 400**；**affectedSlugs 实时重算（DB 字段被改空仍能挡冲突）**；**SELECT FOR UPDATE 串行化两并发 apply 测试**）<br>- `wiki-ingest.service.spec.ts`（mock ChatFacade，验证 wrapExternalContent 调用含显式 maxLength + diff 持久化 + **baselineHash 计算确定性：相同 index 两次 hash 相等**）<br>- `wiki.controller.spec.ts`（diffId IDOR：跨 KB diff 返回 403；**wikiEnabled=false 时 POST/PATCH/DELETE 返回 400**） |
| **P2 query + lint（v1.4 修订）**                | wiki-query 双分支（Branch B 直调 engine `EmbeddingService.embed` + `VectorService.similaritySearch`）+ WikiPageEmbedding 写入 + ORPHAN/MISSING_XREF wiki 自做（纯 SQL）+ STALE 调 `StaleDetectorService` + CONTRADICTION/DATA_GAP 调 `CrossCuttingSynthesisService.{detectContradictions, detectDataGaps}` + cron 读 `WikiKnowledgeBaseConfig`                                                                                                                                                                                                                                                                         | 3 天      | engine 侧（P0a 已建，P2 补集成测）：<br>- `cross-cutting-synthesis.service.spec.ts` 加 2 项：`detectContradictions` / `detectDataGaps` 各 ≥1 fixture（mock ChatFacade）<br>- `stale-detector.service.spec.ts` ≥1 fixture<br>wiki app 侧：<br>- `wiki-query.service.spec.ts`：阈值边界 pageCount=200/201、Branch B mock `embeddingService.embed` + `vectorService.similaritySearch` 调用断言（filter 含 `sourceTable: 'wiki_page_embeddings'` + `kbId` + `resolution: 'ONELINER'`）、BM25 排序（Branch A）生效<br>- `wiki-lint.service.spec.ts`：ORPHAN/MISSING_XREF 纯 SQL 不调 LLM；STALE/CONTRADICTION/DATA_GAP 调 engine 服务 mock 验证传参（samplingLimit / preferRecent / minMentions）<br>- cron 与手动并发 spec：第二次返回最近 finding 不重跑<br>- 把首个真实 KB query 结果存到 `eval-baseline.md`（不作为 Phase gate）                                                                              |
| **P3a UI 主路径（v1.5.1 拆分）**                | LibraryTabs 入口（page.tsx 主 Agent 改）+ Wiki sub-header（KB selector + Toolbar）+ 三栏布局（左 Sidebar 树 + 中 Main markdown 渲染 + 右 Inspector）+ Diff 审阅页（split diff + 三色边框 + apply 流）+ Lint Drawer + Log Drawer + Query Panel + ExportJob 集成（WIKI / TARBALL）                                                                                                                                                                                                                                                                                                                                       | 3 天      | `npm test --testPathPattern='wiki/.*\.spec\.tsx$'` 全绿；CONFLICTED 端到端 spec（mock 409 + 红色横幅 + apply 置灰 + 重跑 ingest 跳转）；KB selector 服务端过滤 3 条 fixture；diff 审阅页 split diff 渲染断言；e2e 手测：导入 5 篇 doc → ingest → apply → query → lint → resolve → export tarball 解压可读                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **P3b 空态 + onboarding + 兼容（v1.5.1 新增）** | 三态 funnel（0 KB / 0 wikiEnabled / 0 page）+ KB selector 5 级降级解析 + URL 状态机（互斥/叠加规则）+ wikiEnabled toggle UI（角色 disabled + tooltip）+ What's new toast + localStorage 跨用户隔离 + LibraryHeader searchQuery 数据流隔离 + Wiki 内搜索 endpoint                                                                                                                                                                                                                                                                                                                                                       | 2 天      | `kb-resolver.spec.ts` 5 级降级链每级 fallback 用例；三态空态 4 组 prisma fixture（0 KB / 0 wikiEnabled / 0 page / 正常态）；wikiEnabled toggle 角色门槛 spec（OWNER/ADMIN 通过 / EDITOR 403 / VIEWER 整行 disabled）；`localStorage` What's new toast 仅一次 + activeTab 解析优先级（URL > localStorage > default `'wiki'`）；URL 状态机 spec（`?diff` modal vs `?lint=1`/`?log=1` drawer 互斥规则）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **合计**                                        |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | **13 天** | 每 Phase 落地后 4 路集体评审到 4/4 共识再进下一 Phase（v1.5.1：P0a 1.5→2.5 天 + P3 4→5 天，原 12 天调整为 13 天）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

> **覆盖率守门**（tester P1）：`backend/jest.config.js` 加：
>
> ```js
> "./src/modules/ai-app/library/wiki/": {
>   branches: 70,
>   functions: 80,
>   lines: 80,
>   statements: 80,
> },
> ```

---

## 9. 风险与缓解

| 风险                                              | 缓解                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| LLM 写出语义重合的两个 page 导致双源              | ingest skill 先列现有 index 给 LLM，prompt 强约束"prefer update over create"；diff UI 显式展示 create/update 比例    |
| `[[slug]]` 失锚（链到不存在的页）                 | 不阻塞保存，写 missing_xref finding；UI 高亮链可点"建空页"快速建占位                                                 |
| 大库 query 走 RAG 分支后 retrieval noise 又回来   | RAG 只在 oneLiner 上跑（不在 body 上），oneLiner 是高度浓缩文本（≤280 char），噪声远低于原始 chunk                   |
| document 改了导致大量 page 过期                   | sources 表存 `quote` 冗余字段；STALE lint 用 LLM 判 quote 上下文偏移而非字符 diff，且 LLM 调用按 KB 日预算限速       |
| import documents 速度跟不上 ingest skill          | ingest 异步队列化（NestJS Bull），diffId 立即返回，前端用 WebSocket 拿进度                                           |
| 多用户同 KB 同时 ingest 触发互相覆盖              | apply 时 `baselineHash` 乐观锁 + `affectedSlugs` 集合冲突判定；空交集允许并存                                        |
| export tarball 大库内存爆                         | 流式 `tar-stream`；Page body 按页流出而不是全聚合；超过 200MB 切 multipart 提示用户分 KB 导出；走 ExportJob 异步系统 |
| 架构边界违规                                      | wiki 子模块只 import `AiEngineModule` facade；`verify:arch` + `layer-boundaries.spec.ts` 守门                        |
| KG 数据被无意废弃                                 | KG 表/字段保留只读；本期不删；ADR-XXX 明示 wiki entity ≠ Note.graphNodes 不互相同步                                  |
| Karpathy 阈值假设放在 Claude/GPT 不一定够         | 阈值进 `WikiKnowledgeBaseConfig` 每 KB 可调；进 context 前 token counter 截断兜底                                    |
| **prompt injection**（用户在 doc 里写"忽略指令"） | wiki-ingest 强制 `wrapExternalContent` + `EXTERNAL_CONTENT_SYSTEM_NOTICE`；安全审计日志（`prompt-sanitizer` 已集成） |
| **slug 路径穿越 / XSS**                           | DTO `@Matches` + export 二次校验 `safeSlug` + 前端 `rehype-sanitize`                                                 |
| **diffId IDOR**                                   | service 层第一行验 `diff.knowledgeBaseId === kbId`；spec 强制覆盖跨 KB 场景                                          |
| **PII 数据泄露给 BYOK 第三方模型**                | 在 wiki query / ingest 入口加一次性合规告知（GDPR Art.13/14）；UI 提示"内容会发送给您配置的 AI 模型提供商"           |
| **cron lint 资源滥用**                            | KB 级开关 `cronLintEnabled` + 每日预算 `cronLintDailyBudgetCalls=50`；超额标"待复查"不再调 LLM                       |
| **大 note 输入压垮 ingest**                       | controller 层 token counter 80K 上限强制截断 + 显式告知用户                                                          |
| **dirty write**（apply 时另一用户在改）           | apply 用 `baselineHash` 乐观锁 + `WikiPage.contentHash` 行级比对；冲突 → CONFLICTED + 409，要求重跑 ingest           |

---

## 10. link-parser 测试用例（tester P0 锁定）

`link-parser.spec.ts` 必须覆盖以下 10 条（用 remark AST 实现）：

| #   | 输入 markdown            | 期望 slugs             | 备注                                |
| --- | ------------------------ | ---------------------- | ----------------------------------- |
| 1   | `[[machine-learning]]`   | `['machine-learning']` | 基本                                |
| 2   | `[[Machine Learning]]`   | `['machine-learning']` | 调 normalizeSlug 后                 |
| 3   | `` `[[code-block]]` ``   | `[]`                   | 行内代码不解析                      |
| 4   | ` ```\n[[fenced]]\n``` ` | `[]`                   | 代码围栏内不解析（remark AST 跳过） |
| 5   | `\[\[escaped\]\]`        | `[]`                   | 反斜杠转义                          |
| 6   | `[[a]] and [[b]]`        | `['a', 'b']`           | 同行多个                            |
| 7   | `[[]]`                   | `[]`                   | 空 slug 不合法                      |
| 8   | `[[slug-with-123]]`      | `['slug-with-123']`    | 数字混合                            |
| 9   | `[[a/b/c]]`              | `[]`                   | 路径斜杠不允许（路径穿越防护）      |
| 10  | `<!-- [[comment]] -->`   | `[]`                   | HTML 注释内不解析                   |

> 用例 9 / 10 在 v1.0 是开放问题，v1.1 锁定。

---

## 11. 安全 checklist（security P0/P1 全部覆盖）

| 位置                                                                                    | 措施                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dto/*.dto.ts` 所有 slug 字段                                                           | `@Matches(/^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `wiki-ingest.service.ts` 进入 LLM 前                                                    | `wrapExternalContent(docRawContent, {source:'kb_document'})` + 系统 prompt 末附 `EXTERNAL_CONTENT_SYSTEM_NOTICE_ZH`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `wiki-page.service.ts` export tarball                                                   | `safeSlug = slug.replace(/[^a-z0-9-]/g, '_')` 二次校验                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `wiki-diff.service.ts` apply/dismiss 入口（v1.5.2 改 NotFound）                         | `if (!diff \|\| diff.knowledgeBaseId !== kbId) throw new NotFoundException("Diff not found")` —— 与"diff 不存在"统一响应，切断 diffId 存在性 oracle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `wiki-page.service.ts` sourceRef 写入                                                   | 校验 `0 ≤ spanStart ≤ spanEnd ≤ document.rawContent.length`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| controller 层所有路由                                                                   | `@UseGuards(JwtAuthGuard)` + service 层 `kbService.hasAccess(userId, kbId, RequiredRole)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| 写操作 service 层（v1.2 tester R2 边缘）                                                | hasAccess 后校验 `kb.wikiEnabled === true`，否则 `BadRequestException`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ingest controller                                                                       | `payloadTokenCount > config.ingestMaxTokens` → `BadRequestException` + 明示用户                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `WikiKnowledgeBaseConfig.cronLintDailyBudgetCalls = 50`                                 | cron lint 超额时 STALE/CONTRADICTION/DATA_GAP 跳过，标 finding type=DATA_GAP detail={budget_exceeded}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| frontend 渲染 page body                                                                 | 复用 `frontend/lib/utils/sanitize.ts` 的 `rehype-sanitize` + `katexAwareSchema`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| frontend `[[slug]]` href 拼接                                                           | `encodeURIComponent(slug)` 兜底（DTO 已校验，但前端独立兜底）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ingest / query 入口（前端）                                                             | 一次性合规告知："内容会发送给您配置的 AI 模型提供商"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **(v1.2 新增)** `wiki-diff.service.ts` apply 入口                                       | 进事务前 `WikiDiffItemsSchema.parse(diff.items)`，失败 400（防 LLM 输出非法字段进库）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **(v1.2 新增)** `wiki-diff.service.ts` apply 并发                                       | 实时从 `diff.items` 重算 affectedSlugs，不读 DB 字段（防恶意/有缺陷 ingest 写空数组绕过冲突）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **(v1.2 新增)** `wiki-diff.service.ts` apply 事务                                       | `isolationLevel: 'Serializable'` + apply 首步 `SELECT ... FOR UPDATE` 锁所有涉及 page（防 TOCTOU）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **(v1.2 新增 / v1.5.2 改 NotFound)** `wiki-page.service.ts` revert                      | 校验 `revision.pageId === currentPage.id`，否则 `NotFoundException("Revision not found")`（v1.5.2：与"revision 不存在"统一响应消 oracle）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **(v1.2 新增)** `wiki-ingest.service.ts` 包裹                                           | `wrapExternalContent(content, { source, title, maxLength: 按剩余 budget/N 计算 })`，不依赖默认 maxLength=2000                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **(v1.2 新增)** export endpoint 鉴权语义                                                | VIEWER 与 EDITOR 看到 export 内容**完全相同**（KB 设计本意：VIEWER 可读全部内容，export 不另设权限墙）；前端 UI 加 export 按钮提示词，明示导出范围                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **(v1.2.1 新增)** `wiki-ingest.service.ts` 写 WikiPageEmbedding                         | EmbeddingService 写入侧必须填非空 model 名（与 query 时一致避免维度漂移）；spec 加 "model 字段为空时拒写" 断言（architect R3 P2）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **(v1.2.1 新增)** `wiki-diff.service.ts` 异常处理                                       | 捕获 Prisma `P2034` (serialization_failure)：1 次重试；仍失败 → 409 CONFLICTED（security R3 P2）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **(v1.2.1 新增)** `wiki-diff.service.ts` Step C                                         | 对其他 PENDING diff 也实时重算 affectedSlugs（不读 DB 预存值），防止 affectedSlugs 字段被写坏让冲突判定失效（security R3 P2）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **(v1.4 新增)** `wiki-page.service.ts` body 入库                                        | 入库前必调 engine `sanitizeMarkdownBody(body)`；与 frontend `rehype-sanitize` 形成双层防护（architect R5 非阻塞建议）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **(v1.5 新增 / v1.5.1 落码级)** Library 顶层搜索框语义隔离                              | (1) wiki tab 下不复用全局 `searchQuery` state，新增独立 `wikiSearchQuery` state；(2) wiki 搜索调专用 endpoint `GET /library/wiki/kbs/:kbId/pages/search`（kbId 路径段强制 + service 层 hasAccess + 仅返 slug+oneLiner+title），**禁路由到全局 `/library/search`**；(3) 切换 tab 时 wikiSearchQuery 不持久化避免 tab 间状态泄露                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **(v1.5 新增 / v1.5.1 全 endpoint 覆盖 / v1.5.3 越权 404)** KB / page slug 列表统一过滤 | 所有返回 KB / page slug 的 endpoint 统一服务端过滤 `wikiEnabled=true && hasAccess(userId, VIEWER)`：`GET /library/wiki/kbs`（selector）+ `GET /library/wiki/:kbId/pages`（左 sidebar list）+ `GET /library/wiki/:kbId/pages/:slug/backlinks` + `GET /library/wiki/:kbId/lint-findings` + `GET /library/wiki/:kbId/log-entries` + `GET /library/wiki/kbs/:kbId/pages/search`；前端不做兜底过滤（避免越权 listing）；**(v1.5.3) 越权时 service 层返 `NotFoundException` 而非空数组**——切断"返回数组长度=0 vs 404"的间接 KB 存在性 oracle                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **(v1.5.3 新增 security P2)** 404 timing oracle accepted risk                           | 三种 404 路径（hasAccess fail / resource.kbId mismatch / wikiEnabled=false）响应时延略有差异（多/少 1 次 DB 查询）；timing 攻击对外网 SaaS 场景实际可利用性低（jitter 高 + rate limit 60/min + cloud DB latency 噪声）；强制 constant-time 响应（统一 50ms 最小延迟 / 三路径强制走相同 DB round-trip）收益不抵成本；**accepted risk 显式声明**，未来若引入低延迟 cache 或私有部署需重新评估                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **(v1.5 新增 / v1.5.2 语义统一)** `?kb=<kbId>` URL 加载                                 | 双校验失败语义按 §7.3 表分三类：(a) 无 VIEWER access → redirect `/library?tab=wiki`（不带原 kbId 避免 KB 存在性 oracle）；(b) 有 access 但 wikiEnabled=false → 显式空态 §7.5；(c) **diff/page/revision/lint finding 跨 KB IDOR → 404 NotFound**（v1.5.2 追溯修订全部 IDOR 为 404，切断资源存在性 oracle）；403 仅用于"角色不足"场景                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **(v1.5.1 新增 architect P0)** ai-harness facade 导入约束                               | wiki 模块**仅** 从 `@/modules/ai-harness/facade` 导入 `PromptSkillBridge`（与 research/topic-insights/writing 一致）；其余 harness 能力（teams/handoffs/memory/runner 等）**禁导入**；`verify:arch` + ESLint `no-restricted-imports` 守门                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **(v1.5.1 新增 security P0)** wikiEnabled toggle 角色门槛                               | `PATCH /library/kbs/:kbId/wiki-enabled` 强制 KB OWNER/ADMIN 角色（service 层 `hasAccess(userId, kbId, ADMIN)`）；EDITOR/VIEWER 路径返回 403；前端按钮按角色 disabled + tooltip 提示；**不允许 EDITOR 单方面启用 wiki 触发 ingest 暴露面**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **(v1.5.1 新增 / v1.5.2 扩 logout 路径)** localStorage 跨用户隔离                       | (1) 所有 wiki 相关 localStorage key 加 `<userId-hash>` 前缀（`lastWikiKbId:<userId-hash>` / `libraryDefaultTab:<userId-hash>` / 一次性 toast sentinel）；(2) **登出钩子覆盖 4 类路径**：主动登出 / 401 自动登出 / token 过期 / 多 tab 同步登出，统一调 `clearWikiLocalStorage()` helper 清除全部 wiki localStorage 项；spec 用 4 条 fixture 覆盖 4 类路径；(3) 读 localStorage activeTab 后强制 enum 白名单（`'wiki'\|'personal-kb'\|'team-kb'\|'data-sources'`）匹配，未命中回 default `'wiki'`，防 XSS 注入提权 / open redirect                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **(v1.5.1 新增 security P2)** hasAccess 不可缓存                                        | 所有 service 层 `kbService.hasAccess()` 调用每请求独立查询 PostgreSQL，**禁 Redis / 内存跨请求缓存**；避免权限撤销（KB 成员移除）后窗口期内继续放行；spec 强制断言每个调用路径调用 hasAccess 至少 1 次（jest.spyOn）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **(v1.5.1 / v1.5.2 扩) 测试用例落码级补全**                                             | (1) `kb-resolver.spec.ts` 5 级降级链每级失败 fallback；(2) 三态空态 4 组 prisma fixture（0 KB / 0 wikiEnabled / 0 page / 正常态）；(3) KB selector 过滤 3 条 fixture（wikiEnabled+VIEWER / wikiEnabled+无access / !wikiEnabled+OWNER）；(4) CONFLICTED 端到端：mock 409 response 验证横幅 + apply 置灰 + 重跑 ingest 跳转；(5) localStorage What's new toast 仅一次（写 sentinel key）+ activeTab 解析优先级（URL > localStorage > default `'wiki'`）；**(v1.5.2 新增 6-10)** (6) `library-header.spec.tsx` 数据流隔离断言（searchQuery 不变 / wikiSearchQuery 变化 / fetch 走专用 endpoint 不命中全局 search）；(7) `wiki-enable-toggle.spec.tsx` 三角色矩阵（OWNER/ADMIN PATCH 200 + 首次启用断言 `configCreated=true` + WikiKnowledgeBaseConfig 行被 upsert / EDITOR 强发请求 403 / VIEWER 整行 disabled）；(8) `url-state-reducer.spec.ts` 文件名级落点 + 8 行互斥/叠加规则各 1 用例；(9) 每 service spec 强制 `jest.spyOn(kbService, 'hasAccess').toHaveBeenCalledWith(userId, kbId, 期望角色)` 模板；(10) `slug-normalize.util.spec.ts` 加 NFKD / 变音符 / 头尾连字符 / 长度截断回归 fixture（捕获原 4 处 inline 实现差异） |
| **(v1.5.2 新增 security P1)** 跨 KB 资源越权统一 404                                    | service 层校验 `resource.knowledgeBaseId !== kbId` 时统一 throw `NotFoundException`（不 throw `ForbiddenException`）；切断 page slug / diff id / lint finding id / revision id 的存在性 oracle；spec 强制断言：跨 KB 的 4 类资源访问均返 404 而非 403                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **(v1.5.2 新增 security P1)** search endpoint 落码级                                    | DTO 强校验 `q` 字段 zod regex 防 ReDoS（`/^[\w\s\-一-龥]+$/`）+ 长度上限 200；返回字段白名单 DTO（仅 slug / title / oneLiner / category）；rate limit 60 req/min 与 RAGController 一致；spec 覆盖：(a) ReDoS payload 拒；(b) 跨 KB kbId 路径篡改返 404（service 层 hasAccess + 路径段强制）；(c) 返回字段不含 body 等敏感大字段断言                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

### 11.1 `WikiDiffItemsSchema` zod 定义骨架（v1.2.1 security R3 P2）

```typescript
import { z } from "zod";

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,198}[a-z0-9]$/;

const WikiPageSourceItemSchema = z
  .object({
    documentId: z.string().uuid(),
    spanStart: z.number().int().min(0),
    spanEnd: z.number().int().min(0),
    quote: z.string().min(1).max(2000),
  })
  .refine((s) => s.spanStart <= s.spanEnd, "spanStart must <= spanEnd");

export const WikiDiffItemsSchema = z.object({
  creates: z
    .array(
      z.object({
        slug: z.string().regex(SLUG_REGEX),
        title: z.string().min(1).max(500),
        category: z.enum(["ENTITY", "CONCEPT", "SUMMARY", "SOURCE"]),
        body: z.string().min(1).max(200_000), // 单页 body 上限 ~200K char
        oneLiner: z.string().min(1).max(280),
        sources: z.array(WikiPageSourceItemSchema).max(50),
      }),
    )
    .max(100), // 单 diff creates 上限 100
  updates: z
    .array(
      z.object({
        slug: z.string().regex(SLUG_REGEX),
        newBody: z.string().min(1).max(200_000),
        newOneLiner: z.string().min(1).max(280).optional(),
        sources: z.array(WikiPageSourceItemSchema).max(50).optional(),
      }),
    )
    .max(100), // 单 diff updates 上限 100
  deletes: z.array(z.string().regex(SLUG_REGEX)).max(20), // delete 谨慎用
});
```

apply 入事务前 `WikiDiffItemsSchema.parse(diff.items)` 强校验失败 400。span 越界 / body 超长 / slug 非法 / deletes 滥删都在此层挡。

---

## 12. 可观测性（NestJS Logger 关键路径）

| 操作                   | 日志结构                                                              |
| ---------------------- | --------------------------------------------------------------------- |
| ingest skill 调用失败  | `{ op:'ingest', kbId, documentIds, error, durationMs }`               |
| lint LLM 类调用        | `{ op:'lint', kbId, type, durationMs, llmCalls, budgetRemaining }`    |
| apply diff 部分失败    | `{ op:'apply', diffId, succeeded:[], failed:[{slug, reason}] }`       |
| 阈值切换发生           | `{ op:'query', branch:'A'\|'B', kbId, pageCount, totalTokens, mode }` |
| baselineHash 冲突      | `{ op:'apply', diffId, kbId, expected, actual }`                      |
| affectedSlugs 集合冲突 | `{ op:'apply', diffId, conflictWithDiffId, overlappingSlugs }`        |
| cron lint 超额跳过     | `{ op:'cron-lint', kbId, type, budgetSpent, skipped:true }`           |
| export job 进度        | （沿用现有 ExportJob 日志结构，不另起）                               |

每个 service spec 用 `jest.spyOn(logger, 'log'\|'warn'\|'error')` 验证关键路径有日志。

---

## 13. 与项目规范的对齐

- **无双源**（feedback_no_dual_sources）：复用 KnowledgeBase / KnowledgeBaseDocument；KG 冻结 ADR；ChildEmbedding 不侵入
- **simplest-first**（CLAUDE.md §简洁优先）：单一 page 状态 / 不引入 draft-curated-canonical / 默认不 RAG / API 合并 / 砍 QUERY log / 砍 resolvedByUserId
- **暴露多义性**：所有重大决策已让用户选定（§2.1–2.4 累计决策；R1–R7.2 评审过程逐版细化），每条决策均附理由 + 评审纪要追溯
- **手写 SQL migration**（CLAUDE.md §数据库变更）：P0 提供 `2026MMDD_llm_wiki_init/migration.sql` + IF NOT EXISTS 幂等
- **不破坏现有 RAG**：library-rag.service 不动，只是 query 路由分支增加；wiki 走独立 `WikiPageEmbedding`
- **Ingest 走 diff 不直写**（feedback_destructive_op_must_have_rollback）
- **citation 必带 quote span**：`WikiPageSource` 表带 spanStart / spanEnd / quote 三字段
- **强成功标准**（Karpathy 原则）：所有 Phase gate 改为 `npm test --testPathPattern=wiki` 命令级
- **分析先行禁止猜测**（CLAUDE.md 红线）：v1.0 → v1.1 修订主要原因；本版前已 grep 验证 KnowledgeBaseDocument / ChildEmbedding / KnowledgeBaseGuard / fact-extraction / PromptSkillBridge.registerDomain 真实存在性
- **能力归属判断**（CLAUDE.md `.claude/rules/ai-engine.md`，**v1.3 引入、v1.4 校准**）："如果明天做一个完全不同的 AI App，这个能力还能复用吗？" 答 YES → AI Engine。**v1.4 终态**上提 3 项到 engine（link-parser / slug-normalize / StaleDetector）+ 复用 2 项既有（CrossCuttingSynthesisService 加 2 个低级 API / sanitizeMarkdownBody）+ 直调 2 项基元（EmbeddingService / VectorService）；留 wiki/ 7 项均答 NO（依赖 wiki-specific schema）。**v1.3 v1.4 双轮纠正确立"3 维度归属审查"原则**：①是否穿透 facade ②是否过度集中 app（漏上提）③是否过度抽象/与既有重叠（错上提）
- **不说谎断言**（feedback_no_lying_assertion）：从 `WikiDiff.items` Json 取数据前必须 zod parse，禁止 `as WikiDiffItems` 强断言（v1.2 §11 已强制）
- **反硬编码模型**（CLAUDE.md / feedback_no_hardcoded_pricing 同类原则）：`WikiPageEmbedding.model @default("")`，由 EmbeddingService 写入实际 model 名（v1.2）
- **(v1.5)** UI 入口与项目 LibraryTabs pattern 对齐：中性灰底 + 紫色 violet-500 indicator + LucideIcon + LibraryHeader 复用，不引入新组件库
- **(v1.5)** wiki 子组件放 `frontend/components/library/wiki/` 与 nav / resources / header 等同层
- **(v1.5)** 入口文件 `frontend/app/library/page.tsx` 严格遵守 CLAUDE.md "禁 Sub-Agent 修改入口文件" 红线
- **(v1.5.1)** ai-harness facade 双 facade 模式：wiki 模块同时从 `ai-engine/facade` 与 `ai-harness/facade` 导入，按使用语义各取——engine 能力（link-parser / slug / sanitizer / embedding / vector / synthesis / consistency）走 engine facade；`PromptSkillBridge` 走 harness facade（项目惯例与 research/topic-insights/writing 一致）；其余 harness 能力**禁导入**
- **(v1.5.1)** verify:arch / ESLint / pre-push hook 三层守门未受 v1.5 入口位置变更影响——wiki 模块依赖方向仍为 L3 → L2.5 / L2，单向不变

---

## 14. 评审纪要索引

- R1 评审纪要：[llm-wiki-review-r1.md](./llm-wiki-review-r1.md)（v1.0，4/4 NEEDS-CHANGES → v1.1）
- R2 评审纪要：[llm-wiki-review-r2.md](./llm-wiki-review-r2.md)（v1.1，2 APPROVED + 2 NEEDS-CHANGES → v1.2）
- R3 + R4 评审纪要：[llm-wiki-review-r3-r4.md](./llm-wiki-review-r3-r4.md)（v1.2 → v1.2.1，跨轮整合达 4/4 APPROVED）
- R5+R6 评审纪要：[llm-wiki-review-r5-r6.md](./llm-wiki-review-r5-r6.md)（v1.3→v1.4，跨轮整合达 4/4 APPROVED）
- R7 评审纪要：[llm-wiki-review-r7.md](./llm-wiki-review-r7.md)（v1.5 → v1.5.1，4/4 NEEDS-CHANGES 全 7 项 P0 + 12 项 P1 已修订）

---

## 15. 仍开放的问题（不阻塞 R7.2）

1. **wiki-ingest skill 用什么模型？** 默认 reasoning 强的（Opus 4.7 / GPT-5）；BYOK 强制？
2. **export 是否包含 PENDING diff 预览？** 默认不含。
3. **cron lint 整体 KB 还是抽样 KB？** 大量 KB 时是否随机轮询而非每个 KB 每天？
4. ~~**`wikiEnabled=false` 的 KB UI**：tab 隐藏 vs 显示"启用"CTA？~~ **(v1.5 已决)** Library 顶层 Wiki tab 永远在；KB selector 列表过滤仅显示 wikiEnabled=true 的 KB；启用走 KB 设置区一键 toggle 或空态卡片内嵌按钮（**v1.5.1**：必须 KB OWNER/ADMIN 角色，详见 §7.5 + §11）
5. **ingest 上下文窗口**：80K tokens 是否够实际？需要在 P1 实施时实测调整。
6. ~~**老用户切换默认 tab 的偏好同步**~~ **(v1.5.1 已决)** localStorage-only，永不入 DB；接受跨设备首次仍弹 toast 是 acceptable trade-off（避免 wiki 模块对 user 全局表反向耦合）；spec 用 `it.skip('cross-device sync TODO', ...)` 留 todo 痕迹

---

## 16. 附录：P0a slug-normalize 替换清单（16 处真 slugify + 3 处误判已豁免）

> **v1.5.1 reviewer R7 P1 要求**：P0a 落码时按下表逐项 diff 验证，确保替换完整且语义一致。每项注明：路径 / 行号 / 函数或调用位置 / 现有实现摘要 / 是否需替换 / 备注。

### 16.1 必须替换（14 处生产代码 + 4 处实现定义 = 18 处编辑点，对应 6 个文件）

| #   | 文件路径                                                                                                    | 行号            | 函数 / 调用位置                                                  | 现有实现摘要                                               | 替换为                                              |
| --- | ----------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| 1   | `backend/src/common/export/renderers/pdf.renderer.ts`                                                       | 833             | `private slugify(text)`                                          | 类内私有方法，含 NFKD + 变音符删除                         | 改 `import { normalizeMarkdownSlug }`，删除私有方法 |
| 2   | `backend/src/common/export/renderers/pdf.renderer.ts`                                                       | 688             | `slugify(h.content)` 调用                                        | heading anchor                                             | `normalizeMarkdownSlug(h.content)`                  |
| 3   | `backend/src/common/export/renderers/pdf.renderer.ts`                                                       | 725             | `slugify(section.content)`                                       | section anchor                                             | 同上                                                |
| 4   | `backend/src/common/export/renderers/markdown.renderer.ts`                                                  | 218             | `private slugify(text)`                                          | 类内私有方法                                               | 同 #1                                               |
| 5   | `backend/src/common/export/renderers/markdown.renderer.ts`                                                  | 98              | `slugify(h.content)`                                             | heading anchor                                             | `normalizeMarkdownSlug(...)`                        |
| 6   | `backend/src/common/export/renderers/html.renderer.ts`                                                      | 866             | `private slugify(text)`                                          | 类内私有方法                                               | 同 #1                                               |
| 7   | `backend/src/common/export/renderers/html.renderer.ts`                                                      | 613             | `slugify(h.content)`                                             | heading anchor                                             | 同上                                                |
| 8   | `backend/src/common/export/renderers/html.renderer.ts`                                                      | 652             | `slugify(section.content)`                                       | section anchor                                             | 同上                                                |
| 9   | `backend/src/modules/ai-engine/tools/categories/memory/entity-memory.tool.ts`                               | 966             | inline expression                                                | `entity-${name.toLowerCase().replace(/\s+/g, "-")}`        | `entity-${normalizeMarkdownSlug(name)}`             |
| 10  | `backend/src/modules/ai-harness/protocols/a2a/adapter/a2a-team-member-adapter.ts`                           | 40              | inline expression                                                | `a2a-${agentCard.name.toLowerCase().replace(/\s+/g, "-")}` | `a2a-${normalizeMarkdownSlug(agentCard.name)}`      |
| 11  | `backend/src/modules/ai-harness/evaluation/critique/report-artifact/structural-report-assembler.service.ts` | 433             | `private slugify(s)`                                             | 类内私有方法                                               | 改 facade import                                    |
| 12  | 同上                                                                                                        | 163             | `this.slugify(c.title)`                                          | TOC anchor                                                 | `normalizeMarkdownSlug(c.title)`                    |
| 13  | 同上                                                                                                        | 265             | `this.slugify(d.name)`                                           | TOC anchor                                                 | 同上                                                |
| 14  | `backend/src/modules/ai-harness/evaluation/critique/report-artifact/report-artifact-assembler.service.ts`   | 2123            | `function slugify(s)`                                            | 文件级独立函数                                             | 改 facade import，删除函数                          |
| 15  | 同上                                                                                                        | 846             | inner arrow `slugify`                                            | 闭包内重复定义                                             | 删除，使用 facade import                            |
| 16  | `backend/src/modules/ai-app/insight/services/report/report-assembler.service.ts`                            | 363,370,376,382 | inline `toLowerCase().replace(/\s+/g, "-")` × 4                  | TOC anchor                                                 | 4 处统一改 `normalizeMarkdownSlug(...)`             |
| 17  | `backend/src/modules/ai-app/playground/services/mission/rerun/stage-rerun.dispatcher.ts`                    | 821             | inline `heading.toLowerCase().replace(/\s+/g, "-").slice(0, 80)` | mission rerun anchor                                       | `normalizeMarkdownSlug(heading).slice(0, 80)`       |
| 18  | `backend/src/modules/open-api/admin/admin.controller.ts`                                                    | 1806            | inline `skill.name?.toLowerCase().replace(/\s+/g, "-")`          | skill ID 派生                                              | `normalizeMarkdownSlug(skill.name)`                 |

### 16.2 误判豁免（不替换，3 处 type normalize ≠ slugify）

| #   | 文件路径                                                                            | 行号 | 现有实现                                    | 豁免理由                                                                                                                                                                           |
| --- | ----------------------------------------------------------------------------------- | ---- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `backend/src/modules/ai-app/image/infographic/services/infographic-data.service.ts` | 159  | `type.toLowerCase().replace(/[^a-z]/g, "")` | 这是 **alphanum-only type normalization**（去 hyphen + 数字），用于 type 匹配（"Bar Chart" → "barchart"）；与 slug-normalize（kebab-case，保留 hyphen + 数字）语义不同，**不替换** |
| 2   | `backend/src/modules/ai-app/image/infographic/infographic.utils.ts`                 | 42   | 同上                                        | 同上                                                                                                                                                                               |
| 3   | `backend/src/modules/ai-app/image/infographic/infographic.service.ts`               | 234  | 同上                                        | 同上                                                                                                                                                                               |

> **测试守门**：每个被替换的文件原 spec（如 `markdown.renderer.spec.ts` / `html.renderer.spec.ts` / `a2a-team-member-adapter.spec.ts` / `report-artifact-assembler.spec.ts` / `topic-insights/report-assembler.spec.ts`）必须在替换后仍全绿；新增 `slug-normalize.util.spec.ts` 应覆盖原有 ad-hoc 实现的边界差异（NFKD / 变音符 / 头尾连字符 / 长度截断）。`npm test` 单独跑这些受影响的 spec 文件验证 P0a 替换无回归。

> **PR 拆分建议**（reviewer R7 P1）：若单 PR 文件数过多（≥ 6 个文件 + spec 修订），可拆为 **P0a-1**（新增 wiki-link-parser + slug-normalize + facade export，0.5 天）+ **P0a-2**（替换 18 处编辑点，1.5 天）+ **P0a-3**（synthesis API + StaleDetector + consistency module，0.5 天）三个 PR 串联；总工程量仍 2.5 天，但每个 PR 影响面小、review 成本低、回滚粒度细。
