# 专题研究 (Topic Research) PRD v1.0

> **Version**: 1.0
> **Author**: PM Agent
> **Created**: 2026-01-11
> **Updated**: 2026-01-11
> **Status**: Draft

---

## Document Information

| Item             | Value                              |
| ---------------- | ---------------------------------- |
| Module           | topic-research                     |
| English Name     | Topic Research                     |
| Chinese Name     | 专题研究                           |
| Priority         | P0                                 |
| Estimated Effort | 8-10 weeks                         |
| Dependencies     | AI Teams, AI Engine, Deep Research |

---

## 1. Overview

### 1.1 Background

用户需要一种结构化的方法来对特定主题（国家、技术、企业）进行持续的、多维度的研究。当前产品能力：

- **Deep Research**: 一次性深度研究，生成报告
- **AI Teams**: 灵活的团队协作任务

**Gap**: 缺少专门用于**持续性专题洞察**的模块，支持定时更新和历史追踪。

### 1.2 Objectives

1. 支持宏观专题（国家、行业、领域）的多维度结构化洞察
2. 支持技术专项的深度分析
3. 支持标杆企业和初创企业的全面分析
4. 支持定时自动刷新和增量更新
5. 保持引用完整性，采用 NotebookLM 风格的来源管理

### 1.3 Non-Goals (This Version)

- 实时监控（流式更新）
- 用户自定义维度
- 多用户协作
- 外部 API 访问

---

## 2. Module Naming

### 2.1 Final Decision

| Language       | Name               | Route                    |
| -------------- | ------------------ | ------------------------ |
| English        | **Topic Research** | `/topic-research`        |
| Chinese        | **专题研究**       | -                        |
| Backend Module | `topic-research`   | `ai-app/topic-research/` |

### 2.2 Related Terms

| Term            | Chinese  | Description    |
| --------------- | -------- | -------------- |
| Research Topic  | 研究专题 | 研究主题容器   |
| Dimension       | 研究维度 | 分析角度/视角  |
| Research Report | 研究报告 | 生成的分析输出 |
| Refresh Cycle   | 刷新周期 | 更新计划       |
| Evidence        | 支撑证据 | 引用和参考来源 |

---

## 3. Data Sources (数据来源)

### 3.1 数据来源架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Topic Research Module                          │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │                    Data Source Router                            │ │
│  │  根据维度类型和专题类型，智能路由到合适的数据源                      │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐        ┌───────────────────┐        ┌───────────────┐
│  实时搜索源    │        │    学术/专业源     │        │   本地资源库   │
├───────────────┤        ├───────────────────┤        ├───────────────┤
│ • Web Search  │        │ • ArXiv           │        │ • 本地文章    │
│ • News Search │        │ • Semantic Scholar│        │ • 本地报告    │
│ • URL Scraper │        │ • GitHub          │        │ • 本地政策    │
│               │        │ • HackerNews      │        │ • 本地论文    │
│               │        │ • RSS Feeds       │        │               │
└───────────────┘        └───────────────────┘        └───────────────┘
```

### 3.2 主要数据来源详情

#### 3.2.1 Web 搜索 (实时)

| 属性       | 说明                     |
| ---------- | ------------------------ |
| **服务**   | `SearchService`          |
| **提供商** | Tavily (主), Serper (备) |
| **用途**   | 通用网页搜索、新闻搜索   |
| **特点**   | 实时性强、覆盖面广       |
| **限制**   | 每次请求 5-10 条结果     |

**排序算法**（100分制）：

- 相关性 (40%): 关键词在标题/内容中的匹配度
- 质量 (30%): 域名权威性评分
- 新鲜度 (20%): 内容发布时间
- 深度 (10%): 内容长度

**权威域名分类**：

```typescript
HIGH_AUTHORITY = [
  // 学术
  "arxiv.org",
  "nature.com",
  "science.org",
  "ieee.org",
  "acm.org",
  // 新闻
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "nytimes.com",
  // 分析
  "mckinsey.com",
  "bcg.com",
  "hbr.org",
  "economist.com",
];

MEDIUM_AUTHORITY = [
  "techcrunch.com",
  "wired.com",
  "arstechnica.com",
  "medium.com",
  "dev.to",
  "github.com",
];
```

#### 3.2.2 ArXiv 学术论文

| 属性         | 说明                                |
| ------------ | ----------------------------------- |
| **服务**     | `ArxivService`                      |
| **API**      | `http://export.arxiv.org/api/query` |
| **用途**     | 学术论文检索、技术前沿追踪          |
| **特点**     | 免费开放、内容权威                  |
| **数据格式** | XML                                 |

**提取字段**：

- Paper ID (arXiv ID)
- 标题、摘要
- 作者列表（含机构）
- 分类（主分类 + 次分类）
- 发布日期
- PDF URL
- DOI、期刊引用

**适用维度**：

- 技术专项：技术原理、前沿水平、专利分析
- 宏观洞察：技术趋势
- 企业洞察：技术研发

#### 3.2.3 Semantic Scholar 学术搜索

| 属性     | 说明                                                    |
| -------- | ------------------------------------------------------- |
| **服务** | `AiStudioSourceService.searchScholar()`                 |
| **API**  | `https://api.semanticscholar.org/graph/v1/paper/search` |
| **用途** | 学术论文搜索、引用分析                                  |
| **特点** | 免费 API、引用数据丰富                                  |

**提取字段**：

- Paper ID
- 标题、摘要
- 作者
- 年份
- 引用数量
- 开放获取 PDF URL

**适用维度**：

- 技术专项：主要玩家与研究、前沿水平
- 宏观洞察：技术趋势

#### 3.2.4 GitHub 项目搜索

| 属性     | 说明                       |
| -------- | -------------------------- |
| **服务** | `GithubService`            |
| **API**  | GitHub REST API            |
| **用途** | 开源项目追踪、技术生态分析 |
| **特点** | 代码级别的技术洞察         |

**提取字段**：

- 仓库元数据：名称、描述、stars、forks
- 编程语言分布
- 许可证
- Topics 标签
- README 内容
- 贡献者信息
- 更新频率

**质量评分算法**：

