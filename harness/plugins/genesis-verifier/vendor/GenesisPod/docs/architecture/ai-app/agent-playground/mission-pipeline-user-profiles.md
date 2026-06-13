# User Profiles 子文档（§11 / D20）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §11 / §12 D20 / §13 P0
> **优先级**：P0

---

## 1. 问题域

mission 创建时支持丰富的用户档位（depth / budget / style / length / audience / withFigures / auditLayers / language / concurrency / viewMode），并提供合理的**默认值**：深度 + 图文 + 其他中等。

---

## 2. 完整 Profile DTO

```typescript
// POST /agent-playground/missions
interface CreateMissionDto {
  topic: string; // 必填
  depth?: "quick" | "standard" | "deep"; // 默认 'deep'
  budgetProfile?: "low" | "medium" | "high" | "unlimited"; // 默认 'medium'
  styleProfile?: "academic" | "executive" | "journalistic" | "technical"; // 默认 'executive'
  lengthProfile?: "brief" | "standard" | "deep" | "extended"; // 默认 'standard'
  audienceProfile?: "executive" | "domain-expert" | "general-public"; // 默认 'domain-expert'
  withFigures?: boolean; // 默认 true
  auditLayers?: "minimal" | "default" | "thorough" | "paranoid"; // 默认 'default'
  language?: "zh-CN" | "en-US"; // 默认 'zh-CN'
  concurrency?: 1 | 2 | 3 | 5; // 默认 3
  viewMode?: "continuous" | "chapter" | "quick"; // 默认 'continuous'（前端默认进入哪个视图）
}
```

---

## 3. 默认值汇总

| 字段            | 默认              | 说明                       |
| --------------- | ----------------- | -------------------------- |
| depth           | **deep**          | 5-7 维度（深度）           |
| budgetProfile   | **medium**        | budgetMultiplier=1.0       |
| styleProfile    | **executive**     | 简洁 / 行动导向 / 数据支撑 |
| lengthProfile   | **standard**      | ~8K 字                     |
| audienceProfile | **domain-expert** | 术语放开 / 假设有背景      |
| withFigures     | **true**          | 图文并茂                   |
| auditLayers     | **default**       | L0 + L3 启                 |
| language        | **zh-CN**         |                            |
| concurrency     | **3**             | Researcher 并行度          |
| viewMode        | **continuous**    | 默认进连续视图             |

---

## 4. 各档位映射规则

### 4.1 depth → dimensions count

| depth    | dimensions |
| -------- | ---------- |
| quick    | 2-3        |
| standard | 3-5        |
| **deep** | **5-7**    |

### 4.2 budgetProfile → budgetMultiplier

| budgetProfile | budgetMultiplier | 大致总 token       |
| ------------- | ---------------- | ------------------ |
| low           | 0.5              | ~200K              |
| **medium**    | **1.0**          | **~390K**          |
| high          | 2.0              | ~780K              |
| unlimited     | 10.0             | 不限（实际看模型） |

### 4.3 lengthProfile → 字数目标

| lengthProfile | 字数目标 | hard rule ±20%  |
| ------------- | -------- | --------------- |
| brief         | ~3K      | 2.4K - 3.6K     |
| **standard**  | **~8K**  | **6.4K - 9.6K** |
| deep          | ~15K     | 12K - 18K       |
| extended      | ~25K     | 20K - 30K       |

### 4.4 styleProfile → 文风提示词

| styleProfile  | prompt 策略                                               |
| ------------- | --------------------------------------------------------- |
| academic      | 学术规范 / 长句 / 多被动 / 标准引用格式                   |
| **executive** | **行动导向 / 短句 / 数据支撑 / bullet 化 / 含 takeaways** |
| journalistic  | 故事性 / 引言 + 起伏 + 结论 / 引用人物                    |
| technical     | 工程师视角 / 代码块 / 流程图 / 边界条件清单               |

