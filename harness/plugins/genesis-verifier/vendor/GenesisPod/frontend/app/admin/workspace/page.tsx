'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import clsx from 'clsx';
import AppShell from '@/components/layout/AppShell';
import { EmptyState } from '@/components/ui/states/EmptyState';
import {
  WorkspaceTaskSummary,
  WorkspaceTemplate,
  createWorkspaceTask,
  generateWorkspaceReport,
  getWorkspaceTask,
  listWorkspaceTemplates,
} from '@/services/workspace/api';
import {
  useReportWorkspace,
  useWorkspaceSync,
  useAIModels,
  pickPreferredModel,
  userHasBYOK,
} from '@/hooks';
import { ModelSelect } from '@/components/common/model-config/ModelSelect';
import { BYOKRequiredBanner } from '@/components/common/byok/BYOKRequiredBanner';
import ClientDate from '@/components/common/ClientDate';

const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED']);

function formatStatus(status: string) {
  switch (status) {
    case 'SUCCESS':
      return { label: '已完成', tone: 'success' as const };
    case 'FAILED':
      return { label: '失败', tone: 'danger' as const };
    case 'RUNNING':
      return { label: '执行中', tone: 'info' as const };
    default:
      return { label: '排队中', tone: 'muted' as const };
  }
}

function toneStyles(tone: 'success' | 'danger' | 'info' | 'muted') {
  switch (tone) {
    case 'success':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-100';
    case 'danger':
      return 'bg-red-50 text-red-700 border border-red-100';
    case 'info':
      return 'bg-blue-50 text-blue-700 border border-blue-100';
    default:
      return 'bg-gray-100 text-gray-600 border border-gray-200';
  }
}

// Helper to validate date - removed direct formatting to avoid hydration errors
function isValidDate(value?: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
}

function extractQuestion(parameters: WorkspaceTaskSummary['parameters']) {
  if (
    parameters &&
    typeof parameters === 'object' &&
    'question' in parameters
  ) {
    const value = parameters.question;
    if (typeof value === 'string') {
      return value;
    }
  }
  return '';
}

