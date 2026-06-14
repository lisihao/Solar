'use client';

import { useState, useCallback, useRef } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import {
  Bot,
  Plus,
  Pencil,
  Trash2,
  Power,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { Modal } from '@/components/ui/dialogs/Modal';
import { useAdminAgents, AgentConfig } from '@/hooks/domain/useAdminAgents';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { confirm } from '@/stores';
import { TruncatedCell } from '@/components/common/tables';

export default function AgentManagementPage() {
  const { t } = useTranslation();
  const {
    agents,
    loading,
    error,
    createAgent,
    updateAgent,
    deleteAgent,
    refreshAgents,
  } = useAdminAgents();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [formData, setFormData] = useState({
    agentId: '',
    name: '',
    description: '',
    agentType: 'reactive',
    domain: 'general',
    systemPrompt: '',
    tools: '',
    skills: '',
    modelType: '',
    enabled: true,
  });

  const resetForm = useCallback(() => {
    setFormData({
      agentId: '',
      name: '',
      description: '',
      agentType: 'reactive',
      domain: 'general',
      systemPrompt: '',
      tools: '',
      skills: '',
      modelType: '',
      enabled: true,
    });
  }, []);

  const isModalOpen = showCreateModal || editingAgent !== null;

  const closeModal = useCallback(() => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiGenerating(false);
    setShowCreateModal(false);
    setEditingAgent(null);
    resetForm();
  }, [resetForm]);

  const handleCreate = useCallback(async () => {
    await createAgent({
      agentId: formData.agentId,
      name: formData.name,
      description: formData.description || undefined,
      agentType: formData.agentType,
      domain: formData.domain,
      systemPrompt: formData.systemPrompt,
      tools: formData.tools
        ? formData.tools.split(',').map((s) => s.trim())
        : [],
      skills: formData.skills
        ? formData.skills.split(',').map((s) => s.trim())
        : [],
      modelType: formData.modelType || undefined,
      enabled: formData.enabled,
    });
    setShowCreateModal(false);
    resetForm();
  }, [formData, createAgent, resetForm]);

  const handleUpdate = useCallback(async () => {
    if (!editingAgent) return;
    await updateAgent(editingAgent.id, {
      name: formData.name,
      description: formData.description || undefined,
      systemPrompt: formData.systemPrompt,
      tools: formData.tools
        ? formData.tools.split(',').map((s) => s.trim())
        : [],
      skills: formData.skills
        ? formData.skills.split(',').map((s) => s.trim())
        : [],
      modelType: formData.modelType || undefined,
      enabled: formData.enabled,
    });
    setEditingAgent(null);
    resetForm();
  }, [editingAgent, formData, updateAgent, resetForm]);

  const handleEdit = useCallback((agent: AgentConfig) => {
    setEditingAgent(agent);
    setFormData({
      agentId: agent.agentId,
      name: agent.name,
      description: agent.description || '',
      agentType: agent.agentType,
      domain: agent.domain,
      systemPrompt: agent.systemPrompt,
      tools: agent.tools.join(', '),
      skills: agent.skills.join(', '),
      modelType: agent.modelType || '',
      enabled: agent.enabled,
    });
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (
        await confirm({
          title: 'Are you sure you want to delete this agent configuration?',
          type: 'danger',
        })
      ) {
        await deleteAgent(id);
      }
    },
    [deleteAgent]
  );

  const handleToggleEnabled = useCallback(
    async (agent: AgentConfig) => {
      await updateAgent(agent.id, { enabled: !agent.enabled });
    },
    [updateAgent]
  );

  const handleAiGenerate = useCallback(async () => {
    if (!formData.name.trim()) return;

    // Abort any in-flight request before starting a new one
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;

    setAiGenerating(true);
    try {
      const response = await fetch(`${config.apiUrl}/ai/simple-chat`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({
          message: [
            'You are an AI agent configuration expert.',
            `Generate a complete agent configuration for an agent named "${formData.name}"${formData.domain !== 'general' ? ` in the "${formData.domain}" domain` : ''}.`,
            'Return ONLY valid JSON (no markdown, no code fences) with these fields:',
            '- agentId: kebab-case identifier derived from the name',
            "- description: one-sentence description of the agent's purpose",
            "- systemPrompt: a detailed system prompt (2-4 paragraphs) defining the agent's role, capabilities, and behavior guidelines",
            '- tools: array of relevant tool names (e.g. ["web-search", "code-exec", "file-read"])',
            '- skills: array of relevant skill names (e.g. ["report-writing", "data-analysis"])',
            '- agentType: one of "reactive", "plan-based", or "hybrid"',
          ].join('\n'),
          stream: false,
        }),
      });

      if (!response.ok) return;

      const result = (await response.json()) as {
        data?: { content?: string; message?: string };
        content?: string;
        message?: string;
      };
      const data = result.data ?? result;
      const content: string = data.content || data.message || '';

      // Extract JSON from the response (handle potential markdown fences)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return;

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      setFormData((prev) => ({
        ...prev,
        agentId:
          typeof parsed.agentId === 'string' ? parsed.agentId : prev.agentId,
        description:
          typeof parsed.description === 'string'
            ? parsed.description
            : prev.description,
        systemPrompt:
          typeof parsed.systemPrompt === 'string'
            ? parsed.systemPrompt
            : prev.systemPrompt,
        tools: Array.isArray(parsed.tools)
          ? parsed.tools.join(', ')
          : prev.tools,
        skills: Array.isArray(parsed.skills)
          ? parsed.skills.join(', ')
          : prev.skills,
        agentType:
          typeof parsed.agentType === 'string' &&
          ['reactive', 'plan-based', 'hybrid'].includes(parsed.agentType)
            ? parsed.agentType
            : prev.agentType,
      }));
    } catch {
      // Silently fail — user can manually fill the form
    } finally {
      setAiGenerating(false);
    }
  }, [formData.name, formData.domain]);

  // Group agents by domain
  const groupedAgents = agents.reduce<Record<string, AgentConfig[]>>(
    (acc, agent) => {
      const domain = agent.domain || 'other';
      if (!acc[domain]) acc[domain] = [];
      acc[domain].push(agent);
      return acc;
    },
    {}
  );

  const inputClassName =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20';
  const labelClassName = 'mb-1.5 block text-sm font-medium text-gray-700';

  return (
    <AdminPageLayout
      title={t('admin.agents.title')}
      description={t('admin.agents.description')}
      icon={Bot}
      domain="ai"
    >
      <div className="space-y-6">
        {/* Header with Add button */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500">
            {agents.length} agent configuration{agents.length !== 1 ? 's' : ''}
          </div>
          <button
            onClick={() => {
              resetForm();
              setShowCreateModal(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            <Plus className="h-4 w-4" />
            Add Agent
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
            {error.message || 'Failed to load agent configurations'}
            <button
              onClick={() => {
                void refreshAgents();
              }}
              className="ml-2 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {loading && !agents.length && (
          <div className="flex items-center justify-center py-12 text-gray-500">
            Loading agent configurations...
          </div>
        )}

        {/* Agent list grouped by domain */}
        {Object.entries(groupedAgents).map(([domain, domainAgents]) => (
          <div key={domain} className="space-y-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
              {domain}
            </h3>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <Table className="w-full text-sm">
                <THead>
                  <Tr className="border-b border-gray-200 text-left text-gray-500">
                    <Th className="px-4 py-3 font-medium">Name</Th>
                    <Th className="px-4 py-3 font-medium">Agent ID</Th>
                    <Th className="px-4 py-3 font-medium">Type</Th>
                    <Th className="px-4 py-3 font-medium">Status</Th>
                    <Th className="px-4 py-3 text-right font-medium">
                      Actions
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {domainAgents.map((agent) => (
                    <Tr
                      key={agent.id}
                      className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                    >
                      <Td className="px-4 py-3">
                        <TruncatedCell
                          className="max-w-[200px] font-medium text-gray-900"
                          tooltip={agent.description || agent.name}
                        >
                          {agent.name}
                        </TruncatedCell>
                      </Td>
                      <Td className="font-mono px-4 py-3 text-xs text-gray-500">
                        <TruncatedCell className="font-mono max-w-[180px] text-xs text-gray-500">
                          {agent.agentId}
                        </TruncatedCell>
                      </Td>
                      <Td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {agent.agentType}
                        </span>
                      </Td>
                      <Td className="px-4 py-3">
                        <button
                          onClick={() => {
                            void handleToggleEnabled(agent);
                          }}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors ${
                            agent.enabled
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-gray-100 text-gray-500'
                          }`}
                        >
                          <Power className="h-3 w-3" />
                          {agent.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                      </Td>
                      <Td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleEdit(agent)}
                            className="rounded p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {!agent.isBuiltIn && (
                            <button
                              onClick={() => {
                                void handleDelete(agent.id);
                              }}
                              className="rounded p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-500"
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
        {!loading && agents.length === 0 && (
          <EmptyState
            icon={<Bot className="h-12 w-12" />}
            title="No agent configurations"
            description="Create your first agent configuration to get started."
            action={{
              label: 'Add Agent',
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
          onClose={closeModal}
          title={
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-violet-50 p-2">
                <Bot className="h-5 w-5 text-violet-600" />
              </div>
              <span>
                {editingAgent
                  ? 'Edit Agent Configuration'
                  : 'Create Agent Configuration'}
              </span>
            </div>
          }
          size="lg"
          footer={
            <>
              <button
                onClick={closeModal}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  void (editingAgent ? handleUpdate() : handleCreate());
                }}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500"
              >
                {editingAgent ? 'Save Changes' : 'Create Agent'}
              </button>
            </>
          }
        >
          <div className="space-y-4">
            {/* Name + AI Generate row */}
            <div>
              <label className={labelClassName}>Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      name: e.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder="e.g., Research Lead"
                />
                {!editingAgent && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleAiGenerate();
                    }}
                    disabled={aiGenerating || !formData.name.trim()}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-50 px-3 py-2 text-sm font-medium text-violet-600 transition-colors hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                    title="AI auto-fill agent configuration"
                  >
                    {aiGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    AI 生成
                  </button>
                )}
              </div>
            </div>

            {/* Agent ID (only for create) */}
            {!editingAgent && (
              <div>
                <label className={labelClassName}>Agent ID</label>
                <input
                  type="text"
                  value={formData.agentId}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      agentId: e.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder="e.g., research-lead"
                />
              </div>
            )}

            {/* Description */}
            <div>
              <label className={labelClassName}>Description</label>
              <input
                type="text"
                value={formData.description}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                className={inputClassName}
                placeholder="Optional description"
              />
            </div>

            {/* Agent Type & Domain */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Agent Type</label>
                <select
                  value={formData.agentType}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      agentType: e.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="reactive">Reactive</option>
                  <option value="plan-based">Plan-Based</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
              <div>
                <label className={labelClassName}>Domain</label>
                <select
                  value={formData.domain}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      domain: e.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="general">General</option>
                  <option value="research">Research</option>
                  <option value="writing">Writing</option>
                  <option value="coding">Coding</option>
                  <option value="slides">Slides</option>
                  <option value="social">Social</option>
                </select>
              </div>
            </div>

            {/* System Prompt */}
            <div>
              <label className={labelClassName}>System Prompt</label>
              <textarea
                value={formData.systemPrompt}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    systemPrompt: e.target.value,
                  }))
                }
                rows={4}
                className={`${inputClassName} resize-y`}
                placeholder="System prompt for this agent..."
              />
            </div>

            {/* Tools & Skills */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>
                  Tools{' '}
                  <span className="font-normal text-gray-400">
                    (comma-separated)
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.tools}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      tools: e.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder="web-search, code-exec"
                />
              </div>
              <div>
                <label className={labelClassName}>
                  Skills{' '}
                  <span className="font-normal text-gray-400">
                    (comma-separated)
                  </span>
                </label>
                <input
                  type="text"
                  value={formData.skills}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      skills: e.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder="slides-outline, report-writing"
                />
              </div>
            </div>

            {/* Model Type & Enabled */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClassName}>Model Type</label>
                <input
                  type="text"
                  value={formData.modelType}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      modelType: e.target.value,
                    }))
                  }
                  className={inputClassName}
                  placeholder="CHAT, REASONING, etc."
                />
              </div>
              <div className="flex items-end">
                <div className="flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                  <span className="text-sm font-medium text-gray-700">
                    Enabled
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        enabled: !prev.enabled,
                      }))
                    }
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      formData.enabled ? 'bg-green-500' : 'bg-gray-300'
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                        formData.enabled ? 'left-[22px]' : 'left-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Modal>
      </div>
    </AdminPageLayout>
  );
}
