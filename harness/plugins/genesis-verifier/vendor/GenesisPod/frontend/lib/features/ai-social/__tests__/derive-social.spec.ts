import { describe, it, expect } from 'vitest';
import {
  deriveSocialView,
  socialAgentByRole,
  latestThought,
  agentTools,
  socialRoleLabel,
} from '../derive-social';
import type { MissionEvent } from '@/hooks/features/useMissionStream';

function ev(
  type: string,
  payload: Record<string, unknown>,
  timestamp: number
): MissionEvent {
  return { type, payload, timestamp };
}

const find = (v: ReturnType<typeof deriveSocialView>, stepId: string) =>
  v.stages.find((s) => s.stepId === stepId);

// 13 个预置阶段（s1..s12 + s8b）
const SEEDED = 13;

describe('deriveSocialView', () => {
  it('空事件 → idle，预置完整阶段列表（全 pending）', () => {
    const v = deriveSocialView([]);
    expect(v.status).toBe('idle');
    expect(v.stages).toHaveLength(SEEDED);
    expect(v.stages.every((s) => s.status === 'pending')).toBe(true);
    expect(v.progress).toEqual({ done: 0, total: SEEDED });
  });

  it('running 中间态：s1 完成 + s2 运行中 → done 1，状态 running', () => {
    const v = deriveSocialView([
      ev(
        'social.stage:lifecycle',
        { stepId: 's1-mission-budget-eval', status: 'started' },
        1
      ),
      ev(
        'social.stage:lifecycle',
        { stepId: 's1-mission-budget-eval', status: 'completed' },
        2
      ),
      ev(
        'social.stage:lifecycle',
        { stepId: 's2-platform-probe', status: 'started' },
        3
      ),
    ]);
    expect(v.status).toBe('running');
    expect(v.stages).toHaveLength(SEEDED);
    expect(find(v, 's1-mission-budget-eval')).toMatchObject({
      label: '预算评估',
      status: 'done',
    });
    expect(find(v, 's2-platform-probe')).toMatchObject({
      label: '平台探测',
      status: 'running',
    });
    expect(v.progress).toEqual({ done: 1, total: SEEDED });
  });

  it('completed：mission:completed → 状态 completed', () => {
    const v = deriveSocialView([
      ev(
        'social.stage:lifecycle',
        { stepId: 's6-body-compose', status: 'completed' },
        1
      ),
      ev('social.mission:completed', { wallTimeMs: 1000 }, 2),
    ]);
    expect(v.status).toBe('completed');
    expect(v.completedAt).toBe(2);
    expect(find(v, 's6-body-compose')?.status).toBe('done');
  });

  it('failed：stage failed + mission:failed → 阶段失败 + mission 失败信息', () => {
    const v = deriveSocialView([
      ev(
        'social.stage:lifecycle',
        { stepId: 's8-publish-execute', status: 'failed', error: '账号未授权' },
        1
      ),
      ev('social.mission:failed', { message: '发布失败' }, 2),
    ]);
    expect(v.status).toBe('failed');
    expect(v.failedMessage).toBe('发布失败');
    expect(find(v, 's8-publish-execute')).toMatchObject({
      status: 'failed',
      error: '账号未授权',
    });
  });

  it('未知 stepId → humanize 兜底 + 追加到列表', () => {
    const v = deriveSocialView([
      ev(
        'social.stage:lifecycle',
        { stepId: 's99-some-new-stage', status: 'started' },
        1
      ),
    ]);
    expect(v.stages).toHaveLength(SEEDED + 1);
    expect(find(v, 's99-some-new-stage')?.label).toBe('some new stage');
  });

  it('roles 聚合：按阶段角色汇总状态', () => {
    const v = deriveSocialView([
      ev(
        'social.stage:lifecycle',
        { stepId: 's2-platform-probe', status: 'completed' },
        1
      ),
      ev(
        'social.stage:lifecycle',
        { stepId: 's6-body-compose', status: 'started' },
        2
      ),
    ]);
    expect(v.roles.find((r) => r.role === 'PlatformProbe')?.status).toBe(
      'done'
    );
    expect(v.roles.find((r) => r.role === 'Composer')?.status).toBe('working');
  });

  it('幂等：重复事件不重复建阶段', () => {
    const events = [
      ev(
        'social.stage:lifecycle',
        { stepId: 's1-mission-budget-eval', status: 'started' },
        1
      ),
      ev(
        'social.stage:lifecycle',
        { stepId: 's1-mission-budget-eval', status: 'started' },
        1
      ),
    ];
    expect(deriveSocialView(events).stages).toHaveLength(SEEDED);
  });
});

