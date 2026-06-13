# Replay API 子文档（D12）

> **基线版本**：v0.1 / 2026-04-26
> **上游**：mission-pipeline-baseline.md §9.5 / §10 Q12 / §12 D12
> **优先级**：P1（dev only）

---

## 1. 问题域

mission 失败时开发者需要快速诊断。当前可走 `failureCode + diagnostic`（90% 信息够），剩 10% 需要钻 events 表。Replay API 让开发者在**不消费 credits** 的前提下重放 mission（用 stub LLM）调试问题。

---

## 2. 仅 dev 环境暴露

```typescript
// 仅在 NODE_ENV !== 'production' 注册
@Controller('agent-playground/missions/:missionId/replay')
@UseGuards(DevOnlyGuard)
class ReplayController {
  @Get()
  async getReplaySnapshot(@Param('missionId') id: string): Promise<ReplaySnapshot>;

  @Post('replay')
  async runReplay(@Param('missionId') id: string, @Body() opts: ReplayOptions): Promise<ReplayResult>;
}
```

DevOnlyGuard：检查 user role + env，非 dev 用户 / 非 dev 环境直接 404。

---

## 3. ReplaySnapshot 结构

```typescript
interface ReplaySnapshot {
  missionId: string;
  createdAt: Date;
  profile: MergedProfile;          // user-profiles.md merged 后的 profile
  stages: StageSnapshot[];
}

interface StageSnapshot {
  stage: 'leader'|'researcher'|'reconciler'|'analyst'|'writer'|'reviewer';
  agentId: string;
  spec: { id: string; version: string };
  envelope: {
    system: string;
    messages: IContextMessage[];
    tools: string[];
    metadata: Record<string, unknown>;
  };
  llmTrace: {
    iter: number;
    request: { model: string; messages: any[]; params: any };
    response: { content: string; tokensUsed: { ... } };
  }[];
  toolTrace: {
    toolId: string;
    input: unknown;
    output: unknown;
    error?: string;
    latencyMs: number;
  }[];
  result: RunResult;
}
```

数据来源：`agent_checkpoints` + `agent_events` 表（已有持久化）。

---

## 4. Replay 模式

```typescript
interface ReplayOptions {
  mode: 'fixture'|'stub'|'live';
  // fixture: 用录制的 LLM/tool 输出回放，零成本
  // stub: 用预设规则的 stub LLM（spec.stubFn）
  // live: 真跑（dev 环境用便宜模型，限单次执行）
  fromStage?: 'leader'|'researcher'|...;  // 从某 stage 开始（不重跑前面）
  modifyEnvelope?: { stage: string; patch: Partial<Envelope> };  // 修改某 stage 的输入再 replay
}
```

### 4.1 fixture 模式

把原 mission 的 LLM request/response 序列存盘，replay 时直接喂回。
适合：**复现失败 bug**（输入完全相同时模型输出确定）。

### 4.2 stub 模式

用 spec.stubFn 提供的 deterministic 输出。
适合：**改进算法时回归测试**（想看新逻辑 vs 旧的 trace）。

### 4.3 live 模式

真跑但用 cheap model（haiku-4.5），dev quota 限制。
适合：**模型升级测试**（想看新模型在同 input 下的差异）。

---

## 5. ReplayResult

```typescript
interface ReplayResult {
  replayedMissionId: string; // 新生成的 mission（不污染原 mission）
  divergencePoints: {
    // 与原 mission 的发散点
    stage: string;
    iter: number;
    field: string; // 'output' | 'tool_call.input' 等
    original: unknown;
    replay: unknown;
  }[];
  finalArtifact?: ReportArtifact;
}
```

---

## 6. 数据隐私

- replay 的产物不进生产 DB（用 dev schema 或临时表）
- 不计费、不发邮件、不调 destructive 工具
- ToolInvoker 感知 replay flag，destructive 工具自动 mock

---

## 7. 实现要点

- `agent_checkpoints` + `agent_events` 已有，replay 只需读不写
- fixture/stub 模式不调真实 LLM，由 LlmExecutor 内置 dispatcher 切换
- live 模式强制 modelOverride='haiku-4.5'
- divergencePoints 计算用 deepEqual + 字段级 diff

---

## 8. 验收标准

- prod 环境访问 replay 接口直接 404
- fixture 模式 replay 一个失败 mission，divergencePoints 应为空（完全一致）
- stub 模式 replay 显示新逻辑的 trace
- replay 不消费 credits（账单零变化）
- replay 不写入 prod DB

---

## 9. 风险 / 边界

- agent_checkpoints / agent_events 表数据量大 → 加 retention 策略（30 天）
- LLM 输出非 deterministic → live 模式即使同输入也可能不同结果（fixture/stub 才能精确复现）
- destructive 工具 mock 不完整 → replay 可能行为偏差，列限制在 README
