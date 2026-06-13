# Blog Collection System Documentation

## 概述

GenesisPod 的 Blog Collection System 是一个完整的自动化博客采集和管理系统，可以从全球知名企业和分析机构的博客中自动采集、解析、存储和展示最新内容。

## 系统架构

### 核心组件

```
┌─────────────────────────────────────────────────────────────┐
│              Blog Collection System                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Data Sources Configuration                             │
│     └─ 预定义的 12+ 个博客数据源                              │
│     └─ 支持 RSS Feed 和网页爬虫两种采集方式                    │
│                                                             │
│  2. Collection Services                                    │
│     ├─ RSS Feed Collector (RSS 订阅采集)                     │
│     ├─ Web Scraper (网页爬虫采集)                             │
│     └─ Blog Collection Service (主采集服务)                   │
│                                                             │
│  3. Scheduler System                                       │
│     ├─ Cron-based Scheduler (定时任务调度)                    │
│     ├─ Task Queue Management (任务队列管理)                    │
│     └─ Retry Logic (失败重试机制)                             │
│                                                             │
│  4. Data Storage (Prisma ORM)                              │
│     ├─ CollectedReport (采集的报告/博客)                       │
│     ├─ ReportPublisher (发布商/数据源)                        │
│     └─ User Collections (用户收藏)                            │
│                                                             │
│  5. API Layer                                              │
│     ├─ /api/v1/blog/sources (数据源管理)                      │
│     ├─ /api/v1/blog/collect (手动触发采集)                    │
│     ├─ /api/v1/blog/posts (博客文章查询)                      │
│     ├─ /api/v1/blog/scheduler (采集器配置)                    │
│     └─ /api/v1/blog/stats (采集统计)                          │
│                                                             │
│  6. Frontend UI                                            │
│     ├─ Blog Collection Manager (采集管理界面)                 │
│     ├─ Blog List View (列表展示)                             │
│     ├─ Blog Detail View (详情展示)                           │
│     └─ Search & Filter (搜索和筛选)                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 配置的数据源

### 企业博客 (Enterprise - 5 个)

| 名称      | 类型          | URL                           | RSS Feed |
| --------- | ------------- | ----------------------------- | -------- |
| NVIDIA    | GPU/AI 芯片   | https://blogs.nvidia.com      | 支持     |
| Broadcom  | 芯片/基础设施 | https://www.broadcom.com/blog | 支持     |
| Google AI | AI/机器学习   | https://ai.googleblog.com     | 支持     |
| Fortinet  | 网络安全      | https://www.fortinet.com/blog | 支持     |
| Cisco     | 网络/基础设施 | https://blogs.cisco.com       | 支持     |

### 分析机构 (Analyst - 4 个)

| 名称         | 类型        | URL                          | RSS Feed |
| ------------ | ----------- | ---------------------------- | -------- |
| SemiAnalysis | 芯片分析    | https://www.semianalysis.com | 支持     |
| OPECHAI      | AI 市场分析 | https://www.opechai.org      | 支持     |
| Gartner      | IT 咨询     | https://www.gartner.com      | 部分支持 |
| IDC          | 市场研究    | https://blogs.idc.com        | 支持     |

### 研究机构 (Research - 4 个)

| 名称      | 类型    | URL                            | RSS Feed |
| --------- | ------- | ------------------------------ | -------- |
| OpenAI    | AI 研究 | https://openai.com/blog        | 暂无     |
| Anthropic | AI 研究 | https://www.anthropic.com/news | 暂无     |
| DeepMind  | AI 研究 | https://deepmind.google/blog   | 支持     |
| Meta AI   | AI 研究 | https://ai.meta.com/blog       | 暂无     |

## 后端实现

### 1. 采集服务 (`blog-collection.service.ts`)

#### 主要类

**BlogCollectionService**

- `collectFromSource(source: BlogSource)` - 从单个数据源采集
- `collectFromAllSources()` - 从所有数据源采集
- `saveBlogPost(post: BlogPost)` - 保存单篇博客
- `saveBlogPosts(posts: BlogPost[])` - 批量保存博客
- `runFullCollection()` - 执行完整的采集流程

**RSSCollector**

- 专门处理 RSS Feed 的采集
- 支持自动重试和错误处理

**WebScraperCollector**

- 使用 cheerio 解析 HTML
- 智能提取文章标题、内容、作者等信息

#### 数据模型

```typescript
interface BlogPost {
  title: string;
  url: string;
  content: string;
  excerpt?: string;
  publishedAt: Date;
  author?: string;
  category?: string;
  tags?: string[];
  imageUrl?: string;
  sourceId: string;
  sourceName: string;
}
```

### 2. 调度系统 (`blog-scheduler.service.ts`)

#### 主要功能

- **Cron 表达式支持** - 灵活的定时计划

  ```
  0 */6 * * *     // 每 6 小时采集一次
  0 0 * * *       // 每天午夜采集一次
  0 9,18 * * *    // 每天上午 9 点和下午 6 点采集
  ```

- **并发控制** - 限制同时采集数，避免过载
- **重试机制** - 失败自动重试（可配置）
- **任务监控** - 跟踪每个采集任务的状态

#### 配置示例

```typescript
const config = {
  enabled: true,
  cronExpression: "0 */6 * * *", // 每 6 小时
  maxConcurrent: 3, // 最多同时采集 3 个源
  retryAttempts: 2, // 失败重试 2 次
  retryDelayMs: 5000, // 重试延迟 5 秒
};
```

### 3. API 端点 (`blog-collection.controller.ts`)

#### 数据源管理

```bash
# 获取所有数据源
GET /api/v1/blog/sources

