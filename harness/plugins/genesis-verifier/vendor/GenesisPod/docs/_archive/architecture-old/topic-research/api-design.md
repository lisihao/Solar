# Topic Research API Design

> **Version**: 1.0
> **Date**: 2026-01-11
> **Status**: Draft

---

## Overview

本文档定义了专题研究 (Topic Research) 模块的完整 RESTful API 接口规范。

**设计原则**:

- 遵循 RESTful 规范
- 一致的错误处理和响应格式
- 分页查询支持
- 版本化设计
- SSE 流式支持

**参考实现**:

- `ai-teams.controller.ts` - Topic CRUD、成员管理
- `ai-studio.controller.ts` - 项目管理、资源管理

---

## Base URL

```
Production: https://api.deepdive.com/api/topic-research
Development: http://localhost:8000/api/topic-research
```

**认证**: 所有端点需要 Bearer Token (JWT)

```
Authorization: Bearer <access_token>
```

---

## 1. Topic CRUD

### 1.1 创建专题

创建新的研究专题（宏观洞察/技术专项/企业洞察）。

```http
POST /api/topic-research/topics
```

**Request Body**:

```json
{
  "name": "美国 AI 宏观洞察",
  "description": "追踪美国 AI 行业的政策、市场、技术和投资动态",
  "type": "MACRO",
  "topicConfig": {
    "country": "United States",
    "industry": "Artificial Intelligence",
    "focusAreas": ["policy", "market", "technology"]
  },
  "icon": "🇺🇸",
  "color": "#1E40AF",
  "refreshFrequency": "WEEKLY",
  "dimensions": [
    {
      "name": "政策法规",
      "description": "政府政策、法规和激励措施",
      "searchQueries": ["US AI policy", "AI regulation USA"],
      "searchSources": ["web", "local_policy", "news"],
      "sortOrder": 1,
      "isEnabled": true
    }
  ]
}
```

**Response (201)**:

```json
{
  "id": "topic_abc123",
  "userId": "user_xyz",
  "name": "美国 AI 宏观洞察",
  "description": "追踪美国 AI 行业的政策、市场、技术和投资动态",
  "type": "MACRO",
  "status": "DRAFT",
  "topicConfig": { "country": "United States", ... },
  "icon": "🇺🇸",
  "color": "#1E40AF",
  "refreshFrequency": "WEEKLY",
  "nextRefreshAt": null,
  "totalReports": 0,
  "totalSources": 0,
  "dimensions": [
    {
      "id": "dim_001",
      "name": "政策法规",
      "status": "PENDING",
      "sortOrder": 1
    }
  ],
  "createdAt": "2026-01-11T10:00:00Z",
  "updatedAt": "2026-01-11T10:00:00Z"
}
```

### 1.2 获取专题列表

获取当前用户的所有专题。

```http
GET /api/topic-research/topics
```

**Query Parameters**:

- `type` (optional): 专题类型 - `MACRO` | `TECHNOLOGY` | `COMPANY`
- `status` (optional): 专题状态 - `DRAFT` | `ACTIVE` | `PAUSED` | `ARCHIVED`
- `search` (optional): 搜索关键词
- `skip` (optional): 分页偏移，默认 0
- `take` (optional): 分页数量，默认 20

**Response (200)**:

```json
{
  "items": [
    {
      "id": "topic_abc123",
      "name": "美国 AI 宏观洞察",
      "type": "MACRO",
      "status": "ACTIVE",
      "icon": "🇺🇸",
      "color": "#1E40AF",
      "refreshFrequency": "WEEKLY",
      "lastRefreshAt": "2026-01-10T09:00:00Z",
      "nextRefreshAt": "2026-01-17T09:00:00Z",
      "totalReports": 5,
      "totalSources": 127,
      "latestReport": {
        "id": "report_xyz",
        "version": 5,
        "versionLabel": "2026-01 更新",
        "generatedAt": "2026-01-10T09:00:00Z"
      },
      "createdAt": "2025-12-01T10:00:00Z",
      "updatedAt": "2026-01-10T09:00:00Z"
    }
  ],
  "pagination": {
    "total": 15,
    "skip": 0,
    "take": 20,
    "hasMore": false
  }
}
```

### 1.3 获取专题详情

获取单个专题的完整信息（包含维度、最新报告摘要）。

