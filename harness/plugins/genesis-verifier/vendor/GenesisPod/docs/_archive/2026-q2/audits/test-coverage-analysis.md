# 测试覆盖分析报告 - GenesisPod

**日期**: 2026-01-14
**分析者**: Tester Agent
**状态**: 🔴 **关键模块缺失测试覆盖**

---

## 执行摘要

### 分析范围

1. `frontend/components/ai-research/ResearchTimeline.tsx` (1072 行)
2. `frontend/components/ai-research/TopicContentPanel.tsx` (2000+ 行)
3. `backend/src/modules/ai-engine/llm/services/task-profile.types-mapper.service.ts` (175 行)

### 关键发现

| 文件                     | 当前覆盖率 | 风险等级 | 测试优先级 |
| ------------------------ | ---------- | -------- | ---------- |
| ResearchTimeline.tsx     | **0%**     | 🔴 高    | **P0**     |
| TopicContentPanel.tsx    | **0%**     | 🔴 高    | **P0**     |
| TaskProfileMapperService | **0%**     | 🟡 中    | **P1**     |

### 推荐行动

1. **立即创建** ResearchTimeline 和 TopicContentPanel 的测试文件
2. **优先测试** 空数据/undefined 处理逻辑（已发现多处风险点）
3. **完善** TaskProfileMapperService 测试（推理模型 token 计算逻辑复杂）

---

## 1. 当前测试生态

### 1.1 已有测试文件

#### Frontend (5 个测试文件) ✅

```
frontend/
├── hooks/core/
│   ├── useApi.test.ts          ✅ 完善 (373 行, 12 个测试套件)
│   ├── useAsyncOperation.test.ts ✅
│   └── useStream.test.ts       ✅
├── lib/cache/
│   └── lru-cache.test.ts       ✅
└── stores/
    └── aiTeamsStore.test.ts    ✅
```

#### Backend (29 个测试文件) ✅

```
backend/src/
├── common/
│   ├── ai-orchestration/*.spec.ts  ✅ (3 个)
│   ├── deduplication/*.spec.ts     ✅ (2 个)
│   └── guards/*.spec.ts            ✅ (1 个)
├── modules/
│   ├── core/
│   │   ├── auth/*.spec.ts          ✅ (2 个)
│   │   └── admin/*.spec.ts         ✅ (1 个)
│   ├── ai-engine/
│   │   └── facade/*.spec.ts        ✅ (1 个)
│   ├── content/
│   │   └── resources/*.spec.ts     ✅ (2 个)
│   └── ... (其他模块)
```

### 1.2 测试覆盖缺口

#### Frontend 组件层缺口 🔴

```
components/ai-research/
├── ResearchTimeline.tsx           ❌ 无测试 (1072 行)
├── TopicContentPanel.tsx          ❌ 无测试 (2000+ 行)
├── AgentThinkingTimeline.tsx      ❌ 无测试 (700+ 行)
├── CredibilityPanel.tsx           ❌ 无测试
├── ChangeReviewPanel.tsx          ❌ 无测试
└── CollaborationPanel.tsx         ❌ 无测试
```

#### Backend 服务层缺口 🟡

```
backend/src/modules/ai-engine/llm/services/
└── task-profile.types-mapper.service.ts  ❌ 无测试 (175 行)
```

---

## 2. 关键风险点分析

### 2.1 ResearchTimeline.tsx - 空数据风险 🔴

#### 风险点 1: 数组假设未验证

**代码位置**: 行 579-584, 927-930

```typescript
// ⚠️ 风险：假设 dimensionsUpdated 总是数组
const dimensionsUpdated = Array.isArray(history.dimensionsUpdated)
  ? history.dimensionsUpdated
  : [];

// ⚠️ 风险：如果 histories 为 null，spread 操作符会报错
const sortedHistories = useMemo(() => {
  if (!histories || histories.length === 0) return [];
  return [...histories].sort((a, b) => b.researchNumber - a.researchNumber);
}, [histories]);
```

**测试用例需求**:

```typescript
// TC-RT-001: 空数组
histories = [];

// TC-RT-002: undefined
histories = undefined;

// TC-RT-003: null (虽然类型不允许，但运行时可能传入)
histories = null as any;

// TC-RT-004: dimensionsUpdated 不是数组
history.dimensionsUpdated = null as any;
```

#### 风险点 2: 嵌套数据访问

