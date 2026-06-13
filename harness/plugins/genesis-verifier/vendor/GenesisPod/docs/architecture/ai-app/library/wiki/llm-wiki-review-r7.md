# LLM Wiki R7 评审纪要

> **评审对象**：`llm-wiki.md` v1.5（2026-05-09 提交，引入 8 处变更：顶部 changelog / §1.4 / §2.4 / §3.1 / §7 / §8 / §11 / §13 / §15）
> **评审形式**：4 路 subagent 并行集体审视（reviewer / architect / security / tester）
> **评审日期**：2026-05-09
> **评审结论**：4/4 NEEDS-CHANGES，共 7 项 P0 阻塞 + 12 项 P1 必修 + 8 项 P2 改进
> **修订结果**：v1.5.1（吸收全部 P0 + 关键 P1，待 R7.1 第二轮共识）

---

## 1. 评审范围

v1.5 修订相对 v1.4 引入产品定位升级（Wiki 作为 Library 主形态）+ 实施前现实校准。R7 评审聚焦 v1.5 新增内容，不重审已 4/4 APPROVED 的 v1.4 范围。

## 2. 评审结论汇总

| 评审角色  | VERDICT           | P0 阻塞                              | P1 必修                            | P2 改进 |
| --------- | ----------------- | ------------------------------------ | ---------------------------------- | ------- |
| reviewer  | NEEDS-CHANGES     | 2                                    | 5                                  | 4       |
| architect | NEEDS-CHANGES     | 2                                    | 2                                  | 0       |
| security  | NEEDS-CHANGES     | 2                                    | 3                                  | 3       |
| tester    | NEEDS-CHANGES     | 3                                    | 5                                  | 3       |
| **合计**  | **NEEDS-CHANGES** | **7 (含部分重叠 → 实际唯一 P0 = 6)** | **12 (含重叠 → 实际唯一 P1 = 10)** | **8**   |

## 3. P0 阻塞项（v1.5.1 全部修订）

### P0-1（reviewer）：§7.1 实测代码事实冲突

**问题**：方案 v1.5 §7.1 写"`activeTab` 初值由 `'personal-kb'` 改为 `'wiki'`"，但 `frontend/app/library/page.tsx` L241 现状默认值是 `'data-sources'`；同 union 类型已含第 4 个值 `'graph'`（L220、L267），但 `libraryTabs` 数组（L1693-1709）仅 3 项不含 graph，graph 通过 L1892 独立条件渲染分支。v1.5 落码会破坏现有 graph 入口。

**修订**（v1.5.1 §7.1）：

- 显式记录现状：union 4 值 + 默认 `'data-sources'` + libraryTabs 数组 3 项 + graph 渲染独立分支
- 修改：union 首位增加 `'wiki'`、默认值改 `'wiki'`、libraryTabs 首位插入 wiki 项、graph 分支不动

### P0-2（reviewer）：§7.2 + §11 LibraryHeader 数据流冲突

**问题**：`LibraryHeader` 的 `searchQuery` / `onSearchChange` 现状驱动 page.tsx L286 `setSearchQuery` 资源过滤；wiki tab 下若复用同一 state，用户输入跨 KB 搜索 wiki 内容时仍按资源过滤逻辑发起 API → 跨 KB slug 通过 devtools 网络面板泄露。v1.5 §11 仅说"placeholder 切换 + 搜索范围限当前 KB"，未到落码级。

**修订**（v1.5.1 §7.1 + §11）：

- 新增 `wikiSearchQuery` 独立 state，与 `searchQuery` 完全解耦
- LibraryHeader 在 wiki tab 下接 `searchMode: 'wiki'` prop 或不渲染默认 search input（由 P3a 实施时定夺）
- §11 新增专用 endpoint `GET /library/wiki/kbs/:kbId/pages/search`，禁路由全局 search
- 切换 tab 时 wikiSearchQuery 不持久化避免状态泄露

### P0-3（architect）：§7.1 LibraryTabs 同层语义破坏

**问题**：现有 3 个 tab（personal-kb / team-kb / data-sources）是"资源容器/数据源"维度，wiki 是"知识沉淀产物"维度，跨 2 个语义维度并列；用户预期"切 tab 切容器"被破坏（点 wiki 后还要再选 KB，与点 personal-kb 直接看 KB 列表不对称）。

**修订**（v1.5.1 §1.4 + §2.4）：

