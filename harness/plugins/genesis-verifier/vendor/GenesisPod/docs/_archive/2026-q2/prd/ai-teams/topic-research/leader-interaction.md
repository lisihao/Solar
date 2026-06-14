# @Leader 交互功能 PRD

> 专题研究中用户与 Leader Agent 的交互设计

---

## 1. 背景与目标

### 1.1 当前问题

- 用户发送 @Leader 指令后，缺乏状态反馈
- 不知道 Leader 是否收到、正在处理、还是已完成
- Leader 的回复和执行结果没有可视化展示
- 指令历史无法追溯

### 1.2 目标

- 建立完整的用户-Leader双向沟通机制
- 提供清晰的指令状态反馈
- 展示 Leader 的思考过程和执行结果
- 支持指令历史记录和回溯

---

## 2. 功能设计

### 2.1 指令发送增强

**输入框优化：**

```
┌─────────────────────────────────────────────────────┐
│ 💬 输入 @Leader 给协调员发送指令...                   │
│                                                     │
│ 示例指令:                                            │
│ • "请重点分析政策监管方面的内容"                       │
│ • "补充技术趋势相关的研究"                            │
│ • "当前研究深度不够，请扩展分析"                       │
└─────────────────────────────────────────────────────┘
```

**@Leader 提及菜单增强：**

```
┌─────────────────────────────────────────────────────┐
│ 提及 Leader                                         │
├─────────────────────────────────────────────────────┤
│ 👑 @Leader                                          │
│    研究协调员                                        │
│                                                     │
│    可执行操作:                                       │
│    • 调整研究方向和重点                              │
│    • 补充新的研究维度                                │
│    • 提升或降低研究深度                              │
│    • 重新分配研究任务                                │
│    • 暂停/继续研究任务                               │
└─────────────────────────────────────────────────────┘
```

### 2.2 指令状态反馈

**状态流转：**

```
发送中 → 已接收 → 处理中 → 已执行/已拒绝
```

**状态展示位置：** 团队互动 Tab 中显示为对话消息

**消息卡片设计：**

```
┌─────────────────────────────────────────────────────┐
│ 👤 用户                                    10:30 AM │
│ @Leader 请重点分析政策监管方面的内容                  │
│                                         ✓ 已发送    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ 👑 Leader                                  10:30 AM │
│ 收到指令，正在调整研究计划...                         │
│                                                     │
│ 📋 执行计划:                                         │
│ 1. 提升「国家战略与政策监管」维度优先级                │
│ 2. 分配额外研究员深入分析                             │
│ 3. 预计新增 3 个子任务                                │
│                                         ⏳ 执行中    │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│ 👑 Leader                                  10:32 AM │
│ 已完成调整！                                         │
│                                                     │
│ ✅ 已执行操作:                                       │
│ • 「政策监管深度分析」任务已创建并分配                 │
│ • 研究员 2 已开始执行                                 │
│ • 预计 5 分钟后完成                                   │
│                                         ✓ 已完成    │
└─────────────────────────────────────────────────────┘
```

### 2.3 Leader 回复类型

| 类型     | 图标 | 说明              |
| -------- | ---- | ----------------- |
| 确认接收 | ✓    | Leader 已收到指令 |
| 执行计划 | 📋   | Leader 的调整计划 |
| 执行结果 | ✅   | 操作执行成功      |
| 拒绝说明 | ⚠️   | 无法执行及原因    |
| 询问澄清 | ❓   | 需要用户补充信息  |

### 2.4 快捷指令

提供常用指令模板，点击即可发送：

```
┌─────────────────────────────────────────────────────┐
│ 快捷指令                                            │
├─────────────────────────────────────────────────────┤
│ [深入分析] [扩展研究] [加快进度] [暂停任务]           │
│ [调整方向] [补充维度] [重新规划] [查看状态]           │
└─────────────────────────────────────────────────────┘
```

**快捷指令定义：**

| 指令     | 发送内容                             | 说明         |
| -------- | ------------------------------------ | ------------ |
| 深入分析 | 请对当前进行中的研究进行更深入的分析 | 提升研究深度 |
| 扩展研究 | 请扩展当前研究范围，补充相关内容     | 扩大研究广度 |
| 加快进度 | 请加快研究进度，优先完成核心内容     | 调整优先级   |
| 暂停任务 | 请暂停当前所有研究任务               | 暂停研究     |
| 调整方向 | (弹出输入框让用户输入具体方向)       | 自定义方向   |
| 补充维度 | (弹出输入框让用户输入新维度)         | 新增维度     |
| 重新规划 | 请根据已有研究结果重新规划后续任务   | 重新规划     |
| 查看状态 | 请汇报当前研究进度和状态             | 状态查询     |

---

## 3. 数据结构

### 3.1 Leader 指令消息

