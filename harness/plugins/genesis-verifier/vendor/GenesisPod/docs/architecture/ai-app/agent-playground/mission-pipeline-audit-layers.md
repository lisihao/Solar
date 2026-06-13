# Audit Layers 子文档（Q5 / §6）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §6 / §10 Q5 / §11 / §13 P0+P1
> **优先级**：P0（L0/L3 必启）+ P1（L1/L2/L4 用户档位）

---

## 1. 问题域

每个 Agent 产出物需要审核，但全开太贵、全关太烂。业界主流做法是 **L0~L4 五层**，按用户档位灵活启用。

---

## 2. 五层审核

| 层              | 谁负责                            | 范围                                       | 默认状态   |
| --------------- | --------------------------------- | ------------------------------------------ | ---------- |
| **L0 自审**     | Agent 自己（Loop 内 finalize 闸） | schema + business rule                     | ★ 总是启用 |
| **L1 反思**     | Agent 自己（Reflexion verifier）  | 内容质量自评                               | ☆ 默认关   |
| **L2 同侪**     | 同角色另一实例                    | 跨实例一致性（相同任务两次跑结果是否相符） | ☆ 默认关   |
| **L3 跨角**     | 下游 Agent（Reviewer 审 Writer）  | 是否满足下游需要                           | ★ 总是启用 |
| **L4 独立复审** | 独立 Critic Agent（不参与生产）   | 跳出闭环看大方向                           | ☆ 默认关   |

---

## 3. 用户档位映射

| auditLayers 档位 | 启用层                 | 大致成本（vs minimal） | 适用场景                |
| ---------------- | ---------------------- | ---------------------- | ----------------------- |
| `minimal`        | L0                     | 1×                     | 草稿快出，纯校验        |
| **`default`**    | **L0 + L3**            | **~1.3×**              | **标准任务（默认）**    |
| `thorough`       | L0 + L1 + L3 + L4      | ~2×                    | 高质量要求 / 高风险任务 |
| `paranoid`       | L0 + L1 + L2 + L3 + L4 | ~3×                    | 极致质量（不推荐常用）  |

**自动启用规则（覆盖默认）**：

- `audienceProfile === 'executive'` → 自动启 L4（高管阅读，质量敏感）
- `auditLayers === 'default' && depth === 'deep'` → 自动启 L1（深度报告需自我修正）

---

## 4. 各层实现接口

### 4.1 L0 自审（Loop 内）

**已有**：spec.outputSchema + spec.validateBusinessRules → AgentRunner / HarnessedAgent / ReActLoop 内闭环。

不可关闭，不需要新接口。

### 4.2 L1 反思（Reflexion 启用）

**接口**：spec.loop = `'reflexion'`，spec 加 verifiers 配置。

```typescript
@DefineAgent({
  loop: 'reflexion',
  reflexion: {
    verifiers: ['self-critique'],
    passThreshold: 75,
    maxRevisions: 2,
  },
})
```

**触发条件**：用户 auditLayers ∈ {thorough, paranoid} 或自动规则触发。

**ReflexionLoop 已实现**（baseline §10 Q3/Q4），只需 App 层根据档位决定 spec.loop。

### 4.3 L2 同侪（同角色另一实例）

**接口**：App 层在 [3.b] [5] [6] 等关键节点起两个相同 spec 实例并行，比对输出。

```typescript
async function runWithPeer(Spec, input, opts): Promise<RunResult> {
  const [a, b] = await Promise.all([
    runner.run(Spec, input, opts),
    runner.run(Spec, input, { ...opts, seed: opts.seed! + 1 }),
  ]);
  const consistency = compareOutputs(a.output, b.output); // embedding similarity
  if (consistency < 0.8) {
    // 起 tie-breaker
    return runTieBreaker(a, b);
  }
  return a;
}
```

**默认关**：仅 paranoid 档位启用，成本翻倍。

### 4.4 L3 跨角（下游审上游）

**已有**：Reviewer Stage（[6]）就是 L3。Writer 输出 ReportArtifact → Reviewer 评 10 维。

不可关闭。

### 4.5 L4 独立复审（独立 Critic）

**新增 Agent**：

```typescript
@DefineAgent({
  id: 'playground.critic',
  loop: 'react',
  toolCategories: [],
  budget: { maxTokens: 12_000, maxIterations: 2 },
  taskProfile: { creativity: 'low', outputLength: 'medium', reasoningDepth: 'deep' },
  inputSchema: {
    artifact, factTable, reconciliationReport,
    upstreamReviewerVerdict,                 // 看 Reviewer 怎么评的
    audienceProfile, lengthProfile, styleProfile,
  },
  outputSchema: {
    overallVerdict: 'pass'|'concerns'|'fail',
    blindspots: string[],                    // Reviewer 没看到的问题
    biasFlags: string[],                     // 论调偏倚
    suggestions: string[],                   // 改进方向
  },
})
```

Critic 不与 Writer 通信（避免 self-confirmation），只读 artifact + 旁观 Reviewer 评分。

**输出处理**：

- `pass` → 放行
- `concerns` → 标记到 metadata.warnings（不阻塞）
- `fail` → 触发整体重审（可选回到 W3 CrossDimSynth 重做跨维度部分）

---

## 5. 各 Stage 适用层

| Stage             | L0  | L1               | L2       | L3              | L4              |
| ----------------- | --- | ---------------- | -------- | --------------- | --------------- |
| Leader            | ✅  | thorough+        | -        | -               | -               |
| Researcher        | ✅  | thorough+ / deep | paranoid | -               | -               |
| Reconciler        | ✅  | -                | -        | -               | -               |
| Analyst           | ✅  | thorough+        | -        | -               | -               |
| Writer (W1~W4)    | ✅  | thorough+        | -        | -               | -               |
| Reviewer (W5/[6]) | ✅  | -                | -        | **本身就是 L3** | thorough+ 启 L4 |

---

## 6. 实现要点

- App 层在 missionStart 解析 `auditLayers` 档位 → 计算每个 stage 的 audit 配置
- ReflexionLoop 本身已实现，只需 App 层条件性把 spec.loop 改成 `'reflexion'`
- L4 Critic 是新 Agent，独立 spec
- L2 同侪需要 LLM seed 控制（保证两次跑确实独立）—— 当前 LlmExecutor 不支持 seed override，需补
- 所有审核结果汇总到 `quality.qualityTrace` 字段（baseline §7.7）

---

## 7. 验收标准

- minimal 档位：mission 跑完只有 L0 通过/失败信息
- default 档位：mission 末尾 quality.dimensions 有 10 维评分
- thorough 档位：每个 stage 内出现 reflection 事件 + L4 critic 输出附在 metadata.warnings
- paranoid 档位：关键 stage 出现两次相同 spec 调用 + 一次 tie-breaker（如有）
- 自动规则：audienceProfile=executive 时 metadata.warnings 必有 L4 critic 输出（即使用户选 default）

---

## 8. 风险 / 边界

- L1 Reflexion verifier 评分维度需要标准化（避免每个 spec 各自定义评分维度漂移）
- L2 同侪比对的相似度阈值难定（不同任务"合理差异"幅度不同）→ 默认 0.8 + 用户可调
- L4 Critic 可能与 L3 Reviewer 意见相左 → 取 L4 优先（独立 critic 的元审视角更外部）
- L1 + L4 同时开启可能 over-correction → thorough 档位实测调阈值