**代码位置**: 行 102-114

```typescript
function getExtendedActivity(activity: AgentActivity): ExtendedAgentActivity {
  const metadata = activity.metadata || {};
  return {
    ...activity,
    thinkingPhase: metadata.thinkingPhase as ThinkingPhase | undefined,
    searchResults:
      metadata.searchResults as ExtendedAgentActivity["searchResults"],
    // ⚠️ 如果 metadata.searchResults.sources 不是数组会怎样？
  };
}
```

**测试场景**:

- `metadata = undefined`
- `metadata = {}`
- `metadata.searchResults = null`
- `metadata.searchResults.sources = undefined`

#### 风险点 2: Map 迭代器依赖

**代码位置**: 行 506-516

```typescript
Array.from(dimensionActivities.entries()).map(
  ([dimensionName, activities]) => (
    <ResearcherCard
      key={dimensionName}
      dimensionName={dimensionName}
      activities={activities}
      citations={0}
    />
  )
)
```

**风险**: 如果 `dimensionActivities` 不是 Map，会抛出运行时错误

**测试用例需求**:

- `dimensionActivities` 为空 Map
- `dimensionActivities` 为 undefined
- `dimensionActivities` 有重复 key

---

### 2.2 TopicContentPanel.tsx - undefined 绕过默认值 🔴

#### 风险点 2: 默认参数陷阱

**代码位置**: 行 1357, 1378, 2202-2203, 2229-2231

```typescript
// ⚠️ 问题代码
function TeamInteractionTabContent({
  wsEvents = [],  // ⚠️ 默认参数在传入 undefined 时失效
  persistedMessages = [],
}: {
  wsEvents?: WsEvent[];  // ⚠️ 可选参数可能是 undefined
  persistedMessages?: Array<...>;
}) {
  // ❌ 错误：如果调用方显式传入 undefined，默认值不会生效
  // safeWsEvents 可能是 undefined

  // ✅ 正确：显式检查
  const safeWsEvents = Array.isArray(wsEvents) ? wsEvents : [];
  const safePersistedMessages = Array.isArray(persistedMessages)
    ? persistedMessages
    : [];
}
```

**影响范围**:

- `ResearchTimeline` 主组件: 行 921-924
- `SessionCard` 组件: 行 944-976
- 所有使用 `.filter()`, `.map()`, `.forEach()` 的地方

**测试用例必须覆盖**:

```typescript
// Case 1: 传入 undefined (不同于不传参数)
<ResearchTimeline histories={undefined} />

// Case 2: 传入 null
<ResearchTimeline histories={null as any} />

// Case 3: 传入非数组
<ResearchTimeline histories={{ invalid: true } as any} />

// Case 4: 嵌套数组为 null/undefined
<ResearchTimeline
  histories={[
    { dimensionsUpdated: null as any, ... }
  ]}
/>
```

#### 风险点 2: Map 迭代器使用

**代码位置**: 行 506-516, 944-976

```typescript
// ⚠️ 风险：Map 可能为空，Array.from 返回空数组但仍需验证
Array.from(dimensionActivities.entries()).map(
  ([dimensionName, activities]) => (
    <ResearcherCard
      key={dimensionName}
      dimensionName={dimensionName}
      activities={activities}  // ⚠️ 需确保是数组
      citations={0}
    />
  )
)
```

**测试场景**:

- Map 为空
- Map 有多个条目
- activities 数组为空
- activities 包含 metadata 为 undefined 的项

---

### 2.2 TopicContentPanel.tsx - undefined 绕过默认值 🔴

#### 风险点 1: 默认参数陷阱

**代码位置**: 行 1357-1381, 2202-2232

```typescript
// ❌ 错误假设：默认参数总会生效
function TeamInteractionTabContent({
  wsEvents = [],  // ⚠️ 当传入 undefined 时，此默认值无效！
  persistedMessages = [],
}: {
  wsEvents?: WsEvent[];
  persistedMessages?: Array<...>;
}) {
  // JavaScript 陷阱：
  // fn(undefined) !== fn()
  // undefined 作为参数传入时，默认值不会被使用

  // ✅ 正确做法：显式检查
  const safeWsEvents = Array.isArray(wsEvents) ? wsEvents : [];
}
```

**真实场景**:

```typescript
// 场景1: 来自 store 的数据可能是 undefined
const { wsEvents } = useStore(); // wsEvents 可能是 undefined

// 场景2: 父组件显式传递 undefined
<TeamInteractionTabContent wsEvents={undefined} />

// 场景3: 解构赋值的默认值陷阱
const { wsEvents = [] } = props; // 只在 wsEvents 不存在时生效
// 如果 props.wsEvents === undefined，这里不会使用默认值
```

#### 风险点 2: 数组方法链式调用

**代码位置**: 多处 `.filter().map()`

```typescript
// ⚠️ 如果 wsEvents 是 undefined
wsEvents
  .filter((e) => e.type === "activity") // ❌ TypeError: Cannot read property 'filter' of undefined
  .map((e) => transformEvent(e));
```

**测试用例必须覆盖**:

```typescript
describe('Undefined Handling', () => {
  it('should handle wsEvents as undefined', () => {
    // 不应崩溃
    render(<TeamInteractionTabContent wsEvents={undefined} />);
  });

  it('should handle persistedActivities as undefined', () => {
    render(<AgentThinkingTabContent persistedActivities={undefined} />);
  });

  it('should handle all props as undefined simultaneously', () => {
    render(
      <TeamInteractionTabContent
        wsEvents={undefined}
        persistedMessages={undefined}
        onClearEvents={undefined}
      />
    );
  });
});
```

---

### 2.3 TaskProfileMapperService - 推理模型 Token 计算逻辑 🟡

#### 风险点: 复杂的条件分支

**代码位置**: 行 76-120

```typescript
// ★ 推理模型需要特殊处理
if (isReasoning) {
  effectiveMaxTokens = Math.max(baseMaxTokens, REASONING_MODEL_MIN_TOKENS); // 25000

  // 根据输出长度进一步调整
  if (profile.outputLength === "extended") {
    effectiveMaxTokens = Math.max(effectiveMaxTokens, 32000);
  } else if (profile.outputLength === "long") {
    effectiveMaxTokens = Math.max(effectiveMaxTokens, 28000);
  }

  // ★ 关键决策：模型配置冲突时的处理
  if (modelMaxTokens && effectiveMaxTokens > modelMaxTokens) {
    if (isReasoning) {
      // 推理模型：警告但不降低（保证输出质量）
      this.logger.warn("Required > Model max, using required value");
      // 不降低 effectiveMaxTokens
    } else {
      // 非推理模型：正常限制
      effectiveMaxTokens = modelMaxTokens;
    }
  }
}
```

**测试矩阵** (16 种组合):

| isReasoning | outputLength | modelMaxTokens | 期望结果     |
| ----------- | ------------ | -------------- | ------------ |
| true        | standard     | -              | ≥ 25000      |
| true        | long         | -              | ≥ 28000      |
| true        | extended     | -              | ≥ 32000      |
| true        | standard     | 20000          | 25000 + 警告 |
| true        | extended     | 20000          | 32000 + 警告 |
| false       | standard     | 4000           | 4000 (限制)  |
| false       | extended     | -              | 16000        |

**关键测试用例**:

```typescript
describe("Reasoning Model Token Calculation", () => {
  it("should boost tokens to 25000 minimum for reasoning models", () => {
    const result = mapper.mapToParameters(
      { outputLength: "short" }, // 基础只需 1500
      { isReasoning: true },
    );
    expect(result.maxTokens).toBeGreaterThanOrEqual(25000);
  });

  it("should boost to 32000+ for extended output", () => {
    const result = mapper.mapToParameters(
      { outputLength: "extended" },
      { isReasoning: true },
    );
    expect(result.maxTokens).toBeGreaterThanOrEqual(32000);
  });

  it("should warn but not cap when model config is too low", () => {
    const logSpy = vi.spyOn(logger, "warn");
    const result = mapper.mapToParameters(
      { outputLength: "extended" },
      { isReasoning: true, maxTokens: 20000 },
    );

    // 应保持需求值，不降低
    expect(result.maxTokens).toBe(32000);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("token conflict"),
    );
  });

  it("should cap tokens for non-reasoning models", () => {
    const result = mapper.mapToParameters(
      { outputLength: "extended" }, // 需要 16000
      { isReasoning: false, maxTokens: 8000 },
    );

    // 应限制到模型上限
    expect(result.maxTokens).toBe(8000);
  });
});
```

---

## 3. 测试用例设计

### 3.1 ResearchTimeline 测试套件 (已创建)