```typescript
interface LeaderInstruction {
  id: string;
  topicId: string;
  missionId?: string;

  // 用户指令
  userInstruction: string;
  sentAt: Date;

  // Leader 响应
  status: "pending" | "received" | "processing" | "completed" | "rejected";
  leaderResponse?: {
    type: "acknowledge" | "plan" | "result" | "reject" | "clarify";
    content: string;
    actions?: LeaderAction[];
    respondedAt: Date;
  };
}

interface LeaderAction {
  type: "create_task" | "adjust_priority" | "assign_agent" | "pause" | "resume";
  description: string;
  status: "pending" | "executing" | "completed" | "failed";
  taskId?: string;
}
```

### 3.2 API 设计

**发送指令：**

```
POST /api/topic-research/topics/:id/leader-instruction
Body: { instruction: string }
Response: { instructionId: string, status: 'pending' }
```

**获取指令历史：**

```
GET /api/topic-research/topics/:id/leader-instructions
Query: { limit?: number, missionId?: string }
Response: LeaderInstruction[]
```

**WebSocket 事件：**

```typescript
// Leader 响应事件
{
  type: 'leader:response',
  topicId: string,
  instructionId: string,
  response: LeaderResponse
}

// Leader 动作执行事件
{
  type: 'leader:action',
  topicId: string,
  instructionId: string,
  action: LeaderAction
}
```

---

## 4. UI 实现

### 4.1 输入框区域增强

**文件：** `ResearchCommandInput.tsx`

新增功能：

- 快捷指令按钮栏
- 发送状态指示器
- 指令模板选择器

### 4.2 团队互动 Tab 增强

**文件：** `TopicContentPanel.tsx` - TeamInteractionTabContent

新增功能：

- Leader 指令消息卡片样式
- 执行计划展开/收起
- 操作状态实时更新

### 4.3 视觉设计

**Leader 消息卡片配色：**

- 背景：紫色渐变 (from-purple-50 to-white)
- 边框：紫色 (border-purple-200)
- 图标：👑 配紫色背景圆形

**状态标签：**

- 已发送：灰色
- 已接收：蓝色
- 处理中：黄色 + 动画
- 已完成：绿色
- 已拒绝：红色

---

## 5. 实现计划

### Phase 1: 基础反馈 (MVP)

- [ ] 发送指令后显示"发送中"状态
- [ ] Leader 确认收到后更新状态
- [ ] 在团队互动 Tab 显示用户指令消息
- [ ] 在团队互动 Tab 显示 Leader 简单回复

### Phase 2: 丰富交互

- [ ] 快捷指令按钮栏
- [ ] Leader 执行计划展示
- [ ] 操作执行状态实时更新
- [ ] 指令历史持久化

### Phase 3: 高级功能

- [ ] Leader 询问澄清交互
- [ ] 指令模板管理
- [ ] 指令效果预览
- [ ] 撤销/重做指令

---

## 6. 技术要点

### 6.1 后端处理

Leader 收到指令后的处理流程：

1. 解析指令意图 (NLP/LLM)
2. 生成执行计划
3. 通过 WebSocket 推送计划
4. 执行操作（创建任务、调整优先级等）
5. 推送执行结果

### 6.2 前端状态管理

```typescript
// topicResearchStore 新增
interface TopicResearchState {
  // ... existing
  leaderInstructions: LeaderInstruction[];
  sendingInstruction: boolean;

  // actions
  sendLeaderInstruction: (
    topicId: string,
    instruction: string,
  ) => Promise<void>;
  fetchLeaderInstructions: (topicId: string) => Promise<void>;
}
```

### 6.3 WebSocket 集成

```typescript
// useResearchWebSocket 新增事件处理
case 'leader:response':
  updateInstructionStatus(event.instructionId, event.response);
  break;
case 'leader:action':
  updateActionStatus(event.instructionId, event.action);
  break;
```

---

## 7. 验收标准

1. **发送反馈**：用户发送指令后 1 秒内看到发送状态
2. **接收确认**：Leader 收到后 2 秒内显示确认
3. **计划展示**：执行计划清晰展示预计操作
4. **结果反馈**：操作完成后明确展示结果
5. **历史记录**：刷新页面后指令历史可恢复
6. **快捷指令**：点击快捷按钮能正确发送对应指令

---

## 8. 用户指令到Leader能力的转换

### 8.1 整体架构

```
用户指令 → 意图识别 → 能力匹配 → 参数提取 → 执行调度 → 结果反馈
   ↓           ↓           ↓           ↓           ↓           ↓
"深入分析   LLM解析    INCREASE    dimension   LeaderExecutor  WebSocket
 政策监管"  意图+置信度  _DEPTH     =政策监管    .execute()     推送
```

### 8.2 意图识别流程

