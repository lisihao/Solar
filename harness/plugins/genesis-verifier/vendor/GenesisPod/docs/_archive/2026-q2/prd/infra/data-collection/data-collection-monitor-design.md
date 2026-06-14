# 批量数据采集进度监控系统 - 产品设计方案

## 一、问题分析

### 当前痛点

1. **缺乏可视化反馈**：点击"Run All"后只有简单的confirm对话框和alert提示
2. **无法追踪进度**：用户不知道采集任务的实时状态
3. **错误定位困难**：无法快速识别和定位失败的任务
4. **体验不专业**：缺少专业的工作台感觉

### 用户需求

- 点击"Run All"时应该进入专业的进度监控页面
- 实时查看所有数据源的采集进度
- 清晰的统计数据和可视化展示
- 快速定位和处理错误

## 二、产品设计方案

### 方案选择：全屏进度监控页面（推荐）

**优势：**

- 更大的展示空间，可以同时监控多个任务
- 支持复杂交互（筛选、排序、展开详情）
- 专业的数据工作台体验
- 可以集成到Monitor菜单，复用于所有批量任务

### 页面结构设计

#### 1. 顶部总览区域（Header Overview）

```
┌─────────────────────────────────────────────────────────────┐
│ ◀ Back to Config     Papers批量采集                         │
│                      Started: 2025-01-22 14:30:25            │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ Overall Progress: ████████████████░░░░░░ 65%            │ │
│ │ 5 tasks: 3 Running | 1 Completed | 1 Pending            │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│ │  Total   │ │ Success  │ │ Duplicates│ │ Failed   │       │
│ │   245    │ │   198    │ │    42     │ │    5     │       │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**包含内容：**

- 返回按钮
- 批次标题（类别名称 + "批量采集"）
- 启动时间
- 总体进度条（聚合所有任务）
- 任务状态分布（运行中/完成/等待/失败）
- 四大核心指标：总采集数、成功数、去重数、失败数

#### 2. 任务列表区域（Task List）

```
┌─────────────────────────────────────────────────────────────┐
│ Filter: [All ▼] [Running] [Completed] [Failed]              │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔵 arXiv                                    ▼ Expand     │ │
│ │ Running • Progress: 75% • 45/60 items                    │ │
│ │ ████████████████████░░░░░░                               │ │
│ │ ✓ 38 Success  ⊗ 2 Failed  ⚡ 5 Duplicates               │ │
│ │ Current: Fetching metadata... [14:35:22]                 │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🔴 Semantic Scholar                        ▼ Expand     │ │
│ │ Failed • Progress: 23% • 14/60 items                     │ │
│ │ ████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░                  │ │
│ │ ✓ 10 Success  ⊗ 4 Failed  ⚡ 0 Duplicates               │ │
│ │ ❌ Error: API rate limit exceeded [14:33:15]             │ │
│ │   ┌─ View Error Details ─────────────────────────────┐  │ │
│ │   │ Status: 429 Too Many Requests                      │  │ │
│ │   │ Message: Rate limit: 10 req/min exceeded          │  │ │
│ │   │ Retry After: 45 seconds                           │  │ │
│ │   │ [Retry Now] [Skip This Source]                    │  │ │
│ │   └──────────────────────────────────────────────────┘  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                               │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ✅ Google Scholar                          ▼ Expand     │ │
│ │ Completed • 100% • 50/50 items                           │ │
│ │ ████████████████████████████████████████                 │ │
│ │ ✓ 42 Success  ⊗ 0 Failed  ⚡ 8 Duplicates               │ │
│ │ ✓ Completed in 2m 34s [14:33:05]                        │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**每个任务卡片包含：**

- 状态图标（蓝色运行/绿色完成/红色失败/灰色等待）
- 数据源名称
- 展开/折叠按钮
- 状态标签 + 进度百分比 + 已处理/总数
- 进度条（视觉化）
- 三项统计：成功/失败/去重数量
- 当前步骤或错误信息（带时间戳）
- 展开区域：
  - 详细日志（滚动显示）
  - 错误详情（如果失败）
  - 操作按钮（重试/跳过）

#### 3. 底部操作区域（Actions）

```
┌─────────────────────────────────────────────────────────────┐
│ [⏸ Pause All] [▶ Resume All] [📊 Export Report]           │
│                                        [Close & Background] │
└─────────────────────────────────────────────────────────────┘
```

**操作按钮：**

- 暂停所有任务
- 恢复所有任务
- 导出采集报告（JSON/CSV）
- 关闭并后台运行（返回配置页，任务继续运行）

### 实时更新机制

1. **WebSocket连接**（理想方案）
   - 后端推送实时进度更新
   - 低延迟、高效率
   - 需要后端WebSocket支持

