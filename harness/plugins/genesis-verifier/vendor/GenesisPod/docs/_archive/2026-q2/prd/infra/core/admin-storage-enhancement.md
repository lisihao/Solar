# Admin Storage 功能增强 PRD

> ⚠️ **状态更新 (2026-05-11)**：存储管理正在并入 **数据管理** 大卡（含 数据源 / 存储用量 / 数据资产 / 数据治理 4 Tab），不再作为独立顶级菜单。本 PRD 中的"系统内存 / 进程内存 / 缓存监控"诉求归并入 **系统管理 → 运行监控 Tab**。最新设计见 `.claude/standards/20-admin-ui-design.md` v1.1+。本文档归档保留。
>
> 全面的存储与内存监控管理系统
>
> 版本: 1.0 | 日期: 2024-12-29 | 状态: 草稿 → 已演进 | 作者: PM Agent

---

## 文档信息

| 项目     | 说明                                      |
| -------- | ----------------------------------------- |
| 版本     | 1.0                                       |
| 创建日期 | 2024-12-29                                |
| 状态     | 草稿                                      |
| 优先级   | P1                                        |
| 依赖     | storage.service.ts, storage.controller.ts |

---

## 一、执行摘要

### 1.1 背景

用户反馈当前 Admin -> Storage 页面存在两个核心问题：

1. **信息不全面**：页面名为"存储管理"，但只展示数据库存储信息，缺少系统内存、进程内存、缓存等关键指标
2. **AI 优化无用**：AI 诊断返回的建议只是文字描述，无法一键执行，用户需要手动操作

### 1.2 当前功能分析

**现有能力（storage.service.ts, 1657行）：**

| 功能            | 状态     | 说明                       |
| --------------- | -------- | -------------------------- |
| 数据类别统计    | 已实现   | 21个类别，基于预估值       |
| PostgreSQL 分析 | 已实现   | 真实表大小、TOAST、索引    |
| AI 诊断         | 部分实现 | 只返回 JSON 建议，不可执行 |
| 分类清理        | 已实现   | 支持 8 种数据类型清理      |
| VACUUM 操作     | 已实现   | 支持 VACUUM FULL           |
| 磁盘使用分析    | 已实现   | getFullDiskUsage()         |

**缺失能力：**

| 缺失功能             | 影响                     | 优先级 |
| -------------------- | ------------------------ | ------ |
| Node.js 进程内存监控 | 无法判断后端是否内存泄漏 | P0     |
| 操作系统内存监控     | 无法判断服务器整体状态   | P1     |
| AI 建议一键执行      | 用户体验差，建议无法落地 | P0     |
| Redis 缓存监控       | 如有使用 Redis，无法监控 | P2     |
| 历史趋势图表         | 无法判断资源增长趋势     | P2     |

### 1.3 核心目标

1. **信息全面**：一个页面展示所有存储/内存相关信息
2. **可操作性**：AI 建议可一键执行，清理操作更智能
3. **实用优先**：避免过度设计，聚焦核心痛点

---

## 二、需求分析

### 2.1 "内存/存储"概念澄清

用户提到的"内存占用"可能指以下几种：

```
1. 系统内存 (OS Level)
   - 服务器总内存
   - 已使用/可用内存
   - 交换分区使用

2. 进程内存 (Node.js)
   - Heap Used / Heap Total
   - RSS (Resident Set Size)
   - External Memory
   - Array Buffers

3. 数据库内存 (PostgreSQL)
   - shared_buffers
   - work_mem
   - 连接池使用

4. 缓存内存 (Redis/内存缓存)
   - 缓存键数量
   - 内存使用量
   - 命中率

5. 数据库存储 (磁盘)
   - 表大小
   - 索引大小
   - TOAST 数据
   ← 这是当前页面已有的功能
```

### 2.2 用户场景

#### 场景 1：服务器性能诊断

**角色**：系统管理员

**痛点**：