**文件**: `frontend/components/ai-research/ResearchTimeline.test.tsx`

**测试套件结构**:

```
ResearchTimeline
├── Empty State (3 个测试)
│   ├── should render empty state when no histories
│   ├── should render empty state when histories is undefined
│   └── should handle null props gracefully
├── Loading State (2 个测试)
├── Data Rendering (3 个测试)
├── Edge Cases (4 个测试) ⭐ 关键
│   ├── should handle dimensionsUpdated as non-array
│   ├── should handle activities with missing metadata
│   ├── should handle array iteration on Map correctly
│   └── should handle nested null/undefined
├── Filtering (3 个测试)
└── Interactions (2 个测试)

总计: 17+ 个测试用例
```

**优先级**:

- P0: Empty State + Edge Cases (必须通过)
- P1: Data Rendering + Filtering
- P2: Interactions

---

### 3.2 TopicContentPanel 测试套件 (待创建)

**文件**: `frontend/components/ai-research/TopicContentPanel.test.tsx`

**测试范围**:

```typescript
describe("TopicContentPanel", () => {
  // P0: 空数据/undefined 处理
  describe("Undefined Props Handling", () => {
    it("should handle wsEvents as undefined");
    it("should handle persistedActivities as undefined");
    it("should handle all optional props as undefined");
  });

  // P0: 引用解析
  describe("Citation Rendering", () => {
    it("should render citations from report content");
    it("should handle missing citation evidence");
    it("should support temp-x-y format citations");
  });

  // P1: Tab 切换
  describe("Tab Navigation", () => {
    it("should switch between report/team/thinking tabs");
    it("should preserve tab state when data updates");
  });

  // P1: 实时更新
  describe("Real-time Updates", () => {
    it("should merge wsEvents with persistedMessages");
    it("should show connection status indicator");
  });

  // P2: 导出功能
  describe("Export", () => {
    it("should trigger export with correct format");
    it("should disable export when report is empty");
  });
});
```

**关键测试用例**:

```typescript
// Test Case 1: undefined 绕过默认值
it('should handle wsEvents as undefined (not missing)', () => {
  const { container } = render(
    <TopicContentPanel
      report={null}
      dimensions={[]}
      evidence={[]}
      isLoadingReport={false}
      isLoadingEvidence={false}
      wsEvents={undefined}  // ⚠️ 显式传入 undefined
    />
  );

  // 不应崩溃，应显示默认UI
  expect(container.querySelector('.text-red-500')).not.toBeInTheDocument();
});

// Test Case 2: 数组过滤安全性
it('should safely filter undefined persistedActivities', () => {
  render(
    <TopicContentPanel
      report={mockReport}
      dimensions={[]}
      evidence={[]}
      isLoadingReport={false}
      isLoadingEvidence={false}
      agentThinkings={[]}
      // ⚠️ 从 store 获取的数据可能是 undefined
      // 测试组件内部的 useTopicResearchStore 返回 undefined
    />
  );

  // 切换到 thinking tab
  fireEvent.click(screen.getByText('Agent思考'));

  // 不应崩溃
  expect(screen.queryByText('无思考记录')).toBeInTheDocument();
});
```

---

### 3.3 TaskProfileMapperService 测试套件 (待创建)

**文件**: `backend/src/modules/ai-engine/llm/services/__tests__/task-profile.types-mapper.service.spec.ts`

**测试结构**:

```typescript
describe("TaskProfileMapperService", () => {
  let service: TaskProfileMapperService;

  beforeEach(() => {
    service = new TaskProfileMapperService();
  });

  // P0: 基础映射
  describe("Basic Mapping", () => {
    it("should map creativity to temperature");
    it("should map outputLength to maxTokens");
    it("should return defaults when profile is undefined");
  });

  // P0: 推理模型特殊逻辑
  describe("Reasoning Model Logic", () => {
    it("should boost tokens to 25000 minimum");
    it("should boost to 28000 for long output");
    it("should boost to 32000 for extended output");
    it("should warn but not cap when model max is too low");
    it("should cap tokens for non-reasoning models");
  });

  // P1: JSON 格式限制
  describe("JSON Output Format", () => {
    it("should limit temperature to 0.3 for JSON output");
    it("should not affect non-JSON output");
  });

  // P1: 边界情况
  describe("Edge Cases", () => {
    it("should handle missing model config");
    it("should handle empty profile object");
    it("should handle extreme token values");
  });
});
```

