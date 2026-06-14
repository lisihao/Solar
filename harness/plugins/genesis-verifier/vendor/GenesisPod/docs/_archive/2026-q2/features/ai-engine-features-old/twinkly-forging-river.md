# AI Writing Skills 集成方案 v2

> 采用 Claude Code 风格的 SKILL.md 机制 + SkillsMP 生态系统集成

---

## 核心设计理念

**为什么采用 SKILL.md 而非 TypeScript Skills？**

| 维度           | TypeScript Skills  | SKILL.md Skills                |
| -------------- | ------------------ | ------------------------------ |
| **Token 消耗** | 全部代码编译进系统 | 按需加载，节省 Token           |
| **业务描述**   | 代码逻辑分散       | 集中式 Markdown 描述           |
| **维护成本**   | 需要开发者修改     | 产品/运营可直接编辑            |
| **生态支持**   | 封闭系统           | 可接入 SkillsMP 63,000+ Skills |
| **迭代速度**   | 需重新部署         | 热加载，即时生效               |

---

## 三个核心问题的回答

### 问题 1: 是否需要创建 Skills 加载系统？

**答案：是，创建运行时 SKILL.md 加载系统。**

```
┌─────────────────────────────────────────────────────────────────┐
│  SkillLoaderService（新增）                                      │
│  ├── loadLocalSkills()    # 加载本地 .skill.md 文件              │
│  ├── loadRemoteSkill()    # 从 SkillsMP 加载远程 Skill           │
│  ├── parseSkillMd()       # 解析 YAML frontmatter + Markdown     │
│  └── cacheSkill()         # 缓存远程 Skills                      │
└─────────────────────────────────────────────────────────────────┘
```

### 问题 2: 架构是否会变化？

**答案：AI Engine 核心架构不变，新增 Skills 基础设施层。**

```
┌─────────────────────────────────────────────────────────────────┐
│  AI Engine（核心能力层）- 不变                                    │
│  ✅ AIEngineFacade.chat() - 现有方法保持                         │
│  ★ AIEngineFacade.chatWithSkills() - 新增方法                    │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  Skills Infrastructure（新增基础设施层）                          │
│  ├── SkillLoaderService      # 加载本地/远程 Skills              │
│  ├── SkillPromptBuilder      # 组装 System Prompt                │
│  ├── SkillCacheService       # 远程 Skill 缓存                   │
│  └── SkillsMP Integration    # 生态系统接入                      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│  AI Apps（应用层）- 使用 Skills                                   │
│  ├── Writing: chapter-writing.skill.md, style-control.skill.md  │
│  ├── Research: deep-research.skill.md, citation.skill.md        │
│  └── Office: outline-planning.skill.md                          │
└─────────────────────────────────────────────────────────────────┘
```

### 问题 3: 与 Claude Code Skills 是否同一方案？

**答案：采用相同格式，但扩展为运行时系统 + 生态集成。**

| 对比     | Claude Code Skills   | 我们的 Skills         |
| -------- | -------------------- | --------------------- |
| **格式** | SKILL.md (YAML + MD) | 相同 ✅               |
| **执行** | Claude CLI 读取      | 后端 SkillLoader 读取 |
| **来源** | 仅本地               | 本地 + SkillsMP 生态  |
| **选择** | 手动指定             | 按任务类型自动组合    |

---

## SKILL.md 格式规范

```markdown
---
# YAML Frontmatter
id: writing-chapter-content
name: 章节内容写作
version: 1.0.0
domain: writing
tags: [content, creative, novel]
taskTypes: [chapter-writing, scene-writing]
priority: 10
author: genesis-ai
source: local # local | skillsmp | custom-url
---

# 章节内容写作 Skill

## 角色定位

你是一位专业的小说作家...

## 核心原则

1. 展示而非告知（Show, don't tell）
2. 角色驱动情节
3. 感官细节丰富

## 写作约束

- 避免重复表达
- 保持节奏变化
- 对话要有潜台词

## 输出格式

按章节结构输出，包含场景描写、对话、心理活动...
```