- Stars (最高 50 分)
- Forks (最高 20 分)
- README 存在 (10 分)
- 许可证存在 (10 分)
- 近期活跃 (10 分)

**适用维度**：

- 技术专项：主要玩家、商业化状态、应用场景
- 企业洞察：技术研发

#### 3.2.5 HackerNews 科技资讯

| 属性     | 说明                     |
| -------- | ------------------------ |
| **服务** | `HackernewsService`      |
| **API**  | Firebase API             |
| **用途** | 科技社区热点、行业动态   |
| **特点** | 社区讨论、技术趋势风向标 |

**提取字段**：

- Story ID、标题
- 外部链接 URL
- 作者
- 分数（upvotes）
- 评论数
- 热门评论

**适用维度**：

- 宏观洞察：技术趋势、行业应用
- 企业洞察：战略动态、市场反应

#### 3.2.6 RSS 订阅源

| 属性     | 说明                         |
| -------- | ---------------------------- |
| **服务** | `RssService`                 |
| **格式** | RSS/Atom                     |
| **用途** | 行业博客、官方公告、新闻聚合 |
| **特点** | 可定制、覆盖特定领域         |

**支持的订阅源类型**：

- 科技博客 (TechCrunch, Wired, etc.)
- 公司官方博客
- 行业分析机构
- YouTube 频道（支持时长过滤）

**适用维度**：

- 宏观洞察：所有维度
- 企业洞察：战略动态、产品服务

#### 3.2.7 URL 内容抓取

| 属性     | 说明                    |
| -------- | ----------------------- |
| **服务** | `WebScraperTool`        |
| **用途** | 获取指定 URL 的完整内容 |
| **特点** | 深度内容提取            |

**能力**：

- HTML 解析和净化
- 主内容提取
- 标题、正文分离
- 内容长度限制（默认 10000 字符）

**适用场景**：

- 对搜索结果进行深度内容获取
- 用户指定的参考链接
- 报告内引用的验证

#### 3.2.8 本地资源库

| 属性     | 说明                                    |
| -------- | --------------------------------------- |
| **服务** | `AiStudioSourceService.searchLocalDB()` |
| **存储** | PostgreSQL 16 (统一架构)                |
| **用途** | 已入库的高质量资源检索                  |
| **特点** | 已审核、质量可控                        |

**支持的资源类型**：

- `BLOG` - 博客文章
- `REPORT` - 研究报告
- `POLICY` - 政策文件
- `NEWS` - 新闻资讯
- `PAPER` - 学术论文
- `PROJECT` - 项目资料

**搜索能力**：

- 全文搜索（标题、摘要、内容）
- 分类过滤
- 质量分数过滤
- 时间范围过滤

### 3.3 数据来源与维度映射

#### 3.3.1 宏观洞察 (Macro Insight)

| 维度     | 主要数据源                 | 次要数据源                        |
| -------- | -------------------------- | --------------------------------- |
| 政策法规 | Web Search, Local (POLICY) | News, RSS                         |
| 市场概览 | Web Search, Local (REPORT) | News                              |
| 竞争格局 | Web Search, Local (REPORT) | News, HackerNews                  |
| 技术趋势 | ArXiv, Semantic Scholar    | GitHub, HackerNews, Web           |
| 投资动态 | Web Search, News           | Local (REPORT)                    |
| 人才生态 | Web Search                 | ArXiv (作者机构), GitHub (贡献者) |
| 国际动态 | Web Search, News           | Local (POLICY)                    |
| 行业应用 | Web Search, News           | GitHub, HackerNews                |

#### 3.3.2 技术专项 (Tech Insight)

| 维度       | 主要数据源              | 次要数据源              |
| ---------- | ----------------------- | ----------------------- |
| 技术原理   | ArXiv, Semantic Scholar | Web Search, Wikipedia   |
| 前沿水平   | ArXiv, Semantic Scholar | GitHub, HackerNews      |
| 主要玩家   | ArXiv (作者), GitHub    | Web Search, News        |
| 专利分析   | Web Search (专利数据库) | ArXiv, Semantic Scholar |
| 应用场景   | Web Search, GitHub      | HackerNews, News        |
| 商业化状态 | Web Search, News        | GitHub (stars/forks)    |
| 挑战限制   | ArXiv, Web Search       | HackerNews (讨论)       |
| 未来路线   | ArXiv, Web Search       | News, Reports           |

#### 3.3.3 企业洞察 (Company Insight)

| 维度      | 主要数据源                 | 次要数据源             |
| --------- | -------------------------- | ---------------------- |
| 公司概况  | Web Search (官网)          | Wikipedia, News        |
| 产品服务  | Web Search (官网), News    | HackerNews, GitHub     |
| 商业模式  | Web Search, Local (REPORT) | News                   |
| 财务表现  | Web Search, News           | Local (REPORT)         |
| 技术研发  | GitHub, ArXiv              | Semantic Scholar, News |
| 市场地位  | Web Search, Local (REPORT) | News                   |
| 战略动态  | News, Web Search           | HackerNews, RSS        |
| SWOT 分析 | 综合以上所有来源           | -                      |

### 3.4 数据质量保障

#### 3.4.1 去重策略（5 层）

```typescript
// 1. 同源去重：相同 crawler，相同 ID
// 2. 跨源去重：external ID 匹配
// 3. URL 去重：标准化 URL 比对
// 4. 标题相似度：余弦相似度 > 90%
// 5. 可访问性检查：HEAD/GET 请求验证
```

#### 3.4.2 可信度评分

```typescript
interface CredibilityScore {
  domainAuthority: number; // 0-100，基于域名权威性
  sourceType: number; // 学术 > 官方 > 新闻 > 博客
  citationCount: number; // 被引用次数
  recency: number; // 时效性，越新越高
  contentDepth: number; // 内容深度
}

// 综合可信度 = 加权平均
finalScore =
  domainAuthority * 0.3 +
  sourceType * 0.25 +
  citationCount * 0.2 +
  recency * 0.15 +
  contentDepth * 0.1;
```

#### 3.4.3 数据新鲜度要求

