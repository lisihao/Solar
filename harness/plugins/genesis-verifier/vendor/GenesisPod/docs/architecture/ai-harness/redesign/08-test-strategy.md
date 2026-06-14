# Topic Insights · 测试策略

> 版本：v1（Gate 3）

---

## 一、测试金字塔

```
          ┌──────────────┐
          │   Golden     │   Phase 0 采集 + LLM-judge 对比
          │   Samples    │   10 samples × 2 depths = 20 runs / 回归
          │   (e2e)      │
          ├──────────────┤
          │  Contract    │   Zod schema 校验 + Stage I/O
          │  Tests       │   ~70 contracts
          ├──────────────┤
          │ Integration  │   Pipeline + real Stage + mocked LLM
          │  Tests       │   ~30 scenarios
          ├──────────────┤
          │   Unit       │   Utility / Agent runner / Stage pure logic
          │   Tests      │   ~400 tests
          └──────────────┘
```

---

## 二、Unit Tests

### 2.1 Utility 测试（~200 tests）

每个 utility：

- 边界 case（空输入 / 极长输入）
- 正常 case
- 错误 case
- **Parity test**：新 utility vs 旧实现对比

示例：

```typescript
// utils/research/assess-credibility.spec.ts

describe('UT-CRED-ASSESS', () => {
  it('returns 0-100 range', () => { ... });
  it('high-credibility domains get > 80', () => { ... });
  it('low-credibility unknown domains get < 50', () => { ... });
  it('empty snippet penalizes score', () => { ... });

  // Parity
  const fixtures = loadFixtures('fixtures/golden/utils/assess-credibility/');
  for (const f of fixtures) {
    it(`matches legacy: ${f.name}`, () => {
      expect(assessCredibility(f.input)).toEqual(f.expected);
    });
  }
});
```

### 2.2 Agent Runner 测试（~50 tests，3/runner）

每个 runner：

- Happy path（mock harness return valid output）
- Invalid output（schema fail）
- Fan-out detection（SectionReviewer 专属）
- Abort（signal trigger 测试）

### 2.3 Stage 测试（~50 tests）

每个 stage：

- Happy path
- Upstream missing → error
- Budget exhausted → throw BudgetExhaustedError
- Persist side effect 验证（mock Prisma）

### 2.4 Pipeline 引擎测试（~20 tests）

- Topological sort 正确
- Checkpoint resume 跳过已完成 stage
- Abort 传播
- SLO timeout 拦截
- Degradation mode 跳过 optional stages

### 2.5 Module wiring 测试（~10 tests）

- Module.providers 完整（Nest 启动不报错）
- DI 环路检测（循环依赖应该 build fail）

---

## 三、Contract Tests（~70 contracts）

### 3.1 Agent Output Schema 契约（17 contracts）

每个 agent runner output 过 Zod + custom validation：

```typescript
// harness-agents/leader/__tests__/output-contract.spec.ts

describe('AG-01-LD output contract', () => {
  it('accepts valid LeaderPlan JSON', () => {
    const raw = fs.readFileSync('fixtures/agent-outputs/leader-valid.json', 'utf-8');
    const result = parseLeaderPlan(raw);
    expect(result.valid).toBe(true);
  });

  it('rejects fan-out patterns', () => { ... });  // SectionReview 专属
  it('rejects modelId not in availableModels', () => { ... });
  it('requires min 2 dimensions', () => { ... });
});
```

### 3.2 Stage I/O 契约（14 contracts）

Stage.prepare / execute / persist 的输入输出严格匹配 09-data-contracts 定义。

### 3.3 Skill Lint（18 contracts）

```typescript
// skills/__tests__/skill-lint.spec.ts

describe('Skill Lint', () => {
  for (const skillPath of findAllSkills()) {
    it(`${skillPath} has Output Format section`, () => {
      const md = fs.readFileSync(skillPath, 'utf-8');
      expect(md).toMatch(/## Output Format \(MANDATORY\)/);
    });

    it(`${skillPath} has TaskProfile frontmatter`, () => { ... });
    it(`${skillPath} JSON schema parses`, () => { ... });
  }
});
```

### 3.4 Access Matrix 契约（1 contract × 17 agents）

```typescript
describe("Agent-Tool access matrix", () => {
  it("Synthesizer cannot call topic.evidence.save", () => {
    const spec = buildSynthesizerSpec(ctx);
    expect(spec.identity.tools).not.toContain("topic.evidence.save");
  });

  // ... 每个 agent 一条
});
```

---

## 四、Integration Tests（~30 scenarios）

Pipeline 真实执行 + mocked LLM：

### 4.1 Happy path scenarios

