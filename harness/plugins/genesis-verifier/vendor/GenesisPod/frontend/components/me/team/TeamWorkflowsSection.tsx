'use client';

import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from '@/stores';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Button } from '@/components/ui/primitives/button';
import { Input } from '@/components/ui/form';
import {
  useCompanyStore,
  type WorkflowOrigin,
} from '@/stores/company/companyStore';
import {
  TeamResourceSection,
  type TeamResourceCard,
} from './TeamResourceSection';

function OriginBadge({ origin }: { origin: WorkflowOrigin }) {
  return origin === 'custom' ? (
    <span className="flex-shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700">
      自建
    </span>
  ) : (
    <span className="flex-shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500">
      市场
    </span>
  );
}

/**
 * 团队工作流 —— 私有 SOP 库：市场获取的副本 + 自建，统一可改名/编辑阶段/套用/删除。
 * design.md §5.3（M1 再接真实后端目录）。
 */
export function TeamWorkflowsSection() {
  const {
    teamWorkflows,
    teams,
    createTeam,
    setWorkflow,
    addCustomWorkflow,
    renameWorkflow,
    removeWorkflow,
  } = useCompanyStore();
  const [editId, setEditId] = useState<string | null>(null);

  const usageCount = (wfId: string) =>
    teams.filter((t) => t.workflowId === wfId).length;

  const cards: TeamResourceCard[] = teamWorkflows.map((wf) => ({
    id: wf.id,
    name: wf.name,
    category: wf.category,
    onRename: (name) => renameWorkflow(wf.id, name),
    badge: <OriginBadge origin={wf.origin} />,
    meta: wf.stages.map((s, i) => (
      <span key={`${s}-${i}`} className="inline-flex items-center gap-1.5">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
          {s}
        </span>
        {i < wf.stages.length - 1 && <span className="text-gray-300">→</span>}
      </span>
    )),
    usage: `${wf.teamSize} 人阵型 · 已被 ${usageCount(wf.id)} 个团队使用`,
    actions: (
      <>
        <button
          onClick={() => {
            void createTeam(`${wf.name}小组`).then((teamId) => {
              if (teamId) void setWorkflow(teamId, wf.id);
              toast.success(`已用「${wf.name}」套用出新团队`);
            });
          }}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus className="h-3.5 w-3.5" /> 套用
        </button>
        <button
          onClick={() => setEditId(wf.id)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
        >
          <Pencil className="h-3 w-3" /> 编辑
        </button>
        <button
          onClick={() => {
            void removeWorkflow(wf.id);
            toast.info(`已删除「${wf.name}」`);
          }}
          className="rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
          aria-label="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </>
    ),
  }));

  return (
    <>
      <TeamResourceSection
        kind="workflow"
        cards={cards}
        unitLabel="套工作流"
        marketLabel="工作流市场"
        hint="获取更多 SOP，或自建。"
        emptyTitle="还没有工作流"
        emptyDesc="去工作流市场获取，或自建一个"
        headerExtra={
          <button
            onClick={() => {
              void addCustomWorkflow().then((id) => {
                if (id) setEditId(id);
              });
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> 新建工作流
          </button>
        }
      />
      {editId && (
        <WorkflowEditModal
          workflowId={editId}
          onClose={() => setEditId(null)}
        />
      )}
    </>
  );
}

function WorkflowEditModal({
  workflowId,
  onClose,
}: {
  workflowId: string;
  onClose: () => void;
}) {
  const { teamWorkflows, renameWorkflow, updateWorkflow } = useCompanyStore();
  const wf = teamWorkflows.find((w) => w.id === workflowId);
  const [stagesText, setStagesText] = useState(wf ? wf.stages.join('、') : '');
  if (!wf) return null;

  const commitStages = (text: string) => {
    setStagesText(text);
    const stages = text
      .split(/[,，、]/)
      .map((s) => s.trim())
      .filter(Boolean);
    void updateWorkflow(workflowId, { stages });
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="编辑工作流"
      subtitle={wf.origin === 'custom' ? '自建工作流' : '市场获取（私有副本）'}
      footer={<Button onClick={onClose}>完成</Button>}
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            名称
          </label>
          <Input
            value={wf.name}
            onChange={(e) => void renameWorkflow(workflowId, e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            阶段（用顿号 / 逗号分隔）
          </label>
          <Input
            value={stagesText}
            onChange={(e) => commitStages(e.target.value)}
            placeholder="规划、执行、评审、汇总"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {wf.stages.map((s, i) => (
              <span
                key={`${s}-${i}`}
                className="inline-flex items-center gap-1.5"
              >
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {s}
                </span>
                {i < wf.stages.length - 1 && (
                  <span className="text-gray-300">→</span>
                )}
              </span>
            ))}
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">
            团队规模
          </label>
          <input
            type="number"
            min={1}
            max={12}
            value={wf.teamSize}
            onChange={(e) =>
              void updateWorkflow(workflowId, {
                teamSize: Math.max(1, Number(e.target.value) || 1),
              })
            }
            className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </div>
    </Modal>
  );
}

export default TeamWorkflowsSection;