| 维度类型 | 推荐时效 | 最长时效 |
| -------- | -------- | -------- |
| 政策法规 | 6 个月   | 2 年     |
| 市场数据 | 3 个月   | 1 年     |
| 技术前沿 | 6 个月   | 2 年     |
| 企业动态 | 1 个月   | 6 个月   |
| 学术论文 | 1 年     | 5 年     |

### 3.5 未来数据源扩展

| 数据源       | 类型 | 优先级 | 用途           |
| ------------ | ---- | ------ | -------------- |
| 专利数据库   | API  | P1     | 专利分析维度   |
| Crunchbase   | API  | P1     | 企业融资、估值 |
| LinkedIn     | API  | P2     | 人才、组织分析 |
| Twitter/X    | API  | P2     | 舆情、动态     |
| 政府公开数据 | 爬虫 | P2     | 政策、统计数据 |
| 财报数据库   | API  | P2     | 上市公司财务   |

---

## 4. User Stories

### 4.1 Roles

| Role    | Description        |
| ------- | ------------------ |
| Analyst | 创建和管理研究专题 |
| Viewer  | 查看生成的研究报告 |
| Admin   | 管理系统配置       |

### 4.2 Core User Stories

| ID     | Role    | Story                                                                          | Priority |
| ------ | ------- | ------------------------------------------------------------------------------ | -------- |
| US-001 | Analyst | 作为分析师，我想创建宏观洞察专题（如"美国 AI 宏观洞察"），以便持续追踪多个维度 | P0       |
| US-002 | Analyst | 作为分析师，我想创建技术专项专题（如"空芯光纤技术洞察"），以便深入分析技术细节 | P0       |
| US-003 | Analyst | 作为分析师，我想创建企业洞察专题（如"OpenAI 企业分析"），以便监控企业动态      | P0       |
| US-004 | Analyst | 作为分析师，我想设置自动刷新计划，以便无需手动干预即可保持洞察最新             | P1       |
| US-005 | Analyst | 作为分析师，我想手动触发任意维度的刷新，以便在需要时获得即时更新               | P0       |
| US-006 | Viewer  | 作为查看者，我想看到带引用的最新研究报告，以便信任分析质量                     | P0       |
| US-007 | Viewer  | 作为查看者，我想比较历史版本的洞察，以便追踪变化趋势                           | P1       |
| US-008 | Analyst | 作为分析师，我想导出多种格式的洞察报告（PDF、DOCX），以便外部分享              | P1       |

---

## 5. Functional Architecture

### 5.1 System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                          Frontend Layer                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │ 专题研究列表      │  │ 专题工作区        │  │ 报告查看器        │      │
│  │ TopicList        │  │ TopicWorkspace   │  │ ReportViewer     │      │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘      │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Backend: AI App Layer                              │
│  ┌──────────────────────────┐  ┌──────────────────────────────────┐   │
│  │   TopicResearchService    │  │     TopicRefreshScheduler        │   │
│  └──────────────────────────┘  └──────────────────────────────────┘   │
│              │                              │                          │
│              ▼                              ▼                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                  TopicTeamOrchestrator                          │   │
│  │  - 为每个专题创建和管理 AI Team                                   │   │
│  │  - 协调维度分析任务                                              │   │
│  │  - 处理增量刷新逻辑                                              │   │
│  └────────────────────────────────────────────────────────────────┘   │
│              │                                                         │
│              ▼                                                         │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                  DataSourceRouter                               │   │
│  │  - 根据维度类型路由到合适的数据源                                  │   │
│  │  - 聚合多源搜索结果                                              │   │
│  │  - 数据质量评估和去重                                            │   │
│  └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      AI Engine Layer (Reuse)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │ AI Teams    │  │ Search      │  │ LLM         │  │ Constraint  │   │
│  │ Orchestrator│  │ Service     │  │ Service     │  │ Engine      │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Data Sources Layer                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Tavily/  │ │ ArXiv    │ │ GitHub   │ │ Hacker   │ │ Local    │     │
│  │ Serper   │ │ Scholar  │ │          │ │ News     │ │ Resources│     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
└────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         Data Layer                                      │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐            │
│  │ ResearchTopic  │  │ TopicDimension │  │ TopicReport    │            │
│  └────────────────┘  └────────────────┘  └────────────────┘            │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐            │
│  │ TopicEvidence  │  │ TopicSchedule  │  │ TopicRefreshLog│            │
│  └────────────────┘  └────────────────┘  └────────────────┘            │
└────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Three Research Types

#### 5.2.1 宏观洞察 (Macro Insight)

**Use Case**: "美国 AI 宏观洞察"

| 维度     | 说明                     | 子维度                   |
| -------- | ------------------------ | ------------------------ |
| 政策法规 | 政府政策、法规、激励措施 | 法律、行政命令、机构行动 |
| 市场概览 | 市场规模、增长、细分     | TAM、SAM、SOM、CAGR      |
| 竞争格局 | 主要玩家、市场份额、定位 | 领导者、挑战者、利基玩家 |
| 技术趋势 | 新兴技术、研发方向       | 专利、论文、突破         |
| 投资动态 | 融资轮次、并购、IPO      | VC 活动、企业投资        |
| 人才生态 | 人才、教育、研究机构     | 高校、实验室、人才流动   |
| 国际动态 | 跨境活动、地缘政治       | 贸易、合作、竞争         |
| 行业应用 | 行业特定采用情况         | 医疗、金融、制造         |

#### 5.2.2 技术专项 (Tech Insight)

**Use Case**: "空芯光纤技术洞察"

| 维度       | 说明                     | 子维度               |
| ---------- | ------------------------ | -------------------- |
| 技术原理   | 核心原理、物理、机制     | 理论、架构、材料     |
| 前沿水平   | 当前能力、基准对比       | 性能指标、对比       |
| 主要玩家   | 企业、实验室、关键研究者 | 学术、产业、政府     |
| 专利分析   | IP 活动、核心专利        | 趋势、地理、专利权人 |
| 应用场景   | 当前和潜在应用           | 按行业、按功能       |
| 商业化状态 | 产品、市场成熟度         | TRL、市场产品        |
| 挑战限制   | 技术障碍、差距           | 工程、成本、采用     |
| 未来路线   | 预测、发展方向           | 1-3 年、5-10 年展望  |

#### 5.2.3 企业洞察 (Company Insight)

