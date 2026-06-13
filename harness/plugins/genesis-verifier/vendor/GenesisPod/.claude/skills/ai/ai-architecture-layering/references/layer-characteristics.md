# Layer Characteristics

## AI Engine (核心能力层)

### Characteristics

- ✅ 领域无关（小说、技术文档、研究报告都能用）
- ✅ 可被多种 AI Apps 复用
- ✅ 不依赖具体业务上下文
- ✅ 是"机制"而非"策略"

### File Locations

```
backend/src/modules/ai-engine/
├── orchestration/services/     # 编排服务
│   ├── context-initialization.service.ts
│   ├── context-evolution.service.ts
│   ├── circuit-breaker.service.ts
│   └── ...
├── llm/services/              # LLM 服务
├── search/                    # 搜索服务
└── ...
```

## Predefined AI Teams (官方应用层)

### Characteristics

- ✅ 针对**特定场景**优化
- ✅ 封装了**最佳实践**（提示词、质量标准、输出格式）
- ✅ 用户**开箱即用**
- ✅ 是"策略"而非"机制"

### Configuration Structure

```typescript
interface PredefinedTeamConfig {
  // 团队角色模板
  leaderRole: { persona: string; systemPrompt: string };
  memberRoles: Array<{
    name: string;
    persona: string;
    expertiseAreas: string[];
  }>;

  // 场景特定提示词模板
  planningPromptTemplate: string;
  executionPromptTemplate: string;
  reviewPromptTemplate: string;

  // 质量标准
  qualityStandards: Array<{
    dimension: string;
    requirement: string;
    passThreshold: number;
  }>;

  // 输出格式
  outputFormat: "markdown" | "structured" | "slides";
}
```

### Current Predefined Teams

| Team          | Scene    | Contents                                         |
| ------------- | -------- | ------------------------------------------------ |
| AI Studio     | 研究报告 | Leader=研究主管, Members=研究员/分析师, 报告模板 |
| AI Office     | 商务文档 | Leader=项目经理, Members=文案/设计, 商务风格     |
| AI Simulation | 辩论推演 | 正方/反方角色, 辩论规则, 共识投票                |

## Custom AI Teams (用户配置层)

### Characteristics

- ✅ 用户根据**自己需求**配置
- ✅ 基于 AI Engine 能力**组合**
- ✅ 需要一定的**理解成本**

### User Configurable Items

| Config     | Description      | Examples                   |
| ---------- | ---------------- | -------------------------- |
| 团队成员   | 自定义角色和能力 | "创意总监"、"文案编辑"     |
| 协作模式   | 串行/并行/DAG    | 按章节并行写作             |
| 硬性约束   | 必须遵守的规则   | "主角不能死"、"时代为明朝" |
| 世界观设定 | 初始化配置       | 时代、人物、阵营           |
| 质量标准   | 审核通过条件     | 字数、风格、一致性         |
| 输出格式   | 最终产出形式     | 小说章节、技术文档         |

## Responsibilities

1. **Ask the three questions** in decision framework
2. **Check red flags** to avoid anti-patterns
3. **Propose correct layer** with reasoning
4. **If uncertain, default to higher layer** (easier to move up than down)
5. **Document the decision** for future reference