- Railway 显示内存使用高，但不知道是哪个部分占用
- 需要登录服务器才能查看 Node.js 内存
- 无法判断是数据库还是应用占用

**期望**：

- 一个仪表板展示所有内存/存储指标
- 快速定位问题源头

#### 场景 2：AI 诊断优化落地

**角色**：运维人员

**痛点**：

- AI 说"清理 generated_images 表可节省 50MB"
- 但需要手动找到对应按钮，确认操作
- 建议和操作是分离的

**期望**：

- AI 建议旁边直接有"执行"按钮
- 点击后自动执行对应清理操作
- 执行后自动刷新数据

#### 场景 3：存储成本控制

**角色**：产品经理

**痛点**：

- Railway 存储费用增长，但不知道是什么数据
- 需要定期手动清理

**期望**：

- 查看存储增长趋势
- 设置自动清理策略

### 2.3 功能边界

**本次实现（P0/P1）：**

- Node.js 进程内存监控
- 操作系统内存信息
- AI 建议一键执行
- 页面布局重构

**暂不实现（P2/P3）：**

- Redis 缓存监控（项目未使用 Redis）
- PostgreSQL 内存配置（需要 DBA 权限）
- 历史趋势图表（需要时序数据库）
- 自动清理策略（复杂度高）

---

## 三、功能设计

### 3.1 信息架构

将页面重构为 4 个区域：

```
┌─────────────────────────────────────────────────────────────┐
│                     Storage & Memory Overview                │
│  [Refresh] [Analyze DB] [AI Diagnosis] [Full Cleanup]       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 1. System Overview Cards (新增)                         ││
│  │ ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐││
│  │ │ Node.js   │ │ System    │ │ Database  │ │ Total     │││
│  │ │ Memory    │ │ Memory    │ │ Storage   │ │ Records   │││
│  │ │ 256MB     │ │ 1.2/4GB   │ │ 406MB     │ │ 125,000   │││
│  │ └───────────┘ └───────────┘ └───────────┘ └───────────┘││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 2. AI Diagnosis Panel (增强)                            ││
│  │ ┌─────────────────────────────────────────────────────┐ ││
│  │ │ Health Score: 75/100                                │ ││
│  │ ├─────────────────────────────────────────────────────┤ ││
│  │ │ Issue 1: generated_images 表过大 (65MB)             │ ││
│  │ │ Recommendation: 清理未收藏的图片                    │ ││
│  │ │ Potential Savings: ~50MB                            │ ││
│  │ │ [Execute Cleanup] ← 新增：一键执行按钮              │ ││
│  │ ├─────────────────────────────────────────────────────┤ ││
│  │ │ Issue 2: raw_data 有 1000 条待处理                  │ ││
│  │ │ [Clean Processed Data]  [View Details]              │ ││
│  │ └─────────────────────────────────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 3. Database Analysis (现有，保留)                       ││
│  │ - 表大小排行                                            ││
│  │ - VACUUM 操作                                           ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 4. Data Categories Grid (现有，保留)                    ││
│  │ - 21 个数据类别卡片                                     ││
│  │ - 分类清理按钮                                          ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 功能清单

#### P0 - 必须实现

| 功能ID | 功能名称         | 描述                            | 预估工时 |
| ------ | ---------------- | ------------------------------- | -------- |
| F-001  | Node.js 内存监控 | 展示 Heap、RSS、External 等指标 | 1d       |
| F-002  | 系统内存信息     | 展示 OS 层面的内存使用          | 0.5d     |
| F-003  | AI 建议可执行化  | 每条建议附带执行按钮            | 1.5d     |
| F-004  | 概览卡片重构     | 4 个核心指标卡片                | 0.5d     |

#### P1 - 应该实现

| 功能ID | 功能名称       | 描述                     | 预估工时 |
| ------ | -------------- | ------------------------ | -------- |
| F-005  | 建议优先级排序 | 按影响程度排序 AI 建议   | 0.5d     |
| F-006  | 执行结果反馈   | 执行后显示释放了多少空间 | 0.5d     |
| F-007  | 内存警告阈值   | 超过阈值时显示警告       | 0.5d     |

#### P2 - 可以实现（后续迭代）

| 功能ID | 功能名称     | 描述              | 预估工时 |
| ------ | ------------ | ----------------- | -------- |
| F-008  | 历史趋势图表 | 内存/存储使用趋势 | 2d       |
| F-009  | 自动清理策略 | 定时自动执行清理  | 2d       |
| F-010  | 告警通知     | 超阈值时发送通知  | 1d       |

---

## 四、详细设计

### 4.1 F-001: Node.js 内存监控

#### 4.1.1 概述

**目标**：实时展示 Node.js 进程的内存使用情况

**数据来源**：Node.js `process.memoryUsage()` API

#### 4.1.2 数据结构

```typescript
interface NodeMemoryStats {
  // 进程内存
  heapUsed: number; // V8 堆已使用 (MB)
  heapTotal: number; // V8 堆总量 (MB)
  heapUsedPercent: number; // 堆使用率
  rss: number; // 常驻内存 (MB)
  external: number; // C++ 对象内存 (MB)
  arrayBuffers: number; // ArrayBuffer 内存 (MB)