**Use Case**: "OpenAI 企业洞察" 或 "初创企业: Anthropic"

| 维度      | 说明                   | 子维度               |
| --------- | ---------------------- | -------------------- |
| 公司概况  | 背景、使命、历史       | 创立、里程碑、领导层 |
| 产品服务  | 产品组合、功能、定价   | 产品矩阵、路线图     |
| 商业模式  | 收入来源、变现方式     | B2B、B2C、授权       |
| 财务表现  | 营收、融资、估值       | 公开/私有指标        |
| 技术研发  | 核心技术、创新         | 专利、论文、人才     |
| 市场地位  | 竞争定位               | 市场份额、差异化     |
| 战略动态  | 合作、并购、扩张       | 近期新闻、公告       |
| SWOT 分析 | 优势、劣势、机会、威胁 | 综合评估             |

---

## 6. AI Team Configuration

### 6.1 Research Team Structure

```yaml
TopicResearchTeam:
  name: "专题研究团队"
  description: "多维度专题分析团队"
  type: predefined

  leader:
    role: ResearchLead
    responsibilities:
      - 理解研究专题范围
      - 分配维度分析任务
      - 审核和质量控制
      - 综合最终报告
    preferredModel: claude-opus-4-20250514 # 强推理能力用于综合

  members:
    - role: ResearchAnalyst
      count: 2-4 # 根据维度数量动态调整
      skills: [information_retrieval, data_synthesis, trend_analysis]
      tools:
        [web_search, academic_search, news_search, url_scraper, github_search]
      preferredModel: claude-sonnet-4-20250514 # 成本效益型研究

    - role: DataSpecialist
      count: 1
      skills: [data_analysis, visualization, statistics]
      tools: [data_analysis, chart_generator]
      preferredModel: gpt-4o # 擅长数据任务

    - role: Writer
      count: 1
      skills: [content_creation, report_structuring, citation_management]
      tools: [text_generation, export_docx, export_pdf]
      preferredModel: claude-sonnet-4-20250514

  workflow:
    type: hybrid
    steps:
      - name: scope_definition
        executor: ResearchLead
        description: "定义研究范围和维度优先级"

      - name: dimension_research
        executor: ResearchAnalyst
        parallel: true
        description: "并行研究各个维度"

      - name: data_synthesis
        executor: DataSpecialist
        dependsOn: [dimension_research]
        description: "分析和可视化收集的数据"

      - name: report_drafting
        executor: Writer
        dependsOn: [data_synthesis]
        description: "起草带引用的研究报告"

      - name: quality_review
        executor: ResearchLead
        dependsOn: [report_drafting]
        description: "审核质量并批准最终报告"

  constraintProfile:
    cost_sensitivity: medium
    quality_priority: accuracy
    typical_duration: "1-4h"
    require_evidence: true
    min_sources_per_dimension: 5

  deliverables:
    - research_report_markdown
    - evidence_collection
    - summary_highlights
```

### 6.2 Role Definitions

#### ResearchLead

```typescript
interface ResearchLeadRole {
  id: "research-lead";
  name: "研究组长";
  description: "编排研究分析并确保质量";

  coreSkills: [
    "strategic_thinking",
    "research_planning",
    "quality_assessment",
    "synthesis",
  ];

  coreTools: ["planning_tool", "review_tool", "summary_generator"];

  systemPrompt: `
    你是研究组长，负责编排全面的专题分析。你的职责：

    1. 范围定义：明确研究专题的边界
    2. 任务规划：分解维度并分配给团队成员
    3. 协调推进：确保并行研究按计划进行
    4. 质量审核：验证证据质量和分析深度
    5. 报告综合：从成员输出创建连贯的最终报告

    质量标准：
    - 每个论断必须有支撑证据
    - 优先使用近期来源（最好是最近 6 个月）
    - 对冲突信息进行显式标记和处理
    - 确保所有维度的覆盖均衡
  `;
}
```

#### ResearchAnalyst

```typescript
interface ResearchAnalystRole {
  id: "research-analyst";
  name: "研究分析师";
  description: "对分配的维度进行深度研究";

  coreSkills: [
    "information_retrieval",
    "source_evaluation",
    "data_extraction",
    "trend_identification",
  ];

  coreTools: [
    "web_search",
    "academic_search",
    "news_search",
    "url_scraper",
    "github_search",
    "document_parser",
  ];

  systemPrompt: `
    你是一名研究分析师，专注于深度信息收集。

    对于每个分配的维度：
    1. 搜索：使用多种搜索策略（网页、学术、新闻、GitHub）
    2. 评估：评估来源可信度和时效性
    3. 提取：提取关键事实、数据和引用
    4. 引用：为所有信息保持完整引用
    5. 总结：创建结构化的维度分析

    证据要求：
    - 每个维度至少 5 个唯一来源
    - 所有来源包含发布日期
    - 优先使用一手来源而非聚合器
    - 标记不确定或冲突的信息
  `;
}
```

---

## 7. Data Model Design

### 7.1 Prisma Schema

