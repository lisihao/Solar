# LLM Wiki v2.0 重塑方案（增量补丁，非重写）

> v1.5.3 主方案（[llm-wiki.md](./llm-wiki.md)）已 APPROVED-FOR-IMPLEMENTATION 并完成 P0a/P0b/P1/P2/P3a/P3b 阶段落地。
> 上线后用户反馈 5 类质量差距，本补丁定义 v2.0 增量改造（W1-W5 五个 PR），**严格复用 v1.5.3 已落 schema/service/UI**，不重写已通过 4/4 共识的设计。

> ⚠️ **重要文档关系**：
>
> - **W2 (多 pass) + W3 (多语言)** 的详细实施切片真源是 [2026-05-12-multi-pass-and-locale-consensus.md](./2026-05-12-multi-pass-and-locale-consensus.md)（4 路 subagent 评审已 4/4 CONDITIONAL APPROVE，含 10 BLOCKER + 15 P1 + 17 commit 切片）。本文档 §4.W2/§4.W3 仅做高层概括 + 与 W1/W4/W5 的协同关系，**实施按 consensus 文档执行**。
> - **W1 (URL/YT 预解析) + W4 (ToolRegistry 接入) + W5 (硬删除 + index.md + 图文)** 是 v2.0 新增需求（用户 2026-05-12 后期补充），**本文档为这三块的唯一设计真源**。
> - 图文并茂（image embedding）属于 W1+W2 协同输出，W1 抽 URL，W2 prompt 注入。

**最后更新**：2026-05-12
**版本**：v2.0-rebuild-plan（draft / 用户确认 → 进入实施）
**状态**：🟡 **DRAFT** — 待用户确认 5 PR 顺序后开干
**对应代码区域**：

- `backend/src/modules/ai-app/library/wiki/`（W2/W3/W5 改造）
- `backend/src/modules/ai-app/library/rag/`（W1 加 preparse 字段 / W4 wiki 接 RAG 桥）
- `backend/src/modules/ai-engine/content/`（W1 复用 ContentFetchService / YoutubeService）
- `backend/src/modules/ai-engine/tools/registry/`（W4 注册 wiki tools）
- `backend/src/modules/ai-harness/runner/dag/`（W2 复用 DAGExecutor）
- `frontend/components/library/wiki/`（W3/W5 多语言 picker + 硬删除）

**用户原话**（2026-05-12）：

> 我需要一个高质量，完善的，完整的WIKI实现，并且能够通过知识库向外开放查询能力，同时支持中英多语言，图文并茂。
> 另外Youtube等视频URL或者网页URL导入KB时，需要支持预解析，这样后续WIKI生成的时候，语料库充足。
> 还有一个，要复用既有的能力，包括Harness，Engine。

---

## 1. v1.5.3 落地后的质量差距盘点

| #   | 用户反馈                         | 截图          | v1.5.3 设计                                                   | 实际差距                                                                                                    |
| --- | -------------------------------- | ------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | "为什么 WIKI 提取只有 SOURCE"    | Screenshot_64 | §4.1 WikiPage.category 4 类 + §5.1 ingest prompt 含全 4 类    | LLM `creativity:"deterministic"` (temp 0.1) 偏保守输出，实际几乎只产 SOURCE。无强制配比约束                 |
| 2   | "内容如此之少"                   | Screenshot_64 | §5.1 ingest 单 LLM call 出全部 page                           | Karpathy 蓝图要求"读一篇 → 更新 10-15 相关页面 fan-out"；我们 1 doc → 1-3 page，缺多 pass + cross-link 强制 |
| 3   | "图文并茂"                       | (新需求)      | 无图片处理                                                    | KbDocument.rawContent 是纯文本，丢失源文档 `<img>` URL/视频缩略图；wiki page body 也无图引用                |
| 4   | "中英多语言"                     | (新需求)      | §4.1 locale 字段已有 default 'zh'                             | `wiki-ingest.service.ts:436 DEFAULT_LOCALE="zh"` 硬编码，MULTI mode 是 stub；前端无 locale picker           |
| 5   | "WIKI 为什么不能删除"            | (新需求)      | §6 只有 toggle wiki-enabled                                   | 无 hard delete endpoint；前端 WikiCardGrid "删除"按钮其实调 disable                                         |
| 6   | "能够通过知识库向外开放查询能力" | (新需求)      | §5.2 wiki-query 单 endpoint                                   | 未注册到 ToolRegistry / agent 不可调；与 RAG 检索完全脱节                                                   |
| 7   | "YouTube/网页 URL 导入预解析"    | (新需求)      | KB add 仅存 sourceUrl，YT 拿 transcript 是 wiki ingest 临触发 | 应该在 doc add 阶段就预解析 + 落富语料（含图 URL），后续 wiki ingest 直接用                                 |

