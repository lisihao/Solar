# 知识库增强 PRD

> **版本**: 1.2
> **作者**: Genesis Product Team
> **日期**: 2024-12-27
> **状态**: Active
> **最后更新**: 2024-12-27 (基于实际实现状态更新)

---

## 1. 背景与目标

### 1.1 背景

GenesisPod 的知识库（Knowledge Base）模块是平台核心功能之一，为用户提供文档管理、向量化存储和 RAG（检索增强生成）能力。当前版本已实现完整的知识库 CRUD、文档处理、向量嵌入和成熟的 5 阶段 RAG 检索管道。

### 1.2 当前实现状态 (2024-12-27)

#### 已完成功能 ✅

| 功能模块                | 实现状态 | 关键文件                                                                     |
| ----------------------- | -------- | ---------------------------------------------------------------------------- |
| **知识库 CRUD**         | ✅ 完整  | `knowledge-base.service.ts`, `knowledge-base.controller.ts`                  |
| **5阶段 RAG 管道**      | ✅ 完整  | `rag-pipeline.service.ts` (HyDE → 混合检索 → Rerank → 父块检索 → 上下文构建) |
| **Parent-Child 分块**   | ✅ 完整  | `chunking.service.ts` (父块1000字 → 子块200字)                               |
| **向量嵌入 (pgvector)** | ✅ 完整  | `embedding.service.ts`, `child_chunks` 表                                    |
| **Google Drive 同步**   | ✅ 完整  | `google-drive.controller.ts`, `google-drive.service.ts`                      |
| **成员管理 (RBAC)**     | ✅ 完整  | `knowledge-base-members` 表 (OWNER/ADMIN/EDITOR/VIEWER)                      |
| **URL 内容抓取**        | ✅ 完整  | 通过 `content-fetcher.service.ts` 实现                                       |
| **文档向量化**          | ✅ 完整  | 自动分块+嵌入+存储                                                           |

#### 部分实现 🚧

| 功能模块        | 当前状态           | 缺失部分                   |
| --------------- | ------------------ | -------------------------- |
| **Notion 集成** | OAuth 授权存在     | 未连接到知识库模块         |
| **OCR 识别**    | Tesseract 工具存在 | 未集成到知识库文档处理     |
| **文件解析**    | 基础 PDF/文本解析  | 缺少智能元数据提取         |
| **批量导入**    | UI 存在            | 创建占位符内容，未实际获取 |

#### 未实现 ❌

| 功能模块         | 优先级 | 说明                     |
| ---------------- | ------ | ------------------------ |
| **文档版本控制** | P1     | 无版本历史、回滚能力     |
| **增量同步**     | P1     | 每次全量重新处理         |
| **搜索分析**     | P2     | 无查询日志、热门内容统计 |
| **文件上传解析** | P0     | 上传文件后内容为空占位符 |

**现状评分：**

| 维度     | 当前状态                             | 评分 |
| -------- | ------------------------------------ | ---- |
| 核心功能 | 完整可用                             | 9/10 |
| RAG 管道 | 成熟完整（HyDE + 混合检索 + Rerank） | 9/10 |
| 文档处理 | Parent-Child 分块策略完善            | 8/10 |
| 团队协作 | RBAC 权限模型完整                    | 8/10 |
| 外部集成 | Google Drive 完整，Notion 待连接     | 7/10 |
| 用户体验 | UI 完善，部分边界情况待优化          | 7/10 |
| 测试覆盖 | 待加强                               | 4/10 |

### 1.3 目标

**业务目标：**

- 提升知识库使用率 50%（MAU 占比）
- 降低用户文档处理等待时间 30%
- 增加团队知识库采纳率至 40%

**用户目标：**

- 更快速地构建和管理知识库
- 更精准地获取知识检索结果
- 更便捷地与团队共享知识

**技术目标：**

- 提升 RAG 检索准确率至 90%+
- 支持更多数据源无缝接入
- 优化向量化处理性能

---

## 2. 用户画像与场景

### 2.1 目标用户

| 用户类型       | 描述                           | 核心需求                       |
| -------------- | ------------------------------ | ------------------------------ |
| **研究员**     | 需要管理大量学术文献和研究资料 | 精准检索、文献引用、批量导入   |
| **知识工作者** | 企业中负责知识管理的员工       | 团队共享、权限管理、版本追踪   |
| **内容创作者** | 写作者、编辑、内容运营         | 素材管理、灵感检索、快速引用   |
| **开发者**     | 技术文档和代码库管理           | API 集成、代码片段检索、自动化 |

### 2.2 核心使用场景

**场景 1：研究文献管理**

```
作为一名研究员，我希望能够：
- 批量导入 PDF 论文并自动提取元数据
- 按主题/作者/年份组织文献
- 在写作时快速检索相关段落并获取引用格式
```

**场景 2：企业知识沉淀**

```
作为一名知识管理负责人，我希望能够：
- 将 Notion/Confluence 文档同步到知识库
- 设置团队访问权限，控制敏感信息
- 追踪知识库使用情况和热门内容
```

**场景 3：客服知识库**

```
作为一名客服主管，我希望能够：
- 上传产品手册和 FAQ 文档
- 让客服人员通过 AI 快速找到答案
- 持续更新知识库并保持版本一致
```

**场景 4：个人知识管理**

```
作为一名内容创作者，我希望能够：
- 收藏网页文章并自动提取正文
- 管理读书笔记和灵感片段
- 在创作时检索相关素材
```

---

## 3. 功能需求

### 3.1 P0 - 必须实现（紧急修复）

#### 3.1.1 现有 Bug 修复

| ID     | 问题                        | 影响                        | 解决方案                               |
| ------ | --------------------------- | --------------------------- | -------------------------------------- |
| BUG-01 | 团队知识库类型未正确持久化  | 创建团队 KB 后显示为个人    | 检查 DTO 和 Service 的 `type` 字段传递 |
| BUG-02 | Google Drive 重启后认证失效 | 用户需重新授权              | 实现 Token 自动刷新机制                |
| BUG-03 | KB 选择器样式问题           | AI Ask 中 KB 选择器边框异常 | 调整 CSS 样式和溢出处理                |
| BUG-04 | 个人 KB 页面缺少导航        | 用户无法返回 Library        | 添加面包屑和返回按钮                   |
| BUG-05 | 成员权限未强制执行          | VIEWER 可能执行编辑操作     | 在 Service 层添加权限检查              |

#### 3.1.2 数据一致性修复

**问题描述：** 当前数据采集模块存在严重问题（详见 CLAUDE.md）：

- `data_collection_raw_data` 缺少有效信息
- 原始数据与 `resource` 表无关联
- `resource-xxx` 集合存在大量重复

**修复方案：**

1. 建立 `raw_data` 到 `resource` 的双向引用
2. 实现采集时的判重和去重逻辑
3. 数据迁移脚本修复历史数据

---

### 3.2 P1 - 高优先级（核心体验提升）

#### 3.2.1 智能文档处理

**功能描述：** 增强文档导入和处理能力

| 子功能         | 描述                          | 验收标准        |
| -------------- | ----------------------------- | --------------- |
| PDF 智能解析   | 支持 OCR、表格提取、图片识别  | 准确率 > 95%    |
| 元数据自动提取 | 标题、作者、日期、摘要        | 覆盖率 > 80%    |
| 目录结构识别   | 自动生成文档大纲              | 3级目录准确识别 |
| 批量导入       | 支持 ZIP 包、文件夹、CSV 批量 | 单次 100+ 文件  |

**技术方案：**

```
新增服务：
├── DocumentParserService (智能解析)
│   ├── extractMetadata()
│   ├── extractTableOfContents()
│   └── extractTables()
├── OCRService (图像识别)
│   └── processImage() - 集成 Tesseract/MineRU
└── BatchImportService (批量处理)
    ├── processZipArchive()
    └── processCSVManifest()
```

#### 3.2.2 增量同步与版本管理

**功能描述：** 支持文档更新和版本追踪

| 子功能   | 描述             | 验收标准         |
| -------- | ---------------- | ---------------- |
| 增量同步 | 仅处理变更部分   | 同步时间减少 70% |
| 版本历史 | 记录文档修改历史 | 最近 10 个版本   |
| 差异对比 | 展示版本间差异   | 段落级对比       |
| 回滚能力 | 恢复到历史版本   | 1-click 回滚     |

**数据模型扩展：**

```prisma
model DocumentVersion {
  id            String   @id @default(uuid())
  documentId    String
  document      KnowledgeBaseDocument @relation(...)
  version       Int
  content       String   @db.Text
  contentHash   String   // 用于增量检测
  changeType    ChangeType // CREATED, UPDATED, DELETED
  changeSummary String?
  createdAt     DateTime @default(now())
  createdBy     String?
}

enum ChangeType {
  CREATED
  UPDATED
  DELETED
  RESTORED
}
```

