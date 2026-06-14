/**
 * deriveSocialStages — 从 social mission events 派生 12 步 stage 进度
 *
 * social pipeline 跟 playground 完全不同（platform-probe / content-transform /
 * cover-craft / compose / publish 等），不能复用 playground 的 todo-ledger
 * （那套深绑 dimensions/findings/chapters 业务概念）。这里只扫 social 的
 * stage:lifecycle 事件 → 每个 stepId 的最新状态，喂统一的 StageStepper。
 *
 * 后端 SOCIAL_PIPELINE step id 见 social.config.ts。
 */

import {
  PiggyBank,
  Radar,
  FileText,
  Brain,
  Image,
  Layout,
  Sparkles,
  Send,
  RotateCw,
  ShieldCheck,
  Gavel,
  Database,
  type LucideIcon,
} from 'lucide-react';
import type {
  StageStepperItem,
  StageStepperStatus,
} from '@/components/common/mission-detail/StageStepper';
import type { PlaygroundEvent } from '@/hooks/features/useAgentPlaygroundStream';
import type { SocialStageView } from './derive-social';

const SOCIAL_STAGE_META: { id: string; short: string; Icon: LucideIcon }[] = [
  { id: 's1-mission-budget-eval', short: '预算闸门', Icon: PiggyBank },
  { id: 's2-platform-probe', short: '平台探测', Icon: Radar },
  { id: 's3-content-transform', short: '内容适配', Icon: FileText },
  { id: 's4-leader-assess-transform', short: 'Leader 初审', Icon: Brain },
  { id: 's5-cover-craft', short: '封面生成', Icon: Image },
  { id: 's6-body-compose', short: '正文编排', Icon: Layout },
  { id: 's7-polish-review', short: '润色复审', Icon: Sparkles },
  { id: 's8-publish-execute', short: '发布执行', Icon: Send },
  { id: 's8b-publish-retry', short: '发布重试', Icon: RotateCw },
  { id: 's9-publish-verify', short: '发布验证', Icon: ShieldCheck },
  { id: 's10-leader-signoff', short: 'Leader 签字', Icon: Gavel },
  { id: 's11-mission-persist', short: '落库归档', Icon: Database },
];

function stripNamespace(type: string): string {
  return type.includes('.') ? type.slice(type.indexOf('.') + 1) : type;
}

/**
 * 扫 events 算每个 stage 的状态。stage:lifecycle / stage:started /
 * stage:completed / stage:failed 都看 stepId（payload.stepId 或 payload.stage）。
 */
export function deriveSocialStages(
  events: PlaygroundEvent[]
): StageStepperItem[] {
  const statusByStep = new Map<string, StageStepperStatus>();

  for (const ev of events) {
    const t = stripNamespace(ev.type ?? '');
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    const stepId = (p.stepId as string) ?? (p.stage as string) ?? '';
    if (!stepId) continue;

    if (t === 'stage:lifecycle') {
      const status = p.status as string | undefined;
      if (status === 'started') statusByStep.set(stepId, 'in_progress');
      else if (status === 'completed') statusByStep.set(stepId, 'done');
      else if (status === 'failed') statusByStep.set(stepId, 'failed');
    } else if (t === 'stage:started') {
      statusByStep.set(stepId, 'in_progress');
    } else if (t === 'stage:completed') {
      statusByStep.set(stepId, 'done');
    } else if (t === 'stage:failed') {
      statusByStep.set(stepId, 'failed');
    }
  }

  return SOCIAL_STAGE_META.map((meta) => ({
    id: meta.id,
    short: meta.short,
    Icon: meta.Icon,
    status: statusByStep.get(meta.id) ?? 'pending',
  }));
}

/**
 * 从已派生的 SocialMissionView.stages 生成 stepper —— 实时事件 buffer 过期后（历史回看）
 * events 为空，改用 view.stages（已含持久化快照合成的阶段骨架）喂 stepper。
 */
export function deriveSocialStagesFromView(
  stages: SocialStageView[]
): StageStepperItem[] {
  const statusByStep = new Map(stages.map((s) => [s.stepId, s.status]));
  const toStepper: Record<SocialStageView['status'], StageStepperStatus> = {
    pending: 'pending',
    running: 'in_progress',
    done: 'done',
    failed: 'failed',
  };
  return SOCIAL_STAGE_META.map((meta) => ({
    id: meta.id,
    short: meta.short,
    Icon: meta.Icon,
    status: toStepper[statusByStep.get(meta.id) ?? 'pending'] ?? 'pending',
  }));
}