---

## 目录结构

```
backend/src/modules/
├── ai-engine/
│   ├── facade/
│   │   └── ai-engine.facade.ts        # 新增 chatWithSkills()
│   └── skills/
│       ├── loader/                     # ★ 新增
│       │   ├── skill-loader.service.ts
│       │   ├── skill-parser.ts
│       │   └── skill-cache.service.ts
│       ├── builder/                    # ★ 新增
│       │   └── skill-prompt-builder.service.ts
│       ├── ecosystem/                  # ★ 新增 SkillsMP 集成
│       │   ├── skillsmp-client.service.ts
│       │   └── skill-installer.service.ts
│       └── types/
│           └── skill-md.types.ts       # SKILL.md 类型定义
│
├── ai-app/
│   ├── writing/
│   │   └── skills/                     # ★ 新增 SKILL.md 文件
│   │       ├── chapter-writing.skill.md
│   │       ├── style-control.skill.md
│   │       ├── character-voice.skill.md
│   │       └── narrative-pacing.skill.md
│   └── research/
│       └── skills/
│           ├── deep-research.skill.md
│           └── evidence-synthesis.skill.md
```

---

## 核心组件设计

### 1. SkillLoaderService

```typescript
@Injectable()
export class SkillLoaderService {
  // 加载本地 Skills
  async loadLocalSkills(domain: string): Promise<SkillDefinition[]>;

  // 从 SkillsMP 加载
  async loadFromSkillsMP(skillId: string): Promise<SkillDefinition>;

  // 解析 SKILL.md 文件
  parseSkillMd(content: string): SkillDefinition;

  // 按任务类型获取 Skills
  getSkillsForTask(taskType: string, domain: string): SkillDefinition[];
}
```

### 2. SkillPromptBuilder

```typescript
@Injectable()
export class SkillPromptBuilder {
  // 组装 System Prompt
  buildSystemPrompt(
    skills: SkillDefinition[],
    context?: Record<string, any>,
  ): string;

  // 估算 Token 消耗
  estimateTokens(skills: SkillDefinition[]): number;

  // 智能裁剪（超出限制时）
  trimToTokenLimit(
    skills: SkillDefinition[],
    maxTokens: number,
  ): SkillDefinition[];
}
```

### 3. SkillsMPClient（生态集成）

```typescript
@Injectable()
export class SkillsMPClientService {
  private readonly baseUrl = "https://skillsmp.com/api";

  // 搜索 Skills
  async searchSkills(
    query: string,
    filters?: SkillFilters,
  ): Promise<SkillSearchResult[]>;

  // 获取 Skill 详情
  async getSkill(skillId: string): Promise<SkillDefinition>;

  // 安装到本地缓存
  async installSkill(skillId: string): Promise<void>;

  // 检查更新
  async checkUpdates(installedSkills: string[]): Promise<UpdateInfo[]>;
}
```

### 4. AIEngineFacade 扩展

```typescript
// ai-engine.facade.ts 新增方法
async chatWithSkills(options: {
  messages: Message[];
  taskType: string;           // 任务类型，用于自动选择 Skills
  domain: string;             // 领域，如 'writing', 'research'
  additionalSkills?: string[]; // 额外指定的 Skill IDs
  skillContext?: Record<string, any>; // 传递给 Skill 的上下文
  taskProfile: TaskProfile;
  modelType?: AIModelType;
}): Promise<ChatResponse> {
  // 1. 加载 Skills
  const skills = await this.skillLoader.getSkillsForTask(taskType, domain);

  // 2. 组装 System Prompt
  const systemPrompt = this.promptBuilder.buildSystemPrompt(skills, skillContext);

  // 3. 调用现有 chat()
  return this.chat({
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
    taskProfile,
    modelType,
  });
}
```

---

## SkillsMP 生态集成

### Skill 来源优先级

```
1. 本地 Skills（ai-app/*/skills/*.skill.md）     优先级最高
2. 已安装的远程 Skills（cached/skills/）         次优先
3. SkillsMP 实时拉取                            按需获取
```