```http
GET /api/topic-research/topics/:id
```

**Response (200)**:

```json
{
  "id": "topic_abc123",
  "userId": "user_xyz",
  "name": "美国 AI 宏观洞察",
  "description": "追踪美国 AI 行业的政策、市场、技术和投资动态",
  "type": "MACRO",
  "status": "ACTIVE",
  "topicConfig": {
    "country": "United States",
    "industry": "Artificial Intelligence",
    "focusAreas": ["policy", "market", "technology"]
  },
  "icon": "🇺🇸",
  "color": "#1E40AF",
  "refreshFrequency": "WEEKLY",
  "lastRefreshAt": "2026-01-10T09:00:00Z",
  "nextRefreshAt": "2026-01-17T09:00:00Z",
  "totalReports": 5,
  "totalSources": 127,
  "dimensions": [
    {
      "id": "dim_001",
      "name": "政策法规",
      "description": "政府政策、法规和激励措施",
      "status": "COMPLETED",
      "sortOrder": 1,
      "isEnabled": true,
      "lastResearchedAt": "2026-01-10T09:15:00Z",
      "searchQueries": ["US AI policy", "AI regulation USA"],
      "searchSources": ["web", "local_policy", "news"],
      "minSources": 5
    },
    {
      "id": "dim_002",
      "name": "市场概览",
      "status": "COMPLETED",
      "sortOrder": 2,
      "isEnabled": true
    }
  ],
  "latestReport": {
    "id": "report_xyz",
    "version": 5,
    "versionLabel": "2026-01 更新",
    "executiveSummary": "2026年1月，美国AI行业呈现以下特征...",
    "highlights": [
      {
        "title": "政策重大突破",
        "content": "拜登政府发布新版AI安全框架...",
        "dimensionId": "dim_001"
      }
    ],
    "totalDimensions": 8,
    "totalSources": 127,
    "generatedAt": "2026-01-10T09:00:00Z"
  },
  "createdAt": "2025-12-01T10:00:00Z",
  "updatedAt": "2026-01-10T09:00:00Z"
}
```

### 1.4 更新专题

更新专题的基础信息或配置。

```http
PATCH /api/topic-research/topics/:id
```

**Request Body**:

```json
{
  "name": "美国 AI 行业洞察（更新）",
  "description": "新的描述",
  "status": "ACTIVE",
  "refreshFrequency": "MONTHLY",
  "topicConfig": {
    "country": "United States",
    "industry": "AI",
    "focusAreas": ["policy", "market", "technology", "investment"]
  }
}
```

**Response (200)**:

```json
{
  "id": "topic_abc123",
  "name": "美国 AI 行业洞察（更新）",
  "updatedAt": "2026-01-11T10:00:00Z"
}
```

### 1.5 删除专题

删除专题（级联删除所有报告、维度、证据）。

```http
DELETE /api/topic-research/topics/:id
```

**Response (200)**:

```json
{
  "success": true,
  "message": "专题已删除"
}
```

### 1.6 归档专题

将专题归档（停止自动刷新，但保留历史数据）。

```http
POST /api/topic-research/topics/:id/archive
```

**Response (200)**:

```json
{
  "id": "topic_abc123",
  "status": "ARCHIVED",
  "message": "专题已归档"
}
```

### 1.7 恢复专题

恢复已归档的专题。

```http
POST /api/topic-research/topics/:id/restore
```

**Response (200)**:

```json
{
  "id": "topic_abc123",
  "status": "ACTIVE",
  "message": "专题已恢复"
}
```

---

## 2. Refresh Operations

### 2.1 触发全量/增量刷新

手动触发专题刷新（支持全量或增量）。

```http
POST /api/topic-research/topics/:id/refresh
```

**Request Body**:

```json
{
  "type": "INCREMENTAL",
  "dimensionIds": ["dim_001", "dim_002"],
  "priority": "HIGH",
  "notify": true,
  "notificationEmail": "user@example.com"
}
```

**Request Body Schema**:

- `type` (optional): `FULL` | `INCREMENTAL` | `DIMENSION` - 刷新类型，默认 `INCREMENTAL`
- `dimensionIds` (optional): 仅刷新指定维度（type 为 DIMENSION 时必需）
- `priority` (optional): `LOW` | `NORMAL` | `HIGH` - 优先级，默认 `NORMAL`
- `notify` (optional): 是否发送完成通知，默认 `false`
- `notificationEmail` (optional): 通知邮箱

