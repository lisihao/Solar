# AI 策划 (AI Planning) — PRD

> 目标驱动的多 Agent 结构化策划平台

## 产品定位

用户描述策划目标，系统编排 AI 团队按六阶段工作流（目标分析 → 调研 → 头脑风暴 → 辩论 → 综合 → 交付）协作输出完整策划方案。

## 核心功能

### 策划创建

- 策划名称 + 策划目标（必填）
- 模板选择：通用策划 / 营销策划 / 产品策划 / 活动策划
- 深度选择：快速（~10min）/ 标准（~30min）/ 深度（~60min）

### 六阶段工作流

| Phase | 名称     | 执行方式                                    | 复用服务                            |
| ----- | -------- | ------------------------------------------- | ----------------------------------- |
| 1     | 目标分析 | 单任务 Mission，Leader 解析目标为结构化需求 | MissionExecutionService             |
| 2     | 调研洞察 | 多任务 Mission，研究员+分析师并行调研       | MissionExecutionService + WebSearch |
| 3     | 头脑风暴 | AI 在 Topic 中轮流讨论 (3 轮)               | AiResponseService (AI-AI 协作)      |
| 4     | 辩论推演 | 创建辩论会话，正反方+裁判                   | DebateService + syncDebateToTopic   |
| 5     | 方案综合 | 单任务 Mission，Leader 整合所有产出         | MissionExecutionService             |
| 6     | 输出交付 | 单任务 Mission，Writer 格式化文档           | MissionExecutionService             |

### 策划管理

- 策划列表（我的策划 / 发现公开策划）
- 策划详情：聊天流 + 阶段进度条 + 策划面板
- 阶段操作：推进 / 重试 / 暂停
- 导出：Markdown 策划文档

### AI 成员自动配置

| 深度      | 成员                                        |
| --------- | ------------------------------------------- |
| 快速/标准 | 策划总监 + 研究员 + 分析师 + 文案专家 (4人) |
| 深度      | 上述 + 正方辩手 + 反方辩手 (6人)            |

## 路由

- 列表页：`/ai-planning`
- 详情页：`/ai-planning/[planId]`

## 导航位置

左侧菜单：AI 报告 → **AI 策划** → AI 决策 → 自建团队

## 设计原则

1. **最大化复用**：100% 复用现有 AI Engine + AI Teams 基础设施
2. **独立模块**：作为独立 AI App 模块 (`ai-app/planning/`)，import AiTeamsModule 复用 Topic/Mission/Debate
3. **零迁移**：复用 Topic.metadata JSON 字段存储策划元数据，无需数据库迁移
4. **保持现有功能不受影响**：「自建团队」菜单和功能完全不变

## API 设计

```
POST   /api/v1/ai-planning                        创建策划
GET    /api/v1/ai-planning                        获取策划列表
GET    /api/v1/ai-planning/templates              获取模板列表
GET    /api/v1/ai-planning/:planId                获取策划详情
POST   /api/v1/ai-planning/:planId/advance        推进下一阶段
POST   /api/v1/ai-planning/:planId/phase/:n/retry 重新执行某阶段
GET    /api/v1/ai-planning/:planId/export         导出策划文档
DELETE /api/v1/ai-planning/:planId                删除策划
```

## 数据模型（零迁移）

**Topic.metadata 扩展：**

```typescript
interface PlanningTopicMetadata {
  planningMode: true;
  templateId: string;
  currentPhase: number; // 1-6
  phaseStatus: Record<
    number,
    {
      status: "pending" | "active" | "completed" | "skipped";
      missionId?: string;
      debateSessionId?: string;
      summary?: string;
      completedAt?: string;
    }
  >;
  planConfig: {
    goal: string;
    depth: "quick" | "standard" | "comprehensive";
    autoAdvance: boolean;
  };
}
```

## i18n

- nav key: `nav.aiPlanning`
- 顶级 block: `aiPlanning.*`
- 支持中英文

## 验证标准

1. 左侧菜单显示「AI 策划」且位于 AI 决策上方
2. 原有「自建团队」菜单和功能完全不受影响
3. 创建策划 → 选模板 → AI 成员自动配置
4. 六阶段依次执行，每阶段产出可查看
5. 最终导出 Markdown 策划文档

---

**创建日期**: 2026-02-11
**维护者**: Claude Code