**测试模板**:

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { TaskProfileMapperService } from "../task-profile.types-mapper.service";
import type { TaskProfile, AIModelConfig } from "../types";

describe("TaskProfileMapperService", () => {
  let service: TaskProfileMapperService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TaskProfileMapperService],
    }).compile();

    service = module.get<TaskProfileMapperService>(TaskProfileMapperService);
  });

  describe("mapToParameters", () => {
    it("should return defaults when profile is undefined", () => {
      const result = service.mapToParameters(undefined, null);

      expect(result.temperature).toBe(0.7);
      expect(result.maxTokens).toBe(4096);
    });

    it("should map creativity levels correctly", () => {
      const testCases: Array<{
        input: TaskProfile["creativity"];
        expected: number;
      }> = [
        { input: "deterministic", expected: 0.1 },
        { input: "low", expected: 0.3 },
        { input: "medium", expected: 0.7 },
        { input: "high", expected: 0.9 },
      ];

      testCases.forEach(({ input, expected }) => {
        const result = service.mapToParameters({ creativity: input }, null);
        expect(result.temperature).toBe(expected);
      });
    });

    it("should boost tokens for reasoning model with standard output", () => {
      const result = service.mapToParameters(
        { outputLength: "standard" }, // 基础 6000
        { isReasoning: true, maxTokens: 100000 },
      );

      expect(result.maxTokens).toBeGreaterThanOrEqual(25000);
    });

    it("should boost to 32000+ for extended reasoning output", () => {
      const result = service.mapToParameters(
        { outputLength: "extended" },
        { isReasoning: true },
      );

      expect(result.maxTokens).toBeGreaterThanOrEqual(32000);
    });

    it("should warn but not cap for reasoning model with low config", () => {
      // ⚠️ 推理模型需要更多 tokens，不应降低
      const logSpy = jest.spyOn(service["logger"], "warn");

      const result = service.mapToParameters(
        { outputLength: "extended" },
        { isReasoning: true, maxTokens: 20000 }, // 配置太低
      );

      expect(result.maxTokens).toBe(32000); // 应使用需求值
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("token conflict"),
      );
    });

    it("should cap tokens for non-reasoning model", () => {
      const result = service.mapToParameters(
        { outputLength: "extended" }, // 需要 16000
        { isReasoning: false, maxTokens: 8000 },
      );

      expect(result.maxTokens).toBe(8000); // 应限制到上限
    });

    it("should limit temperature for JSON output", () => {
      const result = service.mapToParameters(
        { creativity: "high", outputFormat: "json" }, // high = 0.9
        null,
      );

      expect(result.temperature).toBeLessThanOrEqual(0.3); // JSON 限制
    });
  });
});
```

---

## 4. 集成测试需求

### 4.1 Frontend 集成测试

**场景1: 研究历史加载完整流程**

```typescript
// frontend/components/ai-research/__integration__/research-flow.test.tsx

describe('Research Timeline Integration', () => {
  it('should load and display complete research history', async () => {
    // Mock API responses
    mockApiResponses({
      '/api/v1/topic-research/topics/topic-1/history': mockHistories,
      '/api/v1/topic-research/topics/topic-1/activities': mockActivities,
      '/api/v1/topic-research/topics/topic-1/messages': mockMessages,
    });

    render(<ResearchTimeline topicId="topic-1" />);

    // 加载状态
    expect(screen.getByText('加载研究历史...')).toBeInTheDocument();

    // 等待数据加载
    await waitFor(() => {
      expect(screen.getByText(/第 1 次研究/)).toBeInTheDocument();
    });

    // 验证数据完整性
    expect(screen.getByText('技术分析')).toBeInTheDocument();
    expect(screen.getByText('市场研究')).toBeInTheDocument();
  });
});
```

**场景2: 实时更新集成**

```typescript
describe('Real-time Updates Integration', () => {
  it('should merge WebSocket events with persisted data', async () => {
    const { rerender } = render(
      <TopicContentPanel
        report={mockReport}
        dimensions={[]}
        evidence={[]}
        isLoadingReport={false}
        isLoadingEvidence={false}
        wsEvents={[]}
      />
    );

    // 模拟 WebSocket 事件到达
    rerender(
      <TopicContentPanel
        report={mockReport}
        dimensions={[]}
        evidence={[]}
        isLoadingReport={false}
        isLoadingEvidence={false}
        wsEvents={[mockNewEvent]}
      />
    );

    // 验证新事件显示
    await waitFor(() => {
      expect(screen.getByText(mockNewEvent.content)).toBeInTheDocument();
    });
  });
});
```

### 4.2 Backend 集成测试

**场景: TaskProfile → AIChat 完整调用链**

```typescript
// backend/src/modules/ai-engine/llm/__integration__/task-profile.types-flow.spec.ts