- 显式承认并定型为有意决策：v1.5 后 LibraryTabs 跨 2 个语义维度（产品形态 + 资源容器）
- 两维度不可被互相收编：Wiki 与 KB 是 N:1 关系，把 wiki 收进 personal-kb 内 sub-tab 会让 KB 列表与 wiki 主形态争夺中栏
- 代价是 tab 语义维度混杂，但产品价值（默认看到知识沉淀）压过架构纯粹性
- §2.4 决策表显式记录 architect P0 反对意见 + 接受理由

### P0-4（architect）：§3.1 ai-harness 层影响未声明

**问题**：CLAUDE.md L41-72 明确 L2.5 ai-harness 已落地；wiki-ingest 是"LLM 编排（产 diff）"按 MECE 原则 1（"engine 不知道 agent / mission"）应走 ai-harness/runner 而非直接 `aiChatService.chat()`；§5.1 Step 3 说"skill 编排"但全文未提及 harness facade，且方案 §3.1 分层图 L2.5 完全缺失。

**实测核查**：`PromptSkillBridge` 实现在 `ai-engine/skills/runtime`，但 ai-app 模块（research / topic-insights / writing 等）项目惯例**统一**从 `@/modules/ai-harness/facade` 导入。

**修订**（v1.5.1 §3.1 + §5.1 Step 3）：

- §3.1 分层图补 L2.5 ai-harness 节点
- §5.1 Step 3 明示：`PromptSkillBridge` 从 `@/modules/ai-harness/facade` 导入（项目惯例）
- 显式声明 wiki-ingest 是单轮 LLM call + tool calling（无 multi-turn agent loop），走 engine `AiChatService.chat()`，不走 harness/runner（MECE 原则 1：无 agent/mission 状态）
- §11 新增 ai-harness facade 导入约束：仅 PromptSkillBridge，其余 harness 能力禁导入

### P0-5（security）：§7.5 0 wikiEnabled toggle 角色门槛缺失

**问题**：方案 v1.5 §7.5 写"点击直接 PATCH `wikiEnabled=true`"，未声明所需角色；若沿用 VIEWER/EDITOR，团队 KB 的普通 EDITOR 可单方面打开 wiki 触发后续 ingest 暴露面。

**攻击场景**：被加为 EDITOR 的内部成员通过空态按钮启用团队 KB wiki，注入 ingest payload。

**修订**（v1.5.1 §7.5 + §11）：

- `PATCH /library/kbs/:kbId/wiki-enabled` 强制 KB OWNER/ADMIN（service 层 `hasAccess(userId, kbId, ADMIN)`）
- EDITOR/VIEWER 路径返回 403
- 前端按钮按角色 disabled + tooltip 提示
- §11 第 4 项专项条款记录

### P0-6（security）：§7.3 + §11 redirect / 403 失败语义自相矛盾

**问题**：§11 v1.5 第 3 项写"失败 redirect 引导态而非 403 暴露 KB 存在性"，§7.3 解析步骤 1 也是"失败 redirect"——但 v1.2 §11 老条款规定"diff 跨 KB throw ForbiddenException"、controller 层默认 hasAccess 失败 403。两套语义并存导致：合法用户被掩盖错因；其它 endpoint 仍 403，攻击者用时间差仍可探测存在性。

**修订**（v1.5.1 §7.3 失败语义对照表）：

| 场景                                     | 处理                                   |
| ---------------------------------------- | -------------------------------------- |
| `?kb=<X>` 无 VIEWER access               | redirect `/library?tab=wiki`（不带 X） |
| `?kb=<X>` 有 access 但 wikiEnabled=false | 显式空态 §7.5                          |
| `/diffs/:diffId` 跨 KB IDOR              | 403（§6 红线）                         |
| `/pages/:slug` 跨 KB（旧 URL 残留）      | 403                                    |
| `/pages/:slug` 在合法 KB 但 page 不存在  | 404                                    |

### P0-7（tester）：§8 P3 工程量未上调，UI 验证未覆盖 v1.5 新增范围

**问题**：v1.5 加了"入口位置 + KB selector + URL 状态 + 三态空态 + 老用户兼容"五块前端可观测面，§8 P3 仍 4 天且 gate 仅"`npm test --testPathPattern=wiki` 全绿 + 手测 5 步"，未拆 spec 文件，工程量未上调。

**修订**（v1.5.1 §8 + 顶部"总工程量"声明）：

