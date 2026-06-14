# Topic Insights · 实施计划（Tier + PR 分解）

> 版本：v1（Gate 3）
>
> 工作量：**50-70 人天 / 10-14 周**（单人）
>
> 原则：**Phase 0 基线先录 → Core Tier 先上 → Enhancement / Advanced 按需增加**。

---

## 一、整体里程碑

| Phase            | 工作量 | 交付物                                             | Gate                                      |
| ---------------- | ------ | -------------------------------------------------- | ----------------------------------------- |
| Phase 0          | 1-2 周 | 10 个 Golden sample snapshots + Baseline telemetry | 通过 = 有客观对比基线                     |
| Tier Core        | 5-6 周 | 6 agents + 8 stages + 15 utilities + Pipeline 骨架 | 通过 = Standard 深度 e2e 跑通、质量 ≥ 95% |
| Tier Enhancement | 3 周   | +5 agents + 4 stages + 10 utilities                | 通过 = Thorough 深度 e2e 跑通             |
| Tier Advanced    | 2-3 周 | +6 agents + 2 stages + 5 utilities                 | 通过 = 全部能力覆盖                       |
| 生产灰度         | 2 周   | 10% → 50% → 100% traffic                           | 通过 = 100% 流量稳定 7 天                 |
| Legacy 清理      | 1 周   | 物理删除 12+ god service                           | 通过 = CI 全绿 + 代码减少 > 15k 行        |

**合计**: 14-19 周（2 位数）。**单人估算可加人平摊**，但 Pipeline 核心骨架是串行依赖（Core 必须先完成）。

---

## 二、Phase 0 · 基线捕获（详细）

### 2.1 目标

在**任何代码变更前**，完整录制 10 个真实 topic 在 baseline commit 下的行为：

| 录制内容                                                                 | 存储位置                                      | 用途                       |
| ------------------------------------------------------------------------ | --------------------------------------------- | -------------------------- |
| 每个 mission 的所有 LLM input/output pair                                | `fixtures/golden/${topicId}/llm-calls.ndjson` | 迁移后对比、LLM judge 打分 |
| 所有 WebSocket event payload                                             | `fixtures/golden/${topicId}/events.ndjson`    | 事件回归检测               |
| 所有 DB 写入快照                                                         | `fixtures/golden/${topicId}/db-snapshot.json` | 迁移后写入一致性验证       |
| Cost / latency / cache rate                                              | `fixtures/golden/${topicId}/metrics.json`     | SLO 基线                   |
| 最终 report markdown + highlights + keyFindings                          | `fixtures/golden/${topicId}/final-report.md`  | Judge 打分对比             |
| Utility 级 input/output pair（numberSubHeadings / assessCredibility 等） | `fixtures/golden/utils/*.json`                | 契约测试 fixtures          |

### 2.2 10 个样本选择

| TopicType  | Topic 示例                                          | 数量 |
| ---------- | --------------------------------------------------- | ---- |
| MACRO      | "中国经济 2025 年展望"、"全球 AI 芯片竞争格局"      | 3    |
| TECHNOLOGY | "大模型训练成本下降趋势"、"AI Agent 技术栈 2026"    | 3    |
| COMPANY    | "OpenAI 商业化策略分析"、"NVIDIA 数据中心业务"      | 2    |
| EVENT      | "某公司 Q3 财报分析"、"Apple Vision Pro 2 发布影响" | 2    |

每个 topic 覆盖 2 种 depth（standard + thorough），共 **20 个 mission run**。

### 2.3 采集工具

**PR-0.1**: `BaselineRecorder` infrastructure

- Wrap `AiChatService.chat` with recorder（stream input/output 到 ndjson）
- Wrap `ResearchEventEmitterService.emit*` 记录 events
- 每个 mission 结束后 dump DB snapshot（TopicReport + DimensionAnalysis + TopicEvidence）
- Env flag `TOPIC_INSIGHTS_RECORD_BASELINE=1` 启用

**PR-0.2**: Run 20 mission + commit fixtures

- 在 staging 环境跑 20 个 mission
- Review fixtures 完整性（手动抽样检查）
- Commit `fixtures/golden/` 到 repo（git-lfs 大文件）

**PR-0.3**: Golden sample test runner

- `npm run test:golden` → 对每个 topic 跑新 pipeline（flag 控制），对比 baseline
- LLM judge：Claude Opus-4.7，独立 3 次取中位数
- 报告各维度 score

### 2.4 Phase 0 通过条件

- 20 个 fixtures 完整（无缺失字段）
- `test:golden --baseline` 跑 baseline 代码验证 recorder 功能
- LLM judge 在 baseline fixtures 上打分稳定（3 次 stddev < 1.0 分）

**通过后才进入 Tier Core。**

---

## 三、Tier Core 实施（5-6 周）

### 3.1 交付物

