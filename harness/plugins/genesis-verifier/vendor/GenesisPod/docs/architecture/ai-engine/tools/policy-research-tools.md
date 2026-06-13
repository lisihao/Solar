# 政策研究工具系统设计文档

> **版本:** v1.0
> **创建日期:** 2026-01-20
> **状态:** 待实施
> **作者:** Claude Code

---

## 1. 概述

### 1.1 背景

为支持 AI 研究和分析任务中的政策法规分析需求，需要集成美国政府官方数据源，包括联邦公报（Federal Register）、国会立法（Congress.gov）和白宫新闻（White House）。

### 1.2 目标

| #   | 问题                | 解决方案                                                                  |
| --- | ------------------- | ------------------------------------------------------------------------- |
| 1   | 数据源问题          | 接入 Federal Register、Congress.gov、White House 三个官方数据源           |
| 2   | 获取数据源的工具    | 创建 3 个新工具：FederalRegisterTool、CongressGovTool、WhiteHouseNewsTool |
| 3   | 工具共享机制        | 注册到全局 ToolRegistry，通过 AIEngineFacade 提供给所有模块               |
| 4   | Agent 使用工具      | 通过 FunctionCallingExecutor 的 LLM Function Calling 机制                 |
| 5   | Leader 指定工具能力 | 在 Topic Research 的 Leader 规划中添加政策工具选项                        |

---

## 2. 数据源配置

### 2.1 数据源清单

| 数据源               | URL                                    | API Key        | 数据类型             | 更新频率 |
| -------------------- | -------------------------------------- | -------------- | -------------------- | -------- |
| **Federal Register** | https://www.federalregister.gov/api/v1 | 免费公开       | 行政命令、法规、通知 | 实时     |
| **Congress.gov**     | https://api.congress.gov/v3            | 需申请(免费)   | 法案、立法、投票记录 | 实时     |
| **White House**      | https://www.whitehouse.gov/news/       | 无需(网页抓取) | 声明、新闻、行政令   | 实时     |

### 2.2 API Key 申请流程

**Congress.gov API:**

1. 访问 https://api.congress.gov/sign-up/
2. 填写邮箱注册
3. 邮件确认后获得 API Key
4. 在 Tools Manager > Policy Research > Congress.gov 配置

---

## 3. 系统架构

### 3.1 工具共享架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    AiEngineModule (@Global)                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    ToolRegistry (单例)                    │    │
│  │  ├── federal-register                                    │    │
│  │  ├── congress-gov                                        │    │
│  │  ├── whitehouse-news                                     │    │
│  │  ├── web-search (现有)                                   │    │
│  │  ├── web-scraper (现有)                                  │    │
│  │  └── ... 其他工具                                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   AIEngineFacade                         │    │
│  │  • executeTool(toolId, input)                           │    │
│  │  • getAvailableTools(category?)                         │    │
│  │  • getToolFunctionDefinitions(toolIds?)                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   AI Ask      │    │  AI Research  │    │   AI Teams    │
│   Module      │    │    Module     │    │    Module     │
└───────────────┘    └───────────────┘    └───────────────┘
```

### 3.2 工具调用流程

```
Agent 接收任务
    │
    ▼
FunctionCallingExecutor.execute(tools: ['federal-register', 'congress-gov', ...])
    │
    ├── 1. 从 ToolRegistry 获取 FunctionDefinitions
    │
    ├── 2. 发送给 LLM (带 tools 参数)
    │      {
    │        messages: [...],
    │        tools: [
    │          { type: "function", function: { name: "federal-register", ... } },
    │          { type: "function", function: { name: "congress-gov", ... } }
    │        ],
    │        tool_choice: "auto"
    │      }
    │
    ├── 3. LLM 决定调用哪个工具
    │      → tool_calls: [{ name: "federal-register", arguments: {...} }]
    │
    ├── 4. 执行工具
    │      → toolRegistry.get("federal-register").execute(input, context)
    │
    └── 5. 返回结果给 LLM，继续推理
