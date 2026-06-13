# AI UI Patrol：自动化页面巡检与自修复方案

> 实现 Claude Code 自主发现前端缺陷、定位代码、修复验证的闭环自动化体系。

**状态**: Phase 0-6 全部已实施 (2026-02-03)
**优先级**: P0
**创建时间**: 2026-02-03

## 实施进度

| Phase             | 状态 | 说明                                                                                         |
| ----------------- | ---- | -------------------------------------------------------------------------------------------- |
| Phase 0: 数据基础 | Done | seed-ui-patrol.ts, auth-manager, route-resolver                                              |
| Phase 1: 巡检引擎 | Done | route-discovery, diagnostics-collector, patrol-runner, evaluator, iteration-controller       |
| Phase 2: AI 审查  | Done | 6 spec YAML + 3 scenario YAML + scenario-validator + issue-analyzer + Claude command + skill |
| Phase 3: 自动修复 | Done | fix-generator + fix-validator + 5 fix strategy templates                                     |
| Phase 4: 旅程测试 | Done | 3 journey YAML + journey-runner + journey-cli                                                |
| Phase 5: E2E 生成 | Done | test-generator + playwright.config.ts                                                        |
| Phase 6: 基线回归 | Done | visual-diff + baseline-manager                                                               |

### 已创建文件

```
# Phase 0: 数据基础
backend/prisma/seed-ui-patrol.ts          # 种子数据（upsert 模式）
backend/prisma/clean-ui-patrol.ts         # 清理测试数据
scripts/ui-iteration/auth-manager.ts      # Auth token 注入
scripts/ui-iteration/route-resolver.ts    # 动态路由参数解析

# Phase 1: 巡检引擎
scripts/ui-iteration/index.ts             # CLI 入口
scripts/ui-iteration/config.ts            # 配置（视口/阈值/分级）
scripts/ui-iteration/route-discovery.ts   # 路由扫描
scripts/ui-iteration/diagnostics-collector.ts # 增强诊断采集
scripts/ui-iteration/patrol-runner.ts     # 巡检执行器
scripts/ui-iteration/report-generator.ts  # 报告生成
scripts/ui-iteration/evaluator.ts         # 评估指标计算
scripts/ui-iteration/iteration-controller.ts # 迭代控制器

# Phase 2: AI 审查
.ui-patrol/specs/*.spec.yaml (6 files)    # 组件规格（ai-research, library, ai-teams, ai-ask, ai-writing, rag）
.ui-patrol/scenarios/*.scenarios.yaml (3) # 测试场景
scripts/ui-iteration/scenario-validator.ts # 场景验证
scripts/ui-iteration/issue-analyzer.ts    # 问题分析 + 置信度计算
.claude/commands/ui-iteration.md          # Claude Code 命令
.claude/skills/quality/ui-iteration/SKILL.md # AI 审查技能

# Phase 3: 自动修复
scripts/ui-iteration/fix-generator.ts     # 修复生成
scripts/ui-iteration/fix-validator.ts     # 修复验证（type-check + lint + forbidden patterns）
.ui-patrol/fix-strategies/*.md (5 files)  # 修复模板（null-check, empty-state, css-overflow, api-path, loading-state）

# Phase 4: 旅程测试
.ui-patrol/journeys/*.journey.yaml (3)    # 用户旅程（create-research-topic, search-library, ai-ask-conversation）
scripts/ui-iteration/journey-runner.ts    # 旅程执行器
scripts/ui-iteration/journey-cli.ts       # 旅程 CLI 入口

# Phase 5: E2E 生成
scripts/ui-iteration/test-generator.ts    # Playwright 测试生成
e2e/playwright.config.ts                  # Playwright 配置

# Phase 6: 基线回归
scripts/ui-iteration/visual-diff.ts       # 像素对比
scripts/ui-iteration/baseline-manager.ts  # 基线管理
```

### NPM 命令

```bash
npm run ui-patrol              # 全站巡检
npm run ui-patrol:critical     # 仅 critical 页面
npm run ui-patrol:changed      # 仅 git 变更影响页面
npm run ui-patrol:journeys     # 执行用户旅程测试
npm run db:seed:ui-patrol      # 注入测试数据
npm run db:clean:ui-patrol     # 清理测试数据
npm run e2e                    # 执行 E2E 测试
npm run e2e:ui                 # Playwright UI 模式
```

---

**关联模块**: 全站前端（73 个页面路由）

---

## 目录