### 4.5 audienceProfile → 知识门槛 + 自动审核规则

| audienceProfile   | 假设知识门槛 | 自动审核规则                     |
| ----------------- | ------------ | -------------------------------- |
| executive         | 商业基础     | 自动启 L4 critic（高管阅读敏感） |
| **domain-expert** | **领域专业** | 跟随 auditLayers 默认            |
| general-public    | 大众         | 自动加术语解释提示               |

### 4.6 auditLayers → 启用层

| auditLayers | 启用层                 | 大致成本（vs minimal） |
| ----------- | ---------------------- | ---------------------- |
| minimal     | L0                     | 1×                     |
| **default** | **L0 + L3**            | **~1.3×**              |
| thorough    | L0 + L1 + L3 + L4      | ~2×                    |
| paranoid    | L0 + L1 + L2 + L3 + L4 | ~3×                    |

### 4.7 withFigures → figures pipeline

| withFigures      | 行为                                                                              |
| ---------------- | --------------------------------------------------------------------------------- |
| **true（默认）** | Researcher 抽 figureCandidates；Reconciler 过滤；Writer W1 figurePlan + W2 inline |
| false            | 跳过整个 figures pipeline，节省 ~10-15% token                                     |

### 4.8 viewMode → 前端默认进入视图

仅前端使用，不影响后端 mission 执行。所有视图共享同一 ReportArtifact。

---

## 5. 自动规则（覆盖默认）

| 触发条件                                                  | 自动应用                              |
| --------------------------------------------------------- | ------------------------------------- |
| `audienceProfile === 'executive'`                         | 自动启 L4（即使 auditLayers=default） |
| `auditLayers === 'default' && depth === 'deep'`           | 自动启 L1                             |
| `withFigures === true && depth === 'quick'`               | 限制 figures 数 ≤ 3 张总              |
| `lengthProfile === 'extended' && budgetProfile === 'low'` | 警告：可能超预算，建议升 medium       |

---

## 6. 实现要点

- DTO 用 class-validator 校验（默认值用 `@IsOptional() + 静态默认 merge`）
- 默认值 merge 在 Orchestrator [1] 节点完成，merged profile 写入 mission 行
- 各 stage spec.taskProfile / prompt 注入根据 styleProfile / audienceProfile 动态调整
- 自动规则在默认值 merge 之后应用，不允许用户显式 disable

---

## 7. 前端 UI 配置

| 控件               | 字段            | 默认显示       |
| ------------------ | --------------- | -------------- |
| 单选按钮组（深度） | depth           | "深度（推荐）" |
| 滑块               | budgetProfile   | 中等           |
| 下拉               | styleProfile    | 高管简报       |
| 滑块               | lengthProfile   | 标准（~8K）    |
| 下拉               | audienceProfile | 领域专家       |
| 开关               | withFigures     | 开             |
| 单选（高级）       | auditLayers     | 标准（L0+L3）  |
| 下拉               | language        | 中文           |
| 数字（高级）       | concurrency     | 3              |
| 视图切换（提交后） | viewMode        | 连续视图       |

UI 可分"基础"（topic / depth / budget / withFigures）和"高级"（其他全部）两栏。

---

## 8. 验收标准

- 不传任何字段时，所有默认值生效（深度 + 图文 + 其他中等）
- 传部分字段时，只覆盖该字段，其余默认
- merged profile 持久化到 mission 行（用于 trace + replay）
- 自动规则触发时 mission_events 有 audit log（如 `auto-rule:l4-enabled-for-executive`）
- ReportArtifact.metadata 完整记录最终生效的 profile（含自动规则应用后的状态）

---

## 9. 风险 / 边界

- 用户传非法值（如 depth='ultra'）→ class-validator fail-fast
- 自动规则可能让用户惊讶 → mission_events 必须可视化告知"已自动启 L4"
- 默认值更改是 breaking change → 加默认值版本号（如 v1.0），DB mission 行存使用的版本