# 获取特定数据源详情
GET /api/v1/blog/sources/{id}
```

#### 采集控制

```bash
# 手动触发全量采集
POST /api/v1/blog/collect
Body: {}

# 手动采集特定源
POST /api/v1/blog/collect
Body: { "sourceId": "nvidia" }
```

#### 采集器管理

```bash
# 获取采集器状态
GET /api/v1/blog/scheduler/status

# 更新采集器配置
PUT /api/v1/blog/scheduler/config
Body: {
  "enabled": true,
  "cronExpression": "0 */6 * * *",
  "maxConcurrent": 3
}
```

#### 博客文章查询

```bash
# 获取博客文章列表（分页）
GET /api/v1/blog/posts?limit=20&offset=0&sortBy=publishedAt

# 过滤特定源的文章
GET /api/v1/blog/posts?sourceId=nvidia&limit=20

# 按分类过滤
GET /api/v1/blog/posts?category=AI&limit=20

# 搜索博客文章
GET /api/v1/blog/search?q=machine+learning&limit=20

# 获取文章详情
GET /api/v1/blog/posts/{id}

# 保存（收藏）文章
POST /api/v1/blog/posts/{id}/save
Body: { "userId": "user123" }

# 点赞文章
POST /api/v1/blog/posts/{id}/upvote
```

#### 统计信息

```bash
# 获取采集统计
GET /api/v1/blog/stats
```

响应示例：

```json
{
  "success": true,
  "data": {
    "totalPosts": 1250,
    "byCategory": [
      { "category": "AI", "_count": 450 },
      { "category": "Security", "_count": 320 }
    ],
    "byPublisher": [
      { "publisherName": "NVIDIA", "_count": 180 },
      { "publisherName": "Google AI", "_count": 145 }
    ],
    "collectionStatus": "active"
  }
}
```

## 前端实现

### BlogCollectionManager 组件

位置：`frontend/components/features/BlogCollectionManager.tsx`

#### 功能

1. **数据源管理**
   - 显示所有配置的博客数据源
   - 显示每个源的最后采集时间
   - 支持单个源的手动采集

2. **采集控制**
   - 全量采集触发按钮
   - 刷新数据
   - 查看采集器状态

3. **采集器配置**
   - 修改 Cron 表达式
   - 调整并发数
   - 启用/禁用采集器

4. **实时监控**
   - 显示活跃采集任务
   - 任务进度显示
   - 错误信息展示

5. **统计信息**
   - 总采集文章数
   - 按分类统计
   - 按数据源统计
   - 最近采集的文章

#### 使用示例

```typescript
import { BlogCollectionManager } from '@/components/features/BlogCollectionManager';

export default function AdminPanel() {
  return (
    <div className="p-6">
      <BlogCollectionManager
        apiBaseUrl="/api/v1/blog"
        autoRefresh={true}
        refreshInterval={30000}  // 每 30 秒刷新一次
      />
    </div>
  );
}
```

## 数据库集成

### Prisma Schema 更新

已在 `schema.prisma` 中添加：

```prisma
model ReportPublisher {
  id              String
  name            String              @unique
  displayName     String
  category        String              // "enterprise", "analyst", "research"
  rssFeeds        Json                @default("[]")
  collectedReports CollectedReport[]
}

model CollectedReport {
  id              String
  title           String
  sourceUrl       String
  publisherName   String
  publishedAt     DateTime
  reportType      String              // "blog-post" for blog content
  category        String
  documentContent String              @db.Text
  aiSummary       String              @db.Text
  sourceType      String              // "blog"
  viewCount       Int                 @default(0)
  saveCount       Int                 @default(0)
  upvoteCount     Int                 @default(0)
  metadata        Json
  publisher       ReportPublisher?
}
```

## 初始化和启动

### 在应用程序启动时初始化采集器

```typescript
// src/main.ts 或 src/app.ts
import { initBlogScheduler } from "./services/blog-scheduler.service";

async function bootstrap() {
  // ... 其他初始化代码 ...

  // 启动博客采集调度器
  await initBlogScheduler({
    enabled: true,
    cronExpression: "0 */6 * * *", // 每 6 小时采集一次
    maxConcurrent: 3,
    retryAttempts: 2,
  });

  // ... 启动应用 ...
}

