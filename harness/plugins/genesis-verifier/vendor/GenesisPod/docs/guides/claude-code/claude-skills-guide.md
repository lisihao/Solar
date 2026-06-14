# Claude Skills 完整指南

> Claude Code 技能系统的实现原理、开发方式、安装方法和最佳实践。

---

## 概述

**Agent Skills** 是 Anthropic 于 2024 年 12 月发布的开放标准，用于扩展 AI Agent 的能力。Skills 是包含指令、脚本和资源的文件夹，Agent 可以动态发现并加载它们来执行特定任务。

> OpenAI 的 Codex CLI 和 ChatGPT 也采用了相同的 SKILL.md 格式。

---

## 核心概念

### Skills vs Commands vs Plugins

| 类型         | 位置                | 触发方式          | 用途               |
| ------------ | ------------------- | ----------------- | ------------------ |
| **Skills**   | `.claude/skills/`   | AI 自动调用       | 领域知识、专业指导 |
| **Commands** | `.claude/commands/` | 用户 `/command`   | 快捷指令、工作流   |
| **Plugins**  | 远程安装            | `/plugin install` | 官方/社区扩展包    |

### 工作原理

```
┌─────────────────────────────────────────────────────────────┐
│  Claude Code 启动                                           │
│  ↓                                                          │
│  扫描 skills 目录，预加载所有 SKILL.md 的 name + description │
│  ↓                                                          │
│  注入到系统提示的 <available_skills> 列表                    │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  用户发送请求                                                │
│  ↓                                                          │
│  Claude 根据上下文判断是否需要某个 Skill                      │
│  ↓                                                          │
│  调用 Skill 工具，加载完整 SKILL.md 内容到上下文               │
│  ↓                                                          │
│  执行任务，可引用 skill 目录中的脚本/模板                      │
└─────────────────────────────────────────────────────────────┘
```

**关键特点**：

- **渐进式披露**：仅加载 name/description 到系统提示，完整内容按需加载
- **无子进程**：纯指令注入，不涉及独立进程或 sub-agent
- **相对路径**：加载后提供 Base Path，可引用捆绑资源

---

## 目录结构

### 最小结构

```
skill-name/
└── SKILL.md          # 必需：包含元数据和指令
```

### 完整结构

```
skill-name/
├── SKILL.md          # 必需：技能定义文件
├── scripts/          # 可选：可执行脚本 (Python/Bash/Node)
│   ├── process.py
│   └── validate.sh
├── references/       # 可选：参考文档（按需加载）
│   ├── api-spec.md
│   └── examples.md
├── assets/           # 可选：模板、图标、字体等
│   ├── template.docx
│   └── styles.css
└── prompts/          # 可选：提示词模板
    └── system.md
```

---

## SKILL.md 规范

### 基本格式

```markdown
---
name: Skill Name
description: 简短描述这个技能的用途（会显示在可用技能列表中）
---

# 技能标题

详细的指令和指导内容...
```

### 完整字段

```yaml
---
# 必需字段
name: Code Reviewer
description: Perform comprehensive code reviews for security and performance

# 可选字段
allowed-tools: # 限制可用工具（提高安全性）
  - Read
  - Grep
  - Glob

tags: # 分类标签
  - code-review
  - security
  - quality

version: 1.0.0 # 版本号
author: Your Name # 作者
---
```

### allowed-tools 说明

| 值                   | 含义               |
| -------------------- | ------------------ |
| 不设置               | 使用所有可用工具   |
| `- Read`             | 只能使用 Read 工具 |
| `- Read, Grep, Glob` | 只能使用这三个工具 |

**可用工具列表**：

- `Read` - 读取文件
- `Write` - 写入文件
- `Edit` - 编辑文件
- `Bash` - 执行命令
- `Grep` - 搜索内容
- `Glob` - 匹配文件
- `WebFetch` - 获取网页
- `WebSearch` - 搜索网络

---

## 安装方式

### 1. 项目级 Skills（推荐）

```bash
# 在项目根目录创建
mkdir -p .claude/skills/my-skill
touch .claude/skills/my-skill/SKILL.md
```

**优点**：团队共享、版本控制、项目隔离

### 2. 个人级 Skills

```bash
# macOS/Linux
mkdir -p ~/.claude/skills/my-skill

# Windows
mkdir %USERPROFILE%\.claude\skills\my-skill
```

**优点**：跨项目可用、个人定制

### 3. Plugin 安装（官方/社区）

```bash
# 安装官方文档处理技能
/plugin install document-skills@anthropic-agent-skills

# 安装示例技能
/plugin install example-skills@anthropic-agent-skills
```

### 4. 从 GitHub 安装

```bash
# 克隆仓库
git clone https://github.com/anthropics/skills.git

# 复制需要的技能到项目
cp -r skills/docx .claude/skills/
```

---

## 开发指南

### 步骤 1：规划技能

```markdown
- 技能名称和用途
- 需要什么工具权限
- 需要什么捆绑资源
- 目标用户和使用场景
```

### 步骤 2：创建 SKILL.md