**元判断**：v1.5.3 工程实现合规，质量不达预期源于：

- **prompt 没强制 fan-out + 4 类配比**（W2 修）
- **schema 缺图字段 + 预解析管线**（W1 修）
- **engine 已有 primitives 未用**（YoutubeService / ContentFetchService / DAGExecutor / ToolRegistry —— W1/W2/W4 修）

---

## 2. 复用 Harness/Engine Primitives 矩阵（用户硬要求）

| v2.0 新能力         | 复用既有 primitive              | 路径                                                   | 复用方式                                                                        |
| ------------------- | ------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------- |
| URL 内容抓取（W1）  | **ContentFetchService**         | `ai-engine/content/fetch/content-fetch.service.ts:114` | `fetch(url, opts)` → HTML+markdown，含 SSRF guard。直接调，不重写               |
| YouTube 字幕（W1）  | **YoutubeService**              | `ai-engine/content/fetch/youtube.service.ts:42`        | `getTranscript(videoId, lang?)`，DB cached + Supadata fallback。直接调          |
| HTML→markdown 清洗  | **WebContentExtractionService** | ContentFetchService 内部                               | 不直接调，通过 ContentFetchService 间接用                                       |
| 图片 URL 提取（W1） | 复用 ContentFetchService 输出   | metadata 字段                                          | extend `KbDocument.metadata.mediaUrls: string[]` 不加新表                       |
| Embedding（W2/W4）  | **EmbeddingService**            | `ai-engine/rag/embedding/embedding.service.ts:150`     | `embed(texts, taskType?)` → 1536-dim，已支持 multi-provider                     |
| 向量检索（W4）      | 复用 RAG 双层检索               | `KnowledgeBaseService` parent-child chunk              | wiki page embedding 走同一 vector store（已有 WikiPageEmbedding 表）            |
| 多 pass 编排（W2）  | **DAGExecutor**                 | `ai-harness/runner/dag/dag-executor.ts:65`             | `run(adapter, config)` 跑 entity-pass → concept-pass → summary-pass 三步 DAG    |
| LLM 调用（W2/W3）   | **AiChatService**               | `ai-engine/facade`                                     | 复用现有 `wiki-ingest.service.ts` 内 chat.chat() pattern                        |
| Skill 加载（W2）    | **PromptSkillBridge**           | `wiki.module.ts:88` registerDomain("library")          | 新增 `wiki-ingest-entities.skill.md` / `wiki-ingest-concepts.skill.md` 走同一桥 |
| Tool 注册（W4）     | **ToolRegistry**                | `ai-engine/tools/registry/tool.registry.ts:21`         | `registry.register(wikiSearchTool)` 标准模式                                    |
| 语种检测            | **AiChatService** mini-call     | 无专用 service                                         | thin LLM 包装：1 句 prompt "detect language: zh/en"                             |
| 级联删除（W5）      | **Prisma onDelete: Cascade**    | schema 已配                                            | DELETE KB row → wiki 全表自动级联，无需手写                                     |

**MECE 原则严守**：

- W1 预解析逻辑放 `ai-app/library/document/preparse/`（业务桥层），调用 engine `ContentFetchService` / `YoutubeService` — engine 不知道 wiki
- W2 多 pass 编排放 `ai-app/library/wiki/wiki-ingest.service.ts` 内（不进 harness），仍是 engine 层"单次 ingest，多 LLM call"模式，符合 v1.5.3 §3.1 分层
- W4 wiki tool 实现放 `ai-engine/tools/wiki-tools/`（engine 唯一 tools 目录）