```

---

## 4. 工具实现设计

### 4.1 文件结构

```
backend/src/modules/ai-engine/tools/categories/information/policy/
├── index.ts                      # 导出所有政策工具
├── policy-data.service.ts        # 共享服务(API Key获取、HTTP请求)
├── federal-register.tool.ts      # Federal Register 工具
├── congress-gov.tool.ts          # Congress.gov 工具
└── whitehouse-news.tool.ts       # White House 工具
```

### 4.2 FederalRegisterTool

**文件:** `backend/src/modules/ai-engine/tools/categories/information/policy/federal-register.tool.ts`

```typescript
@Injectable()
export class FederalRegisterTool extends BaseTool<
  FederalRegisterInput,
  FederalRegisterOutput
> {
  readonly id = "federal-register";
  readonly name = "Federal Register Search";
  readonly description = "搜索联邦公报：行政命令、法规、拟议规则、机构通知";
  readonly category: ToolCategory = "information";
  readonly tags = ["policy", "regulation", "executive-order"];

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      documentType: {
        type: "string",
        enum: ["RULE", "PRORULE", "NOTICE", "PRESDOC"],
        description: "RULE=最终规则, PRORULE=拟议规则, PRESDOC=总统文件",
      },
      agency: { type: "string", description: "机构名称" },
      startDate: { type: "string", description: "开始日期 YYYY-MM-DD" },
      endDate: { type: "string", description: "结束日期 YYYY-MM-DD" },
      maxResults: { type: "number", default: 10 },
    },
  };

  protected async doExecute(input, context): Promise<FederalRegisterOutput> {
    // API: https://www.federalregister.gov/api/v1/documents.json
    // 无需 API Key
  }
}
```

**输入参数:**

| 参数         | 类型   | 必填 | 描述                        |
| ------------ | ------ | ---- | --------------------------- |
| query        | string | 否   | 搜索关键词                  |
| documentType | enum   | 否   | RULE/PRORULE/NOTICE/PRESDOC |
| agency       | string | 否   | 机构名称                    |
| startDate    | string | 否   | 开始日期 (YYYY-MM-DD)       |
| endDate      | string | 否   | 结束日期 (YYYY-MM-DD)       |
| maxResults   | number | 否   | 最大结果数 (默认10)         |

### 4.3 CongressGovTool

**文件:** `backend/src/modules/ai-engine/tools/categories/information/policy/congress-gov.tool.ts`

```typescript
@Injectable()
export class CongressGovTool extends BaseTool<
  CongressGovInput,
  CongressGovOutput
> {
  readonly id = "congress-gov";
  readonly name = "Congress Legislation Search";
  readonly description = "搜索国会法案、立法、决议、投票记录";
  readonly category: ToolCategory = "information";
  readonly tags = ["policy", "legislation", "congress", "bills"];

  constructor(private readonly policyDataService: PolicyDataService) {
    super();
  }

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      congress: { type: "number", description: "国会届数(如118)" },
      billType: { type: "string", enum: ["hr", "s", "hjres", "sjres"] },
      status: {
        type: "string",
        enum: ["introduced", "passed_house", "passed_senate", "enacted"],
      },
      limit: { type: "number", default: 20 },
    },
  };

  protected async doExecute(input, context): Promise<CongressGovOutput> {
    // 需要 API Key (从 Secret Manager 获取)
    const apiKey = await this.policyDataService.getApiKey(this.id);
    if (!apiKey) {
      return { success: false, error: "Congress.gov API Key 未配置" };
    }
    // API: https://api.congress.gov/v3/bill?api_key=xxx
  }
}
```

**输入参数:**

| 参数     | 类型   | 必填 | 描述                                          |
| -------- | ------ | ---- | --------------------------------------------- |
| query    | string | 否   | 搜索关键词                                    |
| congress | number | 否   | 国会届数 (如 118, 119)                        |
| billType | enum   | 否   | hr/s/hjres/sjres                              |
| status   | enum   | 否   | introduced/passed_house/passed_senate/enacted |
| limit    | number | 否   | 最大结果数 (默认20)                           |

### 4.4 WhiteHouseNewsTool

**文件:** `backend/src/modules/ai-engine/tools/categories/information/policy/whitehouse-news.tool.ts`

```typescript
@Injectable()
export class WhiteHouseNewsTool extends BaseTool<
  WhiteHouseNewsInput,
  WhiteHouseNewsOutput
