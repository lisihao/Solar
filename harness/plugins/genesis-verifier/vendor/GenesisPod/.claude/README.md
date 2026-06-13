# Claude Code Configuration

> GenesisPod 项目的 Claude Code 配置目录，包含 AI 助手的行为配置、技能库和自动化工具。

## Quick Start

```bash
# 1. 查看项目配置
cat .claude/CLAUDE.md

# 2. 使用 slash 命令
/review src/modules/auth/auth.service.ts   # 代码审查
/test backend                               # 运行测试
/fix 登录按钮无响应                          # 修复 Bug

# 3. 验证代码
npm run verify:quick
```

## Directory Structure

```
.claude/
├── CLAUDE.md              # 主配置文件（项目规范、开发指南）
├── CLAUDE.local.md        # 本地偏好（不提交 Git）
├── settings.json          # Claude Code 权限和 Hooks
├── settings.local.json    # 本地设置覆盖
│
├── agents/                # Agent 定义（8 个专业 Agent）
│   ├── merge-to-main.md   # 代码合并 Agent
│   ├── monitoring.md      # 监控运维 Agent
│   ├── docs-specialist.md # 文档管理 Agent
│   └── ...
│
├── commands/              # Slash 命令（13 个快捷指令）
│   ├── review.md          # /review - 代码审查
│   ├── test.md            # /test - 运行测试
│   ├── fix.md             # /fix - Bug 修复
│   └── ...
│
├── skills/                # 技能库（28 个专业技能）
│   ├── ai/                # AI 相关（7）
│   ├── development/       # 开发技能（8）
│   ├── quality/           # 质量保证（3）
│   ├── operations/        # 运维技能（4）
│   ├── data/              # 数据技能（2）
│   └── architecture/      # 架构技能（4）
│
├── standards/             # 开发规范（11 个标准文档）
│   ├── 00-overview.md     # 规范总览
│   ├── 04-code-style.md   # 代码风格
│   └── ...
│
├── config/                # Agent 配置
│   ├── monitoring.yml     # 监控配置
│   └── merge-to-main.yml  # 合并策略配置
│
├── tools/                 # 自动化脚本
│   ├── check-all.sh       # 完整检查
│   ├── validate-commit.sh # 提交验证
│   └── *.ps1              # PowerShell 版本
│
├── templates/             # 模板文件
│   ├── pr-template.md     # PR 模板
│   └── commit-template.md # 提交模板
│
├── prompts/               # 系统提示词
│   └── system/            # Agent 系统提示词
│
├── adrs/                  # 架构决策记录
│   └── 0001-*.md          # ADR 文档
│
└── logs/                  # 操作日志（不提交）
    └── merge-audit.jsonl  # 合并审计
```

## Key Files

| 文件                | 描述                  | 更新频率   |
| ------------------- | --------------------- | ---------- |
| `CLAUDE.md`         | 项目规范和开发指南    | 规范变更时 |
| `settings.json`     | 权限、Hooks、环境变量 | 配置变更时 |
| `commands/*.md`     | Slash 命令定义        | 功能扩展时 |
| `skills/*/SKILL.md` | 领域知识和最佳实践    | 知识更新时 |
| `standards/*.md`    | 编码规范和流程规范    | 季度审查   |

## Common Commands

| 命令      | 描述     | 示例                  |
| --------- | -------- | --------------------- |
| `/review` | 代码审查 | `/review src/auth.ts` |
| `/test`   | 运行测试 | `/test backend`       |
| `/fix`    | Bug 修复 | `/fix 用户无法登录`   |
| `/verify` | 验证代码 | `/verify quick`       |
| `/deploy` | 部署运维 | `/deploy logs`        |

完整命令列表见 [commands/README.md](commands/README.md)

## Conventions

- **Encoding**: UTF-8
- **Links**: 使用仓库相对路径（如 `docs/architecture/...`）
- **Source of truth**: 详细规范在 `/docs`，`.claude` 仅存放配置和快速参考
- **Updates**: 修改后更新 "Last updated" 时间戳

## Related Documentation

- [主配置文件](CLAUDE.md) - 项目规范和开发指南
- [Commands 指南](commands/README.md) - Slash 命令使用说明
- [Skills 目录](skills/README.md) - 技能库结构说明
- [Agents 架构](agents/README.md) - Agent 系统文档
- [开发规范](standards/00-overview.md) - 编码规范总览

---

**Last updated**: 2025-01-15
**Maintainer**: Platform Architecture Team