#### 3.2.3 多数据源集成

**功能描述：** 扩展数据源接入能力

| 数据源       | 当前状态    | 目标状态   | 优先级 |
| ------------ | ----------- | ---------- | ------ |
| Google Drive | ✅ 完整     | 维护       | -      |
| Notion       | 🚧 框架存在 | 完整实现   | P1     |
| Confluence   | ❌ 无       | MVP 实现   | P1     |
| URL/网页     | 🚧 部分     | 增强抓取   | P1     |
| GitHub       | ❌ 无       | 代码库同步 | P2     |
| Slack        | ❌ 无       | 消息归档   | P2     |
| 本地文件夹   | ❌ 无       | 监听同步   | P2     |

**Notion 集成方案：**

```typescript
interface NotionSyncConfig {
  accessToken: string;
  workspaceId: string;
  databaseIds?: string[];  // 指定数据库
  pageIds?: string[];      // 指定页面
  syncMode: 'full' | 'incremental';
  lastSyncCursor?: string;
}

// API 端点
POST /api/rag/notion/connect       // OAuth 授权
GET  /api/rag/notion/databases     // 列出数据库
POST /api/rag/knowledge-bases/:id/notion/sync  // 同步
```

#### 3.2.4 检索质量优化

**功能描述：** 提升 RAG 检索精准度

| 优化项       | 描述                       | 预期提升      |
| ------------ | -------------------------- | ------------- |
| 自适应分块   | 根据文档类型调整分块策略   | 相关性 +15%   |
| 语义缓存     | 缓存相似查询结果           | 响应时间 -40% |
| 多向量检索   | 标题、摘要、正文分别向量化 | 召回率 +20%   |
| 用户反馈学习 | 根据点赞/踩优化排序        | 准确率 +10%   |

**多向量方案：**

```prisma
model ChunkEmbedding {
  id          String @id @default(uuid())
  chunkId     String
  chunk       ChildChunk @relation(...)
  embedType   EmbedType  // TITLE, SUMMARY, CONTENT, QUESTION
  vector      Unsupported("vector(1536)")

  @@index([chunkId, embedType])
}

enum EmbedType {
  TITLE      // 标题向量
  SUMMARY    // 摘要向量
  CONTENT    // 内容向量
  QUESTION   // 假设问题向量 (HyDE)
}
```

---

### 3.3 P2 - 中优先级（体验增强）

#### 3.3.1 知识库分析与洞察

**功能描述：** 提供知识库使用分析

| 功能     | 描述                                 |
| -------- | ------------------------------------ |
| 使用统计 | 查询次数、热门文档、活跃用户         |
| 检索分析 | 查询成功率、无结果查询、平均响应时间 |
| 内容洞察 | 主题分布、知识图谱、关联推荐         |
| 健康检查 | 过期文档、低质量内容、重复检测       |

**Dashboard 设计：**

```
┌─────────────────────────────────────────────┐
│  知识库分析                    [日/周/月 ▼] │
├─────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │ 查询数  │ │ 文档数  │ │ 成功率  │       │
│  │  1,234  │ │   456   │ │  87.5%  │       │
│  │  ↑12%   │ │  ↑8     │ │  ↑2.3%  │       │
│  └─────────┘ └─────────┘ └─────────┘       │
├─────────────────────────────────────────────┤
│  热门查询                    热门文档       │
│  1. "如何配置..."  (89)    1. 产品手册.pdf │
│  2. "API 文档..."  (67)    2. FAQ.md       │
│  3. "错误处理..."  (45)    3. 开发指南.md  │
└─────────────────────────────────────────────┘
```

#### 3.3.2 高级权限与安全

**功能描述：** 细粒度权限控制

| 功能       | 描述                   |
| ---------- | ---------------------- |
| 文档级权限 | 单独设置文档可见性     |
| 字段脱敏   | 自动识别和遮盖敏感信息 |
| 访问审计   | 记录谁访问了什么内容   |
| 导出限制   | 控制是否允许导出/复制  |

**权限模型：**

```typescript
interface DocumentPermission {
  documentId: string;
  visibility: "public" | "team" | "private";
  allowedUsers?: string[]; // 白名单
  deniedUsers?: string[]; // 黑名单
  allowExport: boolean;
  allowCopy: boolean;
}

interface AuditLog {
  id: string;
  userId: string;
  action: "view" | "query" | "export" | "edit" | "delete";
  resourceType: "knowledge_base" | "document" | "chunk";
  resourceId: string;
  timestamp: Date;
  metadata: Record<string, any>;
}
```

#### 3.3.3 导出与分享

**功能描述：** 知识库内容导出能力

| 功能         | 格式                  |
| ------------ | --------------------- |
| 知识库导出   | JSON、ZIP（含原文件） |
| 检索结果导出 | Markdown、PDF、Word   |
| 公开分享     | 生成公开链接（只读）  |
| API 访问     | 第三方系统集成        |

#### 3.3.4 智能标签与分类

**功能描述：** 自动化内容组织

| 功能     | 描述                |
| -------- | ------------------- |
| 自动标签 | AI 分析内容生成标签 |
| 智能分类 | 根据内容自动归类    |
| 主题聚类 | 发现相似文档群组    |
| 标签管理 | 自定义标签体系      |

---

### 3.4 P3 - 低优先级（未来规划）

#### 3.4.1 知识图谱可视化

**功能描述：** 展示知识关联关系

- 实体抽取（人名、组织、概念）
- 关系识别（属于、相关、引用）
- 图谱可视化（D3.js / ECharts）
- 路径查询（两个概念的关联）

#### 3.4.2 多模态知识库

**功能描述：** 支持更多内容类型

- 音频/视频转录
- 图像内容理解
- 代码语义理解
- 表格/图表理解

#### 3.4.3 协作编辑

**功能描述：** 实时协同编辑能力

- 多人同时编辑
- 评论与标注
- 变更追踪
- 冲突解决

#### 3.4.4 离线支持

**功能描述：** 离线访问能力

- 本地缓存关键知识
- 离线检索（本地向量）
- 同步队列
- PWA 支持

---

## 4. 非功能需求

### 4.1 性能要求

| 指标           | 当前值           | 目标值                    |
| -------------- | ---------------- | ------------------------- |
| 文档处理速度   | ~10 页/秒        | 20 页/秒                  |
| 向量化速度     | ~100 chunks/请求 | 500 chunks/请求（流水线） |
| 检索延迟 (P95) | ~800ms           | <500ms                    |
| 并发查询       | ~50 QPS          | 200 QPS                   |

### 4.2 可扩展性

- 单知识库支持 100,000+ 文档
- 支持 10,000+ 并发用户
- 向量存储支持水平扩展（pgvector → Milvus/Pinecone 可选）

### 4.3 可靠性

- 数据持久化：PostgreSQL + 定期备份
- 向量索引：支持重建
- 服务可用性：99.9%

### 4.4 安全性

- 数据加密：传输 TLS，存储 AES-256
- 访问控制：RBAC + 文档级权限
- 审计日志：所有敏感操作记录

---

## 5. 技术方案概要

### 5.1 架构演进

```
当前架构：
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Frontend   │───▶│   NestJS     │───▶│  PostgreSQL  │
│   (Next.js)  │    │   Backend    │    │  (pgvector)  │
└──────────────┘    └──────────────┘    └──────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │  OpenAI API  │
                    │  (Embedding) │
                    └──────────────┘

目标架构：
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Frontend   │───▶│   NestJS     │───▶│  PostgreSQL  │
│   (Next.js)  │    │   Backend    │    │  (pgvector)  │
└──────────────┘    └──────────────┘    └──────────────┘
                           │                   │
              ┌────────────┼────────────┐      │
              ▼            ▼            ▼      ▼
       ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌─────────┐
       │  OpenAI  │ │  Cohere  │ │  MineRU  │ │  Redis  │
       │ Embedding│ │  Rerank  │ │   OCR    │ │  Cache  │
       └──────────┘ └──────────┘ └──────────┘ └─────────┘
                           │
                    ┌──────────────┐
                    │  BullMQ      │ (异步任务队列)
                    │  + Workers   │
                    └──────────────┘
```

### 5.2 新增服务清单

