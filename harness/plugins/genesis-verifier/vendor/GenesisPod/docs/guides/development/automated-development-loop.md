# GenesisPod 自动化开发闭环指南

> AI 驱动的自动化开发验证系统，实现代码修改后自动验证、发现问题自动修复、循环直到完成

**最后更新**: 2025-12-28
**文档版本**: v1.0
**状态**: 生产就绪

---

## 概述

本指南定义了 GenesisPod 项目的自动化开发闭环系统，通过 Claude Code Hooks 和 TDD 工作流实现：

- **自动验证**: 代码修改后自动运行 lint、类型检查、测试
- **自愈修复**: 验证失败时 Claude 自动分析并修复，无需人工干预
- **渐进验证**: 从语法层到构建层，逐级验证确保代码质量
- **快速反馈**: 使用快速测试提供即时反馈，完整测试在提交前运行

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    GenesisPod 自动化开发闭环                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         触发层 (Trigger Layer)                       │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │  用户指令 ──→ Claude Code ──→ 代码修改 ──→ Hooks 自动触发            │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      验证层 (Validation Layer)                       │   │
│  ├──────────────┬──────────────┬──────────────┬───────────────────────┤   │
│  │  L1 语法层   │  L2 单元层   │  L3 集成层    │  L4 构建层            │   │
│  │  ────────    │  ────────    │  ────────     │  ────────             │   │
│  │  • ESLint    │  • Jest      │  • API 测试   │  • Next.js Build     │   │
│  │  • TypeCheck │  • Vitest    │  • E2E 测试   │  • NestJS Build      │   │
│  │  • Prettier  │  • 覆盖率    │  • DB 迁移    │  • Prisma Generate   │   │
│  └──────────────┴──────────────┴──────────────┴───────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                       反馈层 (Feedback Layer)                        │   │
│  ├─────────────────────────────────────────────────────────────────────┤   │
│  │                                                                       │   │
│  │   验证通过 ────────────────────────────────────→ 继续/提交           │   │
│  │       │                                                               │   │
│  │   验证失败 ──→ 错误信息反馈 ──→ Claude 分析 ──→ 自动修复 ──→ 重新验证  │   │
│  │                                      │                                │   │
│  │                                      └───────── 循环直到通过 ─────────│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 分层验证策略

| 层级   | 验证内容          | 触发时机        | 执行命令         | 超时 | 失败处理 |
| ------ | ----------------- | --------------- | ---------------- | ---- | -------- |
| **L1** | ESLint + Prettier | 每次 Edit/Write | `lint:fix`       | 30s  | 自动修复 |
| **L1** | TypeScript 检查   | 每次 Edit/Write | `type-check`     | 60s  | 循环修复 |
| **L2** | 单元测试 (快速)   | 功能代码修改    | `test:quick`     | 120s | 循环修复 |
| **L2** | 单元测试 (完整)   | Stop 事件       | `test`           | 300s | 循环修复 |
| **L3** | Prisma 迁移       | Schema 修改     | `prisma migrate` | 60s  | 人工介入 |
| **L3** | E2E 测试          | 提交前          | `test:e2e`       | 600s | 循环修复 |
| **L4** | 完整构建          | 提交前          | `build`          | 300s | 循环修复 |

---

## Claude Code Hooks 配置

### 配置文件位置

- **项目级配置**: `.claude/settings.json` (推荐，可提交到仓库)
- **本地配置**: `.claude/settings.local.json` (个人配置，不提交)
- **用户级配置**: `~/.claude/settings.json` (全局配置)

### 推荐配置

**文件: `.claude/settings.json`**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npm run type-check 2>&1 | head -40",
            "timeout": 90000
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npm run test:quick 2>&1 | tail -60",
            "timeout": 180000
          }
        ]
      }
    ]
  }
}
```

### 完整配置（进阶）

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"const p=process.env.TOOL_INPUT_FILE_PATH||''; if(p.includes('frontend')||p.includes('backend')) process.exit(0); process.exit(1);\" && npm run type-check 2>&1 | head -40",
            "timeout": 90000
          }
        ]
      },
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "if echo \"$TOOL_INPUT_FILE_PATH\" | grep -q 'prisma/schema.prisma'; then echo '[Prisma] Schema modified - generating client...' && cd backend && npx prisma generate 2>&1 | tail -10; fi",
            "timeout": 30000
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Final Validation] Running tests...' && npm run test:quick 2>&1 | tail -60",
            "timeout": 180000
          }
        ]
      }
    ]
  }
}
```

---

## 验证命令速查

| 场景     | 命令                      | 说明                      |
| -------- | ------------------------- | ------------------------- |
| 快速验证 | `npm run verify:quick`    | 类型检查 + 快速测试       |
| 完整验证 | `npm run verify:full`     | Lint + 类型 + 测试 + 构建 |
| 前端验证 | `npm run verify:frontend` | 仅前端                    |
| 后端验证 | `npm run verify:backend`  | 仅后端                    |
| 变更验证 | `npm run verify:changed`  | 仅检测到的变更            |

