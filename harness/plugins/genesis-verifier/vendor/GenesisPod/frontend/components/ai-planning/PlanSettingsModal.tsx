'use client';

import { useState } from 'react';
import { Loader2, Info, Zap, Wrench } from 'lucide-react';
import Modal from '@/components/ui/dialogs/Modal';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils/common';
import type { PlanDetail } from '@/services/ai-planning/api';
import {
  PLANNING_ROLES_CONFIG,
  PLANNING_WORKFLOW_CONFIG,
} from '@/lib/constants/planning-roles';

interface PlanSettingsModalProps {
  open: boolean;
  onClose: () => void;
  plan: PlanDetail;
  onSave: (data: {
    name: string;
    goal: string;
    depth: string;
  }) => Promise<void>;
}

export function PlanSettingsModal({
  open,
  onClose,
  plan,
  onSave,
}: PlanSettingsModalProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(plan.name);
  const [goal, setGoal] = useState(plan.goal);
  const [depth, setDepth] = useState(plan.depth || 'standard');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave({ name, goal, depth });
      onClose();
    } catch {
      // error handled by parent
    } finally {
      setIsSaving(false);
    }
  };

  const depthOptions = [
    { value: 'quick', labelKey: 'aiPlanning.create.depthQuick' },
    { value: 'standard', labelKey: 'aiPlanning.create.depthStandard' },
    {
      value: 'comprehensive',
      labelKey: 'aiPlanning.create.depthComprehensive',
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('aiPlanning.settings.title')}
      subtitle={t('aiPlanning.settings.subtitle')}
      size="lg"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving || !name.trim() || !goal.trim()}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isSaving
              ? t('aiPlanning.settings.saving')
              : t('aiPlanning.settings.save')}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Section 1: Basic Info */}
        <section>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            {t('aiPlanning.settings.basicInfo')}
          </h4>
          <div className="mt-3 space-y-4">
            {/* Plan Name */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('aiPlanning.create.name')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder={t('aiPlanning.create.namePlaceholder')}
              />
            </div>

            {/* Plan Goal */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('aiPlanning.create.goal')}
              </label>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
                placeholder={t('aiPlanning.create.goalPlaceholder')}
              />
            </div>

            {/* Planning Depth */}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                {t('aiPlanning.create.depth')}
              </label>
              <div className="flex flex-wrap gap-3">
                {depthOptions.map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors',
                      depth === opt.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    )}
                  >
                    <input
                      type="radio"
                      name="depth"
                      value={opt.value}
                      checked={depth === opt.value}
                      onChange={(e) => setDepth(e.target.value)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        'h-3 w-3 rounded-full border-2',
                        depth === opt.value
                          ? 'border-blue-500 bg-blue-500'
                          : 'border-gray-300'
                      )}
                    />
                    {t(opt.labelKey)}
                  </label>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Team Config (read-only) */}
        <section>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            {t('aiPlanning.settings.teamConfig')}
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            {t('aiPlanning.settings.memberCount', {
              count: PLANNING_ROLES_CONFIG.length,
            })}
          </p>
          <div className="mt-3 space-y-2">
            {PLANNING_ROLES_CONFIG.map((role) => (
              <div
                key={role.key}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-semibold text-white',
                      role.gradient
                    )}
                  >
                    {role.key[0].toUpperCase()}
                  </div>
                  <span className="text-sm font-medium text-gray-900">
                    {t(`aiPlanning.roles.${role.nameKey}`)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {role.skills.map((skill) => (
                    <span
                      key={skill}
                      className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600"
                    >
                      <Zap className="h-2.5 w-2.5" />
                      {skill}
                    </span>
                  ))}
                  {role.tools.map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center gap-0.5 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-medium text-green-600"
                    >
                      <Wrench className="h-2.5 w-2.5" />
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
            <Info className="h-3.5 w-3.5" />
            {t('aiPlanning.settings.teamConfigHint')}
          </div>
        </section>

        {/* Section 3: Workflow Design (read-only) */}
        <section>
          <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-900">
            {t('aiPlanning.settings.workflowDesign')}
          </h4>
          <p className="mt-1 text-xs text-gray-500">
            {t('aiPlanning.settings.sequentialWorkflow')}
          </p>
          <div className="mt-3 space-y-1">
            {PLANNING_WORKFLOW_CONFIG.map((step, index) => {
              const agentNames = step.agentKeys
                .map((key) => {
                  const role = PLANNING_ROLES_CONFIG.find((r) => r.key === key);
                  return role ? t(`aiPlanning.roles.${role.nameKey}`) : key;
                })
                .join(' + ');

              return (
                <div key={step.phase}>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-medium text-gray-600">
                      {step.phase}
                    </span>
                    <span className="text-sm text-gray-700">
                      {t(`aiPlanning.phases.${step.key}`)}
                    </span>
                    <span className="text-xs text-gray-400">&rarr;</span>
                    <span className="text-xs text-gray-500">{agentNames}</span>
                    {step.parallel && (
                      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-600">
                        {t('aiPlanning.settings.parallelHint')}
                      </span>
                    )}
                  </div>
                  {index < PLANNING_WORKFLOW_CONFIG.length - 1 && (
                    <div className="ml-5 h-3 border-l border-dashed border-gray-300" />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-400">
            <Info className="h-3.5 w-3.5" />
            {t('aiPlanning.settings.workflowHint')}
          </div>
        </section>
      </div>
    </Modal>
  );
}

export default PlanSettingsModal;