---

## 3. 用户决策沉淀（2026-05-12 AskUserQuestion）

| 决策点               | 选项                                                       | 用户选择                                                     | 落地影响                                                                                     |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 图文并茂的"图"从哪来 | (a) 源图 / (b) AI 生成 / (c) 视频抽帧                      | **(a) 只用源文档已有图**（YT 视频缩略图 + HTML `<img>` URL） | W1 预解析不需要图像生成 API / ffmpeg；W2 page body 用 `![](url)` 引用源图                    |
| 多语言策略           | (a) 按源语种各建 / (b) 中文为主翻译 / (c) admin 配 KB 语种 | **(c) admin 选 KB 语种（zh/en/zh+en）**                      | W3 加 `WikiKnowledgeBaseConfig.enabledLocales: string[]`；前端 KB 创建/设置面板加语种 picker |
| 交付节奏             | 全部 / W1+W2 / W2+W5                                       | **全部 5 PR 一次性 + 最后统一 push**                         | 按 feedback_autonomous_phase_execution 连续推进                                              |
| 复用 H/E 能力        | (用户补充强调)                                             | **硬要求**                                                   | §2 矩阵全覆盖，新写代码必须解释"为什么不能复用 X"                                            |

---

## 4. 五个 PR 详细方案

### W1 · 源文档预解析管线（基础设施层）

**目标**：URL/YouTube 加进 KB 时立即落富语料 + 图片 URL，后续 wiki ingest 直接读 `KbDocument.metadata.preparse` 不再现场抓。

**Schema 变更**（最小侵入）：

- `KnowledgeBaseDocument.metadata` (Json) 内增 sub-key（无 schema migration）：
  ```typescript
  metadata: {
    preparse?: {
      status: 'pending' | 'parsing' | 'ready' | 'failed';
      mediaUrls: string[];           // 源文档所有 <img src> / video thumbnail
      structuredContent?: {          // 章节/段落树（用于 W2 outline pass）
        title: string;
        sections: Array<{ heading: string; content: string; images?: string[] }>;
      };
      sourceLocale?: 'zh' | 'en';    // 语种检测结果，给 W3 路由
      parsedAt?: string;
      errorCode?: string;
      retryCount?: number;
    }
  }
  ```

**新文件**：

- `backend/src/modules/ai-app/library/document/preparse/preparse.service.ts`
  - `preparseDocument(docId): Promise<void>` 入口
  - 内部路由：`isYouTubeUrl → YoutubeService.getTranscript`；`isHttpUrl → ContentFetchService.fetch`；其他 → no-op
  - 写回 `metadata.preparse`，幂等（status=ready 跳过）
- `backend/src/modules/ai-app/library/document/preparse/youtube.preparser.ts`
  - 包装 YoutubeService：拉字幕 + 拉视频元信息（标题/缩略图 URL）
  - thumbnailUrl: `https://i.ytimg.com/vi/{videoId}/maxresdefault.jpg`
- `backend/src/modules/ai-app/library/document/preparse/web.preparser.ts`
  - 包装 ContentFetchService：HTML → readable markdown + image URL 抽取
  - 图 URL 提取用现有 `WebContentExtractionService` 已有逻辑

**集成点**：

- `KnowledgeBaseService.addDocument()` 末尾追加 `void this.preparseService.preparseDocument(doc.id)` (fire-and-forget)
- 前端 `KbDocumentList` doc 行加 status badge："解析中 / 已就绪 / 失败"，失败可重试

**Spec**：3 个 unit + 1 个 e2e flow

- YouTube URL → mediaUrls 含 thumbnail + transcript 拼回 rawContent
- HTML URL → mediaUrls 含 `<img>` 列表
- 失败 retry 3 次后落 errorCode

---

### W2 · Wiki ingest 多 pass + fan-out + 图文（核心改造）

> **🔗 实施真源**：[2026-05-12-multi-pass-and-locale-consensus.md](./2026-05-12-multi-pass-and-locale-consensus.md) §4 BLOCKER 清单 + §5 P1 整改 + §7 17 commit 切片。本节仅高层概括 + v2 新增点。