> {
  readonly id = "whitehouse-news";
  readonly name = "White House News";
  readonly description = "获取白宫官方声明、新闻发布、行政命令";
  readonly category: ToolCategory = "information";
  readonly tags = ["policy", "executive", "whitehouse"];

  constructor(private readonly searchService: SearchService) {
    super();
  }

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      contentType: {
        type: "string",
        enum: ["statements", "press-briefings", "executive-orders", "all"],
      },
      limit: { type: "number", default: 10 },
    },
  };

  protected async doExecute(input, context): Promise<WhiteHouseNewsOutput> {
    // 使用 Jina Reader 或 Firecrawl 抓取网页
    // URL: https://www.whitehouse.gov/news/
  }
}
```

**输入参数:**

| 参数        | 类型   | 必填 | 描述                                            |
| ----------- | ------ | ---- | ----------------------------------------------- |
| query       | string | 否   | 搜索关键词                                      |
| contentType | enum   | 否   | statements/press-briefings/executive-orders/all |
| limit       | number | 否   | 最大结果数 (默认10)                             |

### 4.5 PolicyDataService

**文件:** `backend/src/modules/ai-engine/tools/categories/information/policy/policy-data.service.ts`

```typescript
@Injectable()
export class PolicyDataService {
  constructor(
    private readonly httpService: HttpService,
    private readonly prisma: PrismaService,
    private readonly secretsService: SecretsService,
  ) {}

  /**
   * 从 Secret Manager 获取工具的 API Key
   */
  async getApiKey(toolId: string): Promise<string | null> {
    const toolConfig = await this.prisma.toolConfig.findUnique({
      where: { toolId },
    });
    if (toolConfig?.secretKey) {
      return this.secretsService.getValue(toolConfig.secretKey);
    }
    return null;
  }

  /**
   * 带认证的 HTTP 请求
   */
  async fetchWithAuth(
    url: string,
    options: {
      apiKey?: string;
      headers?: Record<string, string>;
      timeout?: number;
    },
  ): Promise<any> {
    // 实现
  }
}
```

---

## 5. 工具注册与共享

### 5.1 注册到全局 ToolRegistry

**修改文件:** `backend/src/modules/ai-engine/ai-engine.module.ts`

```typescript
import {
  FederalRegisterTool,
  CongressGovTool,
  WhiteHouseNewsTool,
  PolicyDataService,
} from "./tools/categories/information/policy";