| 服务                    | 职责                     | 优先级 |
| ----------------------- | ------------------------ | ------ |
| `DocumentParserService` | 智能文档解析、元数据提取 | P1     |
| `OCRService`            | 图像文字识别             | P1     |
| `BatchProcessorService` | 批量导入任务管理         | P1     |
| `NotionSyncService`     | Notion 数据源同步        | P1     |
| `VersionControlService` | 文档版本管理             | P1     |
| `SemanticCacheService`  | 语义查询缓存             | P1     |
| `AnalyticsService`      | 使用分析与统计           | P2     |
| `AuditService`          | 访问审计日志             | P2     |
| `TaggingService`        | 自动标签与分类           | P2     |
| `KnowledgeGraphService` | 知识图谱构建             | P3     |

### 5.3 数据库变更

```sql
-- 新增表
CREATE TABLE document_versions (...);
CREATE TABLE chunk_embeddings (...);  -- 多向量
CREATE TABLE query_logs (...);        -- 查询日志
CREATE TABLE audit_logs (...);        -- 审计日志
CREATE TABLE document_tags (...);     -- 标签
CREATE TABLE auto_tags (...);         -- AI 生成标签

-- 索引优化
CREATE INDEX idx_chunk_embed_type ON chunk_embeddings(chunk_id, embed_type);
CREATE INDEX idx_query_logs_kb ON query_logs(knowledge_base_id, created_at);
```

---

## 6. 发布计划

### 6.1 里程碑规划

```
Phase 1: 基础修复与稳定 (Week 1-2)
├── BUG-01 ~ BUG-05 修复
├── 数据一致性修复
├── 测试覆盖率提升至 50%
└── 性能基线建立

Phase 2: 核心增强 (Week 3-6)
├── 智能文档处理 (PDF/OCR/元数据)
├── 批量导入功能
├── Notion 集成
├── 增量同步 MVP
└── 检索优化 (语义缓存)

Phase 3: 体验提升 (Week 7-10)
├── 版本管理完整实现
├── 知识库分析 Dashboard
├── 高级权限控制
├── 导出与分享
└── 自动标签系统

Phase 4: 高级特性 (Week 11-14)
├── 多向量检索
├── 知识图谱 MVP
├── 更多数据源 (Confluence/GitHub)
└── 性能优化与扩展性
```

### 6.2 发布策略

| 阶段    | 发布类型 | 用户范围        |
| ------- | -------- | --------------- |
| Phase 1 | Hotfix   | 全量            |
| Phase 2 | Beta     | 内部 + 早期用户 |
| Phase 3 | GA       | 全量            |
| Phase 4 | Preview  | 企业用户        |

---

## 7. 成功指标

### 7.1 核心指标 (OKR)

**Objective**: 打造行业领先的企业知识库平台

| Key Result      | 基线  | 目标  | 衡量方式                 |
| --------------- | ----- | ----- | ------------------------ |
| 知识库 MAU 占比 | 30%   | 50%   | 月活用户中使用 KB 的比例 |
| 文档处理成功率  | 85%   | 98%   | 成功处理/总上传          |
| RAG 检索满意度  | N/A   | 4.2/5 | 用户反馈评分             |
| 平均检索延迟    | 800ms | 400ms | P95 响应时间             |
| 团队 KB 采纳率  | 20%   | 40%   | 创建团队 KB 的团队占比   |

### 7.2 监控指标

| 指标         | 告警阈值 | 监控周期 |
| ------------ | -------- | -------- |
| 处理队列深度 | > 1000   | 实时     |
| 向量化失败率 | > 5%     | 小时     |
| API 错误率   | > 1%     | 分钟     |
| 检索空结果率 | > 20%    | 日       |

---

## 8. 风险与依赖

### 8.1 风险评估

| 风险            | 概率 | 影响 | 缓解措施                  |
| --------------- | ---- | ---- | ------------------------- |
| OpenAI API 限流 | 中   | 高   | 实现限流队列、多 Key 轮换 |
| 大文档处理超时  | 高   | 中   | 分片处理、异步队列        |
| 向量存储容量    | 低   | 高   | 监控容量、扩展方案预研    |
| Notion API 变更 | 低   | 中   | 版本锁定、变更监控        |

### 8.2 外部依赖

| 依赖                 | 类型               | 状态   |
| -------------------- | ------------------ | ------ |
| OpenAI Embedding API | 必需               | 已接入 |
| Cohere Rerank API    | 可选（降级方案）   | 已接入 |
| Google OAuth         | 必需（Drive 同步） | 已接入 |
| Notion API           | 新增               | 待接入 |
| MineRU / Tesseract   | 新增（OCR）        | 待评估 |

---

## 9. 附录

### 9.1 竞品分析

| 产品      | 优势               | 可借鉴       |
| --------- | ------------------ | ------------ |
| Notion AI | 无缝集成、简洁 UX  | 内联检索体验 |
| Mem.ai    | 自动关联、知识图谱 | 智能标签     |
| Obsidian  | 本地优先、可扩展   | 插件生态     |
| Guru      | 企业级、验证机制   | 内容审核流程 |

### 9.2 用户调研摘要

> "批量导入太慢了，100 篇论文要等半小时"
> "希望能自动识别论文的标题和作者"
> "团队知识库的权限管理太粗了"
> "检索结果有时候不太相关，希望能反馈"

### 9.3 参考文档

- [知识库 UX 改进清单](./knowledge-ux-improvements.md)
- [RAG 管道技术文档](../tech/rag-pipeline.md)
- [数据模型设计](../tech/data-model.md)

---

---

## 10. 详细设计规格

### 10.1 P0 - Bug 修复详细规格

#### BUG-01: 团队知识库类型未正确持久化

**问题根因分析：**

```
用户创建团队知识库时：
1. 前端发送 type: 'TEAM' 到 API
2. DTO 接收参数但未正确验证
3. Service 层在创建时使用默认值 'PERSONAL'
4. 数据库存储为 PERSONAL，显示错误
```

**修复方案：**

```typescript
// 1. 修改 CreateKnowledgeBaseDto
// backend/src/modules/ai/rag/dto/create-knowledge-base.dto.ts

import { IsEnum, IsOptional } from 'class-validator';
import { KnowledgeBaseType } from '@prisma/client';

export class CreateKnowledgeBaseDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(KnowledgeBaseType)
  @IsOptional()
  type: KnowledgeBaseType = KnowledgeBaseType.PERSONAL;  // 明确默认值

  @IsOptional()
  @IsString()
  embeddingModel?: string;
}

// 2. 修改 KnowledgeBaseService.create()
// backend/src/modules/ai/rag/services/knowledge-base.service.ts

async create(userId: string, dto: CreateKnowledgeBaseDto): Promise<KnowledgeBase> {
  // 验证：如果是 TEAM 类型，必须有 userId
  if (dto.type === KnowledgeBaseType.TEAM && !userId) {
    throw new BadRequestException('Team knowledge base requires owner');
  }

  return this.prisma.knowledgeBase.create({
    data: {
      name: dto.name,
      description: dto.description,
      type: dto.type,  // 确保使用 DTO 中的类型
      embeddingModel: dto.embeddingModel || 'text-embedding-3-small',
      userId,
    },
  });
}
```

**测试用例：**

```typescript
describe("KnowledgeBaseService.create", () => {
  it("should create PERSONAL knowledge base by default", async () => {
    const kb = await service.create(userId, { name: "Test KB" });
    expect(kb.type).toBe("PERSONAL");
  });

  it("should create TEAM knowledge base when type is specified", async () => {
    const kb = await service.create(userId, { name: "Team KB", type: "TEAM" });
    expect(kb.type).toBe("TEAM");
  });

  it("should persist type correctly in database", async () => {
    await service.create(userId, { name: "Team KB", type: "TEAM" });
    const persisted = await prisma.knowledgeBase.findFirst({
      where: { name: "Team KB" },
    });
    expect(persisted.type).toBe("TEAM");
  });
});
```

---

#### BUG-02: Google Drive 重启后认证失效

**问题根因分析：**

```
1. OAuth Access Token 有效期为 1 小时
2. Refresh Token 存储在内存中，重启丢失
3. 未实现自动刷新机制
```

**修复方案：**

