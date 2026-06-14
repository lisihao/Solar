'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import type {
  PlanTemplate,
  CreatePlanPayload,
} from '@/services/ai-planning/api';
import { Modal } from '@/components/ui/dialogs/Modal';

interface CreatePlanDialogProps {
  templates: PlanTemplate[];
  onClose: () => void;
  onCreate: (data: CreatePlanPayload) => Promise<void>;
  isCreating: boolean;
  /** Edit mode: pre-fill form with existing plan data */
  editMode?: {
    name: string;
    goal: string;
    onSave: (data: { name: string; goal: string }) => Promise<void>;
  };
}

const TEMPLATE_ICONS: Record<string, string> = {
  general:
    'M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z',
  marketing:
    'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
  product: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  event:
    'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  financial: 'M13 7h8m0 0v8m0-8l-8 8-4-4-6 6',
  insurance:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  academic:
    'M12 14l9-5-9-5-9 5 9 5zm0 0l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14zm-4 6v-7.5l4-2.222',
  career:
    'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
};

export default function CreatePlanDialog({
  templates,
  onClose,
  onCreate,
  isCreating,
  editMode,
}: CreatePlanDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(editMode?.name ?? '');
  const [goal, setGoal] = useState(editMode?.goal ?? '');
  const [selectedTemplate, setSelectedTemplate] = useState('general');
  const [depth, setDepth] = useState('standard');
  const [isSaving, setIsSaving] = useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !goal.trim()) return;
    if (editMode) {
      setIsSaving(true);
      try {
        await editMode.onSave({
          name: name.trim(),
          goal: goal.trim(),
        });
        onClose();
      } finally {
        setIsSaving(false);
      }
      return;
    }
    await onCreate({
      name: name.trim(),
      goal: goal.trim(),
      templateId: selectedTemplate,
      depth,
    });
  };

  const isSubmitting = editMode ? isSaving : isCreating;

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        editMode ? t('aiPlanning.edit.title') : t('aiPlanning.create.title')
      }
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            {t('aiTeams.create.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || !goal.trim() || isSubmitting}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {editMode
              ? isSaving
                ? t('aiPlanning.edit.saving')
                : t('aiPlanning.edit.save')
              : isCreating
                ? t('aiPlanning.create.creating')
                : t('aiPlanning.create.createButton')}
          </button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiPlanning.create.nameRequired')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('aiPlanning.create.namePlaceholder')}
            className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        {/* Goal */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            {t('aiPlanning.create.goalRequired')}
          </label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder={t('aiPlanning.create.goalPlaceholder')}
            rows={4}
            className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500"
          />
        </div>

        {/* Template Selection (create mode only) */}
        {!editMode && (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('aiPlanning.create.template')}
            </label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(templates.length > 0 ? templates : defaultTemplates()).map(
                (tmpl) => (
                  <button
                    key={tmpl.id}
                    type="button"
                    onClick={() => setSelectedTemplate(tmpl.id)}
                    className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
                      selectedTemplate === tmpl.id
                        ? 'border-amber-500 bg-amber-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                        selectedTemplate === tmpl.id
                          ? 'bg-amber-500 text-white'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d={TEMPLATE_ICONS[tmpl.id] || TEMPLATE_ICONS.general}
                        />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-gray-900">
                        {tmpl.name}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {tmpl.description}
                      </div>
                    </div>
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* Depth Selection (create mode only) */}
        {!editMode && (
          <div>
            <label className="block text-sm font-medium text-gray-700">
              {t('aiPlanning.create.depth')}
            </label>
            <div className="mt-2 flex gap-2">
              {(['quick', 'standard', 'comprehensive'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDepth(d)}
                  className={`flex-1 rounded-lg border-2 px-3 py-2 text-center text-sm font-medium transition-colors ${
                    depth === d
                      ? 'border-amber-500 bg-amber-50 text-amber-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t(
                    `aiPlanning.create.depth${d.charAt(0).toUpperCase() + d.slice(1)}`
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function defaultTemplates(): PlanTemplate[] {
  return [
    {
      id: 'general',
      name: 'General',
      description: 'General purpose planning',
      icon: 'lightbulb',
    },
    {
      id: 'marketing',
      name: 'Marketing',
      description: 'Marketing campaigns',
      icon: 'megaphone',
    },
    {
      id: 'product',
      name: 'Product',
      description: 'Product planning',
      icon: 'cube',
    },
    {
      id: 'event',
      name: 'Event',
      description: 'Event planning',
      icon: 'calendar',
    },
    {
      id: 'financial',
      name: 'Financial',
      description: 'Investment & asset allocation',
      icon: 'trending-up',
    },
    {
      id: 'insurance',
      name: 'Insurance',
      description: 'Insurance planning',
      icon: 'shield',
    },
    {
      id: 'academic',
      name: 'Academic',
      description: 'Academic planning',
      icon: 'graduation-cap',
    },
    {
      id: 'career',
      name: 'Career',
      description: 'Career development',
      icon: 'briefcase',
    },
  ];
}