- P3 拆为 P3a（UI 主路径，3 天）+ P3b（空态 / onboarding / 老用户兼容，2 天）
- 总工程量 12 天 → 13 天
- 各 phase gate 补 spec：`kb-resolver.spec.ts` 5 级降级 / 三态空态 4 组 fixture / KB selector 服务端过滤 3 条 fixture / CONFLICTED 端到端 / What's new toast 仅一次 + activeTab 解析优先级

## 4. P1 必修项（v1.5.1 已修订）

| #     | 提出方    | 项                                                       | v1.5.1 修订                                                                   |
| ----- | --------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1-1  | reviewer  | §3.1 / §8 16 处 slugify 缺 `path:line:functionName` 明细 | 新增 §16 附录列 18 处编辑点 + 3 处误判豁免                                    |
| P1-2  | reviewer  | §7.1 vs §15 第 6 项自相矛盾（一边方案一边开放问题）      | §15 第 6 项关闭：localStorage-only 永不入 DB                                  |
| P1-3  | reviewer  | §7.3 "default KB" 命名歧义                               | §7.3 step 4 显式定义：`WikiPage.updatedAt desc` 第一条 wikiEnabled            |
| P1-4  | reviewer  | §8 P0a 2 天偏紧                                          | P0a 2→2.5 天 + PR 拆分建议                                                    |
| P1-5  | reviewer  | §11 v1.5 第 3 项 redirect vs 403 与 §6 IDOR 红线不一致   | §7.3 + §11 失败语义统一对照表                                                 |
| P1-6  | architect | §7.5 0 wikiEnabled 服务端语义双源                        | §7.5 显式声明走通用 KB list endpoint，不复制                                  |
| P1-7  | architect | §7.1 老用户兼容 schema 双源苗头                          | §15 第 6 项关闭：永不入 DB                                                    |
| P1-8  | security  | localStorage 跨用户残留                                  | §11 第 6 项 + §7.1：key 加 `<userId-hash>` 前缀 + 登出钩子清除                |
| P1-9  | security  | 搜索框语义切换止于 placeholder                           | §11 第 1 项扩落码级：专用 endpoint `GET /library/wiki/kbs/:kbId/pages/search` |
| P1-10 | security  | §11 KB selector 过滤只覆盖一个 endpoint                  | §11 第 2 项扩：list / backlinks / lint findings / log entries / search 全覆盖 |
| P1-11 | tester    | §7.7 ?diff/?lint/?log 互斥/叠加未声明                    | §7.7 新增互斥/叠加规则表（modal > drawer，drawer 互斥取 lint 优先）           |
| P1-12 | tester    | CONFLICTED 前端展示链路无端到端测试                      | §8 P3a gate 加 CONFLICTED 端到端 spec                                         |

## 5. P2 改进项（v1.5.1 部分采纳）

| 提出方   | 项                                 | v1.5.1 处理                    |
| -------- | ---------------------------------- | ------------------------------ |
| reviewer | §1.4 主形态行与 §2.4 重复          | 已精简为 1 句 + 链 §2.4        |
| reviewer | changelog 与 §15 第 6 项重复       | §15 第 6 项已关闭              |
| reviewer | §13 v1.5 项过长                    | 已拆 5 个 bullet               |
| reviewer | §3.1 与 §8 slugify 列表 DRY        | §16 附录单一来源，正文不重复列 |
| security | localStorage activeTab enum 白名单 | §7.1 + §11 第 6 项已加         |
| security | hasAccess 不可缓存                 | §11 第 7 项专项条款            |
| tester   | 覆盖率守门 wiki UI 子目录提升至 80 | 待 R7.1 评审接受后落地         |
| tester   | §15 第 6 条 it.skip TODO 痕迹      | §15 第 6 项已显式提及          |

## 6. R7 元教训

v1.5 修订一次性引入 8 处变更点，4 路评审仍发现 7 项 P0——其中 4 项是"未对照实际代码事实"（reviewer P0 的 activeTab 默认值 + LibraryHeader 数据流 + §11 与 §6 红线一致性 + ai-harness facade 惯例），3 项是"安全细节止于声明未到落码级"（toggle 角色 / redirect 语义 / search endpoint）。

**核心教训**：下次设计任务前置 grep 实测覆盖率应达 90% 以上——每条引用现有代码的描述都必须有对应 file:line 引用。本次 v1.5 仅做了路径级核查，未到 line 级。