### 脚本定义

在根目录 `package.json` 中：

```json
{
  "scripts": {
    "verify:quick": "npm run type-check && npm run test:quick",
    "verify:full": "npm run lint && npm run type-check && npm run test && npm run build",
    "verify:frontend": "cd frontend && npm run type-check && npm run test",
    "verify:backend": "cd backend && npm run type-check && npm run test:quick",
    "verify:changed": "node scripts/verify-changed.js"
  }
}
```

---

## TDD 工作流

### Red-Green-Refactor 循环

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│  写测试  │ → │ 确认失败 │ → │  写实现  │ → │ 运行测试 │
│  (Red)  │    │         │    │ (Green) │    │         │
└─────────┘    └─────────┘    └─────────┘    └────┬────┘
                                                  │
                          ┌───────────────────────┤
                         失败│                   通过│
                          ▼                       ▼
                    ┌─────────┐            ┌─────────┐
                    │分析修复 │            │  重构   │
                    │ (循环)  │            │(Refactor)│
                    └─────────┘            └─────────┘
```

### 提示词模板

#### 新功能开发

```
用 TDD 方式为 GenesisPod 实现 [功能名称]：

前置条件：
- 阅读相关模块代码，理解现有架构
- 确定测试文件位置

执行步骤：
1. 在 [backend/frontend]/src/[module]/__tests__/ 创建测试文件
2. 编写测试用例，覆盖：正常路径、边界条件、错误处理
3. 运行测试，确认全部失败（Red）
4. 实现功能代码
5. 运行测试，如果失败则修复，不要询问我
6. 循环直到全部通过（Green）
7. 重构代码，保持测试通过（Refactor）
8. 运行 `npm run verify:quick` 完整验证
9. 提交代码

测试框架：
- 后端: Jest + @nestjs/testing
- 前端: Vitest + @testing-library/react
```

#### Bug 修复

```
修复 GenesisPod 中的 [Bug 描述]：

执行步骤：
1. 先编写复现 bug 的测试用例
2. 运行测试，确认测试失败（证明 bug 存在）
3. 修复代码
4. 运行测试，如果失败继续修复
5. 循环直到测试通过
6. 运行 `npm run verify:quick` 确保无回归
7. 提交代码
```

#### 重构

```
重构 GenesisPod 的 [模块/组件名称]：

前置条件：
- 确保现有测试覆盖率 > 70%
- 如果覆盖不足，先补充测试

执行步骤：
1. 运行现有测试，确认全部通过
2. 小步重构，每次改动后运行测试
3. 如果测试失败，回滚并重新尝试
4. 循环直到重构完成且测试通过
5. 运行 `npm run verify:full` 完整验证
6. 提交代码
```

---

## 分模块验证策略

### 前端 (Next.js + React)

```
修改文件 ──→ ESLint Fix ──→ TypeCheck ──→ Vitest ──→ Build (可选)
     │           │              │            │
     │           ▼              ▼            ▼
     │      自动修复        报错循环修复   失败循环修复
```

**关键测试位置:**

- `frontend/hooks/**/*.test.ts` - Hooks 测试
- `frontend/stores/**/*.test.ts` - Store 测试
- `frontend/lib/**/*.test.ts` - 工具函数测试

**运行命令:**

```bash
cd frontend && npm run type-check && npm run test
```

### 后端 (NestJS)

```
修改文件 ──→ ESLint Fix ──→ TypeCheck ──→ Jest Quick ──→ Jest Full (可选)
     │           │              │             │
     ▼           ▼              ▼             ▼
  Prisma变更?  自动修复     报错循环      快速反馈
     │
     ▼ (是)
  prisma generate
  prisma migrate dev
```

**关键测试位置:**

- `backend/src/modules/ai/**/*.spec.ts` - AI 模块测试
- `backend/src/modules/content/**/*.spec.ts` - 内容模块测试
- `backend/src/common/**/*.spec.ts` - 公共服务测试

**运行命令:**

```bash
# 快速测试 (排除慢速测试)
cd backend && npm run test:quick

# 完整测试
cd backend && npm run test
```

### 数据库变更

```
修改 schema.prisma
         │
         ▼
  npx prisma format    ← 自动格式化
         │
         ▼
  npx prisma generate  ← 生成客户端
         │
         ▼
  npx prisma validate  ← 验证 schema
         │
         ▼
  npx prisma migrate dev --name <name>  ← 创建迁移
         │
         ▼
  npm run type-check   ← 验证类型兼容
         │
         ▼
  npm run test:quick   ← 运行测试