```typescript
// 1. 新增数据模型存储 OAuth Tokens
// backend/prisma/schema.prisma

model OAuthConnection {
  id            String   @id @default(uuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  provider      String   // 'google_drive', 'notion', etc.
  accessToken   String   @db.Text
  refreshToken  String   @db.Text
  expiresAt     DateTime
  scope         String?
  metadata      Json?    // 存储额外信息如 workspace_id
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([userId, provider])
  @@index([userId])
  @@index([provider, expiresAt])  // 用于批量刷新
  @@map("oauth_connections")
}

// 2. Token 刷新服务
// backend/src/modules/integrations/services/oauth-token.service.ts

@Injectable()
export class OAuthTokenService {
  private readonly REFRESH_THRESHOLD_MINUTES = 5;

  constructor(
    private prisma: PrismaService,
    private googleAuth: GoogleAuthService,
  ) {}

  async getValidToken(userId: string, provider: string): Promise<string> {
    const connection = await this.prisma.oAuthConnection.findUnique({
      where: { userId_provider: { userId, provider } },
    });

    if (!connection) {
      throw new UnauthorizedException(`No ${provider} connection found`);
    }

    // 检查是否需要刷新
    const now = new Date();
    const expiresIn = connection.expiresAt.getTime() - now.getTime();
    const needsRefresh = expiresIn < this.REFRESH_THRESHOLD_MINUTES * 60 * 1000;

    if (needsRefresh) {
      return this.refreshToken(connection);
    }

    return connection.accessToken;
  }

  private async refreshToken(connection: OAuthConnection): Promise<string> {
    this.logger.log(`Refreshing ${connection.provider} token for user ${connection.userId}`);

    try {
      let newTokens: TokenResponse;

      switch (connection.provider) {
        case 'google_drive':
          newTokens = await this.googleAuth.refreshAccessToken(connection.refreshToken);
          break;
        case 'notion':
          newTokens = await this.notionAuth.refreshAccessToken(connection.refreshToken);
          break;
        default:
          throw new Error(`Unknown provider: ${connection.provider}`);
      }

      // 更新数据库
      await this.prisma.oAuthConnection.update({
        where: { id: connection.id },
        data: {
          accessToken: newTokens.accessToken,
          refreshToken: newTokens.refreshToken || connection.refreshToken,
          expiresAt: new Date(Date.now() + newTokens.expiresIn * 1000),
        },
      });

      return newTokens.accessToken;
    } catch (error) {
      this.logger.error(`Failed to refresh token: ${error.message}`);

      // 标记连接为失效
      await this.prisma.oAuthConnection.update({
        where: { id: connection.id },
        data: { metadata: { ...connection.metadata, invalid: true } },
      });

      throw new UnauthorizedException('Token refresh failed, please reconnect');
    }
  }

  // 定时任务：批量刷新即将过期的 token
  @Cron('0 */5 * * * *')  // 每5分钟执行
  async refreshExpiringTokens(): Promise<void> {
    const threshold = new Date(Date.now() + 10 * 60 * 1000);  // 10分钟内过期

    const expiring = await this.prisma.oAuthConnection.findMany({
      where: { expiresAt: { lte: threshold } },
    });

    for (const connection of expiring) {
      try {
        await this.refreshToken(connection);
      } catch (error) {
        this.logger.warn(`Failed to refresh token for ${connection.userId}`);
      }
    }
  }
}
```

**API 变更：**

```typescript
// 连接状态检查 API
GET /api/integrations/connections
Response: {
  connections: [
    {
      provider: 'google_drive',
      connected: true,
      expiresAt: '2024-12-26T10:00:00Z',
      needsReauth: false
    }
  ]
}

// 断开连接 API
DELETE /api/integrations/connections/:provider
```

---

#### BUG-03: KB 选择器样式问题

**问题描述：** AI Ask 页面中知识库选择器边框异常，溢出容器

**修复方案：**

```tsx
// frontend/components/ai-ask/KnowledgeBaseSelector.tsx

export function KnowledgeBaseSelector({
  selectedIds,
  onChange,
}: KnowledgeBaseSelectorProps) {
  return (
    <div className="relative">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              // 修复1: 添加 min-w 和 max-w 防止溢出
              "min-w-[120px] max-w-[300px]",
              // 修复2: 使用 truncate 截断长文本
              "truncate",
              // 修复3: 统一边框样式
              "border border-input hover:bg-accent",
              // 修复4: 移除可能的双边框
              "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-0",
            )}
          >
            <Database className="h-4 w-4 mr-2 shrink-0" />
            <span className="truncate">
              {selectedIds.length === 0
                ? "选择知识库"
                : `已选 ${selectedIds.length} 个`}
            </span>
            <ChevronDown className="h-4 w-4 ml-2 shrink-0" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          className="w-[300px] p-0"
          align="start"
          // 修复5: 确保弹出层不超出视口
          avoidCollisions={true}
          collisionPadding={16}
        >
          {/* 内容区域 */}
          <ScrollArea className="max-h-[300px]">{/* ... */}</ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

---

#### BUG-04: 个人 KB 页面缺少导航

**修复方案：**

```tsx
// frontend/app/library/knowledge-bases/[id]/page.tsx

export default function KnowledgeBaseDetailPage({ params }: Props) {
  const { data: kb } = useKnowledgeBase(params.id);

  return (
    <AppShell
      title={kb?.name || "知识库详情"}
      breadcrumbs={[
        { label: "Library", href: "/library" },
        { label: "知识库", href: "/library/knowledge-bases" },
        { label: kb?.name || "加载中...", href: "#" },
      ]}
      // 添加返回按钮
      actions={
        <Link href="/library/knowledge-bases">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            返回列表
          </Button>
        </Link>
      }
    >
      <KnowledgeBaseDetail id={params.id} />
    </AppShell>
  );
}
```

---

#### BUG-05: 成员权限未强制执行

**修复方案：**

```typescript
// backend/src/modules/ai/rag/guards/kb-permission.guard.ts

@Injectable()
export class KnowledgeBasePermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private kbService: KnowledgeBaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermission = this.reflector.get<KBPermission>(
      'kb-permission',
      context.getHandler(),
    );

    if (!requiredPermission) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    const kbId = request.params.id || request.body.knowledgeBaseId;

    if (!userId || !kbId) {
      throw new UnauthorizedException('Missing user or knowledge base ID');
    }

    const hasPermission = await this.kbService.checkPermission(
      userId,
      kbId,
      requiredPermission,
    );

    if (!hasPermission) {
      throw new ForbiddenException(
        `You don't have ${requiredPermission} permission for this knowledge base`,
      );
    }

    return true;
  }
}

// 权限装饰器
export const RequireKBPermission = (permission: KBPermission) =>
  SetMetadata('kb-permission', permission);

export enum KBPermission {
  VIEW = 'VIEW',
  EDIT = 'EDIT',
  MANAGE = 'MANAGE',
  DELETE = 'DELETE',
}

// Service 层权限检查
// backend/src/modules/ai/rag/services/knowledge-base.service.ts

async checkPermission(
  userId: string,
  kbId: string,
  required: KBPermission,
): Promise<boolean> {
  const kb = await this.prisma.knowledgeBase.findUnique({
    where: { id: kbId },
    include: { members: { where: { userId } } },
  });

  if (!kb) return false;

  // Owner 拥有所有权限
  if (kb.userId === userId) return true;

  // 检查成员权限
  const member = kb.members[0];
  if (!member) return false;

  const permissionHierarchy: Record<KBPermission, number> = {
    VIEW: 1,
    EDIT: 2,
    MANAGE: 3,
    DELETE: 4,
  };

  const rolePermissions: Record<string, KBPermission> = {
    VIEWER: KBPermission.VIEW,
    EDITOR: KBPermission.EDIT,
    ADMIN: KBPermission.MANAGE,
    OWNER: KBPermission.DELETE,
  };

  const memberLevel = permissionHierarchy[rolePermissions[member.role]];
  const requiredLevel = permissionHierarchy[required];

  return memberLevel >= requiredLevel;
}

// 在 Controller 中使用
@Controller('api/rag/knowledge-bases')
@UseGuards(JwtAuthGuard, KnowledgeBasePermissionGuard)
export class KnowledgeBaseController {