```prisma
// ============ Topic Research System ============

enum ResearchTopicType {
  MACRO        // 宏观洞察：国家/行业/领域分析
  TECHNOLOGY   // 技术专项：技术深度分析
  COMPANY      // 企业洞察：企业/初创分析
}

enum ResearchTopicStatus {
  DRAFT        // 草稿
  ACTIVE       // 活跃
  PAUSED       // 暂停
  ARCHIVED     // 归档
}

enum RefreshFrequency {
  MANUAL       // 手动刷新
  DAILY        // 每日
  WEEKLY       // 每周
  BIWEEKLY     // 双周
  MONTHLY      // 每月
}

enum DimensionStatus {
  PENDING      // 待处理
  RESEARCHING  // 研究中
  COMPLETED    // 已完成
  FAILED       // 失败
}

// 研究专题主表
model ResearchTopic {
  id          String              @id @default(uuid())
  userId      String              @map("user_id")

  // 基本信息
  name        String              @db.VarChar(200)
  description String?             @db.Text
  icon        String?             @db.VarChar(10)  // Emoji
  color       String?             @db.VarChar(20)  // Hex color
  type        ResearchTopicType
  status      ResearchTopicStatus @default(DRAFT)

  // 类型特定配置 (JSON 灵活性)
  // MACRO: { country, industry, domain, focusAreas }
  // TECHNOLOGY: { technology, maturityLevel, applicationAreas }
  // COMPANY: { companyName, companyType, industry }
  topicConfig Json               @map("topic_config") @default("{}")

  // 刷新设置
  refreshFrequency RefreshFrequency @default(MANUAL) @map("refresh_frequency")
  lastRefreshAt    DateTime?        @map("last_refresh_at")
  nextRefreshAt    DateTime?        @map("next_refresh_at")

  // AI Team 配置
  teamConfigId     String?          @map("team_config_id")

  // 统计
  totalReports     Int              @default(0) @map("total_reports")
  totalSources     Int              @default(0) @map("total_sources")

  // 时间戳
  createdAt        DateTime         @default(now()) @map("created_at")
  updatedAt        DateTime         @updatedAt @map("updated_at")

  // 关系
  user             User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  dimensions       TopicDimension[]
  reports          TopicReport[]
  schedules        TopicSchedule[]
  refreshLogs      TopicRefreshLog[]

  @@index([userId, status])
  @@index([type])
  @@index([nextRefreshAt])
  @@map("research_topics")
}

// 专题维度定义
model TopicDimension {
  id          String           @id @default(uuid())
  topicId     String           @map("topic_id")

  // 维度信息
  name        String           @db.VarChar(200)
  description String?          @db.Text
  sortOrder   Int              @default(0) @map("sort_order")
  isEnabled   Boolean          @default(true) @map("is_enabled")

  // 研究配置
  searchQueries    Json?       @map("search_queries")     // 建议的搜索词
  searchSources    Json?       @map("search_sources")     // 首选数据源
  minSources       Int         @default(5) @map("min_sources")

  // 最新状态
  status           DimensionStatus @default(PENDING)
  lastResearchedAt DateTime?       @map("last_researched_at")

  // 关系
  topic            ResearchTopic   @relation(fields: [topicId], references: [id], onDelete: Cascade)
  analyses         DimensionAnalysis[]

  @@index([topicId, sortOrder])
  @@map("topic_dimensions")
}

// 维度分析结果（每报告版本）
model DimensionAnalysis {
  id           String          @id @default(uuid())
  dimensionId  String          @map("dimension_id")
  reportId     String          @map("report_id")

  // 分析内容
  summary      String          @db.Text
  keyFindings  Json            @map("key_findings")      // [{title, content}]
  dataPoints   Json?           @map("data_points")       // [{metric, value, source}]

  // 来源追踪
  sourcesUsed  Int             @default(0) @map("sources_used")

  // AI 元数据
  modelUsed    String?         @map("model_used")
  tokensUsed   Int?            @map("tokens_used")

  // 时间戳
  createdAt    DateTime        @default(now()) @map("created_at")

  // 关系
  dimension    TopicDimension  @relation(fields: [dimensionId], references: [id], onDelete: Cascade)
  report       TopicReport     @relation(fields: [reportId], references: [id], onDelete: Cascade)
  evidences    TopicEvidence[]

  @@index([dimensionId])
  @@index([reportId])
  @@map("dimension_analyses")
}

// 研究报告（版本化）
model TopicReport {
  id           String         @id @default(uuid())
  topicId      String         @map("topic_id")

  // 版本信息
  version      Int            @default(1)
  versionLabel String?        @map("version_label")     // e.g., "2026-01 更新"

  // 报告内容
  executiveSummary String     @map("executive_summary") @db.Text
  fullReport       String     @map("full_report") @db.Text        // Markdown 带引用
  highlights       Json       @default("[]")                       // 核心发现

  // 统计
  totalDimensions  Int        @default(0) @map("total_dimensions")
  totalSources     Int        @default(0) @map("total_sources")
  totalTokens      Int        @default(0) @map("total_tokens")

  // 生成元数据
  generatedAt      DateTime   @default(now()) @map("generated_at")
  generationTimeMs Int?       @map("generation_time_ms")

  // 刷新追踪
  isIncremental    Boolean    @default(false) @map("is_incremental")  // vs 全量刷新
  changesFromPrev  Json?      @map("changes_from_prev")  // 与上版本的差异摘要

  // 关系
  topic            ResearchTopic @relation(fields: [topicId], references: [id], onDelete: Cascade)
  dimensionAnalyses DimensionAnalysis[]
  evidences        TopicEvidence[]

  @@unique([topicId, version])
  @@index([topicId, generatedAt(sort: Desc)])
  @@map("topic_reports")
}

// 证据/引用
model TopicEvidence {
  id           String         @id @default(uuid())
  reportId     String         @map("report_id")
  analysisId   String?        @map("analysis_id")

  // 来源信息
  title        String         @db.VarChar(500)
  url          String         @db.Text
  domain       String?        @db.VarChar(200)
  snippet      String?        @db.Text

  // 元数据
  publishedAt  DateTime?      @map("published_at")
  accessedAt   DateTime       @default(now()) @map("accessed_at")
  sourceType   String?        @map("source_type")    // web, academic, news, github, etc.

  // 质量评估
  credibilityScore Int?       @map("credibility_score")  // 0-100

  // 引用索引（用于正文中的 [1], [2] 引用）
  citationIndex    Int?       @map("citation_index")

  // 关系
  report       TopicReport    @relation(fields: [reportId], references: [id], onDelete: Cascade)
  analysis     DimensionAnalysis? @relation(fields: [analysisId], references: [id], onDelete: SetNull)

  @@index([reportId])
  @@index([analysisId])
  @@map("topic_evidences")
}

// 定时刷新配置
model TopicSchedule {
  id           String         @id @default(uuid())
  topicId      String         @map("topic_id")

  // 计划配置
  frequency    RefreshFrequency
  dayOfWeek    Int?           @map("day_of_week")     // 0-6 用于每周
  dayOfMonth   Int?           @map("day_of_month")    // 1-31 用于每月
  hourOfDay    Int            @default(9) @map("hour_of_day")  // UTC 小时

  // 状态
  isActive     Boolean        @default(true) @map("is_active")
  lastRunAt    DateTime?      @map("last_run_at")
  nextRunAt    DateTime?      @map("next_run_at")

  // 关系
  topic        ResearchTopic  @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@index([isActive, nextRunAt])
  @@map("topic_schedules")
}

// 刷新执行日志
model TopicRefreshLog {
  id           String         @id @default(uuid())
  topicId      String         @map("topic_id")

  // 执行信息
  triggerType  String         @map("trigger_type")    // manual, scheduled
  startedAt    DateTime       @default(now()) @map("started_at")
  completedAt  DateTime?      @map("completed_at")

  // 结果
  status       String         // pending, running, completed, failed
  reportId     String?        @map("report_id")       // 生成的报告 ID
  error        String?        @db.Text

  // 统计
  dimensionsRefreshed Int?    @map("dimensions_refreshed")
  sourcesFound        Int?    @map("sources_found")
  tokensUsed          Int?    @map("tokens_used")

  // 关系
  topic        ResearchTopic  @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@index([topicId, startedAt(sort: Desc)])
  @@map("topic_refresh_logs")
}
```