  // 进程信息
  uptime: number; // 运行时长 (秒)
  pid: number; // 进程 ID
  nodeVersion: string; // Node.js 版本

  // 诊断信息
  status: "healthy" | "warning" | "critical";
  warnings: string[]; // 如 "Heap usage > 80%"
}
```

#### 4.1.3 后端实现

```typescript
// backend/src/modules/ai-infra/storage/storage.service.ts

async getNodeMemoryStats(): Promise<NodeMemoryStats> {
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / (1024 * 1024);
  const heapTotalMB = memUsage.heapTotal / (1024 * 1024);
  const heapUsedPercent = (heapUsedMB / heapTotalMB) * 100;

  const warnings: string[] = [];
  let status: 'healthy' | 'warning' | 'critical' = 'healthy';

  if (heapUsedPercent > 90) {
    status = 'critical';
    warnings.push('Heap usage exceeds 90%, consider restarting');
  } else if (heapUsedPercent > 75) {
    status = 'warning';
    warnings.push('Heap usage exceeds 75%');
  }

  return {
    heapUsed: Math.round(heapUsedMB * 100) / 100,
    heapTotal: Math.round(heapTotalMB * 100) / 100,
    heapUsedPercent: Math.round(heapUsedPercent * 100) / 100,
    rss: Math.round(memUsage.rss / (1024 * 1024) * 100) / 100,
    external: Math.round(memUsage.external / (1024 * 1024) * 100) / 100,
    arrayBuffers: Math.round(memUsage.arrayBuffers / (1024 * 1024) * 100) / 100,
    uptime: Math.round(process.uptime()),
    pid: process.pid,
    nodeVersion: process.version,
    status,
    warnings,
  };
}
```

#### 4.1.4 API 端点

```typescript
// backend/src/modules/ai-infra/storage/storage.controller.ts

@Get('node-memory')
async getNodeMemoryStats(@Query('key') key: string): Promise<NodeMemoryStats> {
  this.validateKey(key);
  this.logger.log('Getting Node.js memory stats');
  return this.storageService.getNodeMemoryStats();
}
```

#### 4.1.5 前端展示

```typescript
// 概览卡片
<div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
  <div className="flex items-center gap-2">
    <Cpu className="h-5 w-5 text-blue-600" />
    <span className="text-sm font-medium text-gray-500">Node.js Memory</span>
  </div>
  <div className="mt-2">
    <div className="text-3xl font-bold text-blue-600">
      {nodeMemory.heapUsed}MB
    </div>
    <div className="text-xs text-gray-500">
      of {nodeMemory.heapTotal}MB ({nodeMemory.heapUsedPercent}%)
    </div>
    <div className="mt-2 text-xs text-gray-400">
      RSS: {nodeMemory.rss}MB | Uptime: {formatUptime(nodeMemory.uptime)}
    </div>
  </div>
  {nodeMemory.status !== 'healthy' && (
    <div className={`mt-2 text-xs ${nodeMemory.status === 'critical' ? 'text-red-600' : 'text-yellow-600'}`}>
      {nodeMemory.warnings[0]}
    </div>
  )}