**已评审锁定的设计**（按 consensus 文档）：

- 多 pass = outline → section-fill → cross-link 三段，**不是**我最初草拟的 entity/concept/summary 三段
- outline pass 产出 `coverageMap` + H2/H3 章节骨架
- section-fill 按章节并发跑（带 TPM/RPM 节流：B3 BLOCKER）
- cross-link pass 独立注入 `[[link]]`（按 B5 prompt cache 友好性优化）
- outputLength 保持 `'long'` 8000，不升 `'extended'`（B1 BLOCKER：4 主流 provider max ≤ 8192）
- section-fill 部分失败走 partial progress + cache 兜底（B2 BLOCKER）
- 总 token 预算 cron daily budget 按 N+2 calls 重算（B4 BLOCKER）

**v2.0 在 consensus 之上额外补的点**（本文档新增）：

1. **图文并茂**（用户 2026-05-12 新需求，consensus 文档未覆盖）：
   - outline pass + section-fill pass 的 prompt 接收 W1 产出的 `mediaUrls: string[]`
   - prompt 显式要求："when describing entity/concept X visualized in source, embed `![alt](url)` to relevant image"
   - cross-link pass 末尾 sweeper：检查 section-fill 输出是否引用全部 mediaUrls，未引用的 image 自动 append 到末尾 figure 段（防丢图）
   - 复用 v1.5.3 §4.1 WikiPage.body 字段直存 markdown，图渲染走前端既有 react-markdown

2. **outline pass 显式接收 W1 structuredContent**（替代裸 rawContent）：
   - W1 preparse 已抽出章节树（heading + content + images），outline pass 直接消费
   - 不再让 LLM 现场切章节，节省 outline token + 提升结构准确性

3. **Pass 输入精简策略**（与 B5 prompt cache 协同）：
   - Pass 1 outline 接收 W1 structuredContent + mediaUrls（不传源全文）
   - Pass 2 section-fill 接收章节内容（不传 outline + 不传其他章节）
   - Pass 3 cross-link 接收全部 Pass 2 输出 + entity slug 表（不传源）
   - 每 Pass system prompt 独立 cache key（B5 prompt cache 优化）

**affectedKeys**：按 v1.5.3 §11 P3 BLOCKER C2 + consensus C2 BLOCKER 升级为 `slug:locale` 联合

**Spec**：详见 consensus §7 + D 来源 P1 整改（spec 矩阵 4 路径）

---

### W3 · 多语言（中英）

> **🔗 实施真源**：[2026-05-12-multi-pass-and-locale-consensus.md](./2026-05-12-multi-pass-and-locale-consensus.md) §1.3（用户答案锁定为"单页多语言版本并存"+ translationGroupId 关系） + §4 C2/C3/C6/C7 BLOCKER。本节仅高层概括 + v2 用户决策更新。

**已评审锁定的设计**（按 consensus 文档）：

- 单页多语言版本并存：同概念 zh/en 各一份 `WikiPage` 行，`translationGroupId` (uuid) 关联（C7 BLOCKER：服务端生成不让 LLM hallucinate）
- `WikiDiff.affectedSlugs` 升级 `affectedKeys` = `slug:locale`（C2 BLOCKER：跨 locale 假阴性 / 反锁修）
- `WikiPageLink.toSlug` → `toSlug + toLocale` 联合（C3 BLOCKER：跨 locale 链接污染修）
- 旧 PENDING WikiDiff migration backfill locale=zh（C6 BLOCKER）

**v2.0 用户决策更新**（2026-05-12 AskUserQuestion，覆盖 consensus §1.3 多语言策略）：

> **用户原选**（consensus）：单页多语言版本并存 + translationGroupId 显式维护（每文档跑 ×N locale pass）
> **用户新选**（v2.0）：**按 KB 配置：admin 选 KB 语种（zh / en / zh+en）**

**变更影响**：

- 单语 KB（zh 或 en）：ingest 仅产源语种 page，不触发翻译 pass → 与 consensus 单语流程一致
- 双语 KB（zh+en）：ingest 触发跨语种翻译 pass，按 consensus translationGroupId 维护关系
- 不再"每文档无脑产双语"，admin 显式 opt-in 双语 KB 才付翻译成本