### 7.2 Entity Relationship Diagram

```
ResearchTopic (1) ─────< (N) TopicDimension
      │                        │
      │                        │
      │                        v
      │              DimensionAnalysis (N) >───── (1) TopicReport
      │                        │                        │
      │                        │                        │
      v                        v                        v
TopicSchedule (N)      TopicEvidence (N) <─────────────┘
      │
      v
TopicRefreshLog (N)
```

---

## 8. Refresh Mechanism Design

### 8.1 Refresh Types

| 类型     | 说明               | 场景               |
| -------- | ------------------ | ------------------ |
| 全量刷新 | 重新研究所有维度   | 首次生成、重大更新 |
| 增量刷新 | 仅更新有变化的维度 | 定时刷新           |
| 维度刷新 | 刷新单个维度       | 手动定向更新       |

### 8.2 Incremental Update Algorithm

```typescript
interface IncrementalRefreshStrategy {
  // 1. 确定需要更新的内容
  async analyzeChanges(topic: ResearchTopic): Promise<RefreshPlan> {
    const lastReport = await getLatestReport(topic.id);
    const changes: DimensionChange[] = [];

    for (const dimension of topic.dimensions) {
      // 检查维度是否有新信息
      const newSources = await searchForNewSources(dimension, lastReport.generatedAt);

      if (newSources.length >= threshold) {
        changes.push({
          dimensionId: dimension.id,
          reason: 'new_sources',
          sourceCount: newSources.length
        });
      }
    }

    return { dimensionsToRefresh: changes };
  }

  // 2. 执行增量刷新
  async executeRefresh(plan: RefreshPlan, topic: ResearchTopic): Promise<TopicReport> {
    const lastReport = await getLatestReport(topic.id);
    const newAnalyses: DimensionAnalysis[] = [];

    // 并行刷新变化的维度
    for (const change of plan.dimensionsToRefresh) {
      const analysis = await researchDimension(change.dimensionId);
      newAnalyses.push(analysis);
    }

    // 从上次报告复制未变化的维度
    const unchangedAnalyses = lastReport.analyses.filter(
      a => !plan.dimensionsToRefresh.find(c => c.dimensionId === a.dimensionId)
    );

    // 综合新报告
    return synthesizeReport(topic, [...unchangedAnalyses, ...newAnalyses], {
      isIncremental: true,
      changesFromPrev: plan.dimensionsToRefresh
    });
  }
}
```

### 8.3 Scheduler Implementation

```typescript
@Injectable()
export class TopicRefreshScheduler {
  private readonly logger = new Logger(TopicRefreshScheduler.name);

  constructor(
    private prisma: PrismaService,
    private topicService: TopicResearchService,
  ) {}

  // 每小时检查待刷新的专题
  @Cron("0 * * * *")
  async checkPendingRefreshes() {
    const now = new Date();

    const topicsToRefresh = await this.prisma.researchTopic.findMany({
      where: {
        status: "ACTIVE",
        nextRefreshAt: { lte: now },
        refreshFrequency: { not: "MANUAL" },
      },
      include: { dimensions: true },
    });

    for (const topic of topicsToRefresh) {
      try {
        await this.topicService.triggerRefresh(topic.id, "scheduled");
        await this.updateNextRefreshTime(topic);
      } catch (error) {
        this.logger.error(
          `Failed to refresh topic ${topic.id}: ${error.message}`,
        );
      }
    }
  }

  private async updateNextRefreshTime(topic: ResearchTopic) {
    const nextRefresh = this.calculateNextRefresh(topic);
    await this.prisma.researchTopic.update({
      where: { id: topic.id },
      data: { nextRefreshAt: nextRefresh },
    });
  }
}
```

---

## 9. Frontend Page Structure

### 9.1 Navigation

```
AI Research (existing)
├── Deep Research (existing tab)
├── Fast Research (existing tab)
└── Topic Research (NEW tab)  <-- 本模块
```

### 9.2 Page Hierarchy

```
/topic-research
├── /                           # 专题研究列表页
│   ├── 专题卡片视图
│   ├── 创建新专题按钮
│   └── 按类型/状态筛选
│
├── /create                     # 创建新专题
│   ├── Step 1: 选择类型（宏观/技术/企业）
│   ├── Step 2: 配置专题详情
│   ├── Step 3: 选择/自定义维度
│   └── Step 4: 设置刷新计划
│
└── /[topicId]                  # 专题工作区
    ├── Overview tab
    │   ├── 专题摘要卡片
    │   ├── 最新报告亮点
    │   └── 快速统计
    │
    ├── Report tab
    │   ├── 完整报告查看器（Markdown）
    │   ├── 维度导航
    │   └── 导出选项
    │
    ├── Evidence tab
    │   ├── 所有来源列表
    │   ├── 来源可信度指示器
    │   └── 来源详情弹窗
    │
    ├── History tab
    │   ├── 版本时间线
    │   ├── 版本对比
    │   └── 变更亮点
    │
    └── Settings tab
        ├── 专题配置
        ├── 维度管理
        └── 刷新计划
```

### 9.3 Key UI Components

#### Topic Card