@Global()
@Module({
  providers: [
    // ... 现有 providers

    // 政策工具
    PolicyDataService,
    FederalRegisterTool,
    CongressGovTool,
    WhiteHouseNewsTool,
  ],
  exports: [
    ToolRegistry, // 已导出，新工具自动可用
    FederalRegisterTool,
    CongressGovTool,
    WhiteHouseNewsTool,
  ],
})
export class AiEngineModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly federalRegisterTool: FederalRegisterTool,
    private readonly congressGovTool: CongressGovTool,
    private readonly whiteHouseNewsTool: WhiteHouseNewsTool,
  ) {}

  onModuleInit() {
    // 注册政策工具到全局 Registry
    this.toolRegistry.register(this.federalRegisterTool);
    this.toolRegistry.register(this.congressGovTool);
    this.toolRegistry.register(this.whiteHouseNewsTool);
  }
}
```

### 5.2 各模块工具配置

| 模块        | 可用工具                                                    | 配置位置                                 |
| ----------- | ----------------------------------------------------------- | ---------------------------------------- |
| AI Ask      | 全部信息类工具                                              | `ai-ask.service.ts`                      |
| AI Research | web-search, federal-register, congress-gov, whitehouse-news | Leader 规划                              |
| AI Teams    | 按角色分配                                                  | `team-member.agent.ts` ROLE_TOOL_MAPPING |
| AI Writing  | text-generation, web-search                                 | `writing.service.ts`                     |

---

## 6. Leader 指定工具能力

### 6.1 Topic Research Leader 规划更新

**修改文件:** `backend/src/modules/ai-app/research/topic-research/services/research-leader.service.ts`

在 `DIMENSION_OUTLINE_PROMPT` 中添加政策工具选项：

```typescript
const DIMENSION_OUTLINE_PROMPT = `
...
## agentConfig 配置指南

### tools（可选工具）
- "web-search": 网页搜索
- "data-analysis": 数据分析
- "rag-search": 内部知识库搜索
- "federal-register": 联邦公报搜索（行政命令、法规）  // NEW
- "congress-gov": 国会立法搜索（法案、决议）        // NEW
- "whitehouse-news": 白宫新闻（声明、政策）         // NEW

### skills（分析技能）
- "trend_analysis": 趋势分析
- "policy_analysis": 政策分析          // NEW
- "regulatory_impact": 监管影响评估    // NEW
- "legislative_tracking": 立法追踪     // NEW
...
`;
```

### 6.2 Leader 智能分配示例

当用户研究主题涉及政策时，Leader 会自动分配：

```json
{
  "taskUnderstanding": {
    "topic": "AI芯片出口管制政策影响",
    "scope": "美国对华AI芯片出口限制及产业影响"
  },
  "dimensions": [
    {
      "id": "regulatory",
      "title": "监管政策分析",
      "agentConfig": {
        "tools": ["federal-register", "whitehouse-news"],
        "skills": ["policy_analysis", "regulatory_impact"]
      }
    },
    {
      "id": "legislative",
      "title": "立法动态追踪",
      "agentConfig": {
        "tools": ["congress-gov"],
        "skills": ["legislative_tracking"]
      }
    }
  ]
}
```

---

## 7. Admin UI 配置

### 7.1 工具定义更新

**修改文件:** `backend/src/modules/platform/admin/capabilities-admin.service.ts`

在 `getToolDefinitions()` 方法中添加：

```typescript
// 政策研究工具
{
  id: 'federal-register',
  name: 'federal-register',
  displayName: 'Federal Register',
  description: '联邦公报 - 行政命令、法规、通知',
  category: 'policy-research',
  tags: ['policy', 'regulation', 'executive-order'],
  noKeyRequired: true,
},
{
  id: 'congress-gov',
  name: 'congress-gov',
  displayName: 'Congress.gov',
  description: '国会立法 - 法案、决议、投票',
  category: 'policy-research',
  tags: ['policy', 'legislation', 'bills'],
},
{
  id: 'whitehouse-news',
  name: 'whitehouse-news',
  displayName: 'White House News',
  description: '白宫新闻 - 声明、新闻发布',
  category: 'policy-research',
  tags: ['policy', 'executive', 'announcements'],
  noKeyRequired: true,
},
```

### 7.2 前端 UI 更新

**修改文件:** `frontend/components/admin/ToolsManagement.tsx`

```typescript
// 添加分类
{ id: 'policy', labelKey: 'admin.tools.categories.policy', icon: FileText },