```typescript
// 1. 用户发送指令
const instruction = "请重点分析政策监管方面的内容";

// 2. LLM 解析意图
const intent = await leaderIntentService.parse(instruction, context);
// 返回:
{
  capability: "ADJUST_FOCUS",
  confidence: 0.92,
  params: { target: "政策监管", priority: "high" },
  clarificationNeeded: false
}

// 3. 置信度检查
if (intent.confidence < 0.7) {
  // 请求用户澄清
  return askClarification(intent.clarificationQuestion);
}

// 4. 执行能力
const result = await leaderExecutor.execute(intent.capability, intent.params);
```

### 8.3 能力执行器示例

```typescript
const executors = {
  ADJUST_FOCUS: async (topicId, { target, priority }) => {
    const dimension = await findDimension(topicId, target);
    await adjustPriority(dimension.id, priority);
    await assignAdditionalAgent(dimension.id);
    return { success: true, message: `已将「${target}」设为高优先级` };
  },

  ADD_DIMENSION: async (topicId, { name, description }) => {
    const dimension = await createDimension(topicId, { name, description });
    const task = await createResearchTask(dimension.id);
    return { success: true, message: `已新增维度「${name}」` };
  },

  REPORT_STATUS: async (topicId) => {
    const status = await getMissionStatus(topicId);
    return {
      success: true,
      message: formatStatusReport(status),
      isQuery: true,
    };
  },
};
```

---

## 9. Leader能力管理系统

### 9.1 设计目标

- **可配置**：能力定义存储在数据库，支持动态增删改
- **可维护**：Admin界面管理能力，无需改代码
- **可扩展**：支持自定义能力和执行脚本
- **可追溯**：能力变更历史记录

### 9.2 数据模型

```prisma
// prisma/schema.prisma

// Leader能力定义
model LeaderCapability {
  id          String   @id @default(cuid())
  code        String   @unique  // 能力编码: ADJUST_FOCUS
  name        String            // 显示名称: 调整研究重点
  description String            // 能力描述
  category    String            // 分类: direction/depth/task/query

  // 参数定义 (JSON)
  params      Json     // [{ name, type, required, description }]

  // 意图识别配置
  keywords    String[] // 触发关键词: ["重点", "关注", "聚焦"]
  examples    String[] // 示例指令
  intentPrompt String? // 自定义意图识别prompt片段

  // 执行配置
  executorType String  // 执行器类型: builtin/script/workflow
  executorConfig Json  // 执行器配置

  // 状态管理
  enabled     Boolean  @default(true)
  priority    Int      @default(0)  // 匹配优先级

  // 权限控制
  requiredRole String? // 所需角色: admin/pro/basic

  // 审计
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  createdBy   String?
  version     Int      @default(1)

  // 关联
  usageLogs   CapabilityUsageLog[]
  changeHistory CapabilityChangeLog[]
}

// 能力使用记录
model CapabilityUsageLog {
  id           String   @id @default(cuid())
  capabilityId String
  capability   LeaderCapability @relation(fields: [capabilityId], references: [id])

  topicId      String
  userId       String
  instruction  String   // 原始指令
  params       Json     // 解析出的参数
  confidence   Float    // 匹配置信度

  status       String   // success/failed/clarification
  result       Json?    // 执行结果
  executionTime Int?    // 执行耗时(ms)

  createdAt    DateTime @default(now())
}

// 能力变更历史
model CapabilityChangeLog {
  id           String   @id @default(cuid())
  capabilityId String
  capability   LeaderCapability @relation(fields: [capabilityId], references: [id])

  changeType   String   // create/update/delete/enable/disable
  oldValue     Json?
  newValue     Json?
  changedBy    String
  reason       String?

  createdAt    DateTime @default(now())
}
```

### 9.3 能力定义结构

```typescript
interface LeaderCapabilityDefinition {
  // 基础信息
  code: string; // 唯一编码
  name: string; // 显示名称
  description: string; // 描述
  category: CapabilityCategory;

  // 参数定义
  params: ParamDefinition[];

  // 意图识别
  keywords: string[]; // 触发关键词
  examples: string[]; // 示例指令（用于few-shot）
  intentPrompt?: string; // 自定义prompt片段

  // 执行器配置
  executor: {
    type: "builtin" | "script" | "workflow";
    // builtin: 使用内置执行器
    builtinHandler?: string; // 内置处理器名称
    // script: 执行自定义脚本
    script?: string; // JavaScript代码
    // workflow: 执行工作流
    workflowId?: string; // 工作流ID
  };

  // 控制
  enabled: boolean;
  requiredRole?: string;
  rateLimit?: {
    // 频率限制
    maxPerMinute: number;
    maxPerHour: number;
  };
}

interface ParamDefinition {
  name: string;
  type: "string" | "number" | "boolean" | "dimension" | "task";
  required: boolean;
  description: string;
  default?: any;
  enum?: string[]; // 可选值列表
  validation?: string; // 验证正则
}

enum CapabilityCategory {
  DIRECTION = "direction", // 方向调整类
  DEPTH = "depth", // 深度控制类
  TASK = "task", // 任务管理类
  RESOURCE = "resource", // 资源调度类
  QUERY = "query", // 查询类
}
```