- [1. 问题定义](#1-问题定义)
- [2. 方案总览](#2-方案总览)
- [3. 系统架构](#3-系统架构)
- [4. Phase 1：巡检引擎](#4-phase-1巡检引擎)
- [5. Phase 2：AI 审查命令](#5-phase-2ai-审查命令)
- [6. Phase 3：自动修复闭环](#6-phase-3自动修复闭环)
- [7. Phase 4：基线对比与回归防护](#7-phase-4基线对比与回归防护)
- [8. 路由清单与页面分级](#8-路由清单与页面分级)
- [9. 问题分类体系](#9-问题分类体系)
- [10. 与现有基础设施集成](#10-与现有基础设施集成)
- [11. 安全与边界约束](#11-安全与边界约束)
- [12. 实施路线图](#12-实施路线图)
- [13. 文件结构](#13-文件结构)

---

## 1. 问题定义

### 现状痛点

| 痛点         | 描述                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| 人工截图瓶颈 | 每发现一个 UI 问题需人工截图 → 贴给 Claude Code → 等待定位 → 修改 → 再截图验证 |
| 覆盖率低     | 73 个页面路由，人工只能覆盖当前开发的少数页面，大量回归问题被忽略              |
| 定位效率低   | AI 从截图猜测代码位置，无法直接关联路由 → 组件 → 源码行                        |
| 修复周期长   | 单个 UI 问题从发现到确认修复平均需要 5-15 分钟人工介入                         |
| 无持续保障   | 修复 A 页面可能破坏 B 页面，缺少全站级回归检测                                 |

### 目标状态

```
开发者专注业务开发
       ↓
AI 自动巡检全站页面（定时/按需）
       ↓
AI 自动识别问题并按优先级排序
       ↓
AI 自动修复 + 自动验证
       ↓
人工只需 Review 修复结果
```

**核心指标**：

| 指标                | 目标                 |
| ------------------- | -------------------- |
| 页面覆盖率          | 100%（73/73 页面）   |
| 问题发现 → 修复确认 | 全自动，零人工截图   |
| 单次全站巡检        | < 5 分钟（不含修复） |
| 修复验证            | 自动截图对比         |

---

## 2. 方案总览

### 四层架构

```
┌─────────────────────────────────────────────────┐
│  Phase 4: Baseline Guard（基线对比与回归防护）     │
│  像素级 diff / 视觉回归检测 / PR 阻断            │
├─────────────────────────────────────────────────┤
│  Phase 3: Auto Fix Loop（自动修复闭环）           │
│  定位代码 → 修改 → type-check → 重新截图 → 确认  │
├─────────────────────────────────────────────────┤
│  Phase 2: AI Review（AI 审查）                    │
│  截图分析 / 错误归类 / 问题清单 / 优先级排序      │
├─────────────────────────────────────────────────┤
│  Phase 1: Patrol Engine（巡检引擎）               │
│  路由发现 / 页面导航 / 截图采集 / 错误收集        │
└─────────────────────────────────────────────────┘
```

### 两种运行模式

| 模式         | 触发方式                      | 场景                     |
| ------------ | ----------------------------- | ------------------------ |
| **按需模式** | Claude Code 命令 `/ui-patrol` | 开发完一批功能后主动巡检 |
| **守护模式** | 文件监听 + 变更检测           | 长时间开发中持续后台验证 |

---

## 3. 系统架构

### 数据流

```
[Route Discovery]
  frontend/app/**/page.tsx → 路由表 JSON
        ↓
[Patrol Engine]
  Playwright 启动 → 逐页导航 → 截图 + 错误采集
        ↓
[Patrol Report]
  .ui-patrol/reports/2026-02-03T10-30-00.json
  .ui-patrol/screenshots/ai-research/topic.png
        ↓
[AI Review]
  Claude Code 读取报告 → 分析截图 → 输出问题清单
        ↓
[Fix Loop]
  取问题 → 定位组件 → 修改代码 → type-check → 重新截图 → 确认
        ↓
[Baseline Update]
  修复确认后更新基线截图 → 下次巡检对比
```

### 技术选型

| 组件         | 选型                             | 原因                                   |
| ------------ | -------------------------------- | -------------------------------------- |
| 浏览器自动化 | Playwright                       | 项目已有 playwright-core，MCP 工具可用 |
| 截图分析     | Claude Vision (Read tool)        | 原生支持图片分析，无需额外依赖         |
| 路由发现     | AST/Glob 扫描 app/ 目录          | 自动维护，不需手动更新路由表           |
| 报告格式     | JSON                             | 机器可读，AI 可直接解析                |
| 基线存储     | 本地文件 (.ui-patrol/baselines/) | 简单可靠，Git 可选跟踪                 |

---

## 4. Phase 1：巡检引擎

### 4.1 路由发现模块

自动从 `frontend/app/` 扫描所有 `page.tsx`，生成路由清单：

```typescript
// scripts/ui-patrol/route-discovery.ts

interface PageRoute {
  route: string; // "/ai-research/topic"
  filePath: string; // "frontend/app/ai-research/topic/page.tsx"
  componentPath: string; // 主组件的实际路径（从 page.tsx 中解析 import）
  tier: "critical" | "important" | "standard";
  authRequired: boolean;
  dynamicParams?: string[]; // [id] 等动态路由参数
}
```

**动态路由处理策略**：

| 路由类型               | 示例                      | 处理方式                    |
| ---------------------- | ------------------------- | --------------------------- |
| 静态路由               | `/ai-research`            | 直接访问                    |
| 动态路由 `[id]`        | `/ai-research/topic/[id]` | 从数据库取最近一条记录的 ID |
| 可选动态 `[[...slug]]` | `/share/[[...slug]]`      | 先访问无参版本              |
| 需登录页面             | `/library`                | 注入 auth token/cookie      |

### 4.2 巡检执行器

```typescript
// scripts/ui-patrol/patrol-runner.ts

interface PatrolConfig {
  baseUrl: string; // "http://localhost:3000"
  viewports: Viewport[]; // 多分辨率
  authToken?: string; // 登录态
  routes?: string[]; // 指定路由（空=全部）
  screenshotDir: string; // 截图输出目录
  timeout: number; // 单页超时 ms
  retries: number; // 失败重试次数
}

interface Viewport {
  name: string; // "desktop" | "tablet" | "mobile"
  width: number;
  height: number;
}

// 默认视口
const DEFAULT_VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];
```

**巡检流程**：

```
1. 启动 Playwright browser
2. 设置 auth cookie（如需要）
3. for each route:
   a. 导航到页面，等待 networkidle
   b. 等待额外 2s（SPA 渲染完成）
   c. 收集 console.error 和 console.warn
   d. 收集失败的网络请求（4xx/5xx）
   e. 检测页面是否白屏（DOM 节点数 < 阈值）
   f. 对每个 viewport 截图
   g. 记录页面加载时间
4. 输出巡检报告 JSON
5. 关闭浏览器
```

### 4.3 巡检报告格式

```typescript
// .ui-patrol/reports/{timestamp}.json

interface PatrolReport {
  timestamp: string;
  duration: number; // 总耗时 ms
  baseUrl: string;
  summary: {
    total: number; // 总页面数
    passed: number; // 无问题页面
    warnings: number; // 有警告页面
    errors: number; // 有错误页面
    unreachable: number; // 无法访问页面
  };
  pages: PageResult[];
}

interface PageResult {
  route: string;
  filePath: string;
  status: "pass" | "warning" | "error" | "unreachable";
  loadTime: number;
  screenshots: {
    viewport: string;
    path: string; // 相对路径
  }[];
  consoleErrors: ConsoleEntry[];
  consoleWarnings: ConsoleEntry[];
  networkErrors: NetworkError[];
  domNodeCount: number;
  isBlankPage: boolean;
  htmlSnapshot?: string; // 首屏 HTML（可选，用于结构分析）
}

interface ConsoleEntry {
  type: string;
  text: string;
  url?: string;
  lineNumber?: number;
}

interface NetworkError {
  url: string;
  method: string;
  status: number;
  statusText: string;
}
```

### 4.4 巡检脚本入口

```bash
# 全站巡检
npx tsx scripts/ui-patrol/index.ts

# 指定页面巡检
npx tsx scripts/ui-patrol/index.ts --routes "/ai-research,/library"

# 只巡检 critical 级别页面
npx tsx scripts/ui-patrol/index.ts --tier critical

# 只巡检最近 git 变更影响的页面
npx tsx scripts/ui-patrol/index.ts --changed
```

**智能变更检测**（`--changed` 模式）：

```
git diff --name-only HEAD~1
  → 提取变更的前端文件
  → 反向查找哪些 page.tsx 依赖这些文件
  → 只巡检受影响的页面
```

---

## 5. Phase 2：AI 审查命令

### 5.1 Claude Code Skill

创建 `.claude/skills/quality/ui-patrol/SKILL.md`，定义 AI 审查能力。

### 5.2 Claude Code 命令

创建 `.claude/commands/ui-patrol.md`：

```markdown
---
name: ui-patrol
description: 自动化 UI 巡检、审查与修复
allowed_tools:
  [
    Bash,
    Read,
    Write,
    Edit,
    Glob,
    Grep,
    Task,
    mcp__playwright__browser_navigate,
    mcp__playwright__browser_take_screenshot,
    mcp__playwright__browser_snapshot,
    mcp__playwright__browser_click,
    mcp__playwright__browser_console_messages,
    mcp__playwright__browser_evaluate,
    mcp__playwright__browser_network_requests,
  ]
---
```

### 5.3 AI 审查流程

```
Step 1: 读取最新巡检报告
  → 解析 JSON，按 error > warning > pass 排序

Step 2: 对 error/warning 页面逐一深入分析
  → 用 Read tool 查看截图（Claude Vision）
  → 判断问题类型（见第 9 节分类体系）

Step 3: 对每个问题定位代码
  route → page.tsx → 主组件 → 具体行号
  借助 consoleErrors 中的 stack trace 精确定位

Step 4: 输出结构化问题清单
```

**问题清单格式**：

```typescript
interface UIIssue {
  id: string; // "UI-2026-0203-001"
  route: string;
  severity: "critical" | "major" | "minor" | "cosmetic";
  category: string; // 见第 9 节
  description: string; // AI 对问题的描述
  evidence: {
    screenshot?: string; // 截图路径
    consoleError?: string; // 控制台错误
    networkError?: string; // 网络错误
  };
  codeLocation: {
    file: string;
    line?: number;
    component?: string;
  };
  suggestedFix?: string; // AI 建议的修复方向
  autoFixable: boolean; // AI 是否有信心自动修复
}
```

### 5.4 审查规则引擎

AI 审查截图时应用的检查规则：

```yaml
layout_rules:
  - 页面不应出现水平滚动条（desktop 视口）
  - 主内容区不应为空白（排除 loading 状态）
  - 侧边栏和导航栏应正常渲染
  - 列表页应有数据或空状态提示，不应裸露

content_rules:
  - 不应出现 i18n key（如 "common.save"）
  - 不应出现开发占位符（如 "TODO"、"Lorem ipsum"）
  - 不应出现 undefined、null、NaN 等裸文本
  - 不应出现 "[object Object]"

error_rules:
  - console.error 数量应为 0
  - 不应有 Unhandled Promise Rejection
  - 不应有 React hydration mismatch
  - 不应有 404 资源请求

style_rules:
  - 文字不应溢出容器
  - 图片不应破裂（broken image）
  - 按钮和链接应有可见的交互状态
  - 暗色模式/亮色模式应一致
```

---

## 6. Phase 3：自动修复闭环

### 6.1 修复循环

```
输入: UIIssue[]（按 severity 降序排列）

for each issue where autoFixable == true:
  1. 标记 issue 为 in_progress
  2. 读取 issue.codeLocation.file
  3. 分析问题根因
  4. 生成修复代码
  5. 应用修改（Edit tool）
  6. 运行 type-check（现有 hook 已自动触发）
  7. 如果 type-check 失败 → 回滚 → 标记需人工处理
  8. 用 Playwright 重新导航到该页面并截图
  9. AI 对比修复前后截图
  10. 如果问题解决 → 标记 resolved → 更新基线
  11. 如果未解决 → 重试一次或标记需人工处理
```

### 6.2 修复策略矩阵

| 问题类型              | 自动修复策略                                         | 置信度 |
| --------------------- | ---------------------------------------------------- | ------ |
| Console runtime error | 读取 stack trace → 定位组件 → 加 null check/fallback | 高     |
| 白屏/空状态           | 检查数据加载逻辑 → 加 loading/empty state            | 高     |
| 网络请求 404          | 检查 API 路径 → 修正 endpoint                        | 高     |
| 布局溢出              | 检查 CSS → 加 overflow/truncate                      | 中     |
| i18n key 裸露         | 检查 translation 文件 → 补充翻译                     | 中     |
| 样式不一致            | 对比设计规范 → 调整 Tailwind class                   | 低     |
| 交互逻辑错误          | 需理解业务上下文 → 标记需人工                        | 低     |

### 6.3 安全阀机制

```typescript
interface FixGuardrails {
  maxFixesPerRun: 10; // 单次最多修复 10 个问题
  maxRetriesPerIssue: 2; // 单个问题最多重试 2 次
  requireTypeCheck: true; // 修改后必须通过 type-check
  noDeleteFiles: true; // 不删除文件
  noModifyRoutes: true; // 不修改路由结构
  maxLinesChanged: 50; // 单个修复最多改 50 行
  rollbackOnFailure: true; // type-check 失败自动回滚
}
```

### 6.4 修复报告

每次修复循环结束后输出：

```typescript
interface FixReport {
  timestamp: string;
  summary: {
    attempted: number;
    resolved: number;
    failed: number;
    skippedManual: number;
  };
  fixes: {
    issueId: string;
    route: string;
    status: "resolved" | "failed" | "needs_manual";
    filesChanged: string[];
    beforeScreenshot: string;
    afterScreenshot: string;
    typeCheckPassed: boolean;
  }[];
}
```

---

## 7. Phase 4：基线对比与回归防护

### 7.1 基线管理

```
.ui-patrol/
├── baselines/                    # 基线截图（已确认正确的状态）
│   ├── desktop/
│   │   ├── ai-research.png
│   │   ├── ai-research--topic.png
│   │   └── ...
│   └── mobile/
│       └── ...
├── baselines.json                # 基线元数据
└── ...
```

**基线更新策略**：

| 场景                 | 操作                          |
| -------------------- | ----------------------------- |
| AI 修复成功确认      | 自动更新对应页面基线          |
| 新增页面             | 首次巡检截图作为初始基线      |
| 人工确认 UI 正确     | 命令 `--update-baseline` 更新 |
| 功能迭代导致 UI 变更 | 开发者主动更新基线            |

### 7.2 视觉 Diff 对比

```typescript
interface VisualDiff {
  route: string;
  viewport: string;
  baselinePath: string;
  currentPath: string;
  diffPercentage: number; // 像素差异百分比
  diffRegions: Rectangle[]; // 差异区域坐标
  status: "match" | "minor_diff" | "major_diff" | "no_baseline";
}

// 阈值配置
const DIFF_THRESHOLDS = {
  match: 0.1, // < 0.1% 视为一致（抗锯齿等微小差异）
  minor: 2.0, // 0.1% - 2% 视为小差异（可能是数据变化）
  major: 2.0, // > 2% 视为重大差异（需审查）
};
```

**像素对比实现**：使用 `pixelmatch` 库（轻量，无外部依赖）。

### 7.3 Git Hook 集成

在 `pre-push` 阶段增加变更页面的视觉回归检查：

```bash
# .husky/pre-push（追加）
npx tsx scripts/ui-patrol/index.ts --changed --compare-baseline --fail-on-major
```

**行为**：

- 只检查本次变更影响的页面
- 与基线对比
- `major_diff` 时阻断 push 并输出报告
- 开发者决定：更新基线 or 修复回归

---

## 8. 路由清单与页面分级

### 分级标准

| 级别          | 标准                       | 巡检频率  | 示例                                    |
| ------------- | -------------------------- | --------- | --------------------------------------- |
| **Critical**  | 核心业务流程、用户首次触达 | 每次巡检  | `/ai-research`, `/library`, `/ai-teams` |
| **Important** | 常用功能页面               | 每次巡检  | `/ai-ask`, `/ai-writing`, `/ai-social`  |
| **Standard**  | 管理后台、低频页面         | 按需/每日 | `/admin/*`, `/profile`, `/changelog`    |

### 页面分级配置

```typescript
// scripts/ui-patrol/page-tiers.ts

const PAGE_TIERS: Record<string, "critical" | "important" | "standard"> = {
  // Critical - 核心业务
  "/ai-research": "critical",
  "/ai-research/topic": "critical",
  "/ai-research/topic-research": "critical",
  "/library": "critical",
  "/ai-teams": "critical",
  "/ai-ask": "critical",
  "/auth": "critical",

  // Important - 常用功能
  "/ai-writing": "important",
  "/ai-social": "important",
  "/ai-office": "important",
  "/ai-skills": "important",
  "/ai-store": "important",
  "/explore": "important",
  "/ai-image": "important",

  // Standard - 其余页面（默认）
  // 所有未列出的路由默认为 standard
};
```

---

## 9. 问题分类体系

### 9.1 分类树

```
UI Issues
├── Rendering（渲染问题）
│   ├── BLANK_PAGE          白屏
│   ├── BROKEN_LAYOUT       布局错乱
│   ├── OVERFLOW            内容溢出
│   ├── BROKEN_IMAGE        图片破裂
│   └── MISSING_ELEMENT     关键元素缺失
│
├── Content（内容问题）
│   ├── RAW_I18N_KEY        i18n key 未翻译
│   ├── PLACEHOLDER_TEXT    占位符文本残留
│   ├── RAW_DATA_DISPLAY    裸数据展示（undefined/null/NaN/[object Object]）
│   └── TRUNCATION          文本意外截断
│
├── Error（运行时错误）
│   ├── CONSOLE_ERROR       控制台错误
│   ├── UNHANDLED_REJECTION Promise 未处理
│   ├── HYDRATION_MISMATCH  React hydration 不匹配
│   └── NETWORK_ERROR       网络请求失败
│
├── Performance（性能问题）
│   ├── SLOW_LOAD           加载超过 5s
│   └── EXCESSIVE_REQUESTS  单页请求数过多（>30）
│
└── Accessibility（可访问性）
    ├── NO_ALT_TEXT         图片缺少 alt
    └── LOW_CONTRAST        对比度不足
```

### 9.2 严重度映射

| 严重度       | 定义       | 自动修复   | 示例                       |
| ------------ | ---------- | ---------- | -------------------------- |
| **Critical** | 页面不可用 | 优先尝试   | 白屏、runtime crash        |
| **Major**    | 功能受损   | 尝试       | 数据不显示、按钮不响应     |
| **Minor**    | 体验降级   | 尝试       | 布局小偏差、控制台 warning |
| **Cosmetic** | 视觉瑕疵   | 标记待处理 | 间距不一致、颜色偏差       |

---

## 10. 与现有基础设施集成

### 10.1 验证命令集成

在 `package.json` 中增加 ui-patrol 相关命令：

```json
{
  "scripts": {
    "ui-patrol": "tsx scripts/ui-patrol/index.ts",
    "ui-patrol:critical": "tsx scripts/ui-patrol/index.ts --tier critical",
    "ui-patrol:changed": "tsx scripts/ui-patrol/index.ts --changed",
    "ui-patrol:baseline": "tsx scripts/ui-patrol/index.ts --update-baseline",
    "verify:full": "... && npm run ui-patrol:critical"
  }
}
```

### 10.2 现有 Hook 协同

| 现有 Hook               | UI Patrol 行为                              |
| ----------------------- | ------------------------------------------- |
| Edit/Write → type-check | 修复代码后自动触发 type-check，无需额外配置 |
| pre-push → test:quick   | 追加 `ui-patrol:changed --compare-baseline` |
| pre-commit → lint       | 不变，UI Patrol 独立运行                    |

### 10.3 Claude Code 技能体系集成

```
.claude/skills/quality/
├── code-reviewer/         # 已有
├── performance-optimizer/ # 已有
├── testing-suite/         # 已有
└── ui-patrol/             # 新增
    ├── SKILL.md
    └── references/
        ├── patrol-config.md
        ├── review-rules.md
        └── fix-strategies.md
```

### 10.4 Agent 体系集成

新增专用 agent 或扩展现有 tester agent：

```
.claude/agents/
├── tester.md              # 扩展：增加 ui-patrol 能力
└── ...
```

### 10.5 与 Playwright MCP 的关系

| 层级       | 工具                     | 用途                               |
| ---------- | ------------------------ | ---------------------------------- |
| 脚本层     | `@playwright/test` (npm) | 批量巡检脚本，不依赖 Claude Code   |
| AI 审查层  | Playwright MCP tools     | Claude Code 交互式深入检查问题页面 |
| 修复验证层 | Playwright MCP tools     | 修复后实时截图验证                 |

巡检脚本使用 npm 包独立运行（可 CI 集成），AI 审查和修复使用 MCP tools 交互。

---

## 11. 安全与边界约束

### 11.1 不做什么

| 约束                 | 原因             |
| -------------------- | ---------------- |
| 不修改路由结构       | 影响面过大       |
| 不修改数据库/API     | 只处理前端展示层 |
| 不删除文件           | 防止误删         |
| 不修改认证逻辑       | 安全敏感         |
| 不修改第三方库配置   | 副作用不可控     |
| 单次修复不超过 50 行 | 控制变更范围     |

### 11.2 回滚机制

```
修复前：自动 git stash 或记录 diff
修复后 type-check 失败：自动 git checkout 回滚该文件
修复后 AI 判断未改善：回滚并标记需人工
```

### 11.3 人工介入点

以下情况自动停止并上报：

- 连续 3 个修复失败
- type-check 报错超过 5 个
- 修复导致新的 console.error
- 涉及业务逻辑判断（非纯展示问题）

---

## 12. 实施路线图

### Phase 1：巡检引擎

**前置条件**: 无

**交付物**:

- `scripts/ui-patrol/` 脚本目录
  - `index.ts` — 入口
  - `route-discovery.ts` — 路由扫描
  - `patrol-runner.ts` — 巡检执行
  - `report-generator.ts` — 报告生成
- `package.json` 增加 `ui-patrol` 命令
- `.ui-patrol/` 输出目录（gitignore）

**验收标准**:

- 运行 `npm run ui-patrol` 能扫描全部 73 个页面
- 输出结构化 JSON 报告 + 截图

---

### Phase 2：AI 审查命令

**前置条件**: Phase 1 完成

**交付物**:

- `.claude/commands/ui-patrol.md` — `/ui-patrol` 命令
- `.claude/skills/quality/ui-patrol/SKILL.md` — 技能定义
- `.claude/skills/quality/ui-patrol/references/` — 审查规则参考

**验收标准**:

- Claude Code 中执行 `/ui-patrol` 能读取报告并输出问题清单
- 问题能定位到具体组件文件和行号

---

### Phase 3：自动修复闭环

**前置条件**: Phase 2 完成

**交付物**:

- `/ui-patrol` 命令增加 `--fix` 模式
- 修复报告输出（before/after 截图对比）
- 安全阀配置

**验收标准**:

- 能自动修复 console error 类问题
- 修复后自动验证
- type-check 失败自动回滚

---

### Phase 4：基线对比

**前置条件**: Phase 3 稳定运行

**交付物**:

- `pixelmatch` 集成
- 基线管理命令 `npm run ui-patrol:baseline`
- pre-push hook 集成
- 视觉 diff 报告

**验收标准**:

- `--compare-baseline` 能检测视觉回归
- `--fail-on-major` 能阻断 push

---

## 13. 文件结构

```
genesis-ai/
├── scripts/
│   └── ui-patrol/
│       ├── index.ts                  # CLI 入口
│       ├── route-discovery.ts        # 路由扫描
│       ├── patrol-runner.ts          # Playwright 巡检执行
│       ├── report-generator.ts       # 报告生成
│       ├── baseline-manager.ts       # Phase 4: 基线管理
│       ├── visual-diff.ts            # Phase 4: 像素对比
│       └── config.ts                 # 配置（视口/阈值/分级）
│
├── .ui-patrol/                       # 输出目录（gitignore）
│   ├── reports/                      # 巡检报告 JSON
│   ├── screenshots/                  # 巡检截图
│   ├── baselines/                    # 基线截图
│   │   ├── desktop/
│   │   └── mobile/
│   ├── diffs/                        # 视觉 diff 图
│   └── fix-reports/                  # 修复报告
│
├── .claude/
│   ├── commands/
│   │   └── ui-patrol.md              # /ui-patrol 命令
│   └── skills/
│       └── quality/
│           └── ui-patrol/
│               ├── SKILL.md          # 技能定义
│               └── references/
│                   ├── patrol-config.md
│                   ├── review-rules.md
│                   └── fix-strategies.md
│
└── docs/
    └── plans/
        └── ai-ui-patrol-automation.md  # 本文档
```

---

## 附录：与 Moltbook skill.md 模式的对比

Moltbook 的 `skill.md` 引导模式与本方案有相似理念：

| 维度     | Moltbook                     | UI Patrol                                    |
| -------- | ---------------------------- | -------------------------------------------- |
| 引导方式 | Agent 读取 skill.md 自主执行 | Claude Code 读取 SKILL.md + 报告自主审查修复 |
| 自主性   | Agent 每 4h 心跳拉取指令     | 按需/Hook 触发，不做无人值守                 |
| 安全边界 | 早期无限制（已出安全事故）   | 严格安全阀 + 回滚机制                        |

本方案借鉴了 skill.md 的"自主执行"理念，但增加了安全约束和人工介入点，避免 Moltbook 式的安全事故。

---

---

## 14. 工程规范遵从机制

UI Patrol 的修复不只是"让截图看起来正常"，还必须保证修复代码本身严格遵循项目已有的工程规范。否则就是"治好了病，留下了毒"。

### 14.1 核心问题

AI 自动修复代码时最容易犯的规范错误：

| 违规类型     | 具体表现                                 | 后果                     |
| ------------ | ---------------------------------------- | ------------------------ |
| 类型松散     | 加 `as any` 或 `@ts-ignore` 快速消除错误 | 破坏 TypeScript 严格模式 |
| 命名不规范   | `myVar` 代替项目约定的模式               | 代码风格不一致           |
| 错误处理缺失 | 裸 `.then()` 无 catch                    | 下游新 bug               |
| 导入顺序错乱 | 随意 import                              | lint 失败                |
| 使用 emoji   | 在 UI 中插入 emoji 代替 Lucide 图标      | 违反图标规范             |
| console.log  | 调试代码残留                             | 违反日志规范             |

### 14.2 规范注入策略

AI 审查和修复时，规范知识不应靠"记住"，而应靠**运行时注入 + 自动校验**双重保障。

#### 策略一：Skill 上下文注入

`ui-patrol` SKILL.md 中显式引用项目规范文件，确保 AI 每次执行都加载：

```markdown
# SKILL.md 中的 references 声明

references:

- .claude/standards/04-code-style.md # 代码风格
- .claude/standards/07-testing-standards.md # 测试标准
- .claude/standards/05-api-design.md # API 设计（如涉及 hook 修改）
```

当 Claude Code 执行 `/ui-patrol` 时，这些规范文件作为上下文加载，AI 生成的修复代码必须遵循。

#### 策略二：修复后自动校验链

每次修复代码后，自动运行完整校验链（非仅 type-check）：

```
代码修改
  → Hook 触发 type-check（已有）
  → 追加 lint 检查（eslint --fix 不自动应用，只报错）
  → 追加导入顺序检查
  → 任何一环失败 → 回滚 → 重新修复（带错误信息）
```

**具体校验项**：

```typescript
interface ComplianceChecks {
  // 现有 Hook 已覆盖
  typeCheck: "npx tsc --noEmit"; // 类型安全

  // 需追加的校验
  lint: "npx eslint {changedFile} --no-fix"; // 代码风格
  noAny: 'grep -n ": any" {changedFile}'; // 禁止 any
  noTsIgnore: 'grep -n "ts-ignore" {changedFile}'; // 禁止 @ts-ignore
  noConsoleLog: 'grep -n "console.log" {changedFile}'; // 禁止 console.log
  noEmoji: 'grep -Pn "[\\x{1F600}-\\x{1F9FF}]" {changedFile}'; // 禁止 emoji
}
```

#### 策略三：修复代码模板约束

AI 生成修复代码时，遵循预定义的模式模板，而不是自由发挥：

```typescript
// 修复模式：空数据处理
// ✅ 正确模式
if (!data || data.length === 0) {
  return <EmptyState message="暂无数据" />;
}

// ❌ 禁止模式
if (!data) return <div>No data</div>;        // 硬编码英文
if (!data) return <p>🚫 没有数据</p>;         // emoji
if (!data) return null;                       // 无提示空渲染
```

```typescript
// 修复模式：错误处理
// ✅ 正确模式
try {
  const result = await fetchData();
  return result;
} catch (error) {
  logger.error('Failed to fetch data', { error });
  return <ErrorBoundary message="加载失败" />;
}

// ❌ 禁止模式
const result = await fetchData();              // 无 try-catch
try { ... } catch (e) { console.log(e); }     // console.log
try { ... } catch (e: any) { ... }            // any 类型
```

这些模板写入 `ui-patrol/references/fix-strategies.md`，AI 修复时作为参考。

#### 策略四：自愈式规范修复

如果 AI 第一次修复违反了规范（被校验链捕获），自愈流程为：

```
第一次修复 → lint 报错 "Unexpected any"
  → AI 读取 lint 错误
  → AI 读取 04-code-style.md 中的类型规范
  → 重新生成修复（用 unknown + type guard 代替 any）
  → 再次校验
  → 通过 → 继续
```

最多自愈 2 次，超过则标记为需人工处理。

### 14.3 测试规范遵从

修复 UI 问题时，涉及以下场景应同步补充测试：

| 场景                             | 测试要求                          |
| -------------------------------- | --------------------------------- |
| 修复了组件的 null/undefined 崩溃 | 补充该组件的边界值单元测试        |
| 修复了数据加载逻辑               | 补充 loading/error/empty 三态测试 |
| 修复了条件渲染逻辑               | 补充各分支的渲染测试              |
| 纯样式修复（class 调整）         | 不需要测试                        |

**测试生成规范**（对齐 07-testing-standards.md）：

```typescript
// 命名规范：describe 用组件名，it 用 should 语句
describe('ResourceCard', () => {
  it('should render empty state when data is null', () => {
    // AAA 模式
    // Arrange
    const props = { data: null };
    // Act
    render(<ResourceCard {...props} />);
    // Assert
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });
});
```

**测试文件位置**：与组件同目录，命名 `{Component}.test.tsx`。

### 14.4 修复质量评分

每次修复后自动评估质量得分：

```typescript
interface FixQualityScore {
  typeCheckPass: boolean; // 权重 30%
  lintPass: boolean; // 权重 20%
  noForbiddenPatterns: boolean; // 权重 20%（any/ts-ignore/console.log/emoji）
  visuallyFixed: boolean; // 权重 20%（截图验证）
  testAdded: boolean; // 权重 10%（是否补充了测试）
  totalScore: number; // 0-100
}

// 阈值
const QUALITY_THRESHOLDS = {
  accept: 80, // >= 80 分自动接受
  review: 60, // 60-79 分标记需 review
  reject: 60, // < 60 分回滚
};
```

### 14.5 规范漂移检测

长期运行中，防止 AI 修复逐渐偏离规范（温水煮蛙）：

- 每 10 次修复后，统计修复代码的 lint 错误率趋势
- 如果错误率上升，自动提示需更新 fix-strategies.md 模板
- 定期（每周）对全部 AI 修复过的文件做一次完整 lint 扫描

---

## 15. Playwright MCP 交互式审查协议

Phase 2 的 AI 审查不仅靠静态截图分析，还通过 Playwright MCP 工具进行交互式深入检查。

### 15.1 交互式检查流程

```
截图初判发现疑似问题
  → Playwright navigate 到该页面
  → browser_snapshot 获取 DOM 快照
  → browser_evaluate 执行诊断脚本
  → browser_console_messages 收集错误
  → browser_click 模拟用户交互
  → browser_take_screenshot 对比
```

### 15.2 诊断脚本库

预置一组诊断脚本，AI 通过 `browser_evaluate` 注入执行：

```javascript
// 检测溢出元素
document.querySelectorAll("*").forEach((el) => {
  if (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight) {
    console.warn(
      "OVERFLOW:",
      el.tagName,
      el.className,
      el.getBoundingClientRect(),
    );
  }
});

// 检测空文本节点（可能是数据未加载）
document.querySelectorAll("[data-testid]").forEach((el) => {
  if (!el.textContent?.trim()) {
    console.warn("EMPTY_CONTENT:", el.getAttribute("data-testid"));
  }
});

// 检测 broken images
document.querySelectorAll("img").forEach((img) => {
  if (!img.complete || img.naturalWidth === 0) {
    console.warn("BROKEN_IMG:", img.src);
  }
});

// 检测 i18n key 泄露
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
while (walker.nextNode()) {
  const text = walker.currentNode.textContent;
  if (/^[a-z]+\.[a-z]+(\.[a-z]+)*$/.test(text?.trim() || "")) {
    console.warn(
      "RAW_I18N_KEY:",
      text,
      walker.currentNode.parentElement?.tagName,
    );
  }
}
```

### 15.3 用户交互模拟

对关键页面模拟用户操作路径：

```yaml
ai-research:
  - 点击"新建研究"按钮
  - 检查弹窗是否正常渲染
  - 检查表单字段是否完整

library:
  - 滚动加载更多
  - 切换筛选条件
  - 检查空搜索结果状态

ai-teams:
  - 创建团队
  - 检查成员列表渲染
  - 检查对话面板
```

---

**最后更新**: 2026-02-03
**作者**: Claude Code
**状态**: 方案设计，待审批后进入 Phase 1 实施