**Schema 增量**（在 consensus C2/C3/C6/C7 之上）：

- `WikiKnowledgeBaseConfig` 加 `enabled_locales TEXT[] @default(['zh'])` 列
- migration：`ALTER TABLE wiki_knowledge_base_configs ADD COLUMN enabled_locales TEXT[] DEFAULT ARRAY['zh']`

**前端 UI**（v2.0 新增，consensus 未覆盖）：

- KB 创建/设置 dialog 加 segmented control「语种：中文 / 英文 / 中英」
- WikiTab 顶部加 locale picker（仅当 `enabledLocales.length > 1` 时显示）
- WikiPageDrawer 加 locale tab 切换同 translationGroupId 的多语版本

**Spec**：consensus §7 既有 + v2.0 新增 enabledLocales 路由 spec

---

### W4 · 开放查询能力（接入 agent + KB）

**注册 wiki tools 到 ToolRegistry**（engine 层）：

新文件 `backend/src/modules/ai-engine/tools/wiki-tools/`：

- `wiki-search.tool.ts` implements ITool：
  - id: `wiki-search`
  - input: `{ kbId: string, query: string, locale?: 'zh' | 'en', limit?: number }`
  - output: `{ pages: Array<{ slug, title, category, oneLiner, score }> }`
  - execute: 调 `WikiQueryService.search()` 直返 hit
- `wiki-page-read.tool.ts`：
  - id: `wiki-page-read`
  - input: `{ kbId: string, slug: string, locale?: 'zh' | 'en' }`
  - output: `{ page: WikiPageWithLinks }`
  - execute: 调 `WikiPageService.getPage()`

**注册位置**：`wiki.module.ts onModuleInit()` 加：

```typescript
this.toolRegistry.register(this.wikiSearchTool);
this.toolRegistry.register(this.wikiPageReadTool);
```

**RAG 桥接**（让 KB query 同时命中 wiki page + chunk）：

- 修改 `KnowledgeBaseService.searchKnowledgeBase()`：
  - 旧：仅 vector 检索 ChildEmbedding（doc chunks）
  - 新：并行检索 ChildEmbedding + WikiPageEmbedding，merge by score rerank
  - hit type 字段区分 `chunk | wiki_page`，前端统一渲染

**agent-playground / research 影响**：

- 无需改任何 agent 代码
- agent 通过 LLM tool-use 自动获得 wiki-search 能力
- 在 SkillRegistry 加 `wiki-research.skill.md` 教 agent 何时用 wiki vs chunk 检索

**Spec**：

- ITool execute() 单元测
- KB search merge spec：vector hit + wiki hit 同时出现，rerank 后 wiki 高分排前
- agent playground e2e：mission 用 wiki-search 工具检索 → 成功命中

---

### W5 · 硬删除 + Index.md 自动维护

**硬删除**：

- DELETE `/api/v1/library/wiki/:kbId/destroy`（注意路径区分：`/wiki-enabled` 是 toggle，`/destroy` 是真删）
- 调用：`wikiKbAdminService.destroyAllWikiData(kbId, userId)`
- 实现：单 transaction cascade delete：
  ```typescript
  await this.prisma.$transaction([
    this.prisma.wikiPageEmbedding.deleteMany({
      where: { knowledgeBaseId: kbId },
    }),
    this.prisma.wikiPageLink.deleteMany({
      where: { fromPage: { knowledgeBaseId: kbId } },
    }),
    this.prisma.wikiPageRevision.deleteMany({
      where: { page: { knowledgeBaseId: kbId } },
    }),
    this.prisma.wikiPage.deleteMany({ where: { knowledgeBaseId: kbId } }),
    this.prisma.wikiDiff.deleteMany({ where: { knowledgeBaseId: kbId } }),
    this.prisma.wikiLintFinding.deleteMany({
      where: { knowledgeBaseId: kbId },
    }),
    this.prisma.wikiOperationLog.deleteMany({
      where: { knowledgeBaseId: kbId },
    }),
    this.prisma.wikiKnowledgeBaseConfig.deleteMany({
      where: { knowledgeBaseId: kbId },
    }),
    // 最后关闭 wiki-enabled flag
    this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: { wikiEnabled: false },
    }),
  ]);
  ```