- Standard depth, MACRO topic, 3 dimensions, 0 revisions
- Thorough depth, TECHNOLOGY topic, 5 dimensions, 1 cognitive loop
- Incremental mode, 2 existing dimensions + 1 new

### 4.2 Error scenarios

- Agent returns invalid JSON → Pipeline fail at that stage
- Budget exhausted at Stage 3 → Degradation mode（skip ST-06/09/10）
- AbortSignal fired at Stage 2 → Clean cancel（dim locks released）
- Checkpoint resume from Stage 4 crash → Continue from 5

### 4.3 Edge cases

- 0 evidence found for dimension → fallback to Leader-provided summary
- 1 dimension only → short report
- Max dimensions (10) with deep depth → full scale test
- LaTeX detected → ST-12 triggered

---

## 五、Golden Samples（e2e）

### 5.1 10 个 Topic samples

（见 07-implementation-plan.md 第二节）

### 5.2 LLM Judge 评分 rubric

```typescript
// test/golden/judge-rubric.ts

export const JUDGE_RUBRIC = {
  dimensions: [
    {
      id: "content_completeness",
      prompt: "报告是否覆盖了 plan 中规划的所有关键点？",
      scale: "0-10",
    },
    {
      id: "analytical_depth",
      prompt: "分析是否深入，超越表面信息？",
      scale: "0-10",
    },
    { id: "evidence_usage", prompt: "证据使用是否充分合理？", scale: "0-10" },
    {
      id: "logical_coherence",
      prompt: "逻辑是否连贯，论证完整？",
      scale: "0-10",
    },
    { id: "word_count_compliance", prompt: "字数是否达标？", scale: "0-10" },
    { id: "plan_alignment", prompt: "是否紧扣研究计划？", scale: "0-10" },
    { id: "writing_quality", prompt: "语言专业性和可读性？", scale: "0-10" },
    { id: "figure_usage", prompt: "图表引用是否规范？", scale: "0-10" },
    { id: "section_transitions", prompt: "章节衔接是否自然？", scale: "0-10" },
    {
      id: "independent_analysis",
      prompt: "有独立分析而非证据堆砌？",
      scale: "0-10",
    },
  ],
};
```

### 5.3 判定器

```typescript
// test/golden/judge-runner.ts

async function runJudge(
  baselineReport: string,
  newReport: string,
  topic: TopicInfo,
): Promise<JudgeResult> {
  const prompt = buildJudgePrompt({
    baseline: baselineReport,
    new: newReport,
    topic,
    rubric: JUDGE_RUBRIC,
  });

  const results: JudgeResult[] = [];
  for (let i = 0; i < 3; i++) {
    const r = await aiChatService.chat({
      messages: [{ role: "user", content: prompt }],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "deterministic", outputLength: "medium" },
    });
    results.push(parseJudgeOutput(r.content));
  }

  return median(results); // 中位数
}
```

### 5.4 Pass / Fail 判定

```typescript
function evaluateGoldenSample(judgeResult: JudgeResult): 'pass' | 'fail' {
  const baselineScore = /* from fixtures */;
  for (const dim of JUDGE_RUBRIC.dimensions) {
    const newScore = judgeResult.dimensions[dim.id];
    const baseScore = baselineScore.dimensions[dim.id];
    if (newScore < baseScore * 0.9) return 'fail'; // 任何单维度下降 > 10% 失败
  }
  const newAvg = mean(Object.values(judgeResult.dimensions));
  const baseAvg = mean(Object.values(baselineScore.dimensions));
  if (newAvg < baseAvg * 0.95) return 'fail';
  return 'pass';
}
```

---

## 六、SLO 监控与告警

### 6.1 Metrics 采集

```typescript
// pipeline/metrics.ts

export const pipelineMetrics = {
  stageDuration: new Histogram({
    name: "topic_insights_stage_duration_ms",
    labelNames: ["stage_id", "success"],
    buckets: [100, 500, 1000, 5000, 10000, 60000, 300000],
  }),
  stageTokens: new Histogram({
    name: "topic_insights_stage_tokens",
    labelNames: ["stage_id", "agent_id"],
  }),
  missionCost: new Histogram({
    name: "topic_insights_mission_cost_usd",
    labelNames: ["depth", "topic_type"],
  }),
  missionLatency: new Histogram({
    name: "topic_insights_mission_latency_ms",
    labelNames: ["depth", "topic_type"],
  }),
  cacheHitRate: new Gauge({
    name: "topic_insights_cache_hit_rate",
    labelNames: ["stage_id"],
  }),
  zodValidationFail: new Counter({
    name: "topic_insights_zod_fail_total",
    labelNames: ["agent_id", "error_type"],
  }),
};
```

### 6.2 告警规则（Prometheus）

