# Topic Insights · 10 项超越基线增强

> 版本：v1（Gate 3）
>
> 每项必须有：acceptance metric / baseline measurement / target / test method。

---

## 一、目标

新 pipeline 必须达到：

- 质量 ≥ baseline × 0.95
- 成本 ≤ baseline × 1.3
- 延迟 ≤ baseline × 1.2

**在此基础上**，通过以下 10 项**结构性改进**达成 baseline 无法做到的事。

---

## 二、10 项增强

### E-01 · 类型化 Agent 输出（Zod Schema 强制）

**现状 (baseline)**: Agent 返回 raw string，parser 尽力解析，fan-out 5 轴评分 / 编造 evidenceUsed 等 bug 常见。

**增强**: 每个 agent 输出必须通过 Zod schema + custom validation。

**Acceptance Metric**:

- 所有 agent parse 失败率 < 1%（Zod validation fail 即算失败）
- Section review fan-out 模式 detection 准确率 100%（通过 stddev 检查）

**Target**: 无 fan-out / 编造数据 / 字段缺失问题

**Test Method**:

- 契约测试覆盖每个 Zod schema
- Golden 样本中故意注入 fan-out case，验证 validateSectionReview 捕获

---

### E-02 · Pipeline Checkpoint 断点续跑

**现状**: Mission 失败后必须重头跑（浪费已完成的 dimension）

**增强**: Stage 级 checkpoint，resume 时跳过已完成 stage

**Acceptance Metric**:

- Mission 失败后重启时间 ≤ 剩余 stages 时间（不含已完成）
- Resume 成功率 ≥ 95%

**Target**: 节省平均 40% 的重跑成本

**Test Method**:

- Chaos test：随机在 ST-04 / ST-07 kill process，restart 后对比总 duration

---

### E-03 · Cache Hit Rate 可观测

**现状**: 无法知道 prompt cache 是否生效，账单才发现

**增强**: 每个 agent run 返回 `cacheHitRate`，Stage 14 汇总，低于阈值告警

**Acceptance Metric**:

- 每个 mission 的平均 cache hit rate 暴露在 monitoring 中
- P50 cache hit rate ≥ **40%**（真实目标，不是 98% 幻觉）

**Target**: Cost 降低 25% vs 无 cache

**Test Method**:

- 跑 10 个相似 topic（同一 topicType），观察 cache 命中趋势

---

### E-04 · 分层 PR Checklist + CI bash（代替 ESLint plugin）

**现状**: 跨层调用混乱靠约定

**增强**: CI 脚本 grep 检查 + PR template checkbox

**Acceptance Metric**:

- CI 在 2 秒内完成 layering check
- 任何违反分层的 PR 必须被 CI 阻止合并

**Target**: 0 分层违规合并到 main

**Test Method**:

- 故意写跨层调用的测试 PR，验证 CI 阻止

---

### E-05 · 拐点粒度 Feature Flag + Traffic Split

**现状**: 发布即全量，回退即全部重建

**增强**: 4 flag + 4 阶段 traffic split（0/10/50/100）

**Acceptance Metric**:

- 10% 流量稳定 48h 无 SLO 恶化才推进到 50%
- 任何 SLO 恶化连续 3 个 mission 触发自动回退

**Target**: 发布后 fallback 时间 ≤ 5 分钟（仅 flag 切换）

**Test Method**:

- Pre-prod 环境演练：强制 SLO 恶化，验证 auto-rollback

---

### E-06 · Golden 样本 e2e 测试（LLM-as-judge）

**现状**: 只有单元测试，行为回归靠人眼

**增强**: 10 个真实 topic 的完整 baseline snapshot + LLM judge 打分

**Acceptance Metric**:

- 每个 PR 合并前必跑 Golden 样本回归
- 10-dim 任何维度均分下降 > 10% 阻止合并

**Target**: 回归检测覆盖率 ≥ 80%

**Test Method**:

- 定期（CI 每日 / PR trigger）跑 Golden 样本，记录均分

---

### E-07 · Agent 并发预算管理

**现状**: Section 并行无限制，rate limit 崩溃

**增强**: `PipelineBudget.maxToolCalls` + per-agent `concurrency` 控制

**Acceptance Metric**:

- Rate limit 错误率 < 0.5%
- 并发度超限时自动降级到串行

**Target**: 0 次 rate-limit 导致的 mission 失败

**Test Method**:

- Load test：50 concurrent mission，观察 rate limit 恢复

---

### E-08 · Skill Lint

**现状**: skill.md 写错 prompt 运行时才发现（如缺少 output schema 段）

**增强**: `SkillLint` utility 扫描所有 skill.md，验证：

- 必含 `## Output Format (MANDATORY)` 段
- JSON schema 可 parse
- TaskProfile 字段完整

**Acceptance Metric**: CI 检查，任何 skill 缺段阻止合并

**Target**: 0 skill 配置错误上生产

**Test Method**: unit test 每个 skill 过 lint

---

### E-09 · Tool 调用契约检查

**现状**: Agent 可以调任何 tool，不遵守 role description 里的约定

**增强**: Agent spec 的 `tools[]` 作为白名单，harness 内核强制

**Acceptance Metric**:

- Synthesizer 调用 evidence-save 被 harness 拒绝（0 假证据 bug）
- 所有非法 tool 调用记录到 audit log

**Target**: 0 越权 tool 调用

**Test Method**:

- 故意让 Synthesizer 尝试 evidence-save，验证 harness 拒绝

---

### E-10 · Depth Config 编译期强制

**现状**: `ctx.depthConfig?.maxRevisionRounds` optional，常被忘记设置

**增强**: `PipelineIdentityContext.depthConfig` 非 optional；Stage 0 保证 resolve

**Acceptance Metric**: TypeScript 编译失败如果任何 stage 读 optional 字段

**Target**: 0 runtime undefined depthConfig 错误

**Test Method**:

- Type check 覆盖所有 stage
- Runtime 断言测试

---

## 三、汇总验收表

| ID   | 增强           | 关键 Metric         | Target  |
| ---- | -------------- | ------------------- | ------- |
| E-01 | Zod 强制       | parse fail rate     | < 1%    |
| E-02 | Checkpoint     | resume success rate | ≥ 95%   |
| E-03 | Cache 可观测   | P50 hit rate        | ≥ 40%   |
| E-04 | 分层 check     | 违规合并            | 0       |
| E-05 | Feature flag   | rollback latency    | ≤ 5 min |
| E-06 | Golden samples | 回归检测覆盖        | ≥ 80%   |
| E-07 | 并发预算       | rate limit 失败     | < 0.5%  |
| E-08 | Skill lint     | 配置错误上产        | 0       |
| E-09 | Tool 契约      | 越权调用            | 0       |
| E-10 | Depth 强制     | runtime undefined   | 0       |

---

## 四、每项的实现 PR 分配

见 `07-implementation-plan.md`。