bootstrap();
```

### 注册 API 路由

```typescript
// src/app.ts
import blogCollectionRouter from "./routes/blog-collection.controller";

app.use("/api/v1/blog", blogCollectionRouter);
```

## 工作流程

### 自动采集流程

```
1. 调度器根据 Cron 表达式触发采集任务
   ↓
2. 从所有配置的数据源列表中获取源信息
   ↓
3. 按 maxConcurrent 将源分批处理
   ↓
4. 对每个源执行采集：
   a. 优先尝试 RSS Feed 采集
   b. 如果 RSS 失败，尝试网页爬虫采集
   c. 提取文章标题、内容、发布日期等
   ↓
5. 对采集的文章进行处理：
   a. 检查是否已存在（避免重复）
   b. 保存或更新发布商信息
   c. 存储文章到数据库
   ↓
6. 记录采集统计信息
   ↓
7. 完成：等待下次调度时刻
```

### 手动采集流程

```
用户点击 "采集" 按钮
   ↓
调用 POST /api/v1/blog/collect 接口
   ↓
服务器触发即时采集任务
   ↓
返回采集状态
   ↓
前端定期轮询获取任务状态（通过 WebSocket 或 polling）
```

## 错误处理和重试

系统具有以下错误处理机制：

1. **RSS Feed 超时**
   - 超时时间：10 秒
   - 失败重试：自动重试 2 次
   - 重试延迟：5 秒

2. **网络错误**
   - 自动降级到备选采集方法
   - 详细的日志记录

3. **数据库错误**
   - 事务回滚
   - 错误日志记录

4. **并发控制**
   - 防止过多并发请求
   - 队列管理

## 性能优化

1. **批量采集**
   - 分批处理数据源，避免同时采集过多源
   - 可配置的并发数

2. **去重机制**
   - 采集前检查 URL 是否已存在
   - 避免数据库重复存储

3. **缓存策略**
   - Redis 缓存最近采集的文章
   - 减少数据库查询

4. **索引优化**
   - 在 publishedAt、category、publisherName 等字段建立索引
   - 加速查询

## 监控和日志

所有采集活动都会详细记录：

```
[2024-11-18T10:30:00Z] Starting collection cycle: cycle-1234567890
[2024-11-18T10:30:15Z] Collecting from NVIDIA... (Task: nvidia-1234567890)
[2024-11-18T10:30:45Z] ✓ NVIDIA: 25 collected, 23 saved
[2024-11-18T10:31:00Z] Collecting from Google AI...
[2024-11-18T10:31:30Z] ✓ Google AI: 18 collected, 18 saved
...
[2024-11-18T10:35:45Z] Collection cycle completed in 345000ms:
  - Total posts collected: 250
  - Total posts saved: 245
  - Total failures: 0
```

## 最佳实践

1. **采集频率设置**
   - 高流量源（如 NVIDIA、Google AI）：每 6 小时采集一次
   - 中等流量源（如分析机构）：每 12 小时采集一次
   - 低流量源（研究机构）：每天采集一次

2. **并发配置**
   - 根据服务器资源调整 `maxConcurrent`
   - 推荐值：2-5

3. **重试策略**
   - 对于重要数据源增加 `retryAttempts`
   - 对于稳定数据源可以减少重试

4. **监控告警**
   - 设置采集成功率告警
   - 监控采集耗时

## 扩展建议

1. **AI 摘要生成**
   - 集成 OpenAI/Claude API 生成文章摘要
   - 自动分类和标签生成

2. **情感分析**
   - 对文章内容进行情感分析
   - 用于趋势判断

3. **关键词提取**
   - 自动提取文章关键词
   - 用于聚类和推荐

4. **用户订阅**
   - 允许用户订阅特定来源或关键词
   - 推送通知

5. **Web UI 集成**
   - 在 Reports TAB 中集成博客文章展示
   - 支持搜索、筛选、收藏

## 故障排查

### 采集不工作

1. 检查调度器状态

   ```bash
   curl http://localhost:4000/api/v1/blog/scheduler/status
   ```

2. 检查日志

   ```bash
   tail -f logs/blog-collection.log
   ```

3. 手动触发采集
   ```bash
   curl -X POST http://localhost:4000/api/v1/blog/collect
   ```

### RSS Feed 解析失败

1. 验证 RSS URL 是否正确
2. 检查网络连接
3. 尝试切换到网页爬虫采集

### 数据库错误

1. 检查数据库连接
2. 运行 Prisma 迁移
   ```bash
   npx prisma migrate deploy
   ```
3. 检查数据库磁盘空间

## 许可证

MIT

## 更新日志

### v1.0.0 (2024-11-18)

- 初始版本发布
- 支持 12+ 个博客数据源
- RSS Feed 和网页爬虫采集
- 定时任务调度
- 管理后台 UI
- 完整的 API 端点