**Response (202)**:

```json
{
  "jobId": "refresh_job_xyz",
  "topicId": "topic_abc123",
  "type": "INCREMENTAL",
  "status": "PENDING",
  "estimatedDuration": 1800,
  "createdAt": "2026-01-11T10:00:00Z"
}
```

### 2.2 流式刷新 (SSE)

通过 Server-Sent Events 实时推送刷新进度。

```http
POST /api/topic-research/topics/:id/refresh/stream
```

**Request Body**: 同 2.1

**Response Headers**:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**SSE Event Types**:

**1. 开始事件**:

```
event: start
data: {"topicId":"topic_abc123","type":"INCREMENTAL","timestamp":"2026-01-11T10:00:00Z"}
```

**2. 维度进度**:

```
event: dimension:start
data: {"dimensionId":"dim_001","name":"政策法规","status":"RESEARCHING"}

event: dimension:progress
data: {"dimensionId":"dim_001","progress":50,"sourcesFound":12,"message":"正在分析搜索结果..."}

event: dimension:complete
data: {"dimensionId":"dim_001","status":"COMPLETED","sourcesUsed":15,"tokensUsed":2500}
```

**3. 报告生成**:

```
event: report:start
data: {"message":"开始生成报告..."}

event: report:progress
data: {"progress":70,"message":"正在综合维度分析..."}

event: report:complete
data: {"reportId":"report_xyz","version":6}
```

**4. 完成/错误**:

```
event: complete
data: {"reportId":"report_xyz","totalSources":127,"totalTokens":15000,"duration":1650}

event: error
data: {"error":"数据源超时","dimensionId":"dim_003"}
```

**5. 结束标记**:

```
data: [DONE]
```

### 2.3 获取刷新状态

查询刷新任务的当前状态。

```http
GET /api/topic-research/topics/:id/refresh/status
```

**Query Parameters**:

- `jobId` (optional): 指定任务 ID，默认查询最新任务

**Response (200)**:

```json
{
  "jobId": "refresh_job_xyz",
  "topicId": "topic_abc123",
  "type": "INCREMENTAL",
  "status": "RUNNING",
  "progress": 65,
  "currentDimension": {
    "id": "dim_003",
    "name": "竞争格局",
    "status": "RESEARCHING"
  },
  "completedDimensions": ["dim_001", "dim_002"],
  "totalDimensions": 8,
  "sourcesFound": 48,
  "tokensUsed": 8500,
  "startedAt": "2026-01-11T10:00:00Z",
  "estimatedCompletionAt": "2026-01-11T10:30:00Z"
}
```

### 2.4 维度级刷新

刷新单个维度（用于定向更新）。

```http
POST /api/topic-research/topics/:id/dimensions/:dimId/refresh
```

**Request Body**:

```json
{
  "priority": "HIGH",
  "regenerate": true
}
```

**Response (202)**:

```json
{
  "jobId": "dim_refresh_xyz",
  "dimensionId": "dim_001",
  "status": "PENDING",
  "message": "维度刷新已加入队列"
}
```

### 2.5 取消刷新任务

取消正在进行的刷新任务。

```http
POST /api/topic-research/topics/:id/refresh/cancel
```

**Request Body**:

```json
{
  "jobId": "refresh_job_xyz"
}
```

**Response (200)**:

```json
{
  "jobId": "refresh_job_xyz",
  "status": "CANCELLED",
  "message": "刷新任务已取消"
}
```

---

## 3. Reports

### 3.1 获取报告列表

获取专题的所有历史报告版本。

```http
GET /api/topic-research/topics/:id/reports
```

**Query Parameters**:

- `limit` (optional): 数量限制，默认 10
- `cursor` (optional): 分页游标

**Response (200)**:

```json
{
  "items": [
    {
      "id": "report_xyz",
      "version": 6,
      "versionLabel": "2026-01 更新",
      "executiveSummary": "2026年1月，美国AI行业呈现以下特征...",
      "highlights": [
        {
          "title": "政策重大突破",
          "content": "拜登政府发布新版AI安全框架..."
        }
      ],
      "totalDimensions": 8,
      "totalSources": 127,
      "totalTokens": 15000,
      "isIncremental": true,
      "changesFromPrev": {
        "updatedDimensions": ["dim_001", "dim_005"],
        "newSources": 15
      },
      "generatedAt": "2026-01-10T09:00:00Z",
      "generationTimeMs": 1650000
    },
    {
      "id": "report_abc",
      "version": 5,
      "versionLabel": "2026-01 初版",
      "generatedAt": "2026-01-03T09:00:00Z"
    }
  ],
  "pagination": {
    "cursor": "report_abc",
    "hasMore": true
  }
}
```

### 3.2 获取报告详情

获取指定版本的完整报告。

```http
GET /api/topic-research/topics/:id/reports/:version
```

**Path Parameters**:

- `version`: 报告版本号 (1, 2, 3...) 或 `latest`

**Response (200)**:

```json
{
  "id": "report_xyz",
  "topicId": "topic_abc123",
  "version": 6,
  "versionLabel": "2026-01 更新",
  "executiveSummary": "# 执行摘要\n\n2026年1月，美国AI行业呈现以下特征...",
  "fullReport": "# 美国 AI 宏观洞察报告\n\n## 1. 政策法规\n\n### 1.1 最新政策...",
  "highlights": [
    {
      "title": "政策重大突破",
      "content": "拜登政府发布新版AI安全框架...",
      "dimensionId": "dim_001",
      "importance": "HIGH"
    }
  ],
  "dimensionAnalyses": [
    {
      "dimensionId": "dim_001",
      "dimensionName": "政策法规",
      "summary": "2026年1月，美国AI政策监管框架持续完善...",
      "keyFindings": [
        {
          "title": "AI安全框架更新",
          "content": "拜登政府发布新版AI安全框架，重点关注...",
          "sources": [1, 2, 5]
        }
      ],
      "dataPoints": [
        {
          "metric": "新政策数量",
          "value": "5项",
          "source": 3
        }
      ],
      "sourcesUsed": 15,
      "modelUsed": "claude-sonnet-4-20250514",
      "tokensUsed": 2500
    }
  ],
  "totalDimensions": 8,
  "totalSources": 127,
  "totalTokens": 15000,
  "isIncremental": true,
  "changesFromPrev": {
    "updatedDimensions": ["dim_001", "dim_005"],
    "newSources": 15,
    "summary": "本次更新重点刷新了政策法规和投资动态维度"
  },
  "generatedAt": "2026-01-10T09:00:00Z",
  "generationTimeMs": 1650000
}
```

**Markdown Format** (fullReport):
报告使用 Markdown 格式，引用使用脚注语法 `[1]`, `[2]`，对应 evidences 中的 citationIndex。

### 3.3 导出报告

导出报告为 PDF 或 DOCX 格式。

```http
GET /api/topic-research/topics/:id/reports/:version/export?format=pdf
```

**Query Parameters**:

- `format`: `pdf` | `docx`
- `includeEvidence` (optional): 是否包含证据列表，默认 `true`
- `includeMetadata` (optional): 是否包含元数据，默认 `false`

**Response (200)**:

```json
{
  "downloadUrl": "https://storage.example.com/exports/report_xyz.pdf",
  "expiresAt": "2026-01-11T12:00:00Z",
  "fileSize": 2457600,
  "format": "pdf"
}
```

### 3.4 比较报告版本

比较两个版本的报告差异。

```http
GET /api/topic-research/topics/:id/reports/compare?from=5&to=6
```

**Query Parameters**:

- `from`: 起始版本号
- `to`: 目标版本号

**Response (200)**:

```json
{
  "fromVersion": 5,
  "toVersion": 6,
  "generatedAt": "2026-01-11T10:00:00Z",
  "summary": "本次更新主要变化：政策法规和投资动态维度有重大更新",
  "dimensionChanges": [
    {
      "dimensionId": "dim_001",
      "dimensionName": "政策法规",
      "changeType": "UPDATED",
      "newSourcesCount": 8,
      "contentDiff": {
        "added": ["AI安全框架更新", "欧盟AI法案影响"],
        "removed": [],
        "modified": ["政策监管趋势"]
      }
    },
    {
      "dimensionId": "dim_002",
      "dimensionName": "市场概览",
      "changeType": "UNCHANGED"
    }
  ],
  "newHighlights": [
    {
      "title": "政策重大突破",
      "content": "拜登政府发布新版AI安全框架..."
    }
  ],
  "removedHighlights": []
}
```