```markdown
---
name: API Developer
description: Design and implement REST APIs following best practices
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
tags:
  - api
  - backend
  - rest
---

# API Development Expert

You are an expert at designing and implementing REST APIs.

## Responsibilities

1. Design RESTful endpoints
2. Implement controllers and services
3. Handle error responses
4. Write API documentation

## Standards

- Use proper HTTP methods (GET, POST, PUT, DELETE)
- Return appropriate status codes
- Validate input data
- Document with OpenAPI/Swagger

## Project-Specific Guidelines

### NestJS Conventions

\`\`\`typescript
@Controller('resources')
export class ResourcesController {
@Get()
findAll() {}

@Post()
create(@Body() dto: CreateDto) {}
}
\`\`\`
```

### 步骤 3：添加捆绑资源（可选）

```bash
my-skill/
├── SKILL.md
├── scripts/
│   └── generate-api.py      # 自动化脚本
├── references/
│   └── openapi-spec.md      # 参考文档
└── prompts/
    └── error-handling.md    # 提示词模板
```

**在 SKILL.md 中引用**：

```markdown
## 错误处理指南

详见 [错误处理模板](./prompts/error-handling.md)

## 自动生成

运行 `python scripts/generate-api.py` 生成 API 骨架
```

### 步骤 4：测试技能

1. 将技能放入 `.claude/skills/` 目录
2. 重启 Claude Code 会话
3. 执行相关任务，观察是否自动调用

---

## 最佳实践

### 1. 保持简洁

```markdown
✅ SKILL.md 控制在 5000 词以内
✅ 将详细文档放入 references/ 目录
✅ 避免重复内容
```

### 2. 渐进式披露

```markdown
# 核心指令（始终加载）

简短的核心指导...

## 详细参考

如需了解更多，请参阅：

- [API 设计规范](./references/api-design.md)
- [错误码表](./references/error-codes.constants.md)
```

### 3. 明确边界

```yaml
boundaries:
  includes:
    - "REST API 设计和实现"
    - "OpenAPI 文档生成"
  excludes:
    - "GraphQL API（使用 graphql-expert）"
    - "数据库设计（使用 database-manager）"
  handoff:
    - skill: "database-manager"
      when: "需要设计数据库表结构时"
```

### 4. 项目定制

```markdown
## Project-Specific Guidelines

### 本项目使用

- Framework: NestJS 10
- ORM: Prisma
- Validation: class-validator

### 命名约定

- 控制器：`*.controller.ts`
- 服务：`*.service.ts`
- DTO：`*.dto.ts`
```

---

## 发布与分享

### 1. GitHub 仓库

```bash
# 创建独立仓库
my-claude-skill/
├── SKILL.md
├── scripts/
├── references/
├── README.md         # 使用说明
└── LICENSE           # 开源协议
```

### 2. 提交到官方仓库

1. Fork [anthropics/skills](https://github.com/anthropics/skills)
2. 添加你的技能到 `skills/` 目录
3. 提交 Pull Request

### 3. 发布到 SkillsMP

1. 确保 GitHub 仓库有 2+ stars
2. 技能会被自动索引到 [SkillsMP](https://skillsmp.com/)

---

## 常见问题

### Q: Skills 和 Commands 有什么区别？

| Skills      | Commands            |
| ----------- | ------------------- |
| AI 自动调用 | 用户手动触发        |
| 知识库/指导 | 快捷指令/工作流     |
| 用户不可见  | 用户可 `/help` 查看 |

### Q: 如何知道技能是否被加载？

Claude 不会显式告知，但你可以：

1. 观察响应是否符合技能指导
2. 在技能中添加特定标记让 Claude 提及

### Q: 技能太大怎么办？

1. 拆分到 `references/` 目录
2. 使用条件加载（互斥内容分开）
3. 只保留核心指令在 SKILL.md

### Q: 如何调试技能？

1. 检查 YAML frontmatter 格式
2. 确保 name 和 description 存在
3. 重启 Claude Code 会话
4. 尝试明确相关任务触发

---

## 资源链接

- [Anthropic Skills 官方仓库](https://github.com/anthropics/skills)
- [Claude Code Skills 文档](https://code.claude.com/docs/en/skills)
- [SkillsMP 技能市场](https://skillsmp.com/)
- [Awesome Claude Skills](https://github.com/travisvn/awesome-claude-skills)
- [Skills 技术深度解析](https://mikhail.io/2025/10/claude-code-skills/)
- [Anthropic 官方博客](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

---

## 本项目技能

GenesisPod 项目的技能位于 `.claude/skills/` 目录：

| 分类         | 技能数量 | 主要用途                   |
| ------------ | -------- | -------------------------- |
| AI           | 7        | AI 应用开发、多 Agent 协作 |
| Development  | 8        | 前后端开发、测试、Git      |
| Quality      | 3        | 测试、代码审查、性能优化   |
| Operations   | 4        | 部署、调试、环境配置       |
| Data         | 2        | 数据管道、知识图谱         |
| Architecture | 4        | 系统设计、安全、MCP        |

详见 [.claude/skills/README.md](../../.claude/skills/README.md)

---

**最后更新**: 2025-01-11