2. **轮询机制**（当前实现）
   - 每2秒查询一次所有任务状态
   - 简单可靠，与现有代码一致
   - 批量查询接口：`GET /api/data-collection/tasks?ids=1,2,3,4,5&status=RUNNING,PENDING`

### 状态管理

**任务状态流转：**

```
PENDING → RUNNING → COMPLETED
                  ↓
                FAILED
                  ↓
              RETRYING → RUNNING
```

**颜色编码：**

- PENDING: 灰色 `bg-gray-100 text-gray-700`
- RUNNING: 蓝色 `bg-blue-100 text-blue-700` （带动画）
- COMPLETED: 绿色 `bg-emerald-100 text-emerald-700`
- FAILED: 红色 `bg-red-100 text-red-700`
- RETRYING: 黄色 `bg-yellow-100 text-yellow-700`

### 交互细节

1. **自动展开失败任务**
   - 失败的任务自动展开显示错误详情
   - 方便用户快速定位问题

2. **智能筛选**
   - 默认显示所有任务
   - 可筛选：运行中/完成/失败
   - 失败优先排序

3. **实时日志流**
   - 每个任务展开后显示滚动日志
   - 新日志自动追加到底部
   - 支持暂停自动滚动

4. **完成后提示**
   - 所有任务完成后显示通知
   - 汇总报告弹窗
   - 引导用户查看采集结果

## 三、技术实现方案

### 前端实现

#### 新建页面：`frontend/app/data-collection/batch-monitor/page.tsx`

**关键功能模块：**

1. `BatchMonitorHeader` - 顶部总览组件
2. `TaskCard` - 单个任务卡片组件
3. `TaskLogViewer` - 任务日志查看器
4. `BatchActions` - 批量操作组件

**状态管理：**

```typescript
interface BatchMonitorState {
  batchId: string;
  category: string;
  tasks: CollectionTask[];
  overallProgress: number;
  aggregateStats: {
    total: number;
    success: number;
    failed: number;
    duplicates: number;
  };
  filter: "all" | "running" | "completed" | "failed";
  expandedTasks: Set<string>;
}
```

#### 路由跳转逻辑

修改 `handleRunAllCategory` 函数：

```typescript
const handleRunAllCategory = async (category) => {
  // 1. 创建所有任务
  const taskIds = await createBatchTasks(category);

  // 2. 跳转到批量监控页面
  router.push(
    `/data-collection/batch-monitor?tasks=${taskIds.join(",")}&category=${category.id}`,
  );
};
```

### 后端实现

#### 新增API端点

1. **批量查询任务** `GET /api/data-collection/tasks`
   - 支持批量查询多个任务
   - 返回聚合统计信息

2. **批量暂停/恢复** `POST /api/data-collection/tasks/batch-pause`
   - 批量暂停或恢复任务

3. **导出报告** `GET /api/data-collection/tasks/export-report`
   - 导出批量采集报告

#### 数据模型增强

在 `CollectionTask` 中添加：

```typescript
interface CollectionTask {
  // ... 现有字段
  logs?: TaskLog[]; // 任务日志
  retryCount?: number; // 重试次数
  retryAfter?: Date; // 下次重试时间
}

interface TaskLog {
  timestamp: Date;
  level: "info" | "warn" | "error";
  message: string;
}
```

## 四、实现优先级

### P0 - 核心功能（MVP）

- ✅ 全屏批量监控页面
- ✅ 实时进度展示（轮询）
- ✅ 任务状态可视化
- ✅ 聚合统计数据
- ✅ 失败任务高亮

### P1 - 增强功能

- ✅ 任务筛选
- ✅ 展开/折叠任务详情
- ✅ 简单日志展示
- ✅ 批量操作（暂停/恢复）

### P2 - 优化功能

- 详细日志流
- 导出报告
- WebSocket实时推送
- 任务重试机制

## 五、验收标准

1. **功能完整性**
   - 点击"Run All"能正确跳转到监控页面
   - 所有任务状态实时更新
   - 进度条和统计数据准确

2. **用户体验**
   - 页面响应流畅，无卡顿
   - 失败任务清晰可见
   - 操作反馈及时明确

3. **稳定性**
   - 长时间运行不崩溃
   - 网络异常能优雅降级
   - 数据一致性保证

4. **性能**
   - 页面加载时间 < 1秒
   - 轮询不影响主线程
   - 支持同时监控20+任务

## 六、后续扩展

1. **通知系统**
   - 任务完成浏览器通知
   - 失败邮件告警

2. **历史记录**
   - 查看历史批量采集记录
   - 对比不同批次的效果

3. **调度集成**
   - 定时批量采集
   - Cron表达式配置

4. **智能优化**
   - 自动重试失败任务
   - 动态调整并发数
   - 智能去重建议