export default function WorkspacePage() {
  const router = useRouter();
  const { resources, removeResource, clearAll, maxResources } =
    useReportWorkspace();
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(
    new Set()
  );
  const previousResourceIdsRef = useRef<Set<string>>(new Set());
  const {
    workspace,
    ensureWorkspace,
    refresh: refreshWorkspace,
    syncing: syncingWorkspace,
    error: workspaceError,
    isEnabled: workspaceFeatureEnabled,
  } = useWorkspaceSync();

  const workspaceId = workspace?.id ?? null;

  // 动态获取 AI 模型列表
  const { models: aiModels } = useAIModels();

  const [templates, setTemplates] = useState<WorkspaceTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null
  );

  const [question, setQuestion] = useState('');
  const [model, setModel] = useState(''); // 将在 aiModels 加载后设置默认值

  // 设置默认 AI 模型 — 严格 BYOK：用户 key 模型优先（pickPreferredModel）
  useEffect(() => {
    if (aiModels.length > 0 && !model) {
      const defaultModel = pickPreferredModel(aiModels) || aiModels[0];
      setModel(defaultModel.modelId);
    }
  }, [aiModels, model]);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);

  const [taskStatuses, setTaskStatuses] = useState<
    Record<string, WorkspaceTaskSummary>
  >({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [previewTask, setPreviewTask] = useState<WorkspaceTaskSummary | null>(
    null
  );

  const [reportTitle, setReportTitle] = useState('');
  const [reportNotes, setReportNotes] = useState('');
  const [reportState, setReportState] = useState<
    'idle' | 'loading' | 'success' | 'error'
  >('idle');
  const [reportFeedback, setReportFeedback] = useState<string | null>(null);

  const previewTaskRef = useRef<string | null>(null);

  useEffect(() => {
    if (resources.length === 0) {
      router.push('/');
    }
  }, [resources.length, router]);

  useEffect(() => {
    if (!workspaceFeatureEnabled) {
      return;
    }

    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);

    listWorkspaceTemplates()
      .then((items) => {
        if (cancelled) return;
        setTemplates(items);
        if (!selectedTemplateId && items.length > 0) {
          setSelectedTemplateId(items[0].id);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : '模板加载失败';
        setTemplatesError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setTemplatesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceFeatureEnabled, selectedTemplateId]);

  useEffect(() => {
    if (!workspace) {
      setTaskStatuses({});
      setSelectedTaskId(null);
      setPreviewTask(null);
      return;
    }

    const updates: Record<string, WorkspaceTaskSummary> = {};
    for (const task of workspace.tasks) {
      updates[task.id] = task;
    }
    if (Object.keys(updates).length > 0) {
      setTaskStatuses((prev) => ({ ...updates, ...prev }));
    }
  }, [workspace]);

  useEffect(() => {
    setSelectedResourceIds((prev) => {
      const next = new Set<string>();
      const prevIds = previousResourceIdsRef.current;
      resources.forEach((resource) => {
        if (prev.has(resource.id)) {
          next.add(resource.id);
        } else if (!prevIds.has(resource.id)) {
          next.add(resource.id);
        }
      });
      return next;
    });
    previousResourceIdsRef.current = new Set(
      resources.map((resource) => resource.id)
    );
  }, [resources]);

  const tasks = useMemo(() => {
    const map = new Map<string, WorkspaceTaskSummary>();
    for (const task of workspace?.tasks ?? []) {
      map.set(task.id, task);
    }
    for (const task of Object.values(taskStatuses)) {
      map.set(task.id, task);
    }
    return Array.from(map.values()).sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      return bTime - aTime;
    });
  }, [workspace?.tasks, taskStatuses]);

  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskId(null);
      setPreviewTask(null);
      return;
    }
    if (selectedTaskId) {
      const current = tasks.find((task) => task.id === selectedTaskId);
      if (current) {
        const enriched = taskStatuses[current.id] ?? current;
        setPreviewTask(enriched);
        return;
      }
    }

    const newest = tasks[0];
    setSelectedTaskId(newest.id);
    setPreviewTask(taskStatuses[newest.id] ?? newest);
  }, [tasks, selectedTaskId, taskStatuses]);

  useEffect(() => {
    const task = previewTask;
    if (!task) {
      previewTaskRef.current = null;
      return;
    }

    if (previewTaskRef.current === task.id) {
      return;
    }

    previewTaskRef.current = task.id;

    const templateName =
      templates.find((tpl) => tpl.id === task.templateId)?.name ?? 'AI 报告';
    // Use a simple date format that doesn't cause hydration issues
    const dateStr = new Date().toISOString().split('T')[0];
    setReportTitle(`${templateName} - ${dateStr}`);
    const questionText = extractQuestion(task.parameters);
    setReportNotes(questionText);
    setReportState('idle');
    setReportFeedback(null);
  }, [previewTask, templates]);

  useEffect(() => {
    if (!workspaceId || !activeTaskId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const status = await getWorkspaceTask(workspaceId, activeTaskId);
        if (cancelled) return;
        setTaskStatuses((prev) => ({ ...prev, [status.id]: status }));
        if (selectedTaskId === status.id) {
          setPreviewTask(status);
        }
        if (TERMINAL_STATUSES.has(status.status)) {
          setActiveTaskId(null);
          await refreshWorkspace();
        } else {
          timer = setTimeout(poll, 3000);
        }
      } catch (error) {
        if (cancelled) return;
        timer = setTimeout(poll, 5000);
        const message =
          error instanceof Error ? error.message : '任务状态刷新失败';
        setTaskError(message);
      }
    };

    poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [workspaceId, activeTaskId, selectedTaskId, refreshWorkspace]);

  const handleSelectTask = async (taskId: string) => {
    if (!workspaceId) return;
    setSelectedTaskId(taskId);
    setTaskError(null);
    try {
      const status = await getWorkspaceTask(workspaceId, taskId);
      setTaskStatuses((prev) => ({ ...prev, [status.id]: status }));
      setPreviewTask(status);
      if (!TERMINAL_STATUSES.has(status.status)) {
        setActiveTaskId(status.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '获取任务失败';
      setTaskError(message);
    }
  };

  const selectedCount = selectedResourceIds.size;
  const allResourcesSelected =
    resources.length > 0 && selectedCount === resources.length;

  const toggleResourceSelection = (resourceId: string) => {
    setSelectedResourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(resourceId)) {
        next.delete(resourceId);
      } else {
        next.add(resourceId);
      }
      return next;
    });
  };

  const handleSelectAllResources = () => {
    setSelectedResourceIds(() => {
      if (resources.length === 0) {
        return new Set<string>();
      }

      if (allResourcesSelected) {
        return new Set<string>();
      }

      return new Set(resources.map((item) => item.id));
    });
  };

  const handleRemoveSelectedResources = () => {
    const ids = Array.from(selectedResourceIds);
    if (ids.length === 0) {
      return;
    }
    ids.forEach((id) => removeResource(id));
    setSelectedResourceIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const handleClearAllResources = () => {
    clearAll();
    setSelectedResourceIds(new Set());
    previousResourceIdsRef.current = new Set();
  };

  const handleCreateTask = async () => {
    if (!workspaceFeatureEnabled) {
      setTaskError('Workspace AI 功能未开启');
      return;
    }
    if (selectedResourceIds.size < 2) {
      setTaskError('请至少选择 2 个资源');
      return;
    }
    if (!selectedTemplateId) {
      setTaskError('请选择报告模板');
      return;
    }

    setCreatingTask(true);
    setTaskError(null);

    try {
      await ensureWorkspace();
      const latestWorkspaceId =
        workspaceId ?? useReportWorkspace.getState().workspaceId;
      if (!latestWorkspaceId) {
        throw new Error('工作区创建失败，请稍后重试');
      }

      const task = await createWorkspaceTask(latestWorkspaceId, {
        templateId: selectedTemplateId,
        model,
        question: question.trim() || undefined,
        resourceIds: Array.from(selectedResourceIds),
      });

      setTaskStatuses((prev) => ({ ...prev, [task.id]: task }));
      setSelectedTaskId(task.id);
      setPreviewTask(task);
      setActiveTaskId(task.id);
      setReportState('idle');
      setReportFeedback(null);
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : '任务创建失败';
      setTaskError(message);
    } finally {
      setCreatingTask(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!previewTask) {
      return;
    }

    setReportState('loading');
    setReportFeedback(null);

    try {
      await generateWorkspaceReport({
        taskId: previewTask.id,
        templateId: previewTask.templateId,
        userId: '557be1bd-62cb-4125-a028-5ba740b66aca',
        title: reportTitle.trim() || undefined,
        notes: reportNotes.trim() || undefined,
      });

      setReportState('success');
      setReportFeedback('报告已生成并保存到 Library 中');
      await refreshWorkspace();
    } catch (error) {
      const message = error instanceof Error ? error.message : '报告生成失败';
      setReportState('error');
      setReportFeedback(message);
    }
  };

  const renderTaskResult = () => {
    if (!previewTask) {
      return (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-500">
          选择一个任务以查看 AI 生成的结果。
        </div>
      );
    }

    if (previewTask.hasError && previewTask.error) {
      return (
        <div className="space-y-3 rounded-xl border border-red-100 bg-red-50 p-6 text-sm text-red-700">
          <div className="font-semibold">任务生成失败</div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-white/70 p-3 text-xs text-red-600">
            {JSON.stringify(previewTask.error, null, 2)}
          </pre>
          <p className="text-xs text-red-600">
            请调整问题或稍后重试，如持续失败请联系管理员。
          </p>
        </div>
      );
    }

    if (!previewTask.result) {
      return (
        <div className="rounded-xl border border-dashed border-blue-200 bg-blue-50 p-6 text-sm text-blue-700">
          任务正在执行中，生成结果将在完成后展示。您可以继续浏览其他任务或调整问题。
        </div>
      );
    }

    const result = previewTask.result as {
      summary?: string;
      overview?: string;
      sections?: Array<{ title?: string; content?: string }>;
    };

    const summary = result.summary ?? result.overview ?? '';
    const sections = Array.isArray(result.sections) ? result.sections : [];

    return (
      <div className="space-y-6">
        {summary && (
          <div>
            <h3 className="text-sm font-semibold text-gray-900">摘要</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">
              {summary}
            </p>
          </div>
        )}

        {sections.length > 0 && (
          <div className="space-y-5">
            {sections.map((section, index) => (
              <div
                key={`${section.title ?? index}`}
                className="rounded-lg border border-gray-100 bg-white p-4 shadow-sm"
              >
                <h4 className="text-sm font-semibold text-gray-900">
                  {section.title ?? `部分 ${index + 1}`}
                </h4>
                {section.content && (
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gray-700">
                    {section.content}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {!summary && sections.length === 0 && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-sm text-gray-600">
            AI 返回了未知结构的结果，请稍后再试或检查任务配置信息。
          </div>
        )}
      </div>
    );
  };

  if (!workspaceFeatureEnabled) {
    return (
      <AppShell>
        <div className="mx-auto flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <div className="rounded-full bg-gray-100 p-3 text-gray-500">
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900">
            Workspace AI 功能未开启
          </h1>
          <p className="text-sm text-gray-600">
            请联系系统管理员启用 `WORKSPACE_AI_V2_ENABLED`，或稍后再试。
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex-1 overflow-y-auto pb-16">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-8 py-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Workspace 多资源分析
              </h1>
              <p className="mt-2 text-sm text-gray-600">
                组织多份资源的洞察，配置 AI 任务生成结构化报告并沉淀到 Library。
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-700">
                当前勾选 {selectedCount}/{resources.length} · 容量上限{' '}
                {maxResources}
              </span>
              <button
                onClick={handleClearAllResources}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
              >
                清空资源
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto mt-10 grid max-w-7xl gap-8 px-8 xl:grid-cols-[320px,1fr,360px]">
          <section className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">
                  已选资源
                </h2>
                {syncingWorkspace && (
                  <span className="text-xs text-gray-500">同步中...</span>
                )}
              </div>
              <p className="mt-1 text-sm text-gray-500">
                勾选至少 2 个资源即可启动 Workspace AI 分析（最多支持{' '}
                {maxResources} 个资源）。
              </p>

              {workspaceError && (
                <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                  {workspaceError}
                </div>
              )}

              {resources.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-gray-500">
                  <div>
                    已勾选 {selectedCount}/{resources.length} · 总容量{' '}
                    {maxResources}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSelectAllResources}
                      className="rounded-md border border-gray-200 px-2.5 py-1 transition hover:border-gray-300 hover:text-gray-900"
                    >
                      {allResourcesSelected ? '取消全选' : '全选'}
                    </button>
                    <button
                      onClick={handleRemoveSelectedResources}
                      disabled={selectedCount === 0}
                      className="rounded-md border border-gray-200 px-2.5 py-1 transition hover:border-gray-300 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      移除选中
                    </button>
                  </div>
                </div>
              )}

              {resources.length === 0 ? (
                <EmptyState
                  size="sm"
                  title="暂未选择资源"
                  description="请返回首页挑选内容加入 Workspace"
                />
              ) : (
                <ul className="mt-6 space-y-3">
                  {resources.map((resource) => (
                    <li
                      key={resource.id}
                      className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50/60 p-3"
                    >
                      <input
                        type="checkbox"
                        checked={selectedResourceIds.has(resource.id)}
                        onChange={() => toggleResourceSelection(resource.id)}
                        className="mt-1 h-4 w-4 rounded border-gray-300 text-violet-500 focus:ring-violet-500"
                        aria-label={`选择资源 ${resource.title}`}
                      />
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-sm font-medium text-violet-600">
                        {resource.type.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {resource.title}
                        </p>
                        {resource.abstract && (
                          <p className="mt-1 line-clamp-2 text-xs text-gray-500">
                            {resource.abstract}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => removeResource(resource.id)}
                        className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white hover:text-red-500"
                        aria-label="移除资源"
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
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">
                历史报告
              </h2>
              {workspace?.reports?.length ? (
                <ul className="mt-4 space-y-3">
                  {workspace.reports.map((report) => (
                    <li
                      key={report.id}
                      className="rounded-lg border border-gray-100 bg-gray-50/60 p-3"
                    >
                      <div className="text-sm font-medium text-gray-900">
                        {report.title}
                      </div>
                      <div className="mt-1 text-xs text-gray-500">
                        模板：{report.template} ·{' '}
                        <ClientDate
                          date={report.createdAt}
                          format="datetime"
                          locale="zh-CN"
                          dateOptions={{
                            hour12: false,
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  尚未生成报告。完成 AI 任务后可将结果保存到 Library。
                </div>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    配置 AI 任务
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    选择模板与模型，提供分析问题，AI 将生成结构化结果。
                  </p>
                </div>
                <button
                  onClick={() => ensureWorkspace().catch(() => undefined)}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 transition hover:border-gray-300 hover:text-gray-900"
                >
                  重新同步
                </button>
              </div>

              {templatesError && (
                <div className="mt-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                  {templatesError}
                </div>
              )}

              <div className="mt-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-gray-900">报告模板</span>
                    {templatesLoading && (
                      <span className="text-xs text-gray-500">加载中...</span>
                    )}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    {templates.map((template) => (
                      <button
                        key={template.id}
                        onClick={() => setSelectedTemplateId(template.id)}
                        className={clsx(
                          'rounded-xl border p-4 text-left transition-shadow',
                          selectedTemplateId === template.id
                            ? 'border-violet-500 bg-violet-50 shadow-sm'
                            : 'border-gray-200 bg-white hover:border-red-300 hover:shadow'
                        )}
                      >
                        <div className="text-sm font-semibold text-gray-900">
                          {template.name}
                        </div>
                        <div className="mt-1 text-xs uppercase tracking-wide text-gray-400">
                          {template.category}
                        </div>
                        {template.description && (
                          <p className="mt-2 line-clamp-3 text-xs text-gray-600">
                            {template.description}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {aiModels.length > 0 && !userHasBYOK(aiModels) && (
                  <BYOKRequiredBanner />
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="font-medium text-gray-900">推理模型</span>
                    <ModelSelect
                      value={model}
                      onChange={setModel}
                      models={aiModels}
                      size="md"
                    />
                  </label>
                  <label className="flex flex-col gap-2 text-sm">
                    <span className="font-medium text-gray-900">
                      自定义问题（选填）
                    </span>
                    <input
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="明确希望 AI 聚焦的分析问题"
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                    />
                  </label>
                </div>

                {taskError && (
                  <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                    {taskError}
                  </div>
                )}

                <button
                  onClick={handleCreateTask}
                  disabled={
                    creatingTask || selectedCount < 2 || templates.length === 0
                  }
                  className={clsx(
                    'w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors',
                    creatingTask || selectedCount < 2 || templates.length === 0
                      ? 'cursor-not-allowed bg-violet-200 text-white'
                      : 'bg-violet-500 text-white hover:bg-violet-600'
                  )}
                >
                  {creatingTask ? '创建任务中...' : '启动 AI 分析'}
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-gray-900">
                  任务进度
                </h2>
                <button
                  onClick={() => refreshWorkspace().catch(() => undefined)}
                  className="text-xs text-gray-500 transition hover:text-gray-900"
                >
                  刷新
                </button>
              </div>
              {tasks.length === 0 ? (
                <div className="mt-4 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
                  暂无任务记录。创建新的 AI 任务即可在此查看进度。
                </div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {tasks.map((task) => {
                    const statusInfo = formatStatus(task.status);
                    return (
                      <li key={task.id}>
                        <button
                          onClick={() => handleSelectTask(task.id)}
                          className={clsx(
                            'w-full rounded-xl border p-4 text-left transition-shadow',
                            selectedTaskId === task.id
                              ? 'border-violet-500 bg-violet-50 shadow-sm'
                              : 'border-gray-200 bg-white hover:border-red-300 hover:shadow'
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-gray-900">
                                  {templates.find(
                                    (tpl) => tpl.id === task.templateId
                                  )?.name ?? task.templateId}
                                </span>
                                <span
                                  className={clsx(
                                    'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                                    toneStyles(statusInfo.tone)
                                  )}
                                >
                                  {statusInfo.label}
                                </span>
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                <ClientDate
                                  date={task.createdAt}
                                  format="datetime"
                                  locale="zh-CN"
                                  dateOptions={{
                                    hour12: false,
                                    month: '2-digit',
                                    day: '2-digit',
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  }}
                                />{' '}
                                · 模型 {task.model}
                              </div>
                              {extractQuestion(task.parameters) && (
                                <p className="mt-2 line-clamp-2 text-xs text-gray-600">
                                  Q: {extractQuestion(task.parameters)}
                                </p>
                              )}
                            </div>

                            <svg
                              className={clsx(
                                'h-5 w-5 text-gray-300 transition-transform',
                                selectedTaskId === task.id &&
                                  'rotate-90 text-violet-500'
                              )}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          <section className="space-y-6">
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">
                任务结果预览
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                查看 AI 输出内容，确认无误后生成正式报告。
              </p>

              <div className="mt-6">{renderTaskResult()}</div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">
                生成报告
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                填写报告信息并保存至 Library，可随时导出 Markdown/PDF。
              </p>

              <div className="mt-4 space-y-4">
                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium text-gray-900">报告标题</span>
                  <input
                    value={reportTitle}
                    onChange={(event) => setReportTitle(event.target.value)}
                    placeholder="如：AI 多资源对比分析报告"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm">
                  <span className="font-medium text-gray-900">
                    备注（选填）
                  </span>
                  <textarea
                    value={reportNotes}
                    onChange={(event) => setReportNotes(event.target.value)}
                    rows={3}
                    placeholder="记录本次任务的分析背景、重点关注点等"
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
                  />
                </label>

                {reportFeedback && (
                  <div
                    className={clsx(
                      'rounded-lg border p-3 text-sm',
                      reportState === 'success'
                        ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                        : 'border-red-100 bg-red-50 text-red-700'
                    )}
                  >
                    {reportFeedback}
                  </div>
                )}

                <button
                  onClick={handleGenerateReport}
                  disabled={
                    reportState === 'loading' ||
                    !previewTask ||
                    !previewTask.result ||
                    (reportTitle.trim().length === 0 &&
                      reportNotes.trim().length === 0)
                  }
                  className={clsx(
                    'w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors',
                    reportState === 'loading' ||
                      !previewTask ||
                      !previewTask.result
                      ? 'cursor-not-allowed bg-gray-200 text-gray-500'
                      : 'bg-gray-900 text-white hover:bg-gray-700'
                  )}
                >
                  {reportState === 'loading'
                    ? `${aiModels.find((m) => m.modelId === model)?.name || '模型'} 生成中...`
                    : '生成并保存报告'}
                </button>

                <p className="text-xs text-gray-500">
                  提示：报告会自动关联当前工作区和任务，后续可在 Library
                  中导出或重新生成。
                </p>
              </div>
            </div>
          </section>
        </main>
      </div>
    </AppShell>
  );
}