```

---

## 自愈闭环规则

### 核心原则

1. **验证失败时自动修复**: 不询问用户，分析错误后直接修复
2. **循环直到通过**: 修复后重新验证，失败继续修复
3. **分析优先**: 先理解错误原因，再采取修复策略

### 错误类型与修复策略

| 错误类型            | 修复策略                       |
| ------------------- | ------------------------------ |
| TypeScript 类型错误 | 修复类型定义或添加类型断言     |
| ESLint 错误         | 运行 `lint:fix` 或手动修复     |
| 测试断言失败        | 分析预期与实际，修复实现或测试 |
| 导入路径错误        | 检查文件位置，修正导入         |
| 构建失败            | 检查依赖和模块解析             |
| Prisma 错误         | 重新生成客户端，检查 schema    |

### 禁止行为

- 不运行测试就提交代码
- 跳过类型检查
- 忽略 ESLint 错误
- 验证失败时询问用户是否继续
- 使用 `@ts-ignore` 或 `any` 绕过类型检查
- 注释掉失败的测试

---

## 提交检查清单

提交代码前必须确保：

- [ ] `npm run type-check` 通过
- [ ] `npm run test:quick` 通过
- [ ] 无新增 ESLint 警告
- [ ] 关键逻辑有测试覆盖
- [ ] Prisma schema 变更已生成迁移

---

## 智能变更检测

### verify-changed.js 脚本

**文件: `scripts/verify-changed.js`**

```javascript
#!/usr/bin/env node
const { execSync } = require("child_process");

// 获取已修改的文件
const changedFiles = execSync("git diff --name-only HEAD", {
  encoding: "utf-8",
})
  .split("\n")
  .filter(Boolean);

const hasFrontendChanges = changedFiles.some((f) => f.startsWith("frontend/"));
const hasBackendChanges = changedFiles.some((f) => f.startsWith("backend/"));
const hasPrismaChanges = changedFiles.some((f) =>
  f.includes("prisma/schema.prisma"),
);

const tasks = [];

if (hasPrismaChanges) {
  tasks.push({
    name: "Prisma Generate",
    cmd: "cd backend && npx prisma generate",
  });
}
if (hasBackendChanges) {
  tasks.push({ name: "Backend Type Check", cmd: "npm run type-check:backend" });
  tasks.push({ name: "Backend Test", cmd: "npm run test:quick:backend" });
}
if (hasFrontendChanges) {
  tasks.push({
    name: "Frontend Type Check",
    cmd: "npm run type-check:frontend",
  });
  tasks.push({ name: "Frontend Test", cmd: "npm run test:frontend" });
}

if (tasks.length === 0) {
  console.log("No relevant changes detected.");
  process.exit(0);
}

console.log(`Running ${tasks.length} verification tasks...`);

for (const task of tasks) {
  console.log(`\n[${task.name}]`);
  try {
    execSync(task.cmd, { stdio: "inherit" });
    console.log(`✓ ${task.name} passed`);
  } catch (e) {
    console.error(`✗ ${task.name} failed`);
    process.exit(1);
  }
}

console.log("\n✓ All verifications passed");
```

---

## Playwright MCP 配置（可选）

### 安装

```bash
claude mcp add playwright -- npx @executeautomation/playwright-mcp-server
```

### 使用场景

适用于 UI 组件开发的视觉验证：

```
对于 UI 组件开发，使用 Playwright MCP 进行视觉验证：

1. 启动开发服务器: npm run dev:frontend
2. 使用 Playwright MCP 打开 http://localhost:3000/[页面路径]
3. 截图当前效果
4. 修改组件代码
5. 刷新页面并截图
6. 对比截图，如果不符合预期则继续修改
7. 循环直到视觉效果正确
```

---

## 实施路线图

### 第一阶段：基础配置（立即）

| 任务                         | 说明                  |
| ---------------------------- | --------------------- |
| 创建 `.claude/settings.json` | Hooks 自动化配置      |
| 更新 CLAUDE.md               | 添加自动化规范章节    |
| 添加 verify 脚本             | package.json 验证命令 |

### 第二阶段：验证增强

| 任务                   | 说明             |
| ---------------------- | ---------------- |
| 创建 verify-changed.js | 智能变更检测     |
| 补充后端测试           | 覆盖率提升到 70% |
| 补充前端测试           | Hooks/Store 测试 |

### 第三阶段：高级功能

| 任务                | 说明                |
| ------------------- | ------------------- |
| 配置 Playwright MCP | 视觉测试            |
| CI/CD 自动修复      | GitHub Actions 增强 |
| E2E 测试套件        | 完善端到端测试      |

---

## 相关文档

- [开发指南](development.md) - 本地开发环境搭建
- [测试指南](testing.md) - 测试策略和实践
- [部署指南](deployment.md) - 生产环境部署
- [CLAUDE.md](../../.claude/CLAUDE.md) - Claude Code 配置

---

## 参考资料

- [Claude Code Best Practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- [TDD Guard for Claude Code](https://github.com/nizos/tdd-guard)
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)
- [Playwright MCP](https://github.com/executeautomation/mcp-playwright)

---

**维护者**: GenesisPod Team
**创建日期**: 2025-12-28
**版本**: v1.0