### 已知可用的 SkillsMP Skills

| Skill 名称              | 作者               | 用途               |
| ----------------------- | ------------------ | ------------------ |
| Deep Research           | cameronsjo         | 深度研究，多轮搜索 |
| run-deep-research       | monarch-initiative | 研究执行           |
| Research Skill          | danielmiessler     | 信息检索           |
| Blog Post Writer        | -                  | 博客写作           |
| Content Research Writer | -                  | 内容研究写作       |
| Citation Management     | -                  | 引用管理           |

### 安装流程

```bash
# CLI 命令（未来可实现）
genesis skill install cameronsjo/deep-research
genesis skill search "novel writing"
genesis skill list --installed
```

---

## 实施阶段

| 阶段        | 任务                                         | 优先级 |
| ----------- | -------------------------------------------- | ------ |
| **Phase 1** | 创建 SkillLoaderService + SkillPromptBuilder | 高     |
| **Phase 2** | 迁移 WriterAgent 硬编码 → SKILL.md           | 高     |
| **Phase 3** | AIEngineFacade 新增 chatWithSkills()         | 高     |
| **Phase 4** | SkillsMP 客户端集成                          | 中     |
| **Phase 5** | Skill 安装/缓存/更新机制                     | 中     |
| **Phase 6** | 管理界面（查看/安装 Skills）                 | 低     |

---

## 关键文件清单

| 文件                                                       | 操作 | 说明                |
| ---------------------------------------------------------- | ---- | ------------------- |
| `ai-engine/skills/loader/skill-loader.service.ts`          | 新建 | 核心加载器          |
| `ai-engine/skills/loader/skill-parser.ts`                  | 新建 | YAML+MD 解析        |
| `ai-engine/skills/builder/skill-prompt-builder.service.ts` | 新建 | Prompt 组装         |
| `ai-engine/skills/ecosystem/skillsmp-client.service.ts`    | 新建 | SkillsMP API        |
| `ai-engine/skills/types/skill-md.types.ts`                 | 新建 | 类型定义            |
| `ai-engine/facade/ai-engine.facade.ts`                     | 修改 | 新增方法            |
| `ai-app/writing/skills/*.skill.md`                         | 新建 | Writing Skills      |
| `ai-app/writing/agents/writer.agent.ts`                    | 修改 | 改用 chatWithSkills |

---

## 验证方式

1. **单元测试**
   - SkillLoader 能正确解析 SKILL.md 格式
   - SkillPromptBuilder 能正确组装 System Prompt
   - Token 估算准确

2. **集成测试**
   - chatWithSkills() 能自动加载对应 Skills
   - 本地 Skill 优先于远程 Skill
   - 远程 Skill 缓存正常工作

3. **端到端测试**
   - Writing API 行为不变（向后兼容）
   - 生成内容质量不下降
   - Token 消耗明显减少

4. **SkillsMP 测试**
   - 能搜索到 SkillsMP 的 Skills
   - 能安装远程 Skill 到本地
   - 能正确使用已安装的远程 Skill

---

## Token 优化预期

| 场景     | 旧方案（硬编码） | 新方案（SKILL.md）      |
| -------- | ---------------- | ----------------------- |
| 章节写作 | ~3000 tokens     | ~800 tokens（按需加载） |
| 风格控制 | ~1500 tokens     | ~400 tokens             |
| 质量检查 | ~2000 tokens     | ~500 tokens             |

**预计节省 60-70% System Prompt Token**

---

## 风险与缓解

| 风险                  | 缓解措施                        |
| --------------------- | ------------------------------- |
| SKILL.md 格式解析错误 | 严格 schema 校验 + 友好错误提示 |
| SkillsMP API 不稳定   | 本地缓存兜底 + 超时重试         |
| 远程 Skill 质量参差   | 建立审核机制 + 用户评分         |
| 向后兼容问题          | WriterAgent 保持 API 不变       |

---

**版本**: 2.0
**更新日期**: 2026-01-16
**状态**: 待审批