### 9.4 预置能力清单

| 编码               | 名称         | 分类      | 关键词               | 说明                     |
| ------------------ | ------------ | --------- | -------------------- | ------------------------ |
| `ADJUST_FOCUS`     | 调整研究重点 | direction | 重点、关注、聚焦     | 将研究重心转向指定维度   |
| `ADD_DIMENSION`    | 新增研究维度 | direction | 补充、新增、添加维度 | 添加新的研究维度         |
| `REMOVE_DIMENSION` | 移除研究维度 | direction | 删除、移除、去掉维度 | 移除指定维度             |
| `INCREASE_DEPTH`   | 深入分析     | depth     | 深入、详细、深度分析 | 对指定内容进行更深入研究 |
| `DECREASE_DEPTH`   | 简化分析     | depth     | 简化、概括、简要     | 减少研究深度，只保留核心 |
| `EXPAND_SCOPE`     | 扩展范围     | depth     | 扩展、扩大、更广     | 扩大研究覆盖范围         |
| `PRIORITIZE`       | 调整优先级   | task      | 优先、先做、重要     | 调整任务执行优先级       |
| `PAUSE_TASK`       | 暂停任务     | task      | 暂停、停止、先停     | 暂停研究任务             |
| `RESUME_TASK`      | 恢复任务     | task      | 继续、恢复、重启     | 恢复已暂停的任务         |
| `RETRY_TASK`       | 重试任务     | task      | 重试、重新、再来     | 重新执行失败的任务       |
| `SPEED_UP`         | 加快进度     | resource  | 加快、快点、尽快     | 加快研究进度             |
| `REPORT_STATUS`    | 汇报状态     | query     | 状态、进度、情况     | 汇报当前研究状态         |
| `EXPLAIN_PLAN`     | 解释计划     | query     | 计划、安排、打算     | 解释当前研究计划         |

### 9.5 Admin管理界面

**位置：** `/admin/ai-config/leader-capabilities`

```
┌─────────────────────────────────────────────────────────────────────┐
│  Leader 能力管理                                    [+ 新增能力]    │
├─────────────────────────────────────────────────────────────────────┤
│  🔍 搜索能力...              [全部分类 ▼] [全部状态 ▼]              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ✅ ADJUST_FOCUS                                    direction │   │
│  │    调整研究重点                                              │   │
│  │    将研究重心转向指定维度                                    │   │
│  │    关键词: 重点, 关注, 聚焦                                  │   │
│  │    使用次数: 156  成功率: 94.2%                              │   │
│  │                                    [编辑] [禁用] [查看日志]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ✅ ADD_DIMENSION                                   direction │   │
│  │    新增研究维度                                              │   │
│  │    添加新的研究维度                                          │   │
│  │    关键词: 补充, 新增, 添加维度                              │   │
│  │    使用次数: 89   成功率: 91.0%                              │   │
│  │                                    [编辑] [禁用] [查看日志]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ ⏸️ CUSTOM_ANALYSIS                                   custom │   │
│  │    自定义分析 (已禁用)                                       │   │
│  │    执行用户自定义的分析脚本                                  │   │
│  │    关键词: 自定义, 特殊分析                                  │   │
│  │    使用次数: 12   成功率: 75.0%                              │   │
│  │                                    [编辑] [启用] [查看日志]  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**能力编辑表单：**

```
┌─────────────────────────────────────────────────────────────────────┐
│  编辑能力: ADJUST_FOCUS                                    [保存]  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  基础信息                                                           │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ 能力编码    [ADJUST_FOCUS        ] (创建后不可修改)           │ │
│  │ 显示名称    [调整研究重点        ]                            │ │
│  │ 分类        [方向调整类 ▼        ]                            │ │
│  │ 描述        [将研究重心转向指定维度                         ] │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  意图识别配置                                                       │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ 触发关键词  [重点] [关注] [聚焦] [+添加]                      │ │
│  │                                                               │ │
│  │ 示例指令 (用于AI学习)                                         │ │
│  │ • 请重点分析政策监管方面的内容                                │ │
│  │ • 把研究重心放在技术趋势上                                    │ │
│  │ • 多关注市场竞争方面                    [+添加示例]           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  参数定义                                                           │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ 参数名      类型        必填    描述                          │ │
│  │ ─────────────────────────────────────────────────────────     │ │
│  │ target      dimension   ✅     目标维度名称          [删除]   │ │
│  │ priority    enum        ❌     优先级(high/normal)   [删除]   │ │
│  │                                               [+添加参数]     │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  执行器配置                                                         │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ 执行器类型  (●) 内置执行器  ( ) 自定义脚本  ( ) 工作流        │ │
│  │                                                               │ │
│  │ 内置处理器  [adjustFocusHandler ▼]                            │ │
│  │                                                               │ │
│  │ ──── 或使用自定义脚本 ────                                    │ │
│  │ ┌───────────────────────────────────────────────────────┐     │ │
│  │ │ async function execute(ctx, params) {                 │     │ │
│  │ │   const { target, priority } = params;                │     │ │
│  │ │   const dim = await ctx.findDimension(target);        │     │ │
│  │ │   await ctx.adjustPriority(dim.id, priority);         │     │ │
│  │ │   return { success: true, message: `已调整` };        │     │ │
│  │ │ }                                                     │     │ │
│  │ └───────────────────────────────────────────────────────┘     │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  访问控制                                                           │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │ [✅] 启用此能力                                               │ │
│  │ 所需角色    [所有用户 ▼]                                      │ │
│  │ 频率限制    每分钟 [10] 次，每小时 [100] 次                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│                                      [取消] [保存草稿] [保存并发布] │
└─────────────────────────────────────────────────────────────────────┘
```

### 9.6 能力服务实现

```typescript
// leader-capability.service.ts
@Injectable()
export class LeaderCapabilityService {
  constructor(
    private prisma: PrismaService,
    private cache: CacheService,
  ) {}