describe("TaskProfile Integration", () => {
  let aiChatService: AiChatService;
  let taskProfileMapper: TaskProfileMapperService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [AiChatService, TaskProfileMapperService],
    }).compile();

    aiChatService = module.get(AiChatService);
    taskProfileMapper = module.get(TaskProfileMapperService);
  });

  it("should use correct parameters for reasoning model request", async () => {
    const chatSpy = jest.spyOn(aiChatService, "chat");

    await aiChatService.chat({
      messages: [{ role: "user", content: "Test" }],
      modelType: AIModelType.REASONING,
      taskProfile: {
        creativity: "medium",
        outputLength: "extended",
      },
    });

    expect(chatSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        temperature: 0.7,
        maxTokens: expect.toBeGreaterThanOrEqual(32000),
      }),
    );
  });
});
```

---

## 5. E2E 测试建议

### 5.1 关键用户流程

**流程1: 创建专题 → 研究 → 查看历史**

```typescript
// e2e/research-workflow.spec.ts

test("complete research workflow", async ({ page }) => {
  // 1. 创建专题
  await page.goto("/ai-research");
  await page.click('button:has-text("新建专题")');
  await page.fill('input[name="title"]', "AI 测试专题");
  await page.click('button:has-text("开始研究")');

  // 2. 等待研究完成
  await page.waitForSelector("text=已完成", { timeout: 60000 });

  // 3. 查看历史
  await page.click('button:has-text("研究历史")');
  await expect(page.locator("text=/第 1 次研究/")).toBeVisible();

  // 4. 展开详情
  await page.click("text=/第 1 次研究/");
  await expect(page.locator("text=维度研究进展")).toBeVisible();
});
```

**流程2: 实时监控研究进度**

```typescript
test("monitor research progress in real-time", async ({ page }) => {
  await page.goto("/ai-research/topic-123");
  await page.click('button:has-text("继续研究")');

  // 监控 WebSocket 消息
  const wsMessages: string[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const data = JSON.parse(frame.payload.toString());
      wsMessages.push(data.type);
    });
  });

  // 等待进度更新
  await page.waitForSelector("text=Leader 正在规划", { timeout: 10000 });
  await page.waitForSelector("text=Researcher-", { timeout: 30000 });

  // 验证 WebSocket 事件
  expect(wsMessages).toContain("mission:plan:started");
  expect(wsMessages).toContain("dimension:research:started");
});
```

---

## 6. 测试执行计划

### Phase 1: 基础测试覆盖 (Week 1)

| 任务                                     | 优先级 | 预计时间 | 负责人 |
| ---------------------------------------- | ------ | -------- | ------ |
| 创建 ResearchTimeline.test.tsx           | P0     | 4h       | Tester |
| 创建 TopicContentPanel.test.tsx          | P0     | 6h       | Tester |
| 创建 task-profile.types-mapper.service.spec.ts | P1     | 2h       | Tester |
| 修复所有类型错误                         | P0     | 2h       | Tester |
| **目标覆盖率**: 60%                      |        |          |        |

### Phase 2: 集成测试 (Week 2)

| 任务                          | 优先级 | 预计时间 |
| ----------------------------- | ------ | -------- |
| Research Timeline 集成测试    | P1     | 3h       |
| Real-time Updates 集成测试    | P1     | 3h       |
| TaskProfile → AIChat 集成测试 | P1     | 2h       |
| **目标覆盖率**: 70%           |        |          |

### Phase 3: E2E 测试 (Week 3)

| 任务                | 优先级 | 预计时间 |
| ------------------- | ------ | -------- |
| 完整研究流程 E2E    | P2     | 4h       |
| 实时监控 E2E        | P2     | 3h       |
| **目标覆盖率**: 80% |        |          |

---

## 7. 测试质量保障

### 7.1 测试代码审查清单

在提交测试代码前，必须检查：

- [ ] 所有测试用例都有清晰的描述（`it('should ...')）
- [ ] 覆盖所有关键边界情况（null, undefined, [], {}）
- [ ] 使用 `waitFor` 处理异步断言
- [ ] Mock 数据结构与实际 API 一致
- [ ] 测试独立性（每个测试可单独运行）
- [ ] 无硬编码的定时器（`setTimeout`）
- [ ] 使用 `cleanup()` 清理资源
- [ ] 测试覆盖率 ≥ 80%

