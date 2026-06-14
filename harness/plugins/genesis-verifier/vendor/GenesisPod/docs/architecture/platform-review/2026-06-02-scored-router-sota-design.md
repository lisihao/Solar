# 三路由器务实 SOTA 化 · 设计（待签字）

> **日期**：2026-06-02
> **目标档**：务实 SOTA = 语义检索 + 多信号打分 + 可观测（**不含**在线 bandit/反馈学习）
> **范围/顺序**：先抽 canonical `ScoredRouter` core（以 LLM election 打分为蓝本）→ 落地最弱的 Tools / Skills → LLM router P2 接入同 core
> **状态**：⏳ 等用户签字后实现 P1

---

## 1. 现状基线（已读代码，作为可验证起点）

| Router | 文件                                                               | 现状                                                   | 关键缺口                        |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------- |
| LLM    | `ai-engine/llm/selection/model-election.service.ts`                | 7 维加权打分 + 硬过滤 + tie-break + 可观测             | 无 latency 信号；无语义难度推断 |
| Tools  | `ai-harness/runner/tool-routing/tool-selector.ts`                  | 默认 `SimpleAllowlistSelector` **全选 envelope.tools** | 无语义检索、无打分、全暴露      |
| Skills | `ai-engine/skills/registry/skill.registry.ts:243` `matchByTrigger` | keyword/intent/regex + priority                        | 无语义、无打分、无 health/cost  |

**收敛洞察**：三者本质同一范式 `embed 候选描述 → top-k 语义检索 → 多信号重排 → 可观测`。LLM 已有"重排"半截，Tools/Skills 仅有注册。→ 抽 1 个 core 复用 3 处（符合"3 处使用才抽象"）。

---

## 2. Canonical Core 设计

### 2.1 接口（泛型，agent 无关 → 归 engine）

```typescript
// 候选：任何可被路由的东西（model / tool / skill）
interface RoutableCandidate {
  readonly id: string;
  readonly description: string; // 用于语义 embedding 的文本
  readonly signals?: CandidateSignals; // health / cost / latency / priority（可选）
}

interface CandidateSignals {
  readonly recentErrorRate?: number;
  readonly costTier?: "basic" | "standard" | "strong";
  readonly p95LatencyMs?: number;
  readonly priority?: number;
}

interface RouteQuery {
  readonly goal: string; // 任务文本，embed 后做语义检索
  readonly topK?: number; // 默认全量打分；>0 时先语义裁剪再打分
  readonly costBias?: "cheap" | "balanced" | "quality";
  readonly previouslyChosen?: readonly string[]; // diversity 反坍缩
}

interface RouteResult<T> {
  readonly ranked: ReadonlyArray<{ candidate: T; score: RouteScore }>;
  readonly chosen: T;
  readonly reason: string; // 可观测：复用 election 的 breakdown 文风
}

interface RouteScore {
  readonly id: string;
  readonly total: number;
  readonly breakdown: {
    // 与 ElectionScore.breakdown 同构
    relevance: number; // ← 新：语义余弦相似度归一
    health: number;
    cost: number;
    diversity: number;
    priority: number;
  };
}

interface SignalScorer<T extends RoutableCandidate> {
  readonly key: string;
  score(cand: T, query: RouteQuery): number;
}

interface ScoredRouter {
  route<T extends RoutableCandidate>(
    candidates: readonly T[],
    query: RouteQuery,
    scorers: readonly SignalScorer<T>[],
  ): Promise<RouteResult<T>>;
}
```

### 2.2 算法（务实 SOTA，无学习）

1. **语义检索**：query.goal embed（复用 `ai-engine/rag/embedding/EmbeddingService`，text-embedding-3-small/1536）；候选描述 embedding **启动/注册时预算一次并缓存**（静态文本，不变）。余弦相似度取 topK（topK 未给则跳过裁剪，全量进打分）。
2. **多信号打分**：复用 election 的 `health/cost/diversity/priority` 打分常量得 `signalTotal`。breakdown 全程可观测。
3. **两阶段词典序排序**（2026-06-02 v2，反"加性混合"反模式）：relevance **分档**（默认带宽 5，满分 40 → 8 档）为**主排序键**，signals 仅在**同档内** tie-break，再 priority → id lex 保确定性。**避免高健康但不相关的候选用信号分压过更相关者**。embedding 不可用时 relevance 全 0 → 同档 → 完全退化为信号打分。