---

## 4. Evidence (证据/来源)

### 4.1 获取报告证据列表

获取报告中引用的所有证据来源。

```http
GET /api/topic-research/topics/:id/reports/:version/evidence
```

**Query Parameters**:

- `dimensionId` (optional): 仅获取指定维度的证据
- `sourceType` (optional): 过滤来源类型 - `web`, `academic`, `news`, `github`
- `minCredibility` (optional): 最低可信度分数 (0-100)
- `sortBy` (optional): 排序方式 - `citationIndex` | `credibilityScore` | `publishedAt`

**Response (200)**:

```json
{
  "items": [
    {
      "id": "evidence_001",
      "reportId": "report_xyz",
      "analysisId": "analysis_001",
      "dimensionName": "政策法规",
      "citationIndex": 1,
      "title": "Biden Administration Releases Updated AI Safety Framework",
      "url": "https://whitehouse.gov/ai-safety-framework-2026",
      "domain": "whitehouse.gov",
      "snippet": "The Biden administration today released an updated AI safety framework...",
      "sourceType": "web",
      "publishedAt": "2026-01-05T10:00:00Z",
      "accessedAt": "2026-01-10T09:05:00Z",
      "credibilityScore": 95,
      "usedInDimensions": ["dim_001", "dim_007"]
    },
    {
      "id": "evidence_002",
      "citationIndex": 2,
      "title": "Attention Is All You Need 2.0",
      "url": "https://arxiv.org/abs/2601.00001",
      "sourceType": "academic",
      "publishedAt": "2026-01-02T00:00:00Z",
      "credibilityScore": 98
    }
  ],
  "pagination": {
    "total": 127,
    "page": 1,
    "pageSize": 50
  }
}
```

### 4.2 获取证据详情

获取单个证据的完整信息。

```http
GET /api/topic-research/topics/:id/reports/:version/evidence/:evidenceId
```

**Response (200)**:

```json
{
  "id": "evidence_001",
  "reportId": "report_xyz",
  "analysisId": "analysis_001",
  "dimensionName": "政策法规",
  "citationIndex": 1,
  "title": "Biden Administration Releases Updated AI Safety Framework",
  "url": "https://whitehouse.gov/ai-safety-framework-2026",
  "domain": "whitehouse.gov",
  "snippet": "The Biden administration today released an updated AI safety framework focusing on three pillars: transparency, accountability, and safety testing...",
  "fullContent": "<!-- 如果已抓取完整内容 -->",
  "sourceType": "web",
  "publishedAt": "2026-01-05T10:00:00Z",
  "accessedAt": "2026-01-10T09:05:00Z",
  "credibilityScore": 95,
  "credibilityBreakdown": {
    "domainAuthority": 100,
    "sourceType": 90,
    "citationCount": 0,
    "recency": 95,
    "contentDepth": 85
  },
  "usedInDimensions": [
    {
      "dimensionId": "dim_001",
      "dimensionName": "政策法规",
      "keyFindings": ["AI安全框架更新"]
    }
  ],
  "metadata": {
    "author": "White House Press Office",
    "language": "en",
    "wordCount": 1500
  }
}
```

---

## 5. Dimensions (维度管理)

### 5.1 获取专题维度列表

获取专题的所有维度配置。

```http
GET /api/topic-research/topics/:id/dimensions
```

**Response (200)**:

```json
{
  "items": [
    {
      "id": "dim_001",
      "topicId": "topic_abc123",
      "name": "政策法规",
      "description": "政府政策、法规和激励措施",
      "sortOrder": 1,
      "isEnabled": true,
      "status": "COMPLETED",
      "lastResearchedAt": "2026-01-10T09:15:00Z",
      "searchQueries": ["US AI policy", "AI regulation USA"],
      "searchSources": ["web", "local_policy", "news"],
      "minSources": 5
    }
  ]
}
```

### 5.2 添加维度

向专题添加新维度。

```http
POST /api/topic-research/topics/:id/dimensions
```

**Request Body**:

```json
{
  "name": "国际合作",
  "description": "跨境AI合作与竞争",
  "sortOrder": 9,
  "searchQueries": ["AI international cooperation", "US China AI"],
  "searchSources": ["web", "news"],
  "minSources": 5
}
```