- 仅 KB OWNER 可操作（复用 v1.5.3 §11 ownership check）

**前端**：

- `WikiCardGrid` "删除"按钮重命名为"清空 Wiki 数据"，独立于"禁用 Wiki"
- 二次确认 dialog 展示统计："将销毁 X 页 / Y 待审 diff / Z lint finding。此操作不可恢复"
- KB 卡片普通"删除"维持 disable 语义（命名修正：「禁用」），用 Trash 图标的红按钮才走 destroy

**Index.md 自动维护**：

- Wiki 内置 system page：`__index__`（slug 保留字，用户不可创建同 slug）
- 每次 ingest apply 后 fire-and-forget regen：按 category 分组列出全部 page + oneLiner
- 实现：`wiki-index.service.ts:regenerate(kbId, locale)` 调 prisma 查全部 page → 拼 markdown → upsert `__index__` page
- 前端 WikiTab 左 sidebar 顶部固定显示 "📑 索引"，点击直跳 `__index__` page

**Spec**：

- destroy spec：cascade 删 + 8 表全清 + OWNER guard
- index regen spec：5 page → 索引含 5 条 oneLiner + 按 category 分组
- 前端 dialog 二次确认 spec

---

## 5. 与既有文档的关系（三层引用关系）

```
llm-wiki.md (v1.5.3)                       ← 基础架构真源（schema / API / UI / security）
    │
    ├─── llm-wiki-review-r1~r7.md          ← R1-R7 评审纪要（不改）
    │
    ├─── 2026-05-12-multi-pass-and-locale-consensus.md
    │       │
    │       └── W2 多 pass + W3 多语言     ← 4 路评审已 4/4 CONDITIONAL APPROVE
    │           （10 BLOCKER + 15 P1 + 17 commit 切片）
    │
    └─── llm-wiki-v2-rebuild-plan.md (本文档)
            │
            ├── W1 URL/YT 预解析管线        ← v2.0 唯一真源
            ├── W4 ToolRegistry 接入        ← v2.0 唯一真源
            ├── W5 硬删除 + index.md + 图文  ← v2.0 唯一真源
            ├── W2/W3 高层概括              ← 引用 consensus，不重复细节
            └── 与 v1.5.3 §章节 cross-ref  ← 增量改动定位
```

**保留不动**（v1.5.3 主方案）：

- §4 Schema 10 张表 + 全部 onDelete cascade
- §5.2-5.4 query/lint/export 主体管线
- §6 API endpoint（仅 W5 新增 destroy；W3 加 enabledLocales 字段；W4 注册 tool 不动 endpoint）
- §7 UI 三栏布局
- §10 link-parser 测试用例
- §11 安全 checklist 全部

**consensus 文档锁定**（W2/W3）：

- 10 BLOCKER 必改 + 15 P1 整改 + 17 commit 切片，本 v2 plan **不重写**
- v2 用户决策更新：双语策略改为 admin KB 配置（覆盖 consensus §1.3 默认每文档双语）

**v2.0 新增**（W1/W4/W5）：

- §4 KbDocument.metadata 加 preparse sub-key（W1 无 migration）
- §5.1 ingest 输入升级为 W1 structuredContent + mediaUrls（W2 prompt 改）
- §6 加 1 个 endpoint：DELETE /destroy（W5）
- §6 加 2 个 ITool 注册：wiki-search + wiki-page-read（W4）
- §7 WikiCardGrid "删除"→"禁用"重命名 + 新增"清空"按钮（W5）
- §7 加 locale picker UI（W3，呼应 consensus 数据层）
- KB search 桥：vector chunk + wiki page embedding 合并 rerank（W4）
- 内置 `__index__` system page（W5）

---

## 6. 落地路径

