/**
 * mergeStageProcessTrace.spec — T75 streaming merge logic 不变量
 *
 * 1. 无 canonical + 无 events → undefined
 * 2. 仅 canonical → 原样返回
 * 3. 仅 events 含目标 stage 的 agent → 派生出本地 reactTrace
 * 4. canonical + events 都有 → 合并 + dedupe (kind|ts|toolId)
 * 5. 不归属本 stage 的 agentId → 忽略
 * 6. leader 共享 agentId → first-stage-wins (s2-leader-plan)
 * 7. observation.latencyMs / tokensUsed 累计
 * 8. canonical 已有 aggregate fields → Math.max 保权威值
 */

import { describe, it, expect } from 'vitest';
import {
  mergeStageProcessTrace,
  type StageProcessTraceEventLike,
} from '../useStageProcessTrace';
import type { StageProcessTrace } from '@/lib/features/agent-playground/mission-presentation.types';

describe('mergeStageProcessTrace', () => {
  it('(1) 无 canonical + 无 events → undefined', () => {
    expect(
      mergeStageProcessTrace('s5-reconciler', [], undefined)
    ).toBeUndefined();
  });

  it('(2) 仅 canonical → 透传', () => {
    const canonical: StageProcessTrace = {
      stepCount: 3,
      reactTrace: [{ kind: 'thought', ts: 100, text: 'hi' }],
    };
    const out = mergeStageProcessTrace('s5-reconciler', [], canonical);
    expect(out?.reactTrace).toHaveLength(1);
    expect(out?.stepCount).toBe(3);
  });

  it('(3) 仅 events 命中 stage → 派生 local reactTrace', () => {
    const events: StageProcessTraceEventLike[] = [
      {
        type: 'playground.agent:thought',
        payload: { agentId: 'reconciler', text: 'scanning facts' },
        timestamp: 100,
      },
      {
        type: 'playground.agent:action',
        payload: { agentId: 'reconciler', toolId: 'web-search' },
        timestamp: 200,
      },
    ];
    const out = mergeStageProcessTrace('s5-reconciler', events, undefined);
    expect(out?.reactTrace).toHaveLength(2);
    expect(out?.reactTrace?.[0].kind).toBe('thought');
    expect(out?.reactTrace?.[1].toolId).toBe('web-search');
  });

  it('(4) canonical + events → merge + dedupe', () => {
    const canonical: StageProcessTrace = {
      reactTrace: [
        { kind: 'thought', ts: 100, text: 'committed' },
        { kind: 'action', ts: 200, toolId: 'web-search' },
      ],
    };
    const events: StageProcessTraceEventLike[] = [
      // 同一 (kind|ts|toolId) → 应被 dedupe
      {
        type: 'playground.agent:action',
        payload: { agentId: 'reconciler', toolId: 'web-search' },
        timestamp: 200,
      },
      // 新的 → 应保留
      {
        type: 'playground.agent:observation',
        payload: { agentId: 'reconciler', toolId: 'web-search', latencyMs: 50 },
        timestamp: 300,
      },
    ];
    const out = mergeStageProcessTrace('s5-reconciler', events, canonical);
    expect(out?.reactTrace).toHaveLength(3);
    const items = out?.reactTrace ?? [];
    expect(items[0].ts).toBe(100);
    expect(items[1].ts).toBe(200);
    expect(items[2].ts).toBe(300);
    expect(items[2].kind).toBe('observation');
  });

  it('(5) 不归属本 stage 的 agentId → 忽略', () => {
    const events: StageProcessTraceEventLike[] = [
      {
        type: 'playground.agent:thought',
        payload: { agentId: 'analyst', text: 'wrong stage' },
        timestamp: 100,
      },
    ];
    expect(
      mergeStageProcessTrace('s5-reconciler', events, undefined)
    ).toBeUndefined();
  });

  it('(6) leader 共享 agentId → first-stage-wins (s2-leader-plan)', () => {
    const events: StageProcessTraceEventLike[] = [
      {
        type: 'playground.agent:thought',
        payload: { agentId: 'leader', text: 'planning' },
        timestamp: 100,
      },
    ];
    const s2 = mergeStageProcessTrace('s2-leader-plan', events, undefined);
    expect(s2?.reactTrace).toHaveLength(1);

    const s10 = mergeStageProcessTrace('s10-leader-signoff', events, undefined);
    expect(s10).toBeUndefined();
  });

  it('(7) observation.latencyMs / tokensUsed 累计', () => {
    const events: StageProcessTraceEventLike[] = [
      {
        type: 'playground.agent:observation',
        payload: {
          agentId: 'reconciler',
          toolId: 'web-search',
          latencyMs: 200,
          tokensUsed: 50,
        },
        timestamp: 100,
      },
      {
        type: 'playground.agent:observation',
        payload: {
          agentId: 'reconciler',
          toolId: 'arxiv-search',
          latencyMs: 300,
          tokensUsed: 75,
        },
        timestamp: 200,
      },
    ];
    const out = mergeStageProcessTrace('s5-reconciler', events, undefined);
    expect(out?.totalDurationMs).toBe(500);
    expect(out?.totalTokens).toBe(125);
  });

  it('(8) merge takes max for aggregate fields (canonical 权威)', () => {
    const canonical: StageProcessTrace = {
      totalTokens: 1000,
      totalDurationMs: 2000,
      stepCount: 10,
    };
    const events: StageProcessTraceEventLike[] = [
      {
        type: 'playground.agent:observation',
        payload: {
          agentId: 'reconciler',
          toolId: 'web-search',
          latencyMs: 100,
          tokensUsed: 50,
        },
        timestamp: 100,
      },
    ];
    const out = mergeStageProcessTrace('s5-reconciler', events, canonical);
    expect(out?.totalTokens).toBe(1000);
    expect(out?.totalDurationMs).toBe(2000);
  });
});