**机制改进建议**：设计文档作者在 push 前自检"实测断言清单"——每个"现状 X / 改为 Y"的描述都附 git grep 命令验证，写入 commit description。

## 7. R7.1 第二轮评审结果（v1.5.1）

| 评审角色  | VERDICT                  | 残留 P0 | 残留 P1 | 备注                                                                                                 |
| --------- | ------------------------ | ------- | ------- | ---------------------------------------------------------------------------------------------------- |
| reviewer  | APPROVED-WITH-MINOR-NITS | 0       | 0       | 4 项 P3 doc-drift 建议 v1.5.2 一并修                                                                 |
| architect | **APPROVED**             | 0       | 0       | 单向依赖 / MECE / L2.5 节点声明全部到位                                                              |
| security  | NEEDS-CHANGES            | 0       | 2       | page 403 vs 404 oracle + search endpoint API 落码缺口                                                |
| tester    | **APPROVED**             | 0       | 0       | 5 项 P2 增强建议（wikiSearchQuery / toggle 三角色 / hasAccess spy / url reducer 文件名 / NFKD 回归） |
| **共识**  | **3.5/4 接近共识**       | 0       | 2       | security 残留 2 项 P1 必修，触发 v1.5.2                                                              |

**security 残留 P1 详情**：

- **P1-S1**：§7.3 失败语义对照表第 3-4 行（diff/page 跨 KB IDOR 返 403）与"合法 KB 内不存在返 404"形成时间差 oracle——攻击者枚举 slug 时仍可借两类响应区分"slug 在他 KB 中存在"。修复：v1.5.2 §7.3 全部 IDOR 路径返 **404**，与"资源不存在"统一响应；403 仅用于"角色不足"
- **P1-S2**：`GET /library/wiki/kbs/:kbId/pages/search` 在 §11 + §7.3 出现，但未登记 §6 API 表，鉴权角色 / 输入校验（zod schema 防 ReDoS）/ 返回字段白名单 / rate limit 未声明。修复：v1.5.2 §6 API 表追加完整规格

## 8. v1.5.2 修订（吸收 R7.1 残留 + 文档一致性）

**security 必修**：

- §7.3 失败语义对照表合并 IDOR + 不存在为统一 404；切断 4 类资源（page / diff / lint finding / revision）跨 KB 存在性 oracle
- §6 API 表追加 3 个 endpoint：`GET /library/wiki/kbs/:kbId/pages/search`（VIEWER + zod ReDoS 防护 + 返回字段白名单 DTO）、`PATCH /library/kbs/:kbId/wiki-enabled`（ADMIN/OWNER 角色门槛）、`GET /library/wiki/kbs`（KB selector 列表）
- 总 endpoint 数 13 → 16
- §11 登出钩子扩 4 类路径覆盖（主动登出 / 401 自动 / token 过期 / 多 tab 同步）

**文档一致性**：

- §7.5 补"设置权（OWNER/ADMIN toggle）vs 使用权（EDITOR/VIEWER 操作）解耦"语义说明
- §15 标题去版本号（"不阻塞 R2"→"不阻塞 R7.2"）
- §13 第 3 条决策计数改"§2.1–2.4 累计决策"
- §3.1 + §13 "engine 能力共 7 项"枚举对齐
- 顶部"P0a 1.5→2→2.5 + P3 4→5"两步累计描述与 §8 表脚注一致

**测试用例补全**（5 项 v1.5.2 新增）：

- `library-header.spec.tsx` 数据流隔离断言
- `wiki-enable-toggle.spec.tsx` 三角色矩阵
- `url-state-reducer.spec.ts` 文件名级落点 + 8 行规则
- `hasAccess` spy 模板
- `slug-normalize.util.spec.ts` NFKD / 变音符回归 fixture

## 9. R7.2 第三轮评审结果（v1.5.2）

| 评审角色  | VERDICT          | 残留             | 备注                                                                                                                                               |
| --------- | ---------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| reviewer  | NEEDS-CHANGES    | 5 处穿透替换缺失 | §6 line 1003 + §6 line 1014 + §11 line 1307 + §11 line 1319 + §11 line 1328 + 顶部 changelog line 40 + §2.3 line 260 仍写 ForbiddenException / 403 |
| architect | NEEDS-CHANGES    | 同上             | "doc 级追溯修订声明不可替代正文穿透替换"，落码工程师按邻近字面照抄会写错                                                                           |
| security  | APPROVED         | 4 项 P2 非阻塞   | ReDoS regex i18n 限制 / 404 timing oracle / list endpoint 越权数组长度 oracle                                                                      |
| tester    | APPROVED         | 1 项 P2 非阻塞   | configCreated=true 断言                                                                                                                            |
| **共识**  | **2/4 APPROVED** | -                | reviewer + architect 同根因阻塞 → v1.5.3                                                                                                           |