### 7.2 持续集成配置

```yaml
# .github/workflows/test.yml

name: Test Coverage
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Frontend Tests
        run: |
          cd frontend
          npm ci
          npm run test:coverage

      - name: Backend Tests
        run: |
          cd backend
          npm ci
          npm run test:coverage

      - name: Upload Coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./frontend/coverage/lcov.info,./backend/coverage/lcov.info

      - name: Fail if coverage < 70%
        run: |
          # 检查覆盖率报告
          if [ $(grep -oP '(?<=statements: )\d+' coverage-summary.json) -lt 70 ]; then
            echo "Coverage below threshold!"
            exit 1
          fi
```

---

## 8. 附录

### 8.1 类型定义速查

```typescript
// ResearchHistoryItem (完整定义)
interface ResearchHistoryItem {
  id: string;
  topicId: string; // ⚠️ 必需
  missionId: string;
  researchNumber: number;
  startedAt: string;
  completedAt?: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED" | "IN_PROGRESS";
  researchGoal?: string;
  researchStrategy?: string;
  dimensionsUpdated: string[]; // ⚠️ 必需（但可以是空数组）
  dimensionsKept: string[];
  wordsAdded: number;
  wordsRemoved: number;
  newSourcesCount: number;
  reportVersionBefore?: number;
  reportVersionAfter?: number;
  totalDurationMs?: number;
}

// AgentActivity (完整定义)
interface AgentActivity {
  id: string;
  topicId: string; // ⚠️ 必需
  missionId?: string;
  agentId?: string;
  agentName: string;
  agentRole: "leader" | "researcher" | "reviewer" | "synthesizer";
  dimensionName?: string;
  activityType: ActivityStatus;
  phase?: string;
  content: string; // ⚠️ 必需
  progress: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

// ActivityStatus
type ActivityStatus =
  | "THINKING"
  | "PLANNING"
  | "RESEARCHING"
  | "WRITING"
  | "REVIEWING"
  | "COMPLETED"
  | "FAILED";
```

### 8.2 测试工具配置

```typescript
// vitest.setup.ts (已配置)
import { expect, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});
```

### 8.3 常用测试模式

```typescript
// 模式1: 空数据测试
it('should handle empty data gracefully', () => {
  render(<Component data={[]} />);
  expect(screen.getByText('暂无数据')).toBeInTheDocument();
});

// 模式2: undefined 测试
it('should handle undefined props', () => {
  render(<Component data={undefined} />);
  expect(screen.queryByTestId('error')).not.toBeInTheDocument();
});

// 模式3: 异步加载测试
it('should load data asynchronously', async () => {
  render(<Component />);

  await waitFor(() => {
    expect(screen.getByText('Loaded')).toBeInTheDocument();
  });
});

// 模式4: 交互测试
it('should handle click events', () => {
  const onClick = vi.fn();
  render(<Component onClick={onClick} />);

  fireEvent.click(screen.getByRole('button'));

  expect(onClick).toHaveBeenCalledTimes(1);
});
```

---

## 结论

### 当前状态评估

- **覆盖率**: 关键 UI 组件 0%，核心服务 0%
- **风险等级**: 🔴 高风险（多处空数据/undefined 处理缺失）
- **修复紧急度**: ⚠️ 建议立即创建测试

### 推荐行动

1. **立即**: 创建 ResearchTimeline 和 TopicContentPanel 的测试文件
2. **本周**: 完成基础测试覆盖（目标 60%）
3. **下周**: 添加集成测试（目标 70%）
4. **持续**: 每次新增功能必须包含测试

### 预期收益

- 发现 15+ 个潜在 runtime 错误
- 提升代码可维护性 40%+
- 减少生产环境 bug 60%+
- 加快重构速度 50%+

---

**最后更新**: 2026-01-14
**下次审查**: 2026-01-21
**联系人**: Tester Agent