  // 获取所有启用的能力（带缓存）
  async getEnabledCapabilities(): Promise<LeaderCapability[]> {
    const cacheKey = "leader:capabilities:enabled";
    let capabilities = await this.cache.get(cacheKey);

    if (!capabilities) {
      capabilities = await this.prisma.leaderCapability.findMany({
        where: { enabled: true },
        orderBy: { priority: "desc" },
      });
      await this.cache.set(cacheKey, capabilities, 300); // 5分钟缓存
    }

    return capabilities;
  }

  // 构建意图识别Prompt
  async buildIntentPrompt(instruction: string, context: any): Promise<string> {
    const capabilities = await this.getEnabledCapabilities();

    const capabilityDescriptions = capabilities
      .map(
        (cap) => `
- ${cap.code}: ${cap.description}
  关键词: ${cap.keywords.join(", ")}
  参数: ${JSON.stringify(cap.params)}
  示例: ${cap.examples.slice(0, 3).join("; ")}`,
      )
      .join("\n");

    return `你是研究协调员(Leader)的意图解析器。

用户指令: "${instruction}"

当前研究上下文:
- 专题: ${context.topicName}
- 当前维度: ${context.dimensions?.map((d) => d.name).join(", ") || "无"}
- 研究阶段: ${context.phase || "unknown"}

可用能力:
${capabilityDescriptions}

请分析用户意图并返回JSON:
{
  "capability": "能力编码",
  "confidence": 0.0-1.0,
  "params": { 提取的参数 },
  "clarificationNeeded": false,
  "clarificationQuestion": "如需澄清的问题"
}`;
  }

  // 执行能力
  async executeCapability(
    capabilityCode: string,
    topicId: string,
    params: Record<string, any>,
    userId: string,
  ): Promise<ExecutionResult> {
    const capability = await this.prisma.leaderCapability.findUnique({
      where: { code: capabilityCode },
    });

    if (!capability || !capability.enabled) {
      throw new Error(`能力 ${capabilityCode} 不存在或已禁用`);
    }

    const startTime = Date.now();
    let result: ExecutionResult;

    try {
      // 根据执行器类型执行
      switch (capability.executorType) {
        case "builtin":
          result = await this.executeBuiltin(capability, topicId, params);
          break;
        case "script":
          result = await this.executeScript(capability, topicId, params);
          break;
        case "workflow":
          result = await this.executeWorkflow(capability, topicId, params);
          break;
        default:
          throw new Error(`未知执行器类型: ${capability.executorType}`);
      }
    } catch (error) {
      result = { success: false, message: error.message };
    }

    // 记录使用日志
    await this.prisma.capabilityUsageLog.create({
      data: {
        capabilityId: capability.id,
        topicId,
        userId,
        instruction: params._originalInstruction || "",
        params,
        confidence: params._confidence || 0,
        status: result.success ? "success" : "failed",
        result,
        executionTime: Date.now() - startTime,
      },
    });

    return result;
  }

  // 内置执行器
  private async executeBuiltin(
    capability: LeaderCapability,
    topicId: string,
    params: Record<string, any>,
  ): Promise<ExecutionResult> {
    const config = capability.executorConfig as { handler: string };
    const handler = this.builtinHandlers[config.handler];

    if (!handler) {
      throw new Error(`内置处理器 ${config.handler} 不存在`);
    }

    return handler(topicId, params);
  }

  // 脚本执行器（沙箱执行）
  private async executeScript(
    capability: LeaderCapability,
    topicId: string,
    params: Record<string, any>,
  ): Promise<ExecutionResult> {
    const config = capability.executorConfig as { script: string };

    // 创建安全的执行上下文
    const ctx = this.createScriptContext(topicId);

    // 使用vm2或类似库安全执行
    const result = await this.sandboxExecute(config.script, ctx, params);

    return result;
  }