**Response (201)**:

```json
{
  "id": "dim_009",
  "name": "国际合作",
  "status": "PENDING",
  "message": "维度已添加"
}
```

### 5.3 更新维度

更新维度配置。

```http
PATCH /api/topic-research/topics/:id/dimensions/:dimId
```

**Request Body**:

```json
{
  "name": "国际动态（更新）",
  "description": "新的描述",
  "isEnabled": false,
  "searchQueries": ["AI geopolitics", "US China AI race"],
  "sortOrder": 8
}
```

**Response (200)**:

```json
{
  "id": "dim_009",
  "name": "国际动态（更新）",
  "isEnabled": false
}
```

### 5.4 删除维度

删除维度（软删除，历史分析保留）。

```http
DELETE /api/topic-research/topics/:id/dimensions/:dimId
```

**Response (200)**:

```json
{
  "success": true,
  "message": "维度已删除"
}
```

### 5.5 调整维度顺序

批量调整维度显示顺序。

```http
PUT /api/topic-research/topics/:id/dimensions/order
```

**Request Body**:

```json
{
  "dimensionIds": ["dim_001", "dim_003", "dim_002", "dim_004"]
}
```

**Response (200)**:

```json
{
  "success": true,
  "message": "维度顺序已更新"
}
```

---

## 6. Templates (模板)

### 6.1 获取模板列表

获取预定义的维度模板。

```http
GET /api/topic-research/templates
```

**Query Parameters**:

- `type`: `MACRO` | `TECHNOLOGY` | `COMPANY`

**Response (200)**:

```json
{
  "type": "MACRO",
  "templates": [
    {
      "id": "template_macro_default",
      "name": "宏观洞察标准模板",
      "description": "适用于国家/行业宏观分析",
      "dimensions": [
        {
          "name": "政策法规",
          "description": "政府政策、法规和激励措施",
          "searchQueries": ["{topic} government policy", "{topic} regulation"],
          "searchSources": ["web", "local_policy", "news"],
          "sortOrder": 1
        },
        {
          "name": "市场概览",
          "description": "市场规模、增长趋势和细分",
          "searchQueries": ["{topic} market size", "{topic} market growth"],
          "searchSources": ["web", "local_report", "news"],
          "sortOrder": 2
        }
      ]
    }
  ]
}
```

### 6.2 从模板创建专题

使用模板快速创建专题。

```http
POST /api/topic-research/topics/from-template
```

**Request Body**:

```json
{
  "templateId": "template_macro_default",
  "name": "德国 AI 宏观洞察",
  "topicConfig": {
    "country": "Germany",
    "industry": "Artificial Intelligence"
  },
  "customizations": {
    "dimensions": {
      "add": [
        {
          "name": "欧盟法规",
          "description": "EU AI Act 影响分析"
        }
      ],
      "remove": ["人才生态"]
    }
  }
}
```

**Response (201)**:

```json
{
  "id": "topic_new123",
  "name": "德国 AI 宏观洞察",
  "type": "MACRO",
  "dimensions": [
    { "id": "dim_001", "name": "政策法规" },
    { "id": "dim_002", "name": "市场概览" },
    { "id": "dim_009", "name": "欧盟法规" }
  ]
}
```

---

## 7. Schedules (定时任务)

### 7.1 获取刷新计划

获取专题的自动刷新计划。

```http
GET /api/topic-research/topics/:id/schedules
```

**Response (200)**:

```json
{
  "items": [
    {
      "id": "schedule_001",
      "topicId": "topic_abc123",
      "frequency": "WEEKLY",
      "dayOfWeek": 1,
      "hourOfDay": 9,
      "isActive": true,
      "lastRunAt": "2026-01-10T09:00:00Z",
      "nextRunAt": "2026-01-17T09:00:00Z"
    }
  ]
}
```

### 7.2 更新刷新计划

更新自动刷新配置。

```http
PUT /api/topic-research/topics/:id/schedules
```

**Request Body**:

```json
{
  "frequency": "MONTHLY",
  "dayOfMonth": 1,
  "hourOfDay": 9,
  "isActive": true
}
```

**Response (200)**:

```json
{
  "id": "schedule_001",
  "frequency": "MONTHLY",
  "nextRunAt": "2026-02-01T09:00:00Z"
}
```

---

## 8. Logs (刷新日志)

