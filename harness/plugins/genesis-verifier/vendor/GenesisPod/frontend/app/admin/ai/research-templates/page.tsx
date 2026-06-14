'use client';

import { useState, useCallback } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { FlaskConical, Plus, Pencil, Trash2, Copy, Power } from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { Modal } from '@/components/ui/dialogs/Modal';
import {
  useAdminResearchTemplates,
  ResearchTemplateConfig,
} from '@/hooks/domain/useAdminResearchTemplates';
import { confirm } from '@/stores';
import { TruncatedCell } from '@/components/common/tables';

export default function ResearchTemplatesPage() {
  const { t } = useTranslation();
  const {
    templates,
    loading,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    duplicateTemplate,
    refreshTemplates,
  } = useAdminResearchTemplates();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<ResearchTemplateConfig | null>(null);
  const [formData, setFormData] = useState({
    templateId: '',
    name: '',
    description: '',
    category: 'competitive_analysis',
    dimensions: '{}',
    dataSources: '',
    guidancePrompt: '',
    reportStructure: '',
    iterationCount: 3,
    enabled: true,
  });

  const resetForm = useCallback(() => {
    setFormData({
      templateId: '',
      name: '',
      description: '',
      category: 'competitive_analysis',
      dimensions: '{}',
      dataSources: '',
      guidancePrompt: '',
      reportStructure: '',
      iterationCount: 3,
      enabled: true,
    });
  }, []);

  const handleCreate = useCallback(async () => {
    try {
      const dimensions = JSON.parse(formData.dimensions);
      const reportStructure = formData.reportStructure
        ? JSON.parse(formData.reportStructure)
        : undefined;

      await createTemplate({
        templateId: formData.templateId,
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        dimensions,
        dataSources: formData.dataSources
          ? formData.dataSources.split(',').map((s) => s.trim())
          : [],
        guidancePrompt: formData.guidancePrompt || undefined,
        reportStructure,
        iterationCount: formData.iterationCount,
        enabled: formData.enabled,
      });
      setShowCreateModal(false);
      resetForm();
    } catch {
      // JSON parse error will be caught here
    }
  }, [formData, createTemplate, resetForm]);

  const handleUpdate = useCallback(async () => {
    if (!editingTemplate) return;
    try {
      const dimensions = JSON.parse(formData.dimensions);
      const reportStructure = formData.reportStructure
        ? JSON.parse(formData.reportStructure)
        : undefined;

      await updateTemplate(editingTemplate.id, {
        name: formData.name,
        description: formData.description || undefined,
        category: formData.category,
        dimensions,
        dataSources: formData.dataSources
          ? formData.dataSources.split(',').map((s) => s.trim())
          : [],
        guidancePrompt: formData.guidancePrompt || undefined,
        reportStructure,
        iterationCount: formData.iterationCount,
        enabled: formData.enabled,
      });
      setEditingTemplate(null);
      resetForm();
    } catch {
      // JSON parse error
    }
  }, [editingTemplate, formData, updateTemplate, resetForm]);

  const handleEdit = useCallback((template: ResearchTemplateConfig) => {
    setEditingTemplate(template);
    setFormData({
      templateId: template.templateId,
      name: template.name,
      description: template.description || '',
      category: template.category,
      dimensions: JSON.stringify(template.dimensions, null, 2),
      dataSources: template.dataSources.join(', '),
      guidancePrompt: template.guidancePrompt || '',
      reportStructure: template.reportStructure
        ? JSON.stringify(template.reportStructure, null, 2)
        : '',
      iterationCount: template.iterationCount,
      enabled: template.enabled,
    });
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (
        await confirm({
          title: 'Are you sure you want to delete this research template?',
          type: 'danger',
        })
      ) {
        await deleteTemplate(id);
      }
    },
    [deleteTemplate]
  );

  const handleDuplicate = useCallback(
    async (id: string) => {
      await duplicateTemplate(id);
    },
    [duplicateTemplate]
  );

  const handleToggleEnabled = useCallback(
    async (template: ResearchTemplateConfig) => {
      await updateTemplate(template.id, { enabled: !template.enabled });
    },
    [updateTemplate]
  );

  // Group templates by category
  const groupedTemplates = templates.reduce<
    Record<string, ResearchTemplateConfig[]>
  >((acc, template) => {
    const category = template.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(template);
    return acc;
  }, {});

  const isModalOpen = showCreateModal || editingTemplate !== null;

  return (
    <AdminPageLayout
      title={t('admin.researchTemplates.title')}
      description={t('admin.researchTemplates.description')}
      icon={FlaskConical}
      domain="ai"
    >
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-zinc-400">
            {templates.length} research template
            {templates.length !== 1 ? 's' : ''}
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            <Plus className="h-4 w-4" />
            Add Template
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400">
            {error.message || 'Failed to load research templates'}
            <button
              onClick={() => refreshTemplates()}
              className="ml-2 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading */}
        {loading && !templates.length && (
          <div className="flex items-center justify-center py-12 text-zinc-400">
            Loading research templates...
          </div>
        )}

        {/* Template list grouped by category */}
        {Object.entries(groupedTemplates).map(([category, catTemplates]) => (
          <div key={category} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-300">
              {category.replace(/_/g, ' ')}
            </h3>
            <div className="overflow-hidden rounded-lg border border-zinc-700/50 bg-zinc-800/50">
              <Table className="w-full table-fixed text-sm">
                <colgroup>
                  <col className="w-[26%]" />
                  <col className="w-[26%]" />
                  <col className="w-[10%]" />
                  <col className="w-[10%]" />
                  <col className="w-[12%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <THead>
                  <Tr className="border-b border-zinc-700/50 text-left text-zinc-400">
                    <Th className="px-4 py-3 font-medium">Name</Th>
                    <Th className="px-4 py-3 font-medium">Template ID</Th>
                    <Th className="px-4 py-3 font-medium">Iterations</Th>
                    <Th className="px-4 py-3 font-medium">Usage</Th>
                    <Th className="px-4 py-3 font-medium">Status</Th>
                    <Th className="px-4 py-3 text-right font-medium">
                      Actions
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {catTemplates.map((template) => (
                    <Tr
                      key={template.id}
                      className="border-b border-zinc-700/30 last:border-0 hover:bg-zinc-700/20"
                    >
                      <Td className="px-4 py-3">
                        <TruncatedCell
                          className="max-w-[200px] font-medium text-zinc-200"
                          tooltip={template.description || template.name}
                        >
                          {template.name}
                        </TruncatedCell>
                      </Td>
                      <Td className="font-mono px-4 py-3 text-xs text-zinc-400">
                        <TruncatedCell className="font-mono max-w-[180px] text-xs text-zinc-400">
                          {template.templateId}
                        </TruncatedCell>
                      </Td>
                      <Td className="px-4 py-3 text-zinc-400">
                        {template.iterationCount}
                      </Td>
                      <Td className="px-4 py-3 text-zinc-400">
                        {template.usageCount}
                      </Td>
                      <Td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleEnabled(template)}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                            template.enabled
                              ? 'bg-emerald-500/10 text-emerald-400'
                              : 'bg-zinc-700/50 text-zinc-500'
                          }`}
                        >
                          <Power className="h-3 w-3" />
                          {template.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </Td>
                      <Td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(template)}
                            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDuplicate(template.id)}
                            className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-zinc-700 hover:text-zinc-200"
                            title="Duplicate"
                          >
                            <Copy className="h-4 w-4" />
                          </button>
                          {!template.isBuiltIn && (
                            <button
                              onClick={() => handleDelete(template.id)}
                              className="rounded p-1.5 text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </div>
          </div>
        ))}

        {/* Empty state */}
        {!loading && templates.length === 0 && (
          <EmptyState
            icon={<FlaskConical className="h-12 w-12" />}
            title="No research templates"
            description="Create your first research template to get started."
            action={{
              label: 'Add Template',
              onClick: () => {
                resetForm();
                setShowCreateModal(true);
              },
            }}
          />
        )}

        {/* Create/Edit Modal */}
        <Modal
          open={isModalOpen}
          onClose={() => {
            setShowCreateModal(false);
            setEditingTemplate(null);
            resetForm();
          }}
          title={
            editingTemplate
              ? 'Edit Research Template'
              : 'Create Research Template'
          }
          size="lg"
          footer={
            <>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingTemplate(null);
                  resetForm();
                }}
                className="rounded-lg px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={editingTemplate ? handleUpdate : handleCreate}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
              >
                {editingTemplate ? 'Save Changes' : 'Create Template'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Template ID (only for create) */}
            {!editingTemplate && (
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-300">
                  Template ID
                </label>
                <input
                  type="text"
                  value={formData.templateId}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      templateId: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                  placeholder="e.g., competitive-analysis"
                />
              </div>
            )}

            {/* Name & Category */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-300">
                  Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                  placeholder="e.g., Competitive Analysis"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-300">
                  Category
                </label>
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      category: e.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                >
                  <option value="competitive_analysis">
                    Competitive Analysis
                  </option>
                  <option value="market_research">Market Research</option>
                  <option value="technology_evaluation">
                    Technology Evaluation
                  </option>
                  <option value="policy_analysis">Policy Analysis</option>
                  <option value="literature_review">Literature Review</option>
                  <option value="industry_analysis">Industry Analysis</option>
                  <option value="investment_research">
                    Investment Research
                  </option>
                  <option value="trend_forecast">Trend Forecast</option>
                  <option value="swot_analysis">SWOT Analysis</option>
                  <option value="risk_assessment">Risk Assessment</option>
                </select>
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">
                Description
              </label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                placeholder="Optional description"
              />
            </div>

            {/* Dimensions (JSON) */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">
                Dimensions (JSON)
              </label>
              <textarea
                value={formData.dimensions}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    dimensions: e.target.value,
                  }))
                }
                rows={4}
                className="font-mono w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                placeholder='{"dimensions": [...]}'
              />
            </div>

            {/* Data Sources */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">
                Data Sources (comma-separated)
              </label>
              <input
                type="text"
                value={formData.dataSources}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    dataSources: e.target.value,
                  }))
                }
                className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                placeholder="web, academic, hackernews"
              />
            </div>

            {/* Guidance Prompt */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">
                Guidance Prompt
              </label>
              <textarea
                value={formData.guidancePrompt}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    guidancePrompt: e.target.value,
                  }))
                }
                rows={3}
                className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                placeholder="Instructions for the AI researcher..."
              />
            </div>

            {/* Report Structure (JSON) */}
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-300">
                Report Structure (JSON, optional)
              </label>
              <textarea
                value={formData.reportStructure}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    reportStructure: e.target.value,
                  }))
                }
                rows={3}
                className="font-mono w-full resize-y rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                placeholder='{"sections": [...]}'
              />
            </div>

            {/* Iteration Count & Enabled */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-zinc-300">
                  Iteration Count
                </label>
                <input
                  type="number"
                  value={formData.iterationCount}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      iterationCount: parseInt(e.target.value, 10) || 3,
                    }))
                  }
                  min={1}
                  max={10}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
                />
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={formData.enabled}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        enabled: e.target.checked,
                      }))
                    }
                    className="rounded border-zinc-600 bg-zinc-800 text-violet-600 focus:ring-violet-500"
                  />
                  Enabled
                </label>
              </div>
            </div>
          </div>
        </Modal>
      </div>
    </AdminPageLayout>
  );
}