## 10. v1.5.3 修订（吸收 R7.2 + 收尾 P2）

**reviewer + architect 阻塞**（穿透替换 7 处 ForbiddenException → NotFoundException）：

- 顶部 changelog v1.5.1 表 "(c) IDOR 仍 403" → "(c) IDOR (diff/page/revision/lint finding) → 404 NotFound (v1.5.2 追溯修订)"
- §2.3 R2 决策表 revert 跨页归属校验：`throw ForbiddenException()` → `throw new NotFoundException("Revision not found")`
- §6 diffId IDOR 防护代码块 + 详细文字
- §6 revert 跨页 IDOR 代码块（throw 行）+ 解释
- §11 wiki-diff.service apply/dismiss 入口
- §11 v1.2 revert 跨页校验
- §11 v1.5.1 `?kb=<kbId>` URL 加载条款"diff/page IDOR 仍 403"

**security P2 收尾**：

- §6 search regex 改 Unicode property `/^[\p{L}\p{N}\p{M}\s\-]+$/u` 支持全语种
- §11 list endpoint 越权时返 NotFoundException 而非空数组（切断数组长度 oracle）
- §11 显式声明 404 timing oracle 列入 accepted risk

**tester P2 收尾**：

- §11 第 (7) 项 wiki-enable-toggle spec 补 `configCreated=true` 断言

## 11. R7.3 第四轮评审结果（v1.5.3，最终共识）

| 评审角色  | VERDICT          | 备注                                                                    |
| --------- | ---------------- | ----------------------------------------------------------------------- |
| reviewer  | **APPROVED**     | 7 处穿透替换全部落到正文，inline 标注 "(v1.5.x 改 NotFound)" 清晰可追溯 |
| architect | **APPROVED**     | 跨模块 IDOR 一致性建议作为 §15 follow-up note 留给后续评估              |
| security  | **APPROVED**     | 4 项 P2 已全部吸收，timing oracle 显式 accepted risk 透明               |
| tester    | **APPROVED**     | configCreated 断言 + spec 矩阵完整，可进入 P0a 实施                     |
| **共识**  | **4/4 APPROVED** | **方案 v1.5.3 进入 P0a 实施阶段**                                       |

## 12. 跨 R7-R7.3 元教训汇总

经历 4 轮集体审视才达成共识，核心教训：

1. **设计文档的"实测断言密度"**：v1.5 一次性引入 8 处变更，4 路评审仍发现 7 项 P0——其中 4 项是"未对照实际代码事实"。下次设计任务前置 grep 实测覆盖率应达 90% 以上，每条引用现有代码的描述都必须有对应 file:line 引用。
2. **架构归属审查的 3 维度**（v1.3 / v1.4 元教训延续到 v1.5）：①是否穿透 facade ②是否过度集中 app ③是否过度抽象/与既有重叠。R7 又增加第 4 维度 ④"用户从 zero-state 到看到核心价值的步数"——产品入口位置维度。
3. **追溯修订声明 ≠ 正文穿透替换**：R7.2 的核心教训。"v1.5.x 起此处改为 X" 这种 doc 级声明无法替代逐处文本修订。修订作者必须 grep 全文穿透替换 + 加 inline 标注 + 评审前自检差异。
4. **存在性 oracle 的枚举式审视**：R7.1 → R7.2 → R7.3 三轮才把跨 KB 4 类资源（page / diff / revision / lint finding）全部统一到 404，加上 list endpoint 越权返 404 而非空数组。security 评审 prompt 应明文要求"枚举所有可能的存在性 oracle 路径并统一响应"。
5. **共识达成的迭代成本可控**：4 轮评审看似冗长，但每轮发现的问题都是真问题——P0 是阻塞落码的硬错误，P1 是落码后会导致工程师困惑的歧义。共识后进入实施时 spec / service / controller 三层语义对齐，避免 P0a-P3 各 phase 的 4 路 review 反复返工。

---

**文档版本**：1.2（2026-05-09 R7-R7.3 全程归档，v1.5.3 4/4 APPROVED 进入 P0a 实施）