</div>
```

#### 4.1.6 验收标准

- [ ] API 响应时间 < 100ms
- [ ] 数据每次刷新时更新
- [ ] 超过 75% 显示警告样式
- [ ] 超过 90% 显示危险样式

---

### 4.2 F-002: 系统内存信息

#### 4.2.1 概述

**目标**：展示操作系统层面的内存使用情况

**数据来源**：Node.js `os` 模块

#### 4.2.2 数据结构

```typescript
interface SystemMemoryStats {
  totalMemory: number; // 总内存 (GB)
  freeMemory: number; // 可用内存 (GB)
  usedMemory: number; // 已使用 (GB)
  usedPercent: number; // 使用率

  platform: string; // 操作系统
  cpuCount: number; // CPU 核心数
  loadAverage: number[]; // 负载 (1/5/15分钟)

  status: "healthy" | "warning" | "critical";
}
```

#### 4.2.3 后端实现

```typescript
import * as os from 'os';

async getSystemMemoryStats(): Promise<SystemMemoryStats> {
  const totalMem = os.totalmem() / (1024 * 1024 * 1024); // GB
  const freeMem = os.freemem() / (1024 * 1024 * 1024);
  const usedMem = totalMem - freeMem;
  const usedPercent = (usedMem / totalMem) * 100;

  let status: 'healthy' | 'warning' | 'critical' = 'healthy';
  if (usedPercent > 90) status = 'critical';
  else if (usedPercent > 80) status = 'warning';

  return {
    totalMemory: Math.round(totalMem * 100) / 100,
    freeMemory: Math.round(freeMem * 100) / 100,
    usedMemory: Math.round(usedMem * 100) / 100,
    usedPercent: Math.round(usedPercent * 100) / 100,
    platform: os.platform(),
    cpuCount: os.cpus().length,
    loadAverage: os.loadavg().map(l => Math.round(l * 100) / 100),
    status,
  };
}
```

#### 4.2.4 注意事项

- Railway 容器环境下，`os.totalmem()` 可能返回宿主机内存
- 可考虑读取 cgroup 限制（如 `/sys/fs/cgroup/memory/memory.limit_in_bytes`）
- 简单起见，先使用 `os` 模块，后续可优化

---

### 4.3 F-003: AI 建议可执行化

#### 4.3.1 概述

**目标**：让 AI 诊断的每条建议都可以一键执行

**当前问题**：

- AI 返回 JSON 格式的建议
- 建议中有 `cleanupPlan` 字段，但前端只是展示
- 用户需要手动找到对应的清理按钮

#### 4.3.2 增强 AI 返回格式

```typescript
interface AIDiagnosis {
  summary: string;
  overallScore: number;

  issues: Array<{
    id: string; // 新增：唯一标识
    severity: "critical" | "warning" | "info";
    title: string;
    description: string;
    recommendation: string;
    potentialSavings?: string;

    // 新增：可执行操作
    action?: {
      type: "cleanup" | "vacuum" | "vacuum_full" | "manual";
      endpoint: string; // API 端点
      params?: Record<string, any>; // 请求参数
      confirmMessage: string; // 确认提示语
      dangerous: boolean; // 是否危险操作
    };
  }>;