- 6 agents: AG-01, 03, 04, 05, 06, 11
- 8 stages: ST-00, 01, 02, 03, 04, 05, 07, 13, 14
- 15 utilities: research/ + content-format/ + figure/ + citation/ + evidence/ 的核心
- Pipeline 骨架（含 BudgetService + CheckpointStore）
- PromptCacheCoordinator 对接
- Base Agent Runner（含 AbortSignal + Zod 基类）

### 3.2 PR 分解（共 ~20 个 PR）

#### PR Group A: 基础设施（Week 1）

**PR-A.1**: `Pipeline core types + Context + StageResults`

- 文件：`pipeline/types/*.ts`
- 测试：类型检查 + mock Stage 执行

**PR-A.2**: `PipelineBudget + BudgetService`

- 文件：`pipeline/budget/*.ts`
- Acceptance: depth-based defaults 正确、canAfford/shouldDegrade 正确

**PR-A.3**: `CheckpointStore（基于 ResearchCheckpointService）`

- 文件：`pipeline/checkpoint/*.ts`
- Acceptance: mark/resume/list 功能

**PR-A.4**: `BaseAgentRunner + AbortSignal 传播`

- 文件：`harness-agents/common/base-runner.ts`
- 若 harness facade 改动 in-scope：同 PR 更新 HarnessFacade.execute 接受 `{ signal }`
- 否则：降级方案（stage 边界 cancel）

**PR-A.5**: `ZodValidator + validateWithSchema utility`

- 文件：`harness-agents/common/validate-output.ts`

**PR-A.6**: `CI layering check + PR template`

- 文件：`ci/check-layering.sh`, `.github/pull_request_template.md`

#### PR Group B: Utility 迁移（Week 2）

**PR-B.1**: `research/` utilities
**PR-B.2**: `content-format/` utilities
**PR-B.3**: `figure/` utilities
**PR-B.4**: `citation/` utilities
**PR-B.5**: `evidence/` utilities

每个 PR 附对应的 parity 测试（新 vs 旧 output 对比）。

#### PR Group C: Core Agents（Week 3-4）

**PR-C.1**: `AG-01-LD Leader` + SK-01-PLAN + output schemas

- 含 access matrix 校验

**PR-C.2**: `AG-03-SW SectionWriter` + SK-03-WRITE

**PR-C.3**: `AG-04-SR SectionReviewer` + SK-04-REVIEW + fan-out detection

**PR-C.4**: `AG-05-ME MetaExtractor` + SK-13-META

**PR-C.5**: `AG-06-QR QualityReviewer`（dim + overall scopes）

**PR-C.6**: `AG-11-SY Synthesizer` + SK-12-SYN

每个 agent PR 附：

- Zod schema 测试
- Runner 单元测试（mock harness）
- Golden 样本覆盖该 agent 的场景

#### PR Group D: Core Stages（Week 5）

**PR-D.1**: `ST-00-INIT`
**PR-D.2**: `ST-01-PLAN`
**PR-D.3**: `ST-02-RESEARCH`（含 2a/2b/2c/2d 子步）
**PR-D.4**: `ST-03-WRITE`（含 DAG + 并行）
**PR-D.5**: `ST-04-REVIEW`（含 while loop + 早停）
**PR-D.6**: `ST-05-INTEGRATE`
**PR-D.7**: `ST-07-SYNTH`
**PR-D.8**: `ST-13-PERSIST` + `ST-14-CLEANUP`

#### PR Group E: Pipeline Integration（Week 6）

**PR-E.1**: `TopicInsightsPipeline` 引擎（topological sort + SLO 监控）

**PR-E.2**: 切换 `controllers/` 到 Pipeline（通过 feature flag）

**PR-E.3**: 10% traffic split 启用（staging 验证）

### 3.3 Tier Core 验收

| 检查项           | 标准                                 |
| ---------------- | ------------------------------------ |
| TypeScript 编译  | 0 error                              |
| 单元测试         | ≥ 80% coverage                       |
| Golden 样本测试  | 10/10 通过（质量 ≥ baseline × 0.95） |
| Cost baseline    | ≤ baseline × 1.3                     |
| Latency baseline | ≤ baseline × 1.2                     |
| Stage SLO        | P95 全部达标                         |
| 分层合规         | CI check 通过                        |

通过 → 进入 Tier Enhancement。

---

## 四、Tier Enhancement 实施（3 周）

### 4.1 交付物

- 5 agents: AG-02, 07, 08, 09, 10
- 4 stages: ST-06-COGLOOP, ST-08-QGATE, ST-09-EVAL, ST-10-FACT
- 10 utilities: quality/ 全套 + Iron-wall 6 子

### 4.2 PR 分解

**PR-F.1**: quality/ + iron-wall utilities
**PR-F.2**: AG-02 DimensionPlanner
**PR-F.3**: AG-07 FactChecker
**PR-F.4**: AG-08 GapSearcher
**PR-F.5**: AG-09 HypothesisVerifier
**PR-F.6**: AG-10 FactExtractor
**PR-F.7**: ST-06-COGLOOP
**PR-F.8**: ST-08-QGATE + AG-12 SectionRemediator（共用同一 loop）
**PR-F.9**: ST-09-EVAL + AG-13 ReportEvaluator
**PR-F.10**: ST-10-FACT

