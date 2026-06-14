import { describe, it, expect } from 'vitest';
import { deriveStages } from '../useWritingDerivedView';

/**
 * H3 回归：writing.stage:lifecycle 后端 payload 真实形状是
 *   { stage, stepId, primitive?, status: 'started'|'completed'|'failed' }
 * 之前 deriveStages 误读 payload.stageId / payload.phase（不存在）→ 每条事件
 * 被丢弃 → 进度面板永远空白。本测试把读对字段焊死，防回退。
 */
function ev(payload: Record<string, unknown>) {
  return { type: 'writing.stage:lifecycle', payload } as never;
}

describe('deriveStages (H3 payload-key contract)', () => {
  it('读真实 payload {stage,status} → 产出 stage view', () => {
    const stages = deriveStages(null, [
      ev({ stage: 's6-edit-polish', stepId: 'step-6', status: 'started' }),
      ev({ stage: 's6-edit-polish', stepId: 'step-6', status: 'completed' }),
    ]);
    expect(stages.length).toBe(1);
  });

  it('多个不同 stage 各自产出', () => {
    const stages = deriveStages(null, [
      ev({ stage: 's5-draft', stepId: 's5', status: 'completed' }),
      ev({ stage: 's6-edit-polish', stepId: 's6', status: 'started' }),
    ]);
    expect(stages.length).toBe(2);
  });

  it('旧错字段 {stageId,phase} 不再被识别（防回退到读错字段）', () => {
    const stages = deriveStages(null, [
      ev({ stageId: 's6', phase: 'completed' }),
    ]);
    expect(stages.length).toBe(0);
  });
});