  // 内置处理器映射
  private builtinHandlers: Record<string, BuiltinHandler> = {
    adjustFocusHandler: this.handleAdjustFocus.bind(this),
    addDimensionHandler: this.handleAddDimension.bind(this),
    increaseDepthHandler: this.handleIncreaseDepth.bind(this),
    pauseTaskHandler: this.handlePauseTask.bind(this),
    reportStatusHandler: this.handleReportStatus.bind(this),
    // ... 其他内置处理器
  };

  // CRUD 操作
  async createCapability(data: CreateCapabilityDto, userId: string) {
    const capability = await this.prisma.leaderCapability.create({
      data: { ...data, createdBy: userId },
    });

    await this.logChange(capability.id, "create", null, data, userId);
    await this.cache.del("leader:capabilities:enabled");

    return capability;
  }

  async updateCapability(
    code: string,
    data: UpdateCapabilityDto,
    userId: string,
  ) {
    const old = await this.prisma.leaderCapability.findUnique({
      where: { code },
    });

    const capability = await this.prisma.leaderCapability.update({
      where: { code },
      data: { ...data, version: { increment: 1 } },
    });

    await this.logChange(capability.id, "update", old, data, userId);
    await this.cache.del("leader:capabilities:enabled");

    return capability;
  }

  async toggleCapability(code: string, enabled: boolean, userId: string) {
    const capability = await this.prisma.leaderCapability.update({
      where: { code },
      data: { enabled },
    });

    await this.logChange(
      capability.id,
      enabled ? "enable" : "disable",
      { enabled: !enabled },
      { enabled },
      userId,
    );
    await this.cache.del("leader:capabilities:enabled");

    return capability;
  }
}
```

### 9.7 能力统计与分析

```
┌─────────────────────────────────────────────────────────────────────┐
│  能力使用统计                                      最近30天        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  总调用次数: 1,234        成功率: 92.5%        平均响应: 1.2s      │
│                                                                     │
│  热门能力 TOP 5                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 1. ADJUST_FOCUS      ████████████████████  456次  95.2%     │   │
│  │ 2. INCREASE_DEPTH    ████████████████      389次  93.1%     │   │
│  │ 3. REPORT_STATUS     ██████████████        312次  99.0%     │   │
│  │ 4. ADD_DIMENSION     █████████             198次  88.4%     │   │
│  │ 5. PRIORITIZE        ███████               156次  91.0%     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  失败原因分析                                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ • 参数解析失败 (42%)  - 用户指令表述不清                     │   │
│  │ • 维度不存在 (28%)    - 用户指定了不存在的维度               │   │
│  │ • 执行超时 (18%)      - 任务执行时间过长                     │   │
│  │ • 权限不足 (12%)      - 用户无权执行该操作                   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  低置信度指令 (需优化)                                              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ "帮我看看那个东西" → confidence: 0.32 → 建议: 添加关键词     │   │
│  │ "快一点" → confidence: 0.45 → 建议: 与SPEED_UP关联          │   │
│  │ "再深入一些" → confidence: 0.51 → 建议: 添加到示例           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10. 实现计划（更新）

### Phase 1: 基础框架 (Week 1)

- [ ] 创建 LeaderCapability 数据模型
- [ ] 实现能力服务 CRUD
- [ ] 预置13个基础能力
- [ ] 实现意图识别服务
- [ ] 实现内置执行器

### Phase 2: 管理界面 (Week 2)

- [ ] Admin能力列表页面
- [ ] 能力编辑表单
- [ ] 能力启用/禁用
- [ ] 使用日志查看

### Phase 3: 用户交互 (Week 3)

- [ ] 指令发送状态反馈
- [ ] Leader回复消息卡片
- [ ] 快捷指令按钮
- [ ] WebSocket实时推送

### Phase 4: 高级功能 (Week 4)

- [ ] 自定义脚本执行器
- [ ] 能力统计分析
- [ ] 低置信度优化建议
- [ ] 能力版本管理

---

## 11. 用户诉求管理机制

### 11.1 设计目标

- **全生命周期管理**：从接收到完成，全程跟踪用户诉求
- **智能优先级评估**：Leader 根据研究状态智能判断处理优先级
- **冲突检测与处理**：识别并处理相互冲突的诉求
- **透明反馈**：用户清楚知道诉求的处理状态和原因

### 11.2 诉求状态流转

```
RECEIVED → ANALYZING → CLARIFYING → PLANNED → EXECUTING → COMPLETED
   │           │           │            │          │          │
   └───────────┴───────────┴────────────┴──────────┴──────────┘
                           ↓            ↓          ↓
                        REJECTED    DEFERRED    FAILED
```