### 8.1 获取刷新日志

获取专题的历史刷新记录。

```http
GET /api/topic-research/topics/:id/logs
```

**Query Parameters**:

- `limit` (optional): 数量限制，默认 20
- `status` (optional): 过滤状态 - `completed` | `failed` | `running`

**Response (200)**:

```json
{
  "items": [
    {
      "id": "log_001",
      "topicId": "topic_abc123",
      "triggerType": "scheduled",
      "startedAt": "2026-01-10T09:00:00Z",
      "completedAt": "2026-01-10T09:27:30Z",
      "status": "completed",
      "reportId": "report_xyz",
      "dimensionsRefreshed": 8,
      "sourcesFound": 127,
      "tokensUsed": 15000,
      "error": null
    },
    {
      "id": "log_002",
      "triggerType": "manual",
      "startedAt": "2026-01-03T14:30:00Z",
      "completedAt": "2026-01-03T14:52:00Z",
      "status": "completed"
    }
  ],
  "pagination": {
    "total": 45,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 9. Statistics (统计)

### 9.1 获取专题统计

获取专题的总体统计信息。

```http
GET /api/topic-research/topics/:id/stats
```

**Response (200)**:

```json
{
  "topicId": "topic_abc123",
  "totalReports": 6,
  "totalSources": 487,
  "totalTokens": 72500,
  "totalCost": 145,
  "dimensionStats": [
    {
      "dimensionId": "dim_001",
      "dimensionName": "政策法规",
      "totalSources": 85,
      "avgSourcesPerReport": 14,
      "lastUpdated": "2026-01-10T09:15:00Z"
    }
  ],
  "refreshStats": {
    "totalRefreshes": 6,
    "successRate": 100,
    "avgDuration": 1620000,
    "lastRefresh": "2026-01-10T09:00:00Z"
  },
  "credibilityDistribution": {
    "high": 87,
    "medium": 35,
    "low": 5
  }
}
```

---

## Error Responses

所有端点遵循统一的错误响应格式。

### 错误响应格式

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "专题名称不能为空",
  "timestamp": "2026-01-11T10:00:00Z",
  "path": "/api/topic-research/topics"
}
```

### 常见错误码

| 状态码 | 错误类型              | 说明                   |
| ------ | --------------------- | ---------------------- |
| 400    | Bad Request           | 请求参数错误           |
| 401    | Unauthorized          | 未认证                 |
| 403    | Forbidden             | 无权限访问             |
| 404    | Not Found             | 资源不存在             |
| 409    | Conflict              | 资源冲突（如重复创建） |
| 429    | Too Many Requests     | 请求过于频繁           |
| 500    | Internal Server Error | 服务器内部错误         |
| 503    | Service Unavailable   | 服务暂时不可用         |

### 业务错误码

在 `message` 字段中返回业务错误：

```json
{
  "statusCode": 400,
  "error": "REFRESH_IN_PROGRESS",
  "message": "专题正在刷新中，请稍后再试",
  "details": {
    "currentJobId": "refresh_job_xyz",
    "progress": 65
  }
}
```

**常见业务错误**:

- `REFRESH_IN_PROGRESS` - 刷新进行中
- `INSUFFICIENT_CREDITS` - 积分不足
- `INVALID_DIMENSION_CONFIG` - 维度配置无效
- `REPORT_NOT_READY` - 报告未准备好
- `TEMPLATE_NOT_FOUND` - 模板不存在

---

## Rate Limiting

API 实施速率限制以保护服务质量。

**限制规则**:

- 创建专题: 10 次/小时
- 触发刷新: 5 次/小时
- 查询接口: 100 次/分钟
- 导出报告: 10 次/小时

**响应头**:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1736596800
```

**超限响应 (429)**:

```json
{
  "statusCode": 429,
  "error": "Too Many Requests",
  "message": "请求过于频繁，请稍后再试",
  "retryAfter": 60
}
```

---

## Webhooks (Future)

v1.1 将支持 Webhook 通知。

**事件类型**:

- `topic.refresh.completed` - 刷新完成
- `topic.refresh.failed` - 刷新失败
- `report.generated` - 报告生成
- `dimension.updated` - 维度更新

---

## Version History

| Version | Date       | Changes  |
| ------- | ---------- | -------- |
| 1.0     | 2026-01-11 | 初始版本 |
