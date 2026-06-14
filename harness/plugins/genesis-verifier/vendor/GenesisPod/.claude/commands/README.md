# Claude Code Commands

> GenesisPod 项目的 slash commands 快捷指令集。

## 使用方法

在 Claude Code 中输入 `/command` 即可触发对应指令，例如：

```bash
/review src/modules/auth/auth.service.ts
/test backend
/fix 登录按钮点击无反应
```

## 可用命令

### 代码质量

| 命令      | 描述     | 示例                                   |
| --------- | -------- | -------------------------------------- |
| `/review` | 代码审查 | `/review src/feature.ts`               |
| `/test`   | 运行测试 | `/test`、`/test full`、`/test backend` |
| `/verify` | 验证代码 | `/verify quick`、`/verify full`        |
| `/perf`   | 性能优化 | `/perf 首页加载慢`                     |

### 开发流程

| 命令      | 描述         | 示例                      |
| --------- | ------------ | ------------------------- |
| `/fix`    | Bug 修复     | `/fix 用户无法登录`       |
| `/debug`  | 调试问题     | `/debug API 返回 500`     |
| `/tdd`    | 测试驱动开发 | `/tdd 实现用户注册功能`   |
| `/deploy` | 部署运维     | `/deploy`、`/deploy logs` |

### AI 模块

| 命令          | 描述            | 示例                                        |
| ------------- | --------------- | ------------------------------------------- |
| `/ai-teams`   | AI Teams 开发   | `/ai-teams 添加任务依赖功能`                |
| `/ai-writing` | AI Writing 开发 | `/ai-writing 优化大纲生成`                  |
| `/prompt`     | 提示词工程      | `/prompt 优化研究员 Agent 的 system prompt` |

### 架构设计

| 命令      | 描述       | 示例                              |
| --------- | ---------- | --------------------------------- |
| `/schema` | 数据库架构 | `/schema 添加用户偏好设置表`      |
| `/docs`   | 文档生成   | `/docs 为 AI Studio API 生成文档` |

## 命令参数

所有命令都支持在命令后添加参数，参数会作为 `$ARGUMENTS` 传入：

```bash
/review src/auth.ts          # 审查指定文件
/test full                   # 运行完整测试
/fix 截图中的按钮无法点击     # 描述问题
```

## 与 Skills 的关系

```
用户输入 /review
    ↓
commands/review.md 被加载
    ↓
Claude 执行审查，自动参考 skills/quality/code-reviewer/SKILL.md
    ↓
输出审查结果
```

- **Commands**: 用户主动触发的快捷指令
- **Skills**: Claude 自动参考的知识库

## 自定义命令

创建新命令只需在 `.claude/commands/` 目录添加 `.md` 文件：

```markdown
# .claude/commands/my-command.md

这是命令的提示词内容。

用户参数: $ARGUMENTS

## 执行步骤

1. ...
2. ...
```

### 支持的变量

| 变量         | 说明                   |
| ------------ | ---------------------- |
| `$ARGUMENTS` | 用户在命令后输入的参数 |
| `$SELECTION` | 当前选中的代码（IDE）  |
| `$FILE`      | 当前文件路径           |

## 命令列表

```
.claude/commands/
├── README.md           # 本文档
├── review.md           # /review - 代码审查
├── test.md             # /test - 运行测试
├── verify.md           # /verify - 验证代码
├── fix.md              # /fix - Bug 修复
├── debug.md            # /debug - 调试问题
├── tdd.md              # /tdd - 测试驱动开发
├── deploy.md           # /deploy - 部署运维
├── ai-teams.md         # /ai-teams - AI Teams 开发
├── ai-writing.md       # /ai-writing - AI Writing 开发
├── prompt.md           # /prompt - 提示词工程
├── schema.md           # /schema - 数据库架构
├── perf.md             # /perf - 性能优化
└── docs.md             # /docs - 文档生成
```

---

**最后更新**: 2025-01-15
