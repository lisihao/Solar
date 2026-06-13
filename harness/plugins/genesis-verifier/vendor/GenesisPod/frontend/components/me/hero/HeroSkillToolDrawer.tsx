'use client';

import {
  Sparkles,
  Wrench,
  Workflow,
  ShieldAlert,
  ShieldCheck,
  Eye,
} from 'lucide-react';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';
import { EmptyState } from '@/components/ui/states';
import { findListing } from '@/components/marketplace/marketplace.catalog';
import {
  TOOL_SOURCE_LABEL,
  type SkillListing,
  type ToolListing,
} from '@/components/marketplace/marketplace.types';

/** 工具副作用 → 中文标签 + 图标（只读 / 幂等写 / 破坏性）。 */
const SIDE_EFFECT_META: Record<
  string,
  { label: string; Icon: typeof Eye; cls: string }
> = {
  none: { label: '只读', Icon: Eye, cls: 'text-emerald-600' },
  idempotent: { label: '幂等写', Icon: ShieldCheck, cls: 'text-blue-600' },
  destructive: { label: '破坏性', Icon: ShieldAlert, cls: 'text-rose-600' },
};

interface Props {
  open: boolean;
  onClose: () => void;
  /** 专家显示名（抽屉标题用）。 */
  expertName: string;
  skillIds: string[];
  toolIds: string[];
  /** 工作流阶段（打法），focus='workflow' 时展示。 */
  stages?: string[];
  /** 聚焦展示：'skills' 技能 / 'tools' 工具 / 'workflow' 工作流 / 'all' 技能+工具（默认）。 */
  focus?: 'skills' | 'tools' | 'workflow' | 'all';
}

/**
 * HeroSkillToolDrawer —— 专家「技能与工具」只读详情抽屉（canonical SideDrawer）。
 * 技能展示：名称 + 说明 + 方法论正文预览（instructionsPreview）+ 可用工具白名单。
 * 工具展示：名称 + 来源（内置/MCP/OpenAPI）+ 副作用（只读/幂等写/破坏性）+ 说明。
 * 数据来自市场 catalog（findListing 反查）；catalog 缺项时降级显示原始 id。
 */
export function HeroSkillToolDrawer({
  open,
  onClose,
  expertName,
  skillIds,
  toolIds,
  stages = [],
  focus = 'all',
}: Props) {
  const showSkills = focus === 'all' || focus === 'skills';
  const showTools = focus === 'all' || focus === 'tools';
  const showWorkflow = focus === 'workflow';
  const skills = skillIds
    .map((id) => findListing(id))
    .filter((l): l is SkillListing => l?.kind === 'skill');
  const tools = toolIds
    .map((id) => findListing(id))
    .filter((l): l is ToolListing => l?.kind === 'tool');
  const missingSkills = skillIds.filter(
    (id) => !skills.some((s) => s.id === id)
  );
  const missingTools = toolIds.filter((id) => !tools.some((t) => t.id === id));
  const empty = showWorkflow
    ? stages.length === 0
    : (!showSkills || skillIds.length === 0) &&
      (!showTools || toolIds.length === 0);
  const title =
    focus === 'skills'
      ? `${expertName} · 技能`
      : focus === 'tools'
        ? `${expertName} · 工具`
        : focus === 'workflow'
          ? `${expertName} · 工作流`
          : `${expertName} · 技能与工具`;

  return (
    <SideDrawer open={open} onClose={onClose} title={title} widthPx={520}>
      {empty ? (
        <div className="p-6">
          <EmptyState
            type="noData"
            size="sm"
            title="暂无独立技能 / 工具"
            description="该专家按能力内置流程执行，无可单独装配的技能或工具。"
          />
        </div>
      ) : (
        <div className="space-y-6 p-5">
          {/* 工作流（打法） */}
          {showWorkflow && stages.length > 0 && (
            <section>
              <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <Workflow className="h-4 w-4 text-violet-500" />
                工作流
                <span className="text-xs font-normal text-gray-400">
                  {stages.length} 步
                </span>
              </div>
              <ol className="space-y-2">
                {stages.map((stage, i) => (
                  <li
                    key={`${stage}-${i}`}
                    className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-3"
                  >
                    <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700">
                      {i + 1}
                    </span>
                    <span className="text-sm text-gray-800">{stage}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* 技能 */}
          {showSkills && (skills.length > 0 || missingSkills.length > 0) && (
            <section>
              <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <Sparkles className="h-4 w-4 text-amber-500" />
                技能
                <span className="text-xs font-normal text-gray-400">
                  {skillIds.length}
                </span>
              </div>
              <div className="space-y-3">
                {skills.map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-gray-100 bg-gray-50/60 p-3"
                  >
                    <p className="text-sm font-medium text-gray-900">
                      {s.name}
                    </p>
                    {s.description && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {s.description}
                      </p>
                    )}
                    {s.instructionsPreview && (
                      <div className="mt-2 max-h-44 overflow-y-auto rounded-md bg-white p-2.5 ring-1 ring-gray-100">
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
                          {s.instructionsPreview}
                        </p>
                      </div>
                    )}
                    {s.allowedTools && s.allowedTools.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-xs text-gray-400">
                          可用工具：
                        </span>
                        {s.allowedTools.map((t) => (
                          <span
                            key={t}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {missingSkills.map((id) => (
                  <div
                    key={id}
                    className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-sm font-medium text-gray-700"
                  >
                    {id}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 工具 */}
          {showTools && (tools.length > 0 || missingTools.length > 0) && (
            <section>
              <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
                <Wrench className="h-4 w-4 text-blue-500" />
                工具
                <span className="text-xs font-normal text-gray-400">
                  {toolIds.length}
                </span>
              </div>
              <div className="space-y-2">
                {tools.map((t) => {
                  const se = SIDE_EFFECT_META[t.sideEffect];
                  const SeIcon = se?.Icon ?? Eye;
                  return (
                    <div
                      key={t.id}
                      className="rounded-lg border border-gray-100 bg-gray-50/60 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-gray-900">
                          {t.name}
                        </p>
                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                          {TOOL_SOURCE_LABEL[t.source]}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 text-xs ${se?.cls ?? 'text-gray-500'}`}
                        >
                          <SeIcon className="h-3 w-3" />
                          {se?.label ?? t.sideEffect}
                        </span>
                      </div>
                      {t.description && (
                        <p className="mt-0.5 text-xs text-gray-500">
                          {t.description}
                        </p>
                      )}
                    </div>
                  );
                })}
                {missingTools.map((id) => (
                  <div
                    key={id}
                    className="rounded-lg border border-gray-100 bg-gray-50/60 p-3 text-sm font-medium text-gray-700"
                  >
                    {id}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </SideDrawer>
  );
}

export default HeroSkillToolDrawer;