```tsx
interface ResearchTopicCard {
  id: string;
  name: string;
  type: "macro" | "technology" | "company";
  status: "draft" | "active" | "paused";
  lastUpdated: Date;
  nextRefresh?: Date;
  dimensionCount: number;
  sourceCount: number;

  // 类型特定显示
  typeIcon: string; // 基于类型
  typeLabel: string; // "宏观洞察" | "技术专项" | "企业洞察"
}
```

#### Report Viewer

```tsx
interface ReportViewer {
  // NotebookLM 风格布局
  leftPanel: {
    tableOfContents: DimensionNav[];
    highlights: KeyFinding[];
  };

  mainContent: {
    executiveSummary: string;
    dimensionSections: DimensionSection[];
  };

  rightPanel: {
    sourceList: Evidence[];
    sourceDetail: Evidence | null; // 点击时显示
  };
}
```

---

## 10. Technical Architecture

### 10.1 Module Structure

```
backend/src/modules/ai-app/topic-research/
├── topic-research.module.ts
├── topic-research.controller.ts
├── services/
│   ├── topic-research.service.ts          # 主服务
│   ├── topic-team-orchestrator.ts         # AI Team 协调
│   ├── topic-refresh.scheduler.ts         # 定时刷新
│   ├── dimension-research.service.ts      # 维度分析
│   ├── data-source-router.service.ts      # 数据源路由
│   └── report-synthesis.service.ts        # 报告生成
├── dto/
│   ├── create-topic.dto.ts
│   ├── update-topic.dto.ts
│   ├── trigger-refresh.dto.ts
│   └── index.ts
├── types/
│   ├── research-types.ts
│   ├── dimension-config.ts
│   └── index.ts
└── prompts/
    ├── research-lead.prompt.ts
    ├── research-analyst.prompt.ts
    └── synthesis.prompt.ts
```

### 10.2 Integration Points

| 集成点             | 用途                 | 模块                          |
| ------------------ | -------------------- | ----------------------------- |
| AI Engine Teams    | 团队编排             | `ai-engine/teams`             |
| AI Engine Search   | Web/学术搜索         | `ai-engine/search`            |
| AI Engine LLM      | 模型调用             | `ai-engine/llm`               |
| Ingestion Crawlers | ArXiv/GitHub/HN 数据 | `ingestion/crawlers`          |
| Deep Research      | 报告综合模式         | `ai-app/studio/deep-research` |
| Export System      | PDF/DOCX 导出        | `export`                      |
| Credits System     | 使用计费             | `credits`                     |

### 10.3 API Endpoints

```typescript
@Controller('topic-research')
@UseGuards(JwtAuthGuard)
export class TopicResearchController {

  // Topic CRUD
  @Post('topics')
  createTopic(@Body() dto: CreateTopicDto, @CurrentUser() user): Promise<ResearchTopic>;

  @Get('topics')
  listTopics(@Query() query: ListTopicsDto, @CurrentUser() user): Promise<PaginatedResponse<ResearchTopic>>;

  @Get('topics/:id')
  getTopic(@Param('id') id: string): Promise<ResearchTopicDetail>;

  @Patch('topics/:id')
  updateTopic(@Param('id') id: string, @Body() dto: UpdateTopicDto): Promise<ResearchTopic>;

  @Delete('topics/:id')
  deleteTopic(@Param('id') id: string): Promise<void>;

  // Refresh operations
  @Post('topics/:id/refresh')
  triggerRefresh(@Param('id') id: string, @Body() dto: TriggerRefreshDto): Promise<RefreshJob>;

  @Get('topics/:id/refresh/status')
  getRefreshStatus(@Param('id') id: string): Promise<RefreshStatus>;

  // Reports
  @Get('topics/:id/reports')
  listReports(@Param('id') id: string): Promise<TopicReport[]>;

  @Get('topics/:id/reports/:version')
  getReport(@Param('id') id: string, @Param('version') version: number): Promise<TopicReportDetail>;

  @Get('topics/:id/reports/:version/export')
  exportReport(
    @Param('id') id: string,
    @Param('version') version: number,
    @Query('format') format: 'pdf' | 'docx'
  ): Promise<ExportResult>;

  // Dimensions
  @Get('topics/:id/dimensions')
  listDimensions(@Param('id') id: string): Promise<TopicDimension[]>;

  @Post('topics/:id/dimensions/:dimId/refresh')
  refreshDimension(@Param('id') id: string, @Param('dimId') dimId: string): Promise<RefreshJob>;

  // Evidence
  @Get('topics/:id/reports/:version/evidence')
  listEvidence(@Param('id') id: string, @Param('version') version: number): Promise<TopicEvidence[]>;

  // Templates
  @Get('templates')
  listTemplates(@Query('type') type: ResearchTopicType): Promise<DimensionTemplate[]>;
}
```

---

## 11. MVP Scope & Iteration Plan

### 11.1 MVP (Phase 1) - 4 weeks

**Goal**: 基础专题创建和手动刷新

| Feature          | Priority | Effort |
| ---------------- | -------- | ------ |
| 创建宏观洞察专题 | P0       | 3d     |
| 创建技术专项专题 | P0       | 2d     |
| 创建企业洞察专题 | P0       | 2d     |
| 手动全量刷新     | P0       | 5d     |
| 基础报告查看器   | P0       | 3d     |
| 证据/引用显示    | P0       | 2d     |
| 专题列表页       | P0       | 2d     |
| 基础维度配置     | P1       | 2d     |

**MVP Deliverables**:

- 用户可以创建三种类型的专题
- 用户可以触发手动刷新
- 用户可以查看带引用的生成报告
- 基础专题管理（CRUD）

### 11.2 Phase 2 - 3 weeks

**Goal**: 定时刷新和历史

| Feature                    | Priority | Effort |
| -------------------------- | -------- | ------ |
| 定时刷新（每日/每周/每月） | P0       | 3d     |
| 增量刷新算法               | P0       | 4d     |
| 版本历史查看               | P0       | 2d     |
| 版本对比                   | P1       | 3d     |
| 刷新日志/监控              | P1       | 2d     |
| 维度级刷新                 | P1       | 2d     |

### 11.3 Phase 3 - 2 weeks

