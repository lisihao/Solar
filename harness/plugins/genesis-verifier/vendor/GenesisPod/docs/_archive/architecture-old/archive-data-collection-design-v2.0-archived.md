# 数据采集系统重新设计方案

## Product Requirements Document (PRD)

**版本**: 2.0
**日期**: 2025-11-23
**产品经理**: Senior PM
**状态**: 设计中

---

## 一、背景与目标

### 1.1 当前问题

- 数据采集配置与Explore内容分类不一致
- 每个资源类型只能配置单一数据源
- 缺乏统一的多源管理能力
- 配置页面结构不够清晰

### 1.2 设计目标

✅ 数据采集与Explore内容类型完全对应
✅ 支持每个类别配置多个数据源
✅ 统一的采集配置管理界面
✅ 灵活的数据源添加和配置能力

---

## 二、产品架构设计

### 2.1 内容分类体系

基于现有 `ResourceType` enum，数据采集按以下类别组织：

#### 📚 学术研究类

**PAPER (论文)**

- arXiv (现有)
- Semantic Scholar
- Papers with Code
- ACL Anthology
- IEEE Xplore
- 支持自定义添加

**REPORT (研究报告)**

- OpenAI Research
- DeepMind Research
- Google AI Research
- Microsoft Research
- Meta AI Research
- 各大机构白皮书

#### 💼 产业动态类

**BLOG (企业博客)**

- Google AI Blog
- Meta AI Blog
- OpenAI Blog
- DeepMind Blog
- Anthropic Blog
- Microsoft AI Blog
- 支持自定义博客RSS

**NEWS (行业新闻)**

- TechCrunch AI
- The Verge
- MIT Technology Review
- Wired AI
- VentureBeat AI

#### 💻 开发者资源类

**PROJECT (开源项目)**

- GitHub Trending (现有)
- GitHub Awesome Lists
- GitLab Trending
- Hugging Face Models
- Papers with Code Repos

#### 🎥 视频内容类

**YOUTUBE_VIDEO (视频)**

- YouTube技术频道
- 会议视频
- 教程系列

#### 📡 其他类

**RSS (RSS订阅)**

- 自定义RSS源

**EVENT (技术事件)**

- 会议通知
- Webinar
- 线上活动

---

## 三、数据模型设计

### 3.1 现有数据模型（已支持）

```prisma
enum ResourceType {
  PAPER
  BLOG
  REPORT
  YOUTUBE_VIDEO
  NEWS
  PROJECT
  EVENT
  RSS
}

model DataSource {
  id          String       @id @default(uuid())
  name        String       // 数据源名称，如 "arXiv", "Google AI Blog"
  type        DataSourceType
  category    ResourceType // 对应的资源类型
  baseUrl     String
  // ... 其他配置
}
```

### 3.2 数据源配置层次

```
ResourceType (类别)
  └── DataSource 1 (数据源)
      ├── 采集配置
      ├── 去重规则
      └── 调度设置
  └── DataSource 2
  └── DataSource 3
  ...
```

---

## 四、UI/UX设计方案

### 4.1 数据采集配置页面结构

