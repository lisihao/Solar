---
name: feature-development-lifecycle
description: 功能开发完整业务流 - 从需求到推送的端到端标准化流程，确保每个阶段质量关卡通过后才进入下一阶段。
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Task
tags:
  - workflow
  - lifecycle
  - quality-gate
---

# 功能开发完整业务流

> 来源于 V5 researchDepth 端到端接通的教训：跳过链路追踪和业务模拟导致"双路径"问题直到后期才被发现。

## 问题背景

常见失败模式：

```
需求 → 直接写代码 → 类型检查通过 → "完成"
                                    ↓
                              实际运行时才发现链路断裂
```

正确模式：

```
需求分析 → 链路追踪 → 方案设计 → 编码 → 检视 → 业务模拟 → 测试 → 推送
    ↑                                                         ↓
    └──────────── 任一阶段失败，回退到对应阶段 ←──────────────┘
```

---

## 八阶段流程

### Phase 1: 需求分析

**目标**：明确"改什么"和"为什么改"

```
必答清单：
□ 用户期望的行为是什么？
□ 当前实际行为是什么？（如果是 bug fix）
□ 涉及哪些模块？（前端/后端/数据库）
□ 是新增功能还是修改已有功能？
□ 有没有相关的已有实现可以参考？
```

**产出**：一段明确的需求描述，包含期望行为和验收标准。

**质量关卡**：需求不清晰时必须 AskUserQuestion，禁止假设。

---

### Phase 2: 链路追踪

**目标**：找到代码中的**实际执行路径**，不是"看起来应该的路径"

```
从 UI 入口开始，逐层追踪：
□ UI 组件 → 事件处理函数
□ 事件处理 → Store/Hook 调用
□ Store → API 函数
□ API → 后端 Controller
□ Controller → Service 方法
□ Service → 数据库/外部调用
□ 返回链路：Response → Store 更新 → UI 渲染
```

**关键动作**：

- 用 Grep 搜索实际的函数调用关系，不是看文件名猜测
- 找到所有入口点（可能有多个路径到达同一功能）
- 标记"断点"：参数在哪一层丢失？返回值在哪一层被忽略？

**产出**：完整的调用链路图（文件:行号 级别）。

**质量关卡**：每一层都必须有 Grep/Read 证据支撑，禁止"应该是调用了 XXX"。

**反面教材**：

```
# 错误：假设前端走 orchestrator 路径
Frontend → triggerRefresh → orchestrator.executeRefresh  ← 实际从未被调用

# 正确：追踪实际调用
Frontend → startLeaderPlan → api.leaderPlan → controller.leaderPlan
  → missionService.createMission  ← 这才是真实路径
```

---

### Phase 3: 方案设计

**目标**：基于链路追踪结果，设计修改方案

```
方案必须包含：
□ 修改文件清单（文件路径 + 修改内容摘要）
□ 每个修改点的上下游影响
□ 数据库变更（如有）：字段、迁移、索引
□ 前后端接口变更（如有）：DTO、类型、API
□ 边界情况处理：空值、默认值、向后兼容
```

**质量关卡**：

- 方案中引用的每个文件和行号必须来自 Phase 2 的追踪结果
- 如果发现多条执行路径，方案必须覆盖所有路径或明确说明为什么只改一条
- 使用 EnterPlanMode 获取用户确认

---

### Phase 4: 编码实现

**目标**：按方案逐文件修改，每改一处立即验证连接

```
编码规则：
□ 按数据流顺序修改（先后端 DTO/Schema → Service → Controller → 前端 API → Store → UI）
□ 每改完一层，Grep 确认上下游调用点已更新
□ 数据库变更：Schema → prisma generate → Migration SQL
□ 新增字段必须有默认值或 null 处理
□ 禁止引入 any 类型、console.log、硬编码
```

**质量关卡**：`npm run type-check` 通过。

---

### Phase 5: 代码检视

**目标**：用审查者视角审视自己的代码

```
检视清单：
□ 安全性：输入验证、注入防护、权限检查
□ 类型安全：无 any、无不安全的 as 断言
□ 空值处理：每个新字段在所有层级都有 fallback
□ 错误处理：新增的异步调用都有 try-catch
□ 一致性：前后端类型定义一致（字段名、类型、可选性）
□ 测试影响：新增的依赖注入是否破坏已有测试的 mock
```

**关键动作**：使用 reviewer agent 或 `git diff` 逐文件审查。

**质量关卡**：所有检视问题修复后才进入下一阶段。

---

### Phase 6: 业务推理模拟

**目标**：在脑中"运行"代码，用具体数据追踪完整流程

