# Agent 命名规范 · topic-insights harness

> 2026-04-24 沉淀。目的：把 agent 命名的既有隐式规则文档化，避免未来新增 agent 时风格漂移。

## 两条命名轴

每个 spec agent 有 **两个名字**，两条轴都要一致：

| 轴              | 格式                          | 用途                        |
| --------------- | ----------------------------- | --------------------------- |
| **Spec 文件名** | kebab-case 语义 role 名       | 代码阅读、jump-to-def       |
| **Agent ID**    | `AG-{NN}-{2-4 letter suffix}` | 日志、事件、registry lookup |

例：`section-writer.ts` 对应 ID `AG-03-SW`。

## Spec 文件名规则

1. **kebab-case**，全小写连字符
2. **语义 role 名**，不是功能描述：
   - ✅ `leader-planner.ts`, `section-writer.ts`, `fact-checker.ts`
   - ❌ `plan.ts`, `write.ts`, `check.ts`
3. **Leader 前缀**用于显式标注 Leader-scope agent：
   - `leader-planner`, `leader-dispatcher`, `leader-intent`, `leader-agentic-searcher`
4. **Section / Report / Mission** 前缀用于作用域：
   - `section-writer`, `section-reviewer`, `section-remediator`
   - `report-editor`, `report-evaluator`
   - `mission-adjuster`
5. 位于 `modules/ai-app/topic-insights/agents/specs/` 一层平铺，不再分类

## Agent ID 规则

### 编号 (`NN` 两位数)

按执行阶段分段：

| 段          | 范围          | 语义                                                                                |
| ----------- | ------------- | ----------------------------------------------------------------------------------- |
| 主流水线    | AG-01 ~ AG-11 | Leader → Plan → Write → Review → Integrate → Search → Verify → Extract → Synthesize |
| 修订增强    | AG-12 ~ AG-15 | Section remediate · Report evaluate · Latex repair · Report edit                    |
| Leader 辅助 | AG-16 ~ AG-19 | Mission adjust · Leader dispatch · Leader intent · Leader agentic search            |

新增 agent 时**先选段**，段内顺位 `+1`。

### 后缀 (`XX` 2-4 字母)

1. **首选 2 字母**，对应 role 名主要单词的缩写：
   - SectionWriter → **SW**
   - FactChecker → **FC**
   - GapSearcher → **GS**
2. **碰撞时拓展为 3-4 字母**——这是**有意允许**的偏差，readability 优先：
   - AG-04-SR (SectionReviewer) 已占用 → AG-12-**SREM** (SectionRemediator)
   - AG-13-RE (ReportEvaluator) 已占用 → AG-15-**RED** (ReportEditor)
   - AG-01-LD (LeaderDefault/Director) 已占用 → AG-17-**LDP** (LeaderDispatcher)
   - 5+ 字母的 LeaderAgenticSearcher 无法压到 2 字母 → AG-19-**LAS**
3. **同基础词的不同 agent 必须 suffix 不同**，不得共用：
   - ❌ 两个 agent 都叫 SR
   - ✅ SR / SREM 分开

### 当前完整清单（2026-04-24，19 个 spec）

```
主流水线:
  AG-01-LD   leader-planner.ts        (Leader Director/Default)
  AG-02-DP   dimension-planner.ts     (Dimension Planner)
  AG-03-SW   section-writer.ts        (Section Writer)
  AG-04-SR   section-reviewer.ts      (Section Reviewer)
  AG-05-ME   meta-extractor.ts        (Meta Extractor)
  AG-06-QR   quality-reviewer.ts      (Quality Reviewer)
  AG-07-FC   fact-checker.ts          (Fact Checker)
  AG-08-GS   gap-searcher.ts          (Gap Searcher)
  AG-09-HV   hypothesis-verifier.ts   (Hypothesis Verifier)
  AG-10-FX   fact-extractor.ts        (Fact eXtractor)
  AG-11-SY   synthesizer.ts           (SYnthesizer)

修订增强:
  AG-12-SREM section-remediator.ts    (Section REMediator; SR taken)
  AG-13-RE   report-evaluator.ts      (Report Evaluator)
  AG-14-LX   latex-repair.ts          (LateX repair)
  AG-15-RED  report-editor.ts         (Report EDitor; RE taken)

Leader 辅助:
  AG-16-MA   mission-adjuster.ts      (Mission Adjuster)
  AG-17-LDP  leader-dispatcher.ts     (Leader DisPatcher; LD taken)
  AG-18-LI   leader-intent.ts         (Leader Intent)
  AG-19-LAS  leader-agentic-searcher.ts (Leader Agentic Searcher)
```

## Spec 文件内部结构

所有 spec 遵循相同 shape（见 `defaults.ts`）：

```typescript
export const SECTION_WRITER_SPEC: IAgentSpec<SectionWriterInput, SectionResult> = {
  identity: { role: { id: "AG-03-SW", name: "...", description: "...", workStyle: "structured" },
              persona: ..., goal: ..., constraints: ..., tools: [...] },
  taskProfile: { creativity: "medium", outputLength: "long" },
  outputSchema: SectionResultSchema,
  buildSystemPrompt: (ctx) => ...,
  buildUserPrompt:   (ctx) => ...,
  validateBusinessRules: (output, ctx) => { ... },
  stubFn: async (ctx) => ({ ... }),
};
```

字段对象顺序（convention）：

1. `identity` （role + persona + goal + constraints + tools）
2. `taskProfile`
3. `outputSchema`
4. `buildSystemPrompt`
5. `buildUserPrompt`
6. `validateBusinessRules`
7. `stubFn`

## 目录组织

```
agents/specs/
├── defaults.ts          # 共享默认 identity / workStyle / persona
├── schemas.ts           # 跨 spec 的 Zod output schema
├── index.ts             # barrel export (≈127 LOC, 每个 spec 一行 re-export)
├── __tests__/
└── <spec-file>.ts × 19
```

单 agent 一文件（不按功能分子目录）。19 个 spec 平铺依然可读；超过 30 个再考虑按 "主流水线 / 修订增强 / Leader 辅助" 分子目录。

## 添加新 agent 的 checklist

1. 确定段位（主流水线 / 修订增强 / Leader 辅助）→ 选下一个 `NN`
2. 起语义 role 名 → 文件名 `<role-name>.ts`
3. 后缀 2 字母优先，碰撞时 3-4 字母
4. `export const <ROLE>_SPEC: IAgentSpec<TInput, TOutput> = { identity.role.id: "AG-NN-XX", ... }`
5. `agents/specs/index.ts` 补 re-export
6. `topic-insights.module.ts` 的 `TOPIC_INSIGHTS_AGENT_SPECS` 数组加新 spec
7. 写一个 stubFn（便于 AI_ENGINE_AGENT_STUB=1 测试）
8. 写单测（Zod schema 合法性 + stubFn 返回值）
9. Pipeline stage 引用：`agentRegistry.get<TInput, TOutput>("AG-NN-XX").executeSpec(input, env)`

## 当前不动，未来可选迁移

以下诉求**现状合理，不做**；如将来规模 > 30 个 agent 再考虑：

- ❌ "全部压到 2 字母" — 会破坏 SREM/RED/LDP/LAS 的 readability，且必须改 registry lookup + 历史日志
- ❌ "按段位分子目录" — 19 个文件平铺可读；> 30 个再议
- ❌ "把 Leader agent 单独 `leader/` 子目录" — `leader-*` 前缀已经足够