**Goal**: 导出和优化

| Feature      | Priority | Effort |
| ------------ | -------- | ------ |
| PDF 导出     | P0       | 2d     |
| DOCX 导出    | P0       | 2d     |
| UI/UX 优化   | P1       | 3d     |
| 性能优化     | P1       | 2d     |
| 错误处理改进 | P1       | 1d     |

### 11.4 Future Phases

| Feature            | Phase | Notes          |
| ------------------ | ----- | -------------- |
| 用户自定义维度     | v1.1  | 用户定义的维度 |
| 多用户协作         | v1.2  | 团队共享       |
| 实时监控           | v2.0  | 流式更新       |
| 自定义 AI 团队配置 | v2.0  | 高级用户       |
| API 访问           | v2.0  | 企业功能       |
| 专题模板市场       | v2.0  | 社区分享       |

---

## 12. Risk Analysis

| 风险                    | 影响 | 可能性 | 缓解措施                                       |
| ----------------------- | ---- | ------ | ---------------------------------------------- |
| 搜索质量因专题而异      | 高   | 中     | 实施来源质量评分；允许手动添加来源             |
| 全面专题的刷新时间长    | 中   | 高     | 使用增量刷新；显示进度指示器                   |
| 深度研究的 token 成本高 | 中   | 中     | 实施成本控制；使用 task profiles；分层模型选择 |
| 缓存报告中的过时信息    | 中   | 低     | 清晰的"最后更新"指示器；便捷的手动刷新         |
| 维度配置复杂性          | 低   | 中     | 提供合理的默认值；常见专题的模板               |

---

## 13. Success Metrics

| 指标                   | 目标      | 测量方式                  |
| ---------------------- | --------- | ------------------------- |
| 专题创建完成率         | > 80%     | 开始创建并完成的用户      |
| 刷新成功率             | > 95%     | 成功刷新 / 总尝试次数     |
| 每报告平均来源数       | > 30      | 每次全量刷新收集的证据    |
| 用户满意度（报告质量） | > 4.0/5.0 | 生成后调查                |
| 周活跃使用率           | > 60%     | 有专题的用户每周查看/刷新 |
| 导出使用率             | > 40%     | 导出的报告 / 生成的报告   |

---

## 14. Appendix

### A. Dimension Templates

#### A.1 Macro Insight Default Dimensions

```json
{
  "type": "MACRO",
  "dimensions": [
    {
      "id": "policy",
      "name": "政策法规",
      "description": "政府政策、法规和激励措施",
      "searchQueries": [
        "{topic} government policy",
        "{topic} regulation 2024 2025",
        "{topic} legislative updates"
      ],
      "searchSources": ["web", "local_policy", "news"]
    },
    {
      "id": "market",
      "name": "市场概览",
      "description": "市场规模、增长趋势和细分",
      "searchQueries": [
        "{topic} market size",
        "{topic} market growth forecast",
        "{topic} industry analysis"
      ],
      "searchSources": ["web", "local_report", "news"]
    },
    {
      "id": "competition",
      "name": "竞争格局",
      "description": "主要玩家、市场份额、定位",
      "searchQueries": [
        "{topic} market leaders",
        "{topic} competitive landscape",
        "{topic} key players analysis"
      ],
      "searchSources": ["web", "local_report", "news"]
    },
    {
      "id": "technology",
      "name": "技术趋势",
      "description": "新兴技术、研发方向",
      "searchQueries": [
        "{topic} emerging technology",
        "{topic} technology trends",
        "{topic} innovation breakthroughs"
      ],
      "searchSources": ["arxiv", "scholar", "github", "web"]
    },
    {
      "id": "investment",
      "name": "投资动态",
      "description": "融资轮次、并购、IPO",
      "searchQueries": [
        "{topic} funding rounds",
        "{topic} M&A activity",
        "{topic} investment trends"
      ],
      "searchSources": ["web", "news", "local_report"]
    },
    {
      "id": "talent",
      "name": "人才生态",
      "description": "人才、教育、研究机构",
      "searchQueries": [
        "{topic} talent landscape",
        "{topic} research institutions",
        "{topic} workforce analysis"
      ],
      "searchSources": ["web", "arxiv", "github"]
    },
    {
      "id": "international",
      "name": "国际动态",
      "description": "跨境活动、地缘政治",
      "searchQueries": [
        "{topic} international cooperation",
        "{topic} global competition",
        "{topic} cross-border trends"
      ],
      "searchSources": ["web", "news", "local_policy"]
    },
    {
      "id": "application",
      "name": "行业应用",
      "description": "行业特定采用情况",
      "searchQueries": [
        "{topic} industry adoption",
        "{topic} use cases",
        "{topic} application areas"
      ],
      "searchSources": ["web", "news", "hackernews"]
    }
  ]
}
```

### B. Credit Cost Estimation

| 操作                     | 预估积分 | 说明           |
| ------------------------ | -------- | -------------- |
| 专题创建（无研究）       | 0        | 免费           |
| 全量刷新（宏观，8 维度） | 50-80    | 因深度而异     |
| 全量刷新（技术，8 维度） | 40-60    | 含学术搜索     |
| 全量刷新（企业，8 维度） | 30-50    | 范围更聚焦     |
| 增量刷新                 | 10-30    | 基于变化的维度 |
| 单维度刷新               | 5-10     | 仅一个维度     |
| 导出（PDF/DOCX）         | 2        | 固定成本       |

### C. Related Documents

- [AI Teams Product Vision](../../ai-teams/ai-teams-product-vision.md)
- [AI Engine Architecture](../../ai-engine/ai-engine-architecture-prd.md)
- [Deep Research Types](../../../backend/src/modules/ai-app/studio/deep-research/types.ts)
- [Research Team Template](../../../backend/src/modules/ai-engine/teams/templates/research-team.ts)

---

## Document History

| Version | Date       | Author   | Changes                                                                                 |
| ------- | ---------- | -------- | --------------------------------------------------------------------------------------- |
| 1.0     | 2026-01-11 | PM Agent | Initial version                                                                         |
| 1.0.1   | 2026-01-11 | PM Agent | Updated naming to "专题研究 (Topic Research)"; Added comprehensive Data Sources section |