### 4.3 Enhancement 验收

- Thorough 深度 e2e 测试通过
- 认知循环实际触发 gap search（非摆设）
- Fact-check 检出 golden 样本中故意注入的 disputed claims

---

## 五、Tier Advanced 实施（2-3 周）

### 5.1 交付物

- 6 agents: AG-12 (已在 Enhancement), AG-13 (已在 Enhancement), AG-14, 15, 16, 17
  - 实际 Advanced 独立的：AG-14, 15, 16, 17（4 个）
- 2 stages: ST-11-ASM, ST-12-LATEX
- 5 utilities: assemble/ + section/

### 5.2 PR

**PR-G.1**: assemble/ utilities
**PR-G.2**: ST-11-ASM
**PR-G.3**: ST-12-LATEX + AG-14 LatexRepair
**PR-G.4**: AG-15 ReportEditor（独立 endpoint）
**PR-G.5**: AG-16 MissionAdjuster（独立 endpoint）
**PR-G.6**: AG-17 LeaderDispatcher（独立 endpoint）

---

## 六、生产灰度（2 周）

### 6.1 Traffic Split 阶段

| 阶段 | 流量 | 稳定时长 | 下一阶段触发条件           |
| ---- | ---- | -------- | -------------------------- |
| 0    | 0%   | —        | Tier Core 全部 PR 合并     |
| 1    | 10%  | 48h      | SLO 全绿 + Golden 回归无红 |
| 2    | 50%  | 72h      | Same                       |
| 3    | 100% | 7d       | Same                       |

### 6.2 自动回退触发

连续 3 个 mission 满足任一：

- P95 latency > baseline × 1.5
- Cost 均值 > baseline × 2
- Error rate > 5%
- LLM judge 均分 < baseline × 0.85

→ 自动切 `TOPIC_INSIGHTS_PIPELINE_ENABLED=0`
→ 发 PagerDuty 告警
→ 冻结 traffic split
→ 记录最近 10 失败 mission snapshot

### 6.3 手动回退

Feature flag 在管理后台可手动切换，5 分钟内生效。

---

## 七、Legacy 清理（1 周）

**前置**：100% 流量稳定 7 天 + Golden 样本连续 2 周无回归。

**PR-H.1**: 删除 legacy god services（12+ 文件）

- 对每个文件：确认无任何非测试代码 import
- 删除文件 + 对应 spec
- 更新 barrel indexes

**PR-H.2**: 删除 feature flag `TOPIC_INSIGHTS_PIPELINE_ENABLED`（新 pipeline 成为默认）

**PR-H.3**: 更新文档：标注设计文档的实施状态 `✅ Implemented`

---

## 八、风险与应对

| 风险                                     | 触发条件                | 应对                                             |
| ---------------------------------------- | ----------------------- | ------------------------------------------------ |
| Golden 样本无法录制（baseline 代码 bug） | Phase 0 failure         | 修 baseline 代码 → 重新录制                      |
| Cost 超 baseline × 1.3                   | Tier Core e2e test 失败 | 检查 cache prefix / 合并 agent 调用 / 早停策略   |
| Latency 超 baseline × 1.2                | 同上                    | 提升并行度 / 跳过 optional stages                |
| 质量 < baseline × 0.95                   | Golden judge 失败       | 调优 skill.md prompts / 调整 SLO / 延迟发布      |
| Harness facade 改动被拒绝                | Gate 1 决策             | 降级为 stage 边界 cancel，cancelMission 文档注明 |
| 单人不够                                 | 进度严重滞后            | 加人 + 并行化 PR（utility 和 agent 可并行）      |

---

## 九、Handoff 机制

每个 PR 合并后更新：

- `HANDOFF.md`（本 session 中断时的交接文档）
- 对应设计文档的实施状态

Context window 不够时：

1. 保存所有 in-progress tasks 到 TaskList
2. Commit 当前改动（标 WIP）
3. 写 `HANDOFF-{date}.md` 记录下 session 第一件要做的事

---

## 十、Go/No-Go 决策点

| 决策点             | Go 条件              | No-Go 后果                |
| ------------------ | -------------------- | ------------------------- |
| Gate 1（方向审批） | 用户接受 5 项        | 返工设计                  |
| Gate 2（细节审批） | 03/04/05/09 通过     | 返工细节                  |
| Gate 3（实施审批） | 06/07/08 通过        | 返工实施                  |
| Phase 0 完成       | 20 fixtures OK       | 修 recorder / 修 baseline |
| Tier Core 完成     | 三维 SLO 全通        | 调优或延后 Enhancement    |
| Enhancement 完成   | Thorough 深度 e2e OK | 调优                      |
| 100% 流量稳定 7 天 | 无 auto-rollback     | 回 50% 观察               |
| Legacy 清理        | 代码无非测试 import  | 等依赖切换                |