```
模拟步骤：
□ 选择 2-3 个典型场景（正常流程 + 边界情况）
□ 为每个场景准备具体输入数据
□ 逐层追踪数据变化：
  - 用户点击 → 函数参数值 → API 请求体 → DTO 验证
  - Service 处理 → 数据库写入值 → 返回值
  - 前端接收 → State 更新 → UI 渲染
□ 验证最终结果是否符合需求
```

**示例模拟（以 researchDepth 为例）**：

```
场景: 用户选择 "thorough" 深度，启动研究

1. UI: 点击 "thorough" 按钮
   → onResearchDepthChange('thorough')
   → state.researchDepth = 'thorough'

2. 点击"开始研究":
   → startLeaderPlan(topicId, undefined, 'fresh', 'thorough')
   → api.leaderPlan(topicId, { researchDepth: 'thorough' })

3. 后端 Controller:
   → dto.researchDepth = 'thorough' (通过 @IsIn 验证)
   → missionService.createMission({ researchDepth: 'thorough' })

4. Mission Service:
   → prisma.create({ researchDepth: 'thorough' })
   → DB: research_depth = 'thorough'

5. report_synthesis 执行时:
   → mission.researchDepth = 'thorough'
   → resolveResearchDepthConfig('thorough') → factCheckEnabled = true
   → 执行 factCheckReport()

6. getMissionStatus 返回:
   → { researchDepth: 'thorough', ... }
   → 前端 useEffect 同步 → 显示紫色 badge "深度"

结论: 链路完整 ✓
```

**质量关卡**：每个场景的模拟必须覆盖完整链路，发现问题则回退到 Phase 4。

---

### Phase 7: 测试验证

**目标**：自动化验证代码正确性

```
测试层级：
□ npm run type-check              — 类型安全
□ 相关模块单元测试                 — 逻辑正确
□ 新增/修改的 mock 是否完整        — 测试基础设施
□ npm run verify:quick (可选)      — 快速全量验证
```

**质量关卡**：所有测试通过。失败则修复后重跑，禁止跳过。

---

### Phase 8: 提交推送

**目标**：代码安全落地到远程仓库

```
提交前检查：
□ git status — 确认没有遗漏文件或意外文件
□ git diff — 最终确认所有变更符合预期
□ 提交信息遵循 Conventional Commits 格式
□ 数据库迁移文件已包含
□ 推送后 pre-push hook 验证通过
```

---

## 阶段跳转规则

| 当前阶段 | 发现问题时               | 回退到              |
| -------- | ------------------------ | ------------------- |
| 链路追踪 | 发现多条路径或路径不明确 | Phase 1（补充需求） |
| 方案设计 | 发现影响范围超出预期     | Phase 2（补充追踪） |
| 编码实现 | 发现方案遗漏             | Phase 3（补充方案） |
| 代码检视 | 发现安全/逻辑问题        | Phase 4（修复代码） |
| 业务模拟 | 发现链路断裂             | Phase 2（重新追踪） |
| 测试验证 | 测试失败                 | Phase 4（修复代码） |
| 提交推送 | pre-push 失败            | Phase 4（修复代码） |

---

## 禁止行为

- **禁止跳过 Phase 2（链路追踪）**：这是最容易省略但最致命的步骤
- **禁止在 Phase 4 之前写代码**：没有追踪和方案就写代码 = 盲改
- **禁止用"类型检查通过"替代业务模拟**：类型系统无法检测逻辑断裂
- **禁止在检视中发现问题后不修就推送**：检视不是走过场
- **禁止跳过测试影响分析**：新增注入必检查现有 mock

---

## 快速参考卡片

```
┌─────────────────────────────────────────────────────┐
│              功能开发完整业务流                        │
├──────────┬──────────────────────┬───────────────────┤
│ 阶段     │ 核心动作              │ 质量关卡          │
├──────────┼──────────────────────┼───────────────────┤
│ 1.需求   │ 明确期望行为          │ 不清晰则提问      │
│ 2.链路   │ Grep 追踪实际调用     │ 每层有证据支撑    │
│ 3.方案   │ 文件清单+影响分析     │ 覆盖所有路径      │
│ 4.编码   │ 按数据流顺序修改      │ type-check 通过   │
│ 5.检视   │ reviewer 审查         │ 问题全部修复      │
│ 6.模拟   │ 具体数据走完整链路    │ 场景全部通过      │
│ 7.测试   │ 单元测试+类型检查     │ 测试全部通过      │
│ 8.推送   │ commit + push         │ pre-push 通过     │
└──────────┴──────────────────────┴───────────────────┘
```

---

## 版本历史

| 版本 | 日期       | 变更                                               |
| ---- | ---------- | -------------------------------------------------- |
| 1.0  | 2026-02-01 | 初始版本，来源于 V5 researchDepth 双路径问题的教训 |