```yaml
groups:
  - name: topic-insights-pipeline
    rules:
      - alert: StageLatencyP95High
        expr: histogram_quantile(0.95, rate(topic_insights_stage_duration_ms_bucket[10m])) > 1.5 * baseline_p95
        for: 5m
        labels:
          severity: warning
      - alert: MissionCostExcessive
        expr: avg(rate(topic_insights_mission_cost_usd_sum[10m]) / rate(topic_insights_mission_cost_usd_count[10m])) > 2 * baseline_avg_cost
        for: 10m
        labels:
          severity: critical
      - alert: PipelineErrorRateHigh
        expr: rate(topic_insights_stage_duration_ms_count{success="false"}[5m]) / rate(topic_insights_stage_duration_ms_count[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
```

### 6.3 Auto-rollback 触发

监控系统连续 3 个 mission 违反以下任一 → 调 admin API 切 flag：

- P95 latency > baseline × 1.5
- Cost 均值 > baseline × 2
- Error rate > 5%
- LLM judge 均分 < baseline × 0.85（定期跑抽样）

```typescript
// admin/auto-rollback.service.ts

@Injectable()
export class AutoRollbackService {
  @Cron("*/5 * * * *") // every 5 min
  async check() {
    const violations = await this.slotService.getRecentViolations();
    if (violations.consecutive >= 3) {
      await this.featureFlag.set("TOPIC_INSIGHTS_PIPELINE_ENABLED", false);
      await this.alerting.pageOncall("pipeline-rollback", violations);
      await this.snapshotFailures(); // 存最近 10 个 failed mission
    }
  }
}
```

---

## 七、CI/CD 流水线

```yaml
# .github/workflows/topic-insights-pipeline.yml

name: Topic Insights Pipeline
on:
  pull_request:
    paths:
      - "backend/src/modules/ai-app/topic-insights/**"

jobs:
  layering:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bash ci/check-layering.sh

  types-and-unit:
    runs-on: ubuntu-latest
    steps:
      - run: npx tsc --noEmit
      - run: npx jest src/modules/ai-app/topic-insights --coverage

  skill-lint:
    runs-on: ubuntu-latest
    steps:
      - run: npx jest skills/__tests__/skill-lint.spec.ts

  integration:
    runs-on: ubuntu-latest
    needs: [types-and-unit]
    steps:
      - run: npx jest --testPathPattern=integration

  golden-samples:
    if: github.event.pull_request.labels.*.name contains 'run-golden'
    runs-on: ubuntu-latest
    needs: [integration]
    timeout-minutes: 60
    steps:
      - run: npm run test:golden
```

---

## 八、人工 review 检查清单（PR template）

```markdown
## Topic Insights Pipeline PR Checklist

### 分层合规

- [ ] CI layering check 通过
- [ ] 没有跨层 import

### 契约

- [ ] 若新增 agent：Zod schema + custom validation 定义完整
- [ ] 若新增 stage：I/O schema 定义完整
- [ ] 若新增 skill：有 Output Format (MANDATORY) 段

### 测试

- [ ] 单元测试覆盖 ≥ 80%
- [ ] Contract 测试通过
- [ ] Golden samples 无回归（如 CI 跑了）

### 文档

- [ ] 对应能力 CP-ID 已在 01-capability-matrix 登记
- [ ] 若新增能力：更新 capability matrix

### Access Matrix

- [ ] 新 agent 的 tools[] 在 02 文档 access matrix 中定义
- [ ] 检查写权限（evidence-save 等）遵循 least-privilege

### SLO

- [ ] 新 stage 定义 SLO（p95 / p99 / maxTokens / minSuccessRate）
- [ ] 新 agent 定义 constraints（maxIterations / maxTokens / maxWallTimeMs）

### Budget

- [ ] 预估新增 token / cost 影响，更新 PipelineBudget depth defaults 如必要

### Handoff

- [ ] 如本 PR 中断，更新 HANDOFF 文档
```

---

## 九、测试覆盖率目标

| 层          | 目标                         | 度量          |
| ----------- | ---------------------------- | ------------- |
| Unit        | ≥ 85%                        | jest coverage |
| Integration | 覆盖所有 stage 交互          | 30 scenarios  |
| Contract    | 100%（每 agent/skill/stage） | 70 contracts  |
| Golden      | 10/10 topics pass            | PR trigger    |

---

## 十、测试数据管理

- **Fixtures in git**: Phase 0 golden samples（git-lfs 大文件）
- **Synthetic fixtures**: 单元测试用，inline 定义
- **Ephemeral fixtures**: Integration 测试用 in-memory，test teardown 清理
- **Prod snapshot**: 生产故障时 auto-rollback 捕获的 mission，送入 `fixtures/regressions/`