  cleanupPlan: Array<{
    step: number;
    action: string;
    target: string;
    expectedSavings: string;

    // 新增：可执行操作
    actionConfig?: {
      endpoint: string;
      params?: Record<string, any>;
    };
  }>;
}
```

#### 4.3.3 动作类型映射

```typescript
const ACTION_MAPPING = {
  // 清理操作
  cleanup_images: {
    endpoint: "/api/v1/storage/cleanup/images",
    method: "POST",
    confirmMessage: "Clean up old unbookmarked images?",
    dangerous: false,
  },
  cleanup_raw_data: {
    endpoint: "/api/v1/storage/cleanup/raw-data",
    method: "POST",
    confirmMessage: "Clean up processed raw data older than 30 days?",
    dangerous: false,
  },
  cleanup_office_documents: {
    endpoint: "/api/v1/storage/cleanup/office-documents",
    method: "POST",
    confirmMessage: "Clean up PPT documents older than 7 days?",
    dangerous: false,
  },
  cleanup_user_activities: {
    endpoint: "/api/v1/storage/cleanup/user-activities",
    method: "POST",
    confirmMessage: "Clean up user activities older than 30 days?",
    dangerous: false,
  },
  cleanup_ask_sessions: {
    endpoint: "/api/v1/storage/cleanup/ask-sessions",
    method: "POST",
    confirmMessage: "Clean up AI chat sessions older than 30 days?",
    dangerous: false,
  },
  cleanup_metadata: {
    endpoint: "/api/v1/storage/cleanup/metadata",
    method: "POST",
    confirmMessage: "Clean up expired metadata cache?",
    dangerous: false,
  },

  // 数据库操作
  vacuum: {
    endpoint: "/api/v1/storage/vacuum",
    method: "POST",
    confirmMessage: "Run VACUUM ANALYZE? This may take a few minutes.",
    dangerous: false,
  },
  vacuum_full: {
    endpoint: "/api/v1/storage/vacuum-full-all",
    method: "POST",
    confirmMessage:
      "Run VACUUM FULL on all tables? This will LOCK tables during operation.",
    dangerous: true,
  },

  // 危险操作
  delete_all_images: {
    endpoint: "/api/v1/storage/images/all",
    method: "DELETE",
    confirmMessage:
      "WARNING: This will permanently delete ALL generated images!",
    dangerous: true,
  },
  delete_all_raw_data: {
    endpoint: "/api/v1/storage/raw-data/all",
    method: "DELETE",
    confirmMessage: "WARNING: This will permanently delete ALL raw data!",
    dangerous: true,
  },
};
```

#### 4.3.4 优化 AI Prompt

```typescript
const AI_DIAGNOSIS_PROMPT = `You are a storage optimization expert analyzing a GenesisPod instance.

Current storage data:
- Database size: {dbSize}MB
- Top tables: {topTables}
- Data categories: {categories}

Analyze and provide optimization recommendations in JSON format.

IMPORTANT: For each issue, include an "action" field that maps to available cleanup operations:
- cleanup_images: Clean unbookmarked images
- cleanup_raw_data: Clean processed raw data (>30 days)
- cleanup_office_documents: Clean old PPT documents (>7 days)
- cleanup_user_activities: Clean old activity logs (>30 days)
- cleanup_ask_sessions: Clean old AI chat sessions (>30 days)
- cleanup_metadata: Clean expired metadata cache
- vacuum: Run VACUUM ANALYZE
- vacuum_full: Run VACUUM FULL (use sparingly)

Output format:
{
  "summary": "Brief assessment",
  "overallScore": 0-100,
  "issues": [
    {
      "id": "issue_1",
      "severity": "critical|warning|info",
      "title": "Issue title",
      "description": "What's the problem",
      "recommendation": "What to do",
      "potentialSavings": "~50MB",
      "action": {
        "type": "cleanup_images",
        "confirmMessage": "Clean up old images to save ~50MB?",
        "dangerous": false
      }
    }
  ],
  "cleanupPlan": [...]
}

Focus on actionable recommendations that can be executed immediately.`;
```

#### 4.3.5 前端执行逻辑

```typescript
// 执行建议的操作
const executeAction = async (issue: DiagnosisIssue) => {
  if (!issue.action) return;

  const actionConfig = ACTION_MAPPING[issue.action.type];
  if (!actionConfig) {
    setMessage({ type: "error", text: "Unknown action type" });
    return;
  }

  // 危险操作需要二次确认
  const confirmText = issue.action.dangerous
    ? `${issue.action.confirmMessage}\n\nThis action cannot be undone!`
    : issue.action.confirmMessage;

  if (!confirm(confirmText)) return;

  setExecutingAction(issue.id);
  try {
    const res = await fetch(
      `${API_BASE}${actionConfig.endpoint}?key=${ADMIN_KEY}`,
      { method: actionConfig.method },
    );
    const result = await res.json();

    if (result.success) {
      setMessage({
        type: "success",
        text: result.message || "Action completed successfully",
      });
      // 刷新数据
      await loadStats();
      await loadDbAnalysis();
    } else {
      setMessage({
        type: "error",
        text: result.message || "Action failed",
      });
    }
  } catch (error) {
    setMessage({ type: "error", text: "Failed to execute action" });
  } finally {
    setExecutingAction(null);
  }
};
```

#### 4.3.6 UI 设计

每条 AI 建议的展示增加执行按钮：

```tsx
{
  aiDiagnosis.issues.map((issue) => (
    <div
      key={issue.id}
      className={`rounded-lg border-l-4 p-4 ${severityStyles[issue.severity]}`}
    >
      <div className="flex items-center justify-between">
        <h4 className="font-medium">{issue.title}</h4>
        <div className="flex items-center gap-2">
          {issue.potentialSavings && (
            <span className="rounded-full bg-white px-2 py-0.5 text-xs">
              Save {issue.potentialSavings}
            </span>
          )}
          {issue.action && (
            <button
              onClick={() => executeAction(issue)}
              disabled={executingAction === issue.id}
              className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-white ${
                issue.action.dangerous
                  ? "bg-red-500 hover:bg-red-600"
                  : "bg-blue-500 hover:bg-blue-600"
              } disabled:opacity-50`}
            >
              {executingAction === issue.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              Execute
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-sm">{issue.description}</p>
      <p className="mt-2 text-sm font-medium">
        Recommendation: {issue.recommendation}
      </p>
    </div>
  ));
}
```

#### 4.3.7 验收标准

- [ ] 每条 AI 建议都有可执行的 action（如适用）
- [ ] 危险操作有二次确认
- [ ] 执行过程有 loading 状态
- [ ] 执行成功后自动刷新数据
- [ ] 执行失败有错误提示

---

### 4.4 F-004: 概览卡片重构

#### 4.4.1 设计

页面顶部展示 4 个核心指标卡片：

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Node.js Mem  │ │ System Mem   │ │ Database     │ │ Total        │
│              │ │              │ │ Storage      │ │ Records      │
│   256 MB     │ │  1.2/4 GB    │ │   406 MB     │ │   125,000    │
│ Heap: 180MB  │ │   30% used   │ │ 45 tables    │ │ 21 types     │
│ [healthy]    │ │ [healthy]    │ │ [warning]    │ │              │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

#### 4.4.2 状态指示

- **Healthy** (绿色)：使用率 < 75%
- **Warning** (黄色)：使用率 75-90%
- **Critical** (红色)：使用率 > 90%

---

## 五、任务拆分

### 5.1 后端任务

| ID    | 任务                        | 类型 | 预估  | 依赖  |
| ----- | --------------------------- | ---- | ----- | ----- |
| T-001 | 实现 getNodeMemoryStats()   | 后端 | 0.5d  | -     |
| T-002 | 实现 getSystemMemoryStats() | 后端 | 0.5d  | -     |
| T-003 | 添加 node-memory API 端点   | 后端 | 0.25d | T-001 |
| T-004 | 添加 system-memory API 端点 | 后端 | 0.25d | T-002 |
| T-005 | 更新 AI 诊断 prompt         | 后端 | 0.5d  | -     |

### 5.2 前端任务

| ID    | 任务                 | 类型 | 预估 | 依赖         |
| ----- | -------------------- | ---- | ---- | ------------ |
| T-006 | 重构概览卡片区域     | 前端 | 0.5d | T-003, T-004 |
| T-007 | 实现 AI 建议执行按钮 | 前端 | 1d   | T-005        |
| T-008 | 添加执行状态反馈     | 前端 | 0.5d | T-007        |
| T-009 | 优化页面布局         | 前端 | 0.5d | T-006        |

### 5.3 总工时

| 阶段     | 工时   |
| -------- | ------ |
| 后端开发 | 2d     |
| 前端开发 | 2.5d   |
| 测试联调 | 0.5d   |
| **总计** | **5d** |

---

## 六、风险与依赖

### 6.1 风险

| 风险                     | 概率 | 影响 | 缓解措施                          |
| ------------------------ | ---- | ---- | --------------------------------- |
| Railway 容器内存信息不准 | 中   | 低   | 可选读取 cgroup，或标注为"参考值" |
| AI 建议格式解析失败      | 低   | 中   | 添加格式校验，降级展示纯文本      |
| 误操作执行危险命令       | 低   | 高   | 二次确认 + 危险操作红色警示       |

### 6.2 依赖

| 依赖                       | 状态 | 说明           |
| -------------------------- | ---- | -------------- |
| 现有 storage.service.ts    | 已有 | 在此基础上扩展 |
| 现有 storage.controller.ts | 已有 | 添加新端点     |
| AI simple-chat API         | 已有 | 用于 AI 诊断   |

---

## 七、验收标准

### 7.1 功能验收

- [ ] Node.js 内存信息正确展示
- [ ] 系统内存信息正确展示
- [ ] AI 建议每条都有执行按钮（如适用）
- [ ] 点击执行按钮可以成功执行操作
- [ ] 危险操作有二次确认
- [ ] 执行后自动刷新数据

### 7.2 性能验收

- [ ] 页面加载时间 < 2s
- [ ] 内存 API 响应时间 < 100ms
- [ ] AI 诊断响应时间 < 10s

### 7.3 体验验收

- [ ] 卡片状态指示清晰
- [ ] 加载状态有反馈
- [ ] 错误信息友好

---

## 八、附录

### A. 现有 API 端点

| 端点                              | 方法 | 说明         |
| --------------------------------- | ---- | ------------ |
| /storage/stats                    | GET  | 获取存储统计 |
| /storage/database-analysis        | GET  | 数据库分析   |
| /storage/disk-usage               | GET  | 磁盘使用分析 |
| /storage/vacuum                   | POST | VACUUM 操作  |
| /storage/vacuum-full-all          | POST | VACUUM FULL  |
| /storage/cleanup/images           | POST | 清理图片     |
| /storage/cleanup/raw-data         | POST | 清理原始数据 |
| /storage/cleanup/office-documents | POST | 清理 PPT     |
| /storage/cleanup/user-activities  | POST | 清理活动日志 |
| /storage/cleanup/ask-sessions     | POST | 清理会话     |
| /storage/cleanup/metadata         | POST | 清理缓存     |
| /storage/cleanup/all              | POST | 全量清理     |

### B. 新增 API 端点

| 端点                   | 方法 | 说明             |
| ---------------------- | ---- | ---------------- |
| /storage/node-memory   | GET  | Node.js 内存信息 |
| /storage/system-memory | GET  | 系统内存信息     |

### C. 参考文件

- `frontend/app/admin/storage/page.tsx` (1069行)
- `backend/src/modules/ai-infra/storage/storage.service.ts` (1657行)
- `backend/src/modules/ai-infra/storage/storage.controller.ts` (305行)

---

## 九、变更记录

| 版本 | 日期       | 变更内容 | 作者     |
| ---- | ---------- | -------- | -------- |
| 1.0  | 2024-12-29 | 初始版本 | PM Agent |

---

**文档结束**