  @Get(':id')
  @RequireKBPermission(KBPermission.VIEW)
  async findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Put(':id')
  @RequireKBPermission(KBPermission.EDIT)
  async update(@Param('id') id: string, @Body() dto: UpdateKBDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireKBPermission(KBPermission.DELETE)
  async delete(@Param('id') id: string) {
    return this.service.delete(id);
  }

  @Post(':id/members')
  @RequireKBPermission(KBPermission.MANAGE)
  async addMember(@Param('id') id: string, @Body() dto: AddMemberDto) {
    return this.service.addMember(id, dto);
  }
}
```

---

### 10.2 P1 - 核心功能详细规格

#### 10.2.1 智能文档处理 - 详细设计

**系统架构：**

```
┌─────────────────────────────────────────────────────────────────┐
│                    Document Processing Pipeline                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  Upload  │───▶│  Parser  │───▶│   OCR    │───▶│ Chunking │  │
│  │  Handler │    │  Router  │    │  Engine  │    │  Engine  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│       │              │                │               │          │
│       ▼              ▼                ▼               ▼          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐  │
│  │  S3/R2   │    │ Metadata │    │  Image   │    │  Vector  │  │
│  │ Storage  │    │ Extractor│    │ Storage  │    │ Embedder │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**核心服务设计：**

```typescript
// backend/src/modules/ai/rag/services/document-parser.service.ts

@Injectable()
export class DocumentParserService {
  private readonly logger = new Logger(DocumentParserService.name);

  constructor(
    private ocrService: OCRService,
    private pdfService: PDFService,
    private metadataExtractor: MetadataExtractorService,
  ) {}

  /**
   * 统一文档解析入口
   */
  async parse(file: Express.Multer.File): Promise<ParsedDocument> {
    const mimeType = file.mimetype;
    const parser = this.getParser(mimeType);

    const startTime = Date.now();
    this.logger.log(`Parsing ${file.originalname} (${mimeType})`);

    try {
      const result = await parser.parse(file.buffer);

      // 提取元数据
      const metadata = await this.metadataExtractor.extract(result);

      // 构建目录结构
      const toc = this.buildTableOfContents(result);

      return {
        content: result.text,
        metadata: {
          title: metadata.title || file.originalname,
          author: metadata.author,
          createdAt: metadata.createdAt,
          pageCount: result.pageCount,
          wordCount: this.countWords(result.text),
          language: await this.detectLanguage(result.text),
          ...metadata,
        },
        tableOfContents: toc,
        images: result.images,
        tables: result.tables,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error(`Failed to parse document: ${error.message}`);
      throw new DocumentParseException(error.message);
    }
  }

  private getParser(mimeType: string): IDocumentParser {
    const parsers: Record<string, () => IDocumentParser> = {
      "application/pdf": () => new PDFParser(this.pdfService, this.ocrService),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        () => new DocxParser(),
      "text/markdown": () => new MarkdownParser(),
      "text/plain": () => new PlainTextParser(),
      "text/html": () => new HTMLParser(),
      "image/png": () => new ImageParser(this.ocrService),
      "image/jpeg": () => new ImageParser(this.ocrService),
    };

    const parserFactory = parsers[mimeType];
    if (!parserFactory) {
      throw new UnsupportedFileTypeException(mimeType);
    }

    return parserFactory();
  }

  /**
   * 构建目录结构
   */
  private buildTableOfContents(result: RawParseResult): TOCItem[] {
    const headings = result.headings || [];
    const toc: TOCItem[] = [];
    const stack: TOCItem[] = [];

    for (const heading of headings) {
      const item: TOCItem = {
        level: heading.level,
        title: heading.text,
        pageNumber: heading.pageNumber,
        anchor: this.generateAnchor(heading.text),
        children: [],
      };

      // 根据层级构建树形结构
      while (
        stack.length > 0 &&
        stack[stack.length - 1].level >= heading.level
      ) {
        stack.pop();
      }

      if (stack.length === 0) {
        toc.push(item);
      } else {
        stack[stack.length - 1].children!.push(item);
      }

      stack.push(item);
    }

    return toc;
  }
}

// 解析结果接口
interface ParsedDocument {
  content: string;
  metadata: DocumentMetadata;
  tableOfContents: TOCItem[];
  images: ExtractedImage[];
  tables: ExtractedTable[];
  processingTime: number;
}

interface DocumentMetadata {
  title: string;
  author?: string;
  createdAt?: Date;
  pageCount?: number;
  wordCount: number;
  language: string;
  keywords?: string[];
  abstract?: string;
  doi?: string; // 学术论文
  isbn?: string; // 书籍
  publisher?: string;
}

interface TOCItem {
  level: number;
  title: string;
  pageNumber?: number;
  anchor: string;
  children?: TOCItem[];
}
```

**OCR 服务设计：**

```typescript
// backend/src/modules/ai/rag/services/ocr.service.ts

@Injectable()
export class OCRService {
  private tesseractWorker: Tesseract.Worker | null = null;

  constructor(private configService: ConfigService) {}

  async initialize(): Promise<void> {
    if (this.tesseractWorker) return;

    this.tesseractWorker = await createWorker({
      logger: (m) => this.logger.debug(`Tesseract: ${m.status}`),
    });

    // 支持中英文
    await this.tesseractWorker.loadLanguage("eng+chi_sim");
    await this.tesseractWorker.initialize("eng+chi_sim");
  }

  async recognize(image: Buffer): Promise<OCRResult> {
    await this.initialize();

    const result = await this.tesseractWorker!.recognize(image);

    return {
      text: result.data.text,
      confidence: result.data.confidence,
      blocks:
        result.data.blocks?.map((block) => ({
          text: block.text,
          bbox: block.bbox,
          confidence: block.confidence,
        })) || [],
    };
  }

  /**
   * 批量处理图片（并发控制）
   */
  async recognizeBatch(
    images: Buffer[],
    concurrency = 3,
  ): Promise<OCRResult[]> {
    const results: OCRResult[] = [];
    const queue = [...images];

    const workers = Array(concurrency)
      .fill(null)
      .map(async () => {
        while (queue.length > 0) {
          const image = queue.shift();
          if (image) {
            results.push(await this.recognize(image));
          }
        }
      });

    await Promise.all(workers);
    return results;
  }

  async destroy(): Promise<void> {
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate();
      this.tesseractWorker = null;
    }
  }
}

interface OCRResult {
  text: string;
  confidence: number;
  blocks: OCRBlock[];
}

interface OCRBlock {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
}
```

**批量导入服务：**

```typescript
// backend/src/modules/ai/rag/services/batch-import.service.ts

@Injectable()
export class BatchImportService {
  private readonly MAX_CONCURRENT_FILES = 5;
  private readonly MAX_BATCH_SIZE = 100;

  constructor(
    private documentParser: DocumentParserService,
    private kbDocumentService: KnowledgeBaseDocumentService,
    private eventEmitter: EventEmitter2,
    @InjectQueue('document-processing') private queue: Queue,
  ) {}

  /**
   * 处理 ZIP 包导入
   */
  async importZipArchive(
    kbId: string,
    zipBuffer: Buffer,
    options: ImportOptions,
  ): Promise<BatchImportJob> {
    const jobId = uuid();
    const files = await this.extractZip(zipBuffer);

    if (files.length > this.MAX_BATCH_SIZE) {
      throw new BadRequestException(
        `Maximum ${this.MAX_BATCH_SIZE} files allowed per batch`
      );
    }

    // 创建任务记录
    const job = await this.createJob(jobId, kbId, files.length);

    // 将文件添加到处理队列
    for (const file of files) {
      await this.queue.add('process-document', {
        jobId,
        kbId,
        file: {
          name: file.name,
          buffer: file.buffer.toString('base64'),
          mimeType: file.mimeType,
        },
        options,
      });
    }

    return job;
  }

  /**
   * 处理 CSV 清单导入
   * CSV 格式: url,title,description,tags
   */
  async importFromCSV(
    kbId: string,
    csvContent: string,
    options: ImportOptions,
  ): Promise<BatchImportJob> {
    const records = parse(csvContent, { columns: true });
    const jobId = uuid();

    const job = await this.createJob(jobId, kbId, records.length);

    for (const record of records) {
      await this.queue.add('fetch-and-process', {
        jobId,
        kbId,
        url: record.url,
        metadata: {
          title: record.title,
          description: record.description,
          tags: record.tags?.split(',').map(t => t.trim()),
        },
        options,
      });
    }

    return job;
  }

  /**
   * 获取任务进度
   */
  async getJobProgress(jobId: string): Promise<BatchImportProgress> {
    const job = await this.prisma.batchImportJob.findUnique({
      where: { id: jobId },
      include: {
        items: {
          select: { status: true, error: true },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job ${jobId} not found`);
    }

    const completed = job.items.filter(i => i.status === 'COMPLETED').length;
    const failed = job.items.filter(i => i.status === 'FAILED').length;
    const pending = job.items.filter(i => i.status === 'PENDING').length;

    return {
      jobId,
      status: job.status,
      total: job.items.length,
      completed,
      failed,
      pending,
      progress: Math.round((completed / job.items.length) * 100),
      errors: job.items
        .filter(i => i.error)
        .map(i => ({ file: i.fileName, error: i.error })),
    };
  }

  // 队列处理器
  @Process('process-document')
  async processDocument(job: Job): Promise<void> {
    const { jobId, kbId, file, options } = job.data;

    try {
      // 更新状态为处理中
      await this.updateItemStatus(jobId, file.name, 'PROCESSING');

      // 解析文档
      const buffer = Buffer.from(file.buffer, 'base64');
      const parsed = await this.documentParser.parse({
        buffer,
        originalname: file.name,
        mimetype: file.mimeType,
      } as Express.Multer.File);

      // 创建文档记录
      await this.kbDocumentService.create(kbId, {
        title: parsed.metadata.title,
        content: parsed.content,
        sourceType: 'FILE',
        metadata: parsed.metadata,
      });

      // 更新状态为完成
      await this.updateItemStatus(jobId, file.name, 'COMPLETED');

      // 发送进度事件
      this.eventEmitter.emit('batch-import.progress', { jobId, file: file.name });
    } catch (error) {
      await this.updateItemStatus(jobId, file.name, 'FAILED', error.message);
      this.logger.error(`Failed to process ${file.name}: ${error.message}`);
    }
  }
}