// 添加工具定义
{
  id: 'federal-register',
  name: 'Federal Register',
  category: 'policy',
  url: 'https://www.federalregister.gov/developers/documentation/api/v1',
  noKeyRequired: true,
},
{
  id: 'congress-gov',
  name: 'Congress.gov',
  category: 'policy',
  url: 'https://api.congress.gov/',
  freeQuota: '5,000 requests/hour',
},
{
  id: 'whitehouse-news',
  name: 'White House News',
  category: 'policy',
  url: 'https://www.whitehouse.gov/news/',
  noKeyRequired: true,
},
```

### 7.3 i18n 翻译

**en.json:**

```json
"categories": {
  "policy": "Policy Research"
},
"providers": {
  "federal-register": {
    "description": "Search federal regulations, executive orders, and agency notices"
  },
  "congress-gov": {
    "description": "Track legislation and bills from Congress"
  },
  "whitehouse-news": {
    "description": "Official White House announcements and press briefings"
  }
}
```

**zh.json:**

```json
"categories": {
  "policy": "政策研究"
},
"providers": {
  "federal-register": {
    "description": "搜索联邦法规、行政命令、机构通知"
  },
  "congress-gov": {
    "description": "追踪国会法案和立法进程"
  },
  "whitehouse-news": {
    "description": "白宫官方声明和新闻发布"
  }
}
```

---

## 8. 实施步骤

### Phase 1: 后端工具实现

1. 创建 `policy/` 目录和文件结构
2. 实现 `PolicyDataService` 共享服务
3. 实现 `FederalRegisterTool`
4. 实现 `CongressGovTool`
5. 实现 `WhiteHouseNewsTool`
6. 导出和索引文件

### Phase 2: 工具注册

1. 更新 `ai-engine.module.ts` 注册工具
2. 确保工具在 `onModuleInit` 中注册到 ToolRegistry

### Phase 3: Admin 配置

1. 更新 `capabilities-admin.service.ts` 添加工具定义
2. 更新 `ToolsManagement.tsx` 添加 UI
3. 添加 i18n 翻译

### Phase 4: Leader 集成

1. 更新 `research-leader.service.ts` 的 DIMENSION_OUTLINE_PROMPT
2. 添加政策分析相关 skills

### Phase 5: 测试验证

1. 单元测试各工具
2. 集成测试工具注册和共享
3. E2E 测试 Topic Research 政策分析流程

---

## 9. 关键文件清单

| 操作     | 文件路径                                                                                     |
| -------- | -------------------------------------------------------------------------------------------- |
| **新建** | `backend/src/modules/ai-engine/tools/categories/information/policy/index.ts`                 |
| **新建** | `backend/src/modules/ai-engine/tools/categories/information/policy/policy-data.service.ts`   |
| **新建** | `backend/src/modules/ai-engine/tools/categories/information/policy/federal-register.tool.ts` |
| **新建** | `backend/src/modules/ai-engine/tools/categories/information/policy/congress-gov.tool.ts`     |
| **新建** | `backend/src/modules/ai-engine/tools/categories/information/policy/whitehouse-news.tool.ts`  |
| **修改** | `backend/src/modules/ai-engine/ai-engine.module.ts`                                          |
| **修改** | `backend/src/modules/platform/admin/capabilities-admin.service.ts`                           |
| **修改** | `backend/src/modules/ai-app/research/topic-research/services/research-leader.service.ts`     |
| **修改** | `frontend/components/admin/ToolsManagement.tsx`                                              |
| **修改** | `frontend/lib/i18n/locales/en.json`                                                          |
| **修改** | `frontend/lib/i18n/locales/zh.json`                                                          |

---

## 10. 验证方法

1. **工具注册验证:** 启动后端，查看日志 `Tools: X` 数量增加
2. **Tools Manager 验证:** 访问 Admin > Tools，确认 Policy Research 分类和工具显示
3. **API Key 配置验证:** 配置 Congress.gov API Key，测试连接
4. **Topic Research 验证:** 创建政策相关研究主题，确认 Leader 分配政策工具
5. **工具执行验证:** 通过 AI Ask 或研究任务触发工具调用

---

## 11. 清理：删除无用的 Simulation 工具

当前 Tools Manager 中的以下工具定义未被使用，建议删除：

| 工具 ID          | 显示名称            | 原因             |
| ---------------- | ------------------- | ---------------- |
| `marketData`     | Market & Pricing    | 孤立定义，未实现 |
| `financeData`    | Finance & Filings   | 孤立定义，未实现 |
| `newsData`       | News & Sentiment    | 孤立定义，未实现 |
| `regulationData` | Regulation & Policy | 孤立定义，未实现 |

这些是 `capabilities-admin.service.ts` 中的占位符定义，实际的模拟数据源使用 `external.providers` 系统配置，与这些工具定义无关。

---

## 附录 A: API 参考

### Federal Register API

- **文档:** https://www.federalregister.gov/developers/documentation/api/v1
- **端点:** `https://www.federalregister.gov/api/v1/documents.json`
- **认证:** 无需
- **限制:** 无明确限制

### Congress.gov API

- **文档:** https://api.congress.gov/
- **端点:** `https://api.congress.gov/v3/`
- **认证:** API Key (免费申请)
- **限制:** 5,000 requests/hour

### White House

- **URL:** https://www.whitehouse.gov/news/
- **方法:** Web scraping via Jina Reader / Firecrawl
- **认证:** 无需

---

**最后更新:** 2026-01-20
**维护者:** Claude Code