```
┌─────────────────────────────────────────────────────────┐
│  Data Collection Configuration                           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  📚 Papers (论文)                         [+ Add Source]│
│  ├─ 🔵 arXiv                    [Active] [Edit] [⚙]     │
│  │   Last sync: 2 hours ago | 150 items collected       │
│  ├─ 🔵 Semantic Scholar         [Active] [Edit] [⚙]     │
│  │   Last sync: 1 hour ago | 80 items collected         │
│  └─ ⚪ Papers with Code         [Paused] [Edit] [⚙]     │
│                                                          │
│  💼 Blogs (企业博客)                      [+ Add Source]│
│  ├─ 🔵 Google AI Blog           [Active] [Edit] [⚙]     │
│  │   Last sync: 30 min ago | 5 items collected          │
│  ├─ 🔵 OpenAI Blog              [Active] [Edit] [⚙]     │
│  │   Last sync: 1 hour ago | 3 items collected          │
│  ├─ 🔵 Meta AI Blog             [Active] [Edit] [⚙]     │
│  │   Last sync: 45 min ago | 7 items collected          │
│  └─ 🔵 DeepMind Blog            [Active] [Edit] [⚙]     │
│                                                          │
│  📊 Reports (研究报告)                    [+ Add Source]│
│  └─ [No sources configured]                             │
│                                                          │
│  💻 Projects (开源项目)                   [+ Add Source]│
│  ├─ 🔵 GitHub Trending          [Active] [Edit] [⚙]     │
│  └─ ⚪ Hugging Face Models      [Paused] [Edit] [⚙]     │
│                                                          │
│  🎥 Videos (视频内容)                     [+ Add Source]│
│  📰 News (行业新闻)                       [+ Add Source]│
│  📡 RSS Feeds (RSS订阅)                   [+ Add Source]│
│  🎪 Events (技术事件)                     [+ Add Source]│
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### 4.2 数据源配置模态框

```
┌──────────────────────────────────────────────┐
│  Configure Data Source - Google AI Blog       │
├──────────────────────────────────────────────┤
│                                               │
│  Basic Information                            │
│  ┌──────────────────────────────────────────┐│
│  │ Name: Google AI Blog                     ││
│  │ Category: BLOG                           ││
│  │ Type: RSS                                ││
│  └──────────────────────────────────────────┘│
│                                               │
│  Source Configuration                         │
│  ┌──────────────────────────────────────────┐│
│  │ RSS URL: https://blog.google/technology/ ││
│  │           technology-areas/ai/rss/       ││
│  │                                          ││
│  │ Fallback URL: (optional)                ││
│  └──────────────────────────────────────────┘│
│                                               │
│  Collection Settings                          │
│  ┌──────────────────────────────────────────┐│
│  │ Schedule: Daily at 9:00 AM              ││
│  │ Max items per run: 50                   ││
│  │ Min quality score: 7.0                  ││
│  └──────────────────────────────────────────┘│
│                                               │
│  Deduplication Rules                          │
│  ☑ Check URL                                  │
│  ☑ Check title similarity (threshold: 85%)   │
│  ☐ Check content hash                         │
│                                               │
│  [Cancel]                    [Save & Test]    │
└──────────────────────────────────────────────┘
```

---

## 五、预设数据源配置

### 5.1 Papers (论文)

| 数据源名称       | Type    | URL/API                                  | 默认状态 |
| ---------------- | ------- | ---------------------------------------- | -------- |
| arXiv            | API     | http://export.arxiv.org/api/query        | Active   |
| Semantic Scholar | API     | https://api.semanticscholar.org/graph/v1 | Inactive |
| Papers with Code | Scraper | https://paperswithcode.com               | Inactive |

### 5.2 Blogs (企业博客)

| 数据源名称        | Type | URL                                    | 默认状态 |
| ----------------- | ---- | -------------------------------------- | -------- |
| Google AI Blog    | RSS  | https://blog.google/technology/ai/rss/ | Active   |
| OpenAI Blog       | RSS  | https://openai.com/blog/rss/           | Active   |
| Meta AI Blog      | RSS  | https://ai.meta.com/blog/rss/          | Active   |
| DeepMind Blog     | RSS  | https://deepmind.google/blog/rss.xml   | Active   |
| Anthropic Blog    | RSS  | https://www.anthropic.com/news/rss     | Inactive |
| Microsoft AI Blog | RSS  | https://blogs.microsoft.com/ai/feed/   | Inactive |

### 5.3 Projects (开源项目)

| 数据源名称      | Type    | URL                         | 默认状态 |
| --------------- | ------- | --------------------------- | -------- |
| GitHub Trending | Scraper | https://github.com/trending | Active   |
| Hugging Face    | API     | https://huggingface.co/api  | Inactive |

### 5.4 News (行业新闻)

| 数据源名称         | Type | URL                                                                 | 默认状态 |
| ------------------ | ---- | ------------------------------------------------------------------- | -------- |
| TechCrunch AI      | RSS  | https://techcrunch.com/category/artificial-intelligence/feed/       | Inactive |
| MIT Tech Review AI | RSS  | https://www.technologyreview.com/topic/artificial-intelligence/feed | Inactive |

---

## 六、实施计划

### Phase 1: 数据预设和UI重构 (Week 1)

- [x] 创建预设数据源配置seed脚本
- [ ] 重构数据采集配置页面UI
- [ ] 实现分类折叠/展开功能
- [ ] 实现"添加数据源"功能

### Phase 2: 多源采集支持 (Week 2)

- [ ] 更新采集任务调度器支持多源
- [ ] 实现数据源优先级管理
- [ ] 实现数据源健康检查

### Phase 3: 高级功能 (Week 3)

- [ ] 数据源性能监控
- [ ] 智能采集频率调整
- [ ] 数据源推荐系统

---

## 七、成功指标

- ✅ 支持至少6个资源类别
- ✅ 每个类别至少配置3个数据源
- ✅ 数据源配置时间 < 2分钟
- ✅ UI响应时间 < 500ms
- ✅ 数据采集成功率 > 95%

---

## 八、风险与缓解

| 风险          | 影响 | 缓解措施                   |
| ------------- | ---- | -------------------------- |
| 现有数据迁移  | 高   | 编写迁移脚本，保留现有配置 |
| 第三方API限流 | 中   | 实现智能限流和重试机制     |
| 用户学习成本  | 低   | 提供引导教程和预设配置     |

---

## 九、附录

### 9.1 技术栈

- Frontend: Next.js, TypeScript, Tailwind CSS
- Backend: NestJS, Prisma, PostgreSQL
- Scheduling: node-cron

### 9.2 相关文档

- [数据采集API文档](./data-collection-api.md)
- [数据模型设计](../data-management/data-model.md)