| 状态       | 说明                            | 用户提示           |
| ---------- | ------------------------------- | ------------------ |
| RECEIVED   | Leader 已收到诉求               | "✓ 已收到"         |
| ANALYZING  | Leader 正在分析诉求意图和可行性 | "🔍 分析中..."     |
| CLARIFYING | 需要用户补充信息                | "❓ 请补充..."     |
| PLANNED    | 已纳入执行计划，等待执行        | "📋 已规划"        |
| EXECUTING  | 正在执行中                      | "⚙️ 执行中..."     |
| COMPLETED  | 执行完成                        | "✅ 已完成"        |
| REJECTED   | 无法执行（说明原因）            | "⚠️ 无法执行：..." |
| DEFERRED   | 延后处理（说明原因和预计时间）  | "⏸️ 已延后：..."   |
| FAILED     | 执行失败（说明原因和建议）      | "❌ 执行失败：..." |

### 11.3 Leader 决策逻辑

```typescript
interface RequestDecisionContext {
  request: UserRequest;
  currentMission: MissionStatus;
  pendingRequests: UserRequest[];
  researchProgress: number;
  availableAgents: Agent[];
}

interface RequestDecision {
  action: "accept" | "reject" | "defer" | "clarify";
  priority: "immediate" | "high" | "normal" | "low";
  reason: string;
  executionPlan?: ExecutionStep[];
  clarificationQuestion?: string;
  deferUntil?: Date;
}
```

**决策规则：**

```typescript
async function makeRequestDecision(
  ctx: RequestDecisionContext,
): Promise<RequestDecision> {
  // 1. 检查请求是否与当前任务冲突
  const conflict = detectConflict(ctx.request, ctx.currentMission);
  if (conflict.hasConflict) {
    // 评估冲突严重程度
    if (conflict.severity === "blocking") {
      return {
        action: "reject",
        priority: "normal",
        reason: `当前请求与进行中的「${conflict.conflictingTask}」任务冲突，请等待该任务完成后再试`,
      };
    }
    // 轻微冲突，可以延后
    return {
      action: "defer",
      priority: "normal",
      reason: `需要等待「${conflict.conflictingTask}」完成后执行`,
      deferUntil: conflict.estimatedCompletion,
    };
  }

  // 2. 评估请求紧急程度
  const urgency = assessUrgency(ctx.request, ctx.researchProgress);

  // 3. 检查资源可用性
  const resourceCheck = checkResourceAvailability(
    ctx.request,
    ctx.availableAgents,
  );
  if (!resourceCheck.available) {
    return {
      action: "defer",
      priority: urgency.priority,
      reason: `当前研究员繁忙，${resourceCheck.estimatedWait}后开始执行`,
      deferUntil: resourceCheck.availableAt,
    };
  }

  // 4. 生成执行计划
  const plan = await generateExecutionPlan(ctx.request, ctx);

  return {
    action: "accept",
    priority: urgency.priority,
    reason: urgency.reason,
    executionPlan: plan,
  };
}
```

### 11.4 优先级评估规则

| 场景                           | 优先级    | 说明                       |
| ------------------------------ | --------- | -------------------------- |
| 研究方向完全错误，需要紧急纠正 | immediate | 立即暂停当前任务，优先处理 |
| 补充关键遗漏的研究维度         | high      | 尽快插入执行队列           |
| 调整某个维度的研究深度         | normal    | 按顺序执行                 |
| 单纯查询状态                   | low       | 不影响执行，立即响应       |
| 研究已完成80%后的大幅调整      | deferred  | 建议完成当前研究后再调整   |

### 11.5 冲突检测与处理

**冲突类型：**

| 冲突类型 | 示例                           | 处理方式       |
| -------- | ------------------------------ | -------------- |
| 方向冲突 | "关注A" vs "关注B"（A、B互斥） | 询问用户选择   |
| 深度冲突 | "深入分析" vs "简化内容"       | 以最新指令为准 |
| 资源冲突 | 多个请求都需要同一个研究员     | 按优先级排队   |
| 时间冲突 | 研究已80%，要求大幅调整方向    | 建议延后或确认 |
| 逻辑冲突 | "删除维度A" + "深入分析维度A"  | 拒绝后一个请求 |

**冲突处理流程：**

```
检测到冲突 → 评估影响 → 决定处理方式 → 反馈用户
                          ↓
                    ┌─────┴─────┐
                    │           │
                 可自动解决   需用户决定
                    │           │
                    ↓           ↓
              执行最优方案   询问用户选择
```

### 11.6 诉求队列管理

```typescript
interface RequestQueue {
  // 等待中的请求
  pending: {
    request: UserRequest;
    receivedAt: Date;
    estimatedStartTime: Date;
    blockedBy?: string[]; // 被哪些任务阻塞
  }[];

  // 正在执行的请求
  executing: {
    request: UserRequest;
    startedAt: Date;
    progress: number;
    currentStep: string;
  }[];

  // 已延后的请求
  deferred: {
    request: UserRequest;
    deferredAt: Date;
    reason: string;
    resumeCondition: string;
    autoResumeAt?: Date;
  }[];
}
```