| PR       | 范围                                                                                             | 估时           | 依赖                             | 验证                                                                            |
| -------- | ------------------------------------------------------------------------------------------------ | -------------- | -------------------------------- | ------------------------------------------------------------------------------- |
| **W1**   | preparse 管线 + KbDocument.metadata 扩展 + frontend status badge                                 | 1 天           | 无（独立）                       | `preparse.service.spec.ts` 全绿；e2e 加 YT URL → metadata.preparse.status=ready |
| **W2**   | outline + section-fill + cross-link 三 pass + 图注入（按 consensus 17 commit）                   | 2-3 天         | W1（用 preparse 输出）           | 详见 consensus §7 BLOCKER + P1 + spec 矩阵                                      |
| **W3**   | enabledLocales schema migration + ingest 路由 + 前端 picker（叠加 consensus translationGroupId） | 1 天           | W2（多 pass 已能产多语种）       | 单语 + 双语 KB ingest spec；前端 picker 隐藏/显示                               |
| **W4**   | wiki-search/wiki-page-read tools + KB search merge + skill 教 agent                              | 1 天           | W3 完成（tool 接受 locale 参数） | ITool spec；agent-playground mission 用 wiki-search e2e                         |
| **W5**   | destroy endpoint + index.md auto-regen + 前端 dialog                                             | 0.5 天         | 无（独立）                       | destroy spec；index regen spec                                                  |
| **合计** |                                                                                                  | **5.5-6.5 天** | 顺序 W1→W2→W3→W4→W5              | 每 PR commit；最后统一 push                                                     |

> **注**：W2 估时由本文档"1.5 天"修正为"2-3 天"，对齐 consensus 17 commit 切片实际工程量。

**单次 push 提交策略**（按 feedback_autonomous_phase_execution）：

- W1-W5 每 PR commit 后不 push
- 全部完成后跑一次 verify:full + 最后统一 push
- 中途遇到 god-class size guard 立即拆 helper（按 feedback_god_class_extract_helper）

---

## 7. 风险与缓解

| 风险                             | 影响                              | 缓解                                                                                                 |
| -------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| W2 三 pass LLM 调用成本 ×3       | 单次 ingest 费用 ×3               | TaskProfile outputLength 控制；Pass 1/2/3 输入相互精简（不传全文）                                   |
| W2 fan-out 拒绝重试              | 偶发用户体验延迟                  | 拒绝阈值宽松（cross-link <2 才拒）；重试上限 1 次后 fail open                                        |
| W4 wiki 检索 + chunk 检索 rerank | 检索延迟 +30%                     | 并行检索；wiki embedding 已存（v1.5.3 §4.1）只多一次 query                                           |
| W3 多语言 ingest 翻倍            | 双语 KB 单次 ingest 时间 ×2       | 仅当 KB enabledLocales.length > 1 才触发；admin 选 KB 语种是显式 opt-in                              |
| W5 hard delete 不可恢复          | 用户误操作丢数据                  | 二次确认 + 输入 KB name 校验（高危操作模式）+ 30 天软删除窗口（status='destroying'）— 暂留 follow-up |
| 与 v1.5.3 §11 IDOR 防护冲突      | W5 destroy 端点漏 ownership check | 复用 §11 hasAccess + role check 中间件，spec 强制 OWNER-only 测试                                    |

---

## 8. 不做（明确边界）

- ❌ AI 生成补充图（用户选 (a) 只用源图）
- ❌ 视频抽帧（成本与工程量过高，未来需求再开）
- ❌ 自动翻译 KB.enabledLocales 之外的语种（admin 不配 = 不支持）
- ❌ Obsidian 风格图谱视图（v3.0 候选，当前 v2.0 不做）
- ❌ MCP server 暴露 wiki 给外部 agent（v3.0 候选）
- ❌ wiki 跨 KB 引用（v1.5.3 已明确单 KB scope，v2 不改）

---

## 9. memory 沉淀计划

实施完成后写入：

- `project_wiki_v2_rebuild_2026_05_12.md` — 5 PR 落地记录 + commit hash
- `feedback_wiki_must_reuse_engine_primitives.md` — 复用 H/E primitives 经验
- `feedback_preparse_before_ingest.md` — 预解析与 ingest 解耦的工程模式

---

**变更历史**：

- 2026-05-12 v2.0-rebuild-plan draft：用户提出"完整 wiki 实现 + 多语 + 图文 + 预解析 + 复用 H/E"5 要求，沉淀 5 PR 路线图