// 数据模型
model BatchImportJob {
  id          String   @id @default(uuid())
  kbId        String
  kb          KnowledgeBase @relation(...)
  status      JobStatus @default(PENDING)
  totalFiles  Int
  createdAt   DateTime @default(now())
  completedAt DateTime?
  items       BatchImportItem[]

  @@map("batch_import_jobs")
}

model BatchImportItem {
  id        String   @id @default(uuid())
  jobId     String
  job       BatchImportJob @relation(...)
  fileName  String
  status    ItemStatus @default(PENDING)
  error     String?
  createdAt DateTime @default(now())

  @@map("batch_import_items")
}

enum JobStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum ItemStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}
```

**前端界面设计：**

```tsx
// frontend/components/knowledge-base/BatchImportDialog.tsx

export function BatchImportDialog({ kbId, open, onClose }: Props) {
  const [step, setStep] = useState<"upload" | "progress" | "complete">(
    "upload",
  );
  const [files, setFiles] = useState<File[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const { progress, isLoading } = useBatchImportProgress(jobId);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量导入文档</DialogTitle>
          <DialogDescription>
            支持拖拽 ZIP 包或多个文件，单次最多 100 个文件
          </DialogDescription>
        </DialogHeader>

        {step === "upload" && (
          <div className="space-y-4">
            {/* 拖拽上传区域 */}
            <Dropzone
              onDrop={setFiles}
              accept={{
                "application/pdf": [".pdf"],
                "application/zip": [".zip"],
                "text/markdown": [".md"],
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                  [".docx"],
              }}
              maxFiles={100}
            >
              <div className="border-2 border-dashed rounded-lg p-8 text-center">
                <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
                <p className="mt-2">拖拽文件到这里，或点击选择</p>
                <p className="text-sm text-muted-foreground">
                  支持 PDF、Word、Markdown、ZIP
                </p>
              </div>
            </Dropzone>

            {/* 文件列表 */}
            {files.length > 0 && (
              <div className="max-h-[200px] overflow-y-auto space-y-2">
                {files.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-2 bg-muted rounded"
                  >
                    <span className="text-sm truncate">{file.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {step === "progress" && progress && (
          <div className="space-y-4">
            <div className="flex justify-between text-sm">
              <span>处理进度</span>
              <span>
                {progress.completed}/{progress.total}
              </span>
            </div>
            <Progress value={progress.progress} />

            {/* 错误列表 */}
            {progress.errors.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  {progress.errors.length} 个文件处理失败
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "upload" && (
            <Button onClick={handleImport} disabled={files.length === 0}>
              开始导入 ({files.length} 个文件)
            </Button>
          )}
          {step === "progress" && (
            <Button variant="outline" disabled>
              处理中...
            </Button>
          )}
          {step === "complete" && <Button onClick={onClose}>完成</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

#### 10.2.2 Notion 集成 - 详细设计

**OAuth 授权流程：**

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│  User   │────▶│ Genesis │────▶│  Notion │────▶│ Genesis │
│ Browser │     │ Frontend│     │  OAuth  │     │ Backend │
└─────────┘     └─────────┘     └─────────┘     └─────────┘
     │               │               │               │
     │  1. Click     │               │               │
     │  "Connect"    │               │               │
     │──────────────▶│               │               │
     │               │ 2. Redirect   │               │
     │               │ to Notion     │               │
     │◀──────────────│──────────────▶│               │
     │                               │               │
     │  3. User grants access        │               │
     │  ─────────────────────────────│               │
     │               │               │               │
     │               │ 4. Callback   │               │
     │               │ with code     │               │
     │◀──────────────│◀──────────────│               │
     │               │               │               │
     │               │ 5. Exchange   │               │
     │               │ for token     │               │
     │               │───────────────│──────────────▶│
     │               │               │               │
     │               │               │ 6. Store token│
     │               │               │◀──────────────│
     │               │               │               │
     │  7. Success   │               │               │
     │◀──────────────│               │               │
```

**Notion 同步服务：**

```typescript
// backend/src/modules/integrations/notion/notion-sync.service.ts

@Injectable()
export class NotionSyncService {
  private readonly client: Client;

  constructor(
    private oauthService: OAuthTokenService,
    private prisma: PrismaService,
    private documentService: KnowledgeBaseDocumentService,
  ) {}

  /**
   * 获取用户的 Notion 工作区信息
   */
  async getWorkspaces(userId: string): Promise<NotionWorkspace[]> {
    const token = await this.oauthService.getValidToken(userId, "notion");
    const client = new Client({ auth: token });

    const response = await client.search({
      filter: { property: "object", value: "database" },
    });

    const workspaces = new Map<string, NotionWorkspace>();

    for (const result of response.results) {
      if (result.object === "database") {
        const workspace = this.extractWorkspace(result);
        if (!workspaces.has(workspace.id)) {
          workspaces.set(workspace.id, workspace);
        }
      }
    }

    return Array.from(workspaces.values());
  }

  /**
   * 获取数据库列表
   */
  async getDatabases(userId: string): Promise<NotionDatabase[]> {
    const token = await this.oauthService.getValidToken(userId, "notion");
    const client = new Client({ auth: token });

    const response = await client.search({
      filter: { property: "object", value: "database" },
    });

    return response.results
      .filter((r): r is DatabaseObjectResponse => r.object === "database")
      .map((db) => ({
        id: db.id,
        title: this.extractTitle(db.title),
        icon: db.icon,
        lastEdited: db.last_edited_time,
        propertyCount: Object.keys(db.properties).length,
      }));
  }

  /**
   * 同步数据库到知识库
   */
  async syncDatabase(
    userId: string,
    kbId: string,
    databaseId: string,
    options: SyncOptions = {},
  ): Promise<SyncResult> {
    const token = await this.oauthService.getValidToken(userId, "notion");
    const client = new Client({ auth: token });

    // 获取同步状态
    const syncState = await this.getSyncState(kbId, databaseId);
    const lastSyncCursor = options.fullSync ? undefined : syncState?.cursor;

    // 查询数据库
    const pages = await this.queryDatabasePages(
      client,
      databaseId,
      lastSyncCursor,
    );

    const result: SyncResult = {
      total: pages.length,
      created: 0,
      updated: 0,
      deleted: 0,
      errors: [],
    };

    for (const page of pages) {
      try {
        await this.syncPage(client, kbId, page, result);
      } catch (error) {
        result.errors.push({ pageId: page.id, error: error.message });
      }
    }

    // 保存同步状态
    await this.saveSyncState(kbId, databaseId, {
      cursor: pages[pages.length - 1]?.id,
      lastSyncAt: new Date(),
    });

    return result;
  }

  /**
   * 同步单个页面
   */
  private async syncPage(
    client: Client,
    kbId: string,
    page: PageObjectResponse,
    result: SyncResult,
  ): Promise<void> {
    // 获取页面完整内容
    const blocks = await this.getPageBlocks(client, page.id);
    const content = this.blocksToMarkdown(blocks);
    const metadata = this.extractPageMetadata(page);

    // 检查是否已存在
    const existing = await this.prisma.knowledgeBaseDocument.findFirst({
      where: {
        knowledgeBaseId: kbId,
        sourceType: "NOTION",
        sourceId: page.id,
      },
    });

    if (existing) {
      // 检查是否需要更新
      if (new Date(page.last_edited_time) > existing.updatedAt) {
        await this.documentService.update(existing.id, {
          title: metadata.title,
          content,
          metadata,
        });
        result.updated++;
      }
    } else {
      // 创建新文档
      await this.documentService.create(kbId, {
        title: metadata.title,
        content,
        sourceType: "NOTION",
        sourceId: page.id,
        sourceUrl: page.url,
        metadata,
      });
      result.created++;
    }
  }

  /**
   * 将 Notion blocks 转换为 Markdown
   */
  private blocksToMarkdown(blocks: BlockObjectResponse[]): string {
    const lines: string[] = [];

    for (const block of blocks) {
      switch (block.type) {
        case "paragraph":
          lines.push(this.richTextToMarkdown(block.paragraph.rich_text));
          break;
        case "heading_1":
          lines.push(`# ${this.richTextToMarkdown(block.heading_1.rich_text)}`);
          break;
        case "heading_2":
          lines.push(
            `## ${this.richTextToMarkdown(block.heading_2.rich_text)}`,
          );
          break;
        case "heading_3":
          lines.push(
            `### ${this.richTextToMarkdown(block.heading_3.rich_text)}`,
          );
          break;
        case "bulleted_list_item":
          lines.push(
            `- ${this.richTextToMarkdown(block.bulleted_list_item.rich_text)}`,
          );
          break;
        case "numbered_list_item":
          lines.push(
            `1. ${this.richTextToMarkdown(block.numbered_list_item.rich_text)}`,
          );
          break;
        case "code":
          lines.push(
            `\`\`\`${block.code.language}\n${this.richTextToMarkdown(block.code.rich_text)}\n\`\`\``,
          );
          break;
        case "quote":
          lines.push(`> ${this.richTextToMarkdown(block.quote.rich_text)}`);
          break;
        case "divider":
          lines.push("---");
          break;
        case "image":
          const url =
            block.image.type === "external"
              ? block.image.external.url
              : block.image.file.url;
          lines.push(`![image](${url})`);
          break;
        case "table":
          // 处理表格...
          break;
      }
    }

    return lines.join("\n\n");
  }

  private richTextToMarkdown(richText: RichTextItemResponse[]): string {
    return richText
      .map((text) => {
        let result = text.plain_text;

        if (text.annotations.bold) result = `**${result}**`;
        if (text.annotations.italic) result = `*${result}*`;
        if (text.annotations.code) result = `\`${result}\``;
        if (text.annotations.strikethrough) result = `~~${result}~~`;
        if (text.href) result = `[${result}](${text.href})`;

        return result;
      })
      .join("");
  }
}

// API 端点
@Controller("api/integrations/notion")
@UseGuards(JwtAuthGuard)
export class NotionController {
  @Get("auth/url")
  getAuthUrl(@CurrentUser() user: User): { url: string } {
    const state = this.notionService.generateState(user.id);
    return {
      url:
        `https://api.notion.com/v1/oauth/authorize?` +
        `client_id=${this.config.notionClientId}&` +
        `redirect_uri=${this.config.notionRedirectUri}&` +
        `response_type=code&` +
        `owner=user&` +
        `state=${state}`,
    };
  }

  @Get("callback")
  async callback(
    @Query("code") code: string,
    @Query("state") state: string,
  ): Promise<void> {
    const userId = this.notionService.verifyState(state);
    await this.notionService.exchangeToken(userId, code);
    // Redirect to success page
  }

  @Get("databases")
  async getDatabases(@CurrentUser() user: User): Promise<NotionDatabase[]> {
    return this.notionService.getDatabases(user.id);
  }

  @Post("sync")
  async sync(
    @CurrentUser() user: User,
    @Body() dto: NotionSyncDto,
  ): Promise<SyncResult> {
    return this.notionService.syncDatabase(
      user.id,
      dto.knowledgeBaseId,
      dto.databaseId,
      dto.options,
    );
  }
}
```

**前端 Notion 连接组件：**

```tsx
// frontend/components/knowledge-base/NotionConnector.tsx

export function NotionConnector({ kbId }: { kbId: string }) {
  const { connection, isLoading } = useNotionConnection();
  const { databases, fetchDatabases } = useNotionDatabases();
  const { syncDatabase, isSyncing, progress } = useNotionSync(kbId);
  const [selectedDb, setSelectedDb] = useState<string | null>(null);

  if (isLoading) return <Skeleton className="h-20" />;

  if (!connection?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <NotionIcon className="h-5 w-5" />
            连接 Notion
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            连接您的 Notion 工作区，将页面和数据库同步到知识库
          </p>
          <Button onClick={handleConnect}>
            <ExternalLink className="h-4 w-4 mr-2" />
            授权连接
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NotionIcon className="h-5 w-5" />
          Notion 同步
          <Badge variant="success">已连接</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 数据库选择 */}
        <div>
          <Label>选择要同步的数据库</Label>
          <Select value={selectedDb} onValueChange={setSelectedDb}>
            <SelectTrigger>
              <SelectValue placeholder="选择数据库" />
            </SelectTrigger>
            <SelectContent>
              {databases.map((db) => (
                <SelectItem key={db.id} value={db.id}>
                  <div className="flex items-center gap-2">
                    {db.icon && <span>{db.icon}</span>}
                    <span>{db.title}</span>
                    <span className="text-xs text-muted-foreground">
                      ({db.propertyCount} 属性)
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* 同步选项 */}
        <div className="flex items-center space-x-2">
          <Checkbox id="fullSync" />
          <Label htmlFor="fullSync">全量同步（忽略增量）</Label>
        </div>

        {/* 同步按钮 */}
        <Button
          onClick={() => syncDatabase(selectedDb!)}
          disabled={!selectedDb || isSyncing}
          className="w-full"
        >
          {isSyncing ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              同步中 ({progress?.completed}/{progress?.total})
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4 mr-2" />
              开始同步
            </>
          )}
        </Button>

        {/* 上次同步信息 */}
        {connection.lastSyncAt && (
          <p className="text-xs text-muted-foreground text-center">
            上次同步: {formatDateTime(connection.lastSyncAt)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

---

#### 10.2.3 增量同步与版本管理 - 详细设计

**版本管理数据模型：**

```prisma
// backend/prisma/schema.prisma

model DocumentVersion {
  id            String     @id @default(uuid())
  documentId    String
  document      KnowledgeBaseDocument @relation(fields: [documentId], references: [id], onDelete: Cascade)
  version       Int        // 版本号，从 1 开始
  contentHash   String     // 内容哈希，用于检测变更
  content       String     @db.Text
  metadata      Json?      // 版本时的元数据快照
  changeType    ChangeType
  changeSummary String?    // AI 生成的变更摘要
  diff          String?    @db.Text  // 与上一版本的差异
  createdAt     DateTime   @default(now())
  createdBy     String?    // 操作人 ID

  @@unique([documentId, version])
  @@index([documentId, version])
  @@index([documentId, createdAt])
  @@map("document_versions")
}

enum ChangeType {
  CREATED
  UPDATED
  RESTORED
  SYNCED    // 外部同步更新
}
```

**版本控制服务：**

```typescript
// backend/src/modules/ai/rag/services/version-control.service.ts

@Injectable()
export class VersionControlService {
  private readonly MAX_VERSIONS = 10; // 保留最近 10 个版本

  constructor(
    private prisma: PrismaService,
    private aiService: AIOrchestrationService,
  ) {}

  /**
   * 创建新版本
   */
  async createVersion(
    documentId: string,
    content: string,
    changeType: ChangeType,
    createdBy?: string,
  ): Promise<DocumentVersion> {
    const contentHash = this.hashContent(content);

    // 获取最新版本
    const latestVersion = await this.prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { version: "desc" },
    });

    // 如果内容相同，不创建新版本
    if (latestVersion && latestVersion.contentHash === contentHash) {
      return latestVersion;
    }

    const newVersion = latestVersion ? latestVersion.version + 1 : 1;

    // 计算差异
    let diff: string | undefined;
    if (latestVersion) {
      diff = this.computeDiff(latestVersion.content, content);
    }

    // 生成变更摘要
    let changeSummary: string | undefined;
    if (diff && diff.length > 0) {
      changeSummary = await this.generateChangeSummary(diff);
    }

    // 创建版本
    const version = await this.prisma.documentVersion.create({
      data: {
        documentId,
        version: newVersion,
        content,
        contentHash,
        changeType,
        diff,
        changeSummary,
        createdBy,
      },
    });

    // 清理旧版本
    await this.pruneOldVersions(documentId);

    return version;
  }

  /**
   * 获取版本历史
   */
  async getVersionHistory(
    documentId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<VersionHistoryItem[]> {
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { version: "desc" },
      take: options.limit || 10,
      skip: options.offset || 0,
      select: {
        id: true,
        version: true,
        changeType: true,
        changeSummary: true,
        createdAt: true,
        createdBy: true,
      },
    });

    return versions;
  }

  /**
   * 对比两个版本
   */
  async compareVersions(
    documentId: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<VersionComparison> {
    const [from, to] = await Promise.all([
      this.prisma.documentVersion.findUnique({
        where: { documentId_version: { documentId, version: fromVersion } },
      }),
      this.prisma.documentVersion.findUnique({
        where: { documentId_version: { documentId, version: toVersion } },
      }),
    ]);

    if (!from || !to) {
      throw new NotFoundException("Version not found");
    }

    const diff = this.computeDiff(from.content, to.content);
    const diffStats = this.computeDiffStats(diff);

    return {
      fromVersion,
      toVersion,
      diff,
      stats: diffStats,
      summary: await this.generateComparisonSummary(diff),
    };
  }

  /**
   * 回滚到指定版本
   */
  async rollbackToVersion(
    documentId: string,
    targetVersion: number,
    userId: string,
  ): Promise<KnowledgeBaseDocument> {
    const version = await this.prisma.documentVersion.findUnique({
      where: { documentId_version: { documentId, version: targetVersion } },
    });

    if (!version) {
      throw new NotFoundException(`Version ${targetVersion} not found`);
    }

    // 更新文档内容
    const document = await this.prisma.knowledgeBaseDocument.update({
      where: { id: documentId },
      data: { content: version.content },
    });

    // 创建回滚版本记录
    await this.createVersion(
      documentId,
      version.content,
      ChangeType.RESTORED,
      userId,
    );

    return document;
  }

  /**
   * 计算内容差异（行级别）
   */
  private computeDiff(oldContent: string, newContent: string): string {
    const oldLines = oldContent.split("\n");
    const newLines = newContent.split("\n");

    // 使用 diff-match-patch 或 jsdiff
    const changes = diffLines(oldContent, newContent);

    return changes
      .map((change) => {
        const prefix = change.added ? "+" : change.removed ? "-" : " ";
        return change.value
          .split("\n")
          .filter((line) => line.length > 0)
          .map((line) => `${prefix}${line}`)
          .join("\n");
      })
      .join("\n");
  }

  /**
   * AI 生成变更摘要
   */
  private async generateChangeSummary(diff: string): Promise<string> {
    const response = await this.aiService.chat({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "你是一个文档变更分析助手。请用简洁的中文描述以下变更的主要内容，不超过 50 字。",
        },
        {
          role: "user",
          content: `变更内容：\n${diff.slice(0, 2000)}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 100,
    });

    return response.content;
  }

  /**
   * 清理超过保留数量的旧版本
   */
  private async pruneOldVersions(documentId: string): Promise<void> {
    const versions = await this.prisma.documentVersion.findMany({
      where: { documentId },
      orderBy: { version: "desc" },
      select: { id: true },
    });

    if (versions.length > this.MAX_VERSIONS) {
      const toDelete = versions.slice(this.MAX_VERSIONS);
      await this.prisma.documentVersion.deleteMany({
        where: { id: { in: toDelete.map((v) => v.id) } },
      });
    }
  }

  private hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex");
  }
}

interface VersionHistoryItem {
  id: string;
  version: number;
  changeType: ChangeType;
  changeSummary?: string;
  createdAt: Date;
  createdBy?: string;
}

interface VersionComparison {
  fromVersion: number;
  toVersion: number;
  diff: string;
  stats: { added: number; removed: number; unchanged: number };
  summary: string;
}
```

**增量同步服务：**

```typescript
// backend/src/modules/ai/rag/services/incremental-sync.service.ts

@Injectable()
export class IncrementalSyncService {
  constructor(
    private prisma: PrismaService,
    private versionService: VersionControlService,
    private embeddingService: EmbeddingService,
    private chunkingService: ChunkingService,
  ) {}

  /**
   * 增量更新文档
   * 只重新处理变更的部分
   */
  async incrementalUpdate(
    documentId: string,
    newContent: string,
    userId?: string,
  ): Promise<IncrementalUpdateResult> {
    const document = await this.prisma.knowledgeBaseDocument.findUnique({
      where: { id: documentId },
      include: { parentChunks: { include: { children: true } } },
    });

    if (!document) {
      throw new NotFoundException("Document not found");
    }

    const oldContent = document.content;
    const oldHash = this.hashContent(oldContent);
    const newHash = this.hashContent(newContent);

    // 内容未变化
    if (oldHash === newHash) {
      return {
        unchanged: true,
        chunksUpdated: 0,
        chunksCreated: 0,
        chunksDeleted: 0,
      };
    }

    // 创建版本
    await this.versionService.createVersion(
      documentId,
      newContent,
      ChangeType.UPDATED,
      userId,
    );

    // 分块对比
    const oldChunks = this.splitIntoChunks(oldContent);
    const newChunks = this.splitIntoChunks(newContent);

    const { added, removed, unchanged } = this.diffChunks(oldChunks, newChunks);

    const result: IncrementalUpdateResult = {
      unchanged: false,
      chunksUpdated: 0,
      chunksCreated: added.length,
      chunksDeleted: removed.length,
    };

    // 删除已移除的 chunks
    if (removed.length > 0) {
      await this.deleteChunks(documentId, removed);
    }

    // 添加新的 chunks
    if (added.length > 0) {
      await this.addChunks(documentId, added);
    }

    // 更新文档内容
    await this.prisma.knowledgeBaseDocument.update({
      where: { id: documentId },
      data: { content: newContent },
    });

    return result;
  }

  /**
   * 分块对比算法
   */
  private diffChunks(
    oldChunks: ChunkInfo[],
    newChunks: ChunkInfo[],
  ): { added: ChunkInfo[]; removed: ChunkInfo[]; unchanged: ChunkInfo[] } {
    const oldHashes = new Map(oldChunks.map((c) => [c.hash, c]));
    const newHashes = new Map(newChunks.map((c) => [c.hash, c]));

    const added: ChunkInfo[] = [];
    const removed: ChunkInfo[] = [];
    const unchanged: ChunkInfo[] = [];

    // 找出新增的 chunks
    for (const [hash, chunk] of newHashes) {
      if (!oldHashes.has(hash)) {
        added.push(chunk);
      } else {
        unchanged.push(chunk);
      }
    }

    // 找出删除的 chunks
    for (const [hash, chunk] of oldHashes) {
      if (!newHashes.has(hash)) {
        removed.push(chunk);
      }
    }

    return { added, removed, unchanged };
  }

  /**
   * 删除 chunks 及其向量
   */
  private async deleteChunks(
    documentId: string,
    chunks: ChunkInfo[],
  ): Promise<void> {
    const hashes = chunks.map((c) => c.hash);

    // 删除子 chunks 和向量
    await this.prisma.$executeRaw`
      DELETE FROM child_chunks
      WHERE parent_chunk_id IN (
        SELECT id FROM parent_chunks
        WHERE document_id = ${documentId}
        AND content_hash = ANY(${hashes}::text[])
      )
    `;

    // 删除父 chunks
    await this.prisma.parentChunk.deleteMany({
      where: {
        documentId,
        contentHash: { in: hashes },
      },
    });
  }

  /**
   * 添加新 chunks 并生成向量
   */
  private async addChunks(
    documentId: string,
    chunks: ChunkInfo[],
  ): Promise<void> {
    const document = await this.prisma.knowledgeBaseDocument.findUnique({
      where: { id: documentId },
      include: { knowledgeBase: true },
    });

    for (const chunk of chunks) {
      // 创建父 chunk
      const parentChunk = await this.prisma.parentChunk.create({
        data: {
          documentId,
          content: chunk.content,
          contentHash: chunk.hash,
          startPosition: chunk.position,
          endPosition: chunk.position + chunk.content.length,
        },
      });

      // 分割为子 chunks
      const childContents = this.chunkingService.splitParentChunk(
        chunk.content,
      );

      for (let i = 0; i < childContents.length; i++) {
        const childContent = childContents[i];

        // 生成向量
        const embedding = await this.embeddingService.embed(
          childContent,
          document!.knowledgeBase.embeddingModel,
        );

        // 创建子 chunk
        await this.prisma.childChunk.create({
          data: {
            parentChunkId: parentChunk.id,
            content: childContent,
            chunkIndex: i,
            embedding: embedding,
          },
        });
      }
    }
  }

  private splitIntoChunks(content: string): ChunkInfo[] {
    // 使用段落分割
    const paragraphs = content.split(/\n\n+/);
    const chunks: ChunkInfo[] = [];
    let position = 0;

    for (const para of paragraphs) {
      if (para.trim().length > 0) {
        chunks.push({
          content: para,
          hash: this.hashContent(para),
          position,
        });
      }
      position += para.length + 2; // +2 for \n\n
    }

    return chunks;
  }

  private hashContent(content: string): string {
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }
}

interface ChunkInfo {
  content: string;
  hash: string;
  position: number;
}

interface IncrementalUpdateResult {
  unchanged: boolean;
  chunksUpdated: number;
  chunksCreated: number;
  chunksDeleted: number;
}
```

---

## 变更历史

| 版本 | 日期       | 作者    | 变更内容                          |
| ---- | ---------- | ------- | --------------------------------- |
| 1.0  | 2024-12-26 | PM Team | 初始版本                          |
| 1.1  | 2024-12-27 | PM Team | 添加 P0/P1 详细设计规格，技术方案 |

---

_此 PRD 将根据用户反馈和技术评审持续更新_