### 2.3 关键工程约束（对账 + 不破坏现有）

- **embedding 缓存**：候选描述 embedding 用内存 LRU（key = sha256(description)），boot 预热；**绝不每次调用重 embed**（否则路由比直连还贵，自毁卖点）。
- **零候选/embedding 不可用兜底**：embedding 服务挂 → 退化为"跳过 relevance，仅多信号打分"（等价于 LLM router 现状），**不抛错**。对齐 election 的 last-resort 哲学。
- **LLM router 复用**：P2 让 `ModelElectionService` 内部委托 core（model 描述 = 现有 capability 文本），并新增 `p95LatencyMs` 信号；**保持 elect() 对外签名不变**（facade 不动）。

---

## 3. 三处接入点

| Router           | 接入方式                                                                                                                                                                                                                               | 改动面                               |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **Tools**（P1）  | 新 `SemanticToolSelector implements IToolSelector`（harness/runner/tool-routing），内部调 engine `ScoredRouter`，对 `envelope.tools` 的描述做语义检索；**仅当工具数 > 阈值（默认 8）时启用**，否则沿用 allowlist（小集合不值得 embed） | 新增 1 selector + 注册；默认行为可配 |
| **Skills**（P1） | 新 `SemanticSkillRouter`（engine/skills），与 `matchByTrigger` **互补**：trigger 命中优先（确定性规则），无命中时语义检索兜底                                                                                                          | 新增 1 service；registry 不改        |
| **LLM**（P2）    | `ModelElectionService` 委托 core + 加 `p95LatencyMs` 信号                                                                                                                                                                              | 内部重构，签名不变                   |

---

## 4. 可验证目标（强成功标准，Karpathy）

| #   | 目标               | 验证命令/断言                                                           |
| --- | ------------------ | ----------------------------------------------------------------------- |
| 1   | Tools 语义路由正确 | 单测：goal="检索学术论文" + 全工具 → arxiv/pubmed 排在 weather-api 之上 |
| 2   | Tools 省 token     | 单测：N=20 工具、topK=5 时传给 LLM 的工具数从 20→5                      |
| 3   | Skills 语义兜底    | 单测：trigger 无命中时，任务文本语义匹配到相关 skill 高于无关 skill     |
| 4   | embedding 不重算   | 单测：同描述二次 route 不触发新 embed 调用（mock 计数=1）               |
| 5   | 兜底不抛错         | 单测：embedding 服务抛错时降级为多信号打分，仍返回 chosen               |
| 6   | 架构合规           | `npm run verify:arch` 绿（无 engine→harness 反向依赖）                  |
| 7   | 不回归             | `npm run verify:quick` 绿                                               |

---

## 5. ⚠️ 唯一待你拍板的架构点：canonical core 放哪

core 是 **agent 无关的泛型原语**（不需要 agent/mission 状态）→ 归 **engine**。但它被 engine/llm + engine/skills + harness/tools 三处消费，**不能塞进 llm（非 llm 专属）也不宜塞 rag（是路由不是检索）**。两个选项：

- **A（推荐）新增 `ai-engine/routing/` 顶层聚合**：MECE 最干净，"同名概念全项目唯一"。代价：engine 从 9 个聚合变 10 个，需同步改 `standards/16`。
- **B 寄居 `ai-engine/rag/routing/`**：不新增顶层聚合，但"工具/技能/模型路由"挂在 rag 下语义略别扭。

> 选 A 还是 B？选定后我即按本设计实现 P1（Tools + Skills），过 §4 全部验证门，出一个可合 PR。

---

## 6. 不做什么（务实 SOTA 边界，防过度）

- ❌ 在线反馈/bandit 权重学习（完全 SOTA，本轮不做）
- ❌ prompt 难度估计模型（本轮不做）
- ❌ 改 facade 对外签名（保持兼容）
- ❌ 动 LLM router（P2，本轮只抽 core + 落 Tools/Skills）