**队列优化规则：**

1. **合并相似请求**：短时间内的相似请求合并处理
2. **批量执行**：同类型请求批量执行提高效率
3. **智能排序**：根据依赖关系优化执行顺序
4. **超时处理**：等待超过阈值的请求提醒用户

### 11.7 用户反馈界面

**诉求状态面板：**

```
┌─────────────────────────────────────────────────────────────┐
│  我的诉求                                    [查看历史]      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ⚙️ 执行中                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ "深入分析技术趋势"                           45%    │   │
│  │ 研究员 2 正在分析中...                              │   │
│  │ 预计 3 分钟后完成                                   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  📋 排队中 (2)                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. "补充市场分析维度"                      高优先级 │   │
│  │    预计 5 分钟后开始执行                            │   │
│  │                                                     │   │
│  │ 2. "调整报告结构"                          普通     │   │
│  │    预计 10 分钟后开始执行                           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ⏸️ 已延后 (1)                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ "重新规划整体研究方向"                              │   │
│  │ 原因: 当前研究已完成78%，建议完成后再调整          │   │
│  │ [立即执行] [取消请求]                               │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ✅ 最近完成 (3)                              [展开查看]    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 11.8 异常处理

| 异常情况     | 处理方式         | 用户提示                          |
| ------------ | ---------------- | --------------------------------- |
| 请求解析失败 | 请求澄清         | "未能理解您的意图，请详细说明..." |
| 执行超时     | 自动重试 + 通知  | "执行时间较长，正在重试..."       |
| Agent 异常   | 切换到备用 Agent | "正在调整执行方案..."             |
| 多次失败     | 人工介入提示     | "遇到困难，建议手动调整..."       |

### 11.9 数据模型扩展

```prisma
// 用户诉求记录
model UserRequest {
  id          String   @id @default(cuid())
  topicId     String   @map("topic_id")
  missionId   String?  @map("mission_id")
  userId      String   @map("user_id")

  // 诉求内容
  instruction String   @db.Text
  parsedIntent Json?   // 解析后的意图

  // 状态管理
  status      RequestStatus @default(RECEIVED)
  priority    RequestPriority @default(NORMAL)

  // 处理信息
  assignedTo  String?  // 分配给哪个 Agent
  result      Json?    // 执行结果
  errorMessage String?

  // 延后信息
  deferredReason String?
  deferredUntil DateTime?
  autoResume    Boolean @default(false)

  // 冲突信息
  conflictsWith String[] @default([])
  conflictResolution String?

  // 时间线
  receivedAt  DateTime @default(now())
  analyzedAt  DateTime?
  plannedAt   DateTime?
  startedAt   DateTime?
  completedAt DateTime?

  // 关系
  topic       ResearchTopic @relation(fields: [topicId], references: [id])
  user        User @relation(fields: [userId], references: [id])

  @@index([topicId, status])
  @@index([userId, receivedAt(sort: Desc)])
  @@map("user_requests")
}

enum RequestStatus {
  RECEIVED
  ANALYZING
  CLARIFYING
  PLANNED
  EXECUTING
  COMPLETED
  REJECTED
  DEFERRED
  FAILED
}

enum RequestPriority {
  IMMEDIATE
  HIGH
  NORMAL
  LOW
}
```

---

## 12. 完整实现计划

### Phase 1: 基础框架 (Week 1)

- [ ] 创建 LeaderCapability 数据模型
- [ ] 创建 UserRequest 数据模型
- [ ] 实现能力服务 CRUD
- [ ] 预置13个基础能力
- [ ] 实现意图识别服务
- [ ] 实现内置执行器

### Phase 2: 诉求管理 (Week 2)

- [ ] 实现诉求状态机
- [ ] 实现优先级评估
- [ ] 实现冲突检测
- [ ] 实现诉求队列管理
- [ ] WebSocket 实时推送

### Phase 3: 管理界面 (Week 3)

- [ ] Admin 能力列表页面
- [ ] 能力编辑表单
- [ ] 能力启用/禁用
- [ ] 使用日志查看
- [ ] 诉求状态面板

### Phase 4: 用户交互 (Week 4)

- [ ] 指令发送状态反馈
- [ ] Leader 回复消息卡片
- [ ] 快捷指令按钮
- [ ] 诉求历史查看
- [ ] 延后请求管理

### Phase 5: 高级功能 (Week 5)

- [ ] 自定义脚本执行器
- [ ] 能力统计分析
- [ ] 低置信度优化建议
- [ ] 能力版本管理
- [ ] 智能诉求合并

---

**文档版本：** v2.1
**更新日期：** 2026-01-13
**作者：** Claude (PM)