describe('deriveSocialView · agent 轨迹 + 成本', () => {
  it('agent:thought/action/observation → agents[] 带 trace/模型/工具', () => {
    const v = deriveSocialView([
      ev(
        'social.agent:thought',
        { agentId: 'a1', role: 'composer', text: '构思正文', modelId: 'gpt-x' },
        10
      ),
      ev(
        'social.agent:action',
        {
          agentId: 'a1',
          role: 'composer',
          toolId: 'web-search',
          input: { q: 'x' },
        },
        11
      ),
      ev(
        'social.agent:observation',
        {
          agentId: 'a1',
          role: 'composer',
          toolId: 'web-search',
          latencyMs: 120,
          tokensUsed: 50,
        },
        12
      ),
    ]);
    expect(v.agents).toHaveLength(1);
    const a = v.agents[0];
    expect(a.role).toBe('Composer'); // kebab → Pascal 归一化
    expect(a.modelId).toBe('gpt-x');
    expect(a.trace).toHaveLength(3);
    expect(agentTools(a)).toEqual(['web-search']);
    expect(latestThought(a)).toBe('构思正文');
    expect(socialAgentByRole(v, 'Composer')?.agentId).toBe('a1');
  });

  it('乱序：observation 先于 thought 到达 → trace 按 ts 排序', () => {
    const v = deriveSocialView([
      ev(
        'social.agent:observation',
        { agentId: 'a1', role: 'composer', toolId: 't', tokensUsed: 5 },
        200
      ),
      ev(
        'social.agent:thought',
        { agentId: 'a1', role: 'composer', text: '先思考' },
        100
      ),
    ]);
    const tss = v.agents[0].trace.map((t) => t.ts);
    expect(tss).toEqual([...tss].sort((x, y) => x - y));
    expect(v.agents[0].trace[0].kind).toBe('thought');
  });

  it('重放幂等：同序列 derive 两次结果 deepEqual', () => {
    const events = [
      ev(
        'social.stage:lifecycle',
        { stepId: 's6-body-compose', status: 'started' },
        1
      ),
      ev(
        'social.agent:thought',
        { agentId: 'a1', role: 'composer', text: 'x', modelId: 'm' },
        2
      ),
      ev(
        'social.agent:action',
        {
          agentId: 'a1',
          role: 'composer',
          toolId: 'web-search',
          input: { q: 1 },
        },
        3
      ),
      ev(
        'social.cost:tick',
        { stage: 's6', deltaTokens: 100, deltaCostUsd: 0.01 },
        4
      ),
    ];
    expect(deriveSocialView(events)).toEqual(deriveSocialView(events));
  });

  it('cost:tick：总量取 Math.max，byStage 按 stage 累加', () => {
    const v = deriveSocialView([
      ev(
        'social.cost:tick',
        {
          stage: 's3',
          deltaTokens: 100,
          deltaCostUsd: 0.01,
          tokensUsed: 100,
          costUsd: 0.01,
        },
        1
      ),
      ev(
        'social.cost:tick',
        {
          stage: 's3',
          deltaTokens: 50,
          deltaCostUsd: 0.005,
          tokensUsed: 150,
          costUsd: 0.015,
        },
        2
      ),
    ]);
    expect(v.cost.tokensUsed).toBe(150);
    expect(v.cost.byStage.find((s) => s.stage === 's3')?.tokensUsed).toBe(150);
  });

  it('安全：高危角色（publish-executor）thought/input/output 原文不入 trace，统计字段保留', () => {
    const v = deriveSocialView([
      ev(
        'social.agent:thought',
        { agentId: 'pe', role: 'publish-executor', text: 'token=SECRET' },
        1
      ),
      ev(
        'social.agent:action',
        {
          agentId: 'pe',
          role: 'publish-executor',
          toolId: 'browser',
          input: { url: 'x?token=SECRET' },
        },
        2
      ),
      ev(
        'social.agent:observation',
        {
          agentId: 'pe',
          role: 'publish-executor',
          toolId: 'browser',
          output: { cookie: 'SECRET' },
          tokensUsed: 3,
        },
        3
      ),
    ]);
    const a = socialAgentByRole(v, 'PublishExecutor');
    expect(a).toBeDefined();
    expect(a!.trace.find((t) => t.kind === 'thought')?.text).toBeUndefined();
    expect(a!.trace.find((t) => t.kind === 'action')?.input).toBeUndefined();
    const obs = a!.trace.find((t) => t.kind === 'observation');
    expect(obs?.output).toBeUndefined();
    expect(obs?.tokensUsed).toBe(3); // 统计字段保留
  });

  it('agent phase 兜底：无 lifecycle 时按角色阶段状态推断', () => {
    const v = deriveSocialView([
      ev(
        'social.stage:lifecycle',
        { stepId: 's6-body-compose', status: 'completed' },
        1
      ),
      ev(
        'social.agent:thought',
        { agentId: 'a1', role: 'composer', text: 'x' },
        2
      ),
    ]);
    expect(socialAgentByRole(v, 'Composer')?.phase).toBe('completed');
  });

  it('agent:lifecycle → 精确 phase / wallTime / iterations', () => {
    const v = deriveSocialView([
      ev(
        'social.agent:lifecycle',
        { agentId: 'a1', role: 'composer', phase: 'started' },
        100
      ),
      ev(
        'social.agent:lifecycle',
        {
          agentId: 'a1',
          role: 'composer',
          phase: 'completed',
          wallTimeMs: 2500,
          iterations: 3,
        },
        200
      ),
    ]);
    const a = socialAgentByRole(v, 'Composer');
    expect(a?.phase).toBe('completed');
    expect(a?.wallTimeMs).toBe(2500);
    expect(a?.iterations).toBe(3);
  });
});

describe('socialRoleLabel', () => {
  it('kebab 与 Pascal 均映射到中文标签', () => {
    expect(socialRoleLabel('composer')).toBe('撰稿');
    expect(socialRoleLabel('Composer')).toBe('撰稿');
    expect(socialRoleLabel('publish-executor')).toBe('发布执行');
  });
});
