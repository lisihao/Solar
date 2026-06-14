'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { Layers, Plus } from 'lucide-react';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { confirm } from '@/stores';
import { ScenarioCard, ScenarioTemplate, ScenarioRun } from './types';
import { SCENARIO_TEMPLATES } from './constants';
import { EditorModal } from './components/EditorModal';
import { TemplateCard } from './components/TemplateCard';
import { ScenarioCardItem } from './components/ScenarioCardItem';
import { useTranslation } from '@/lib/i18n';

import { logger } from '@/lib/utils/logger';
import { setVisibility } from '@/services/ai-simulation/api';
export default function AISimulationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [loading, setLoading] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioCard[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editing, setEditing] = useState<ScenarioCard | null>(null);
  const [seed, setSeed] = useState<ScenarioTemplate | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchScenarios = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiUrl}/simulation/scenarios`, {
        headers: { ...getAuthHeader() },
      });
      if (res.ok) {
        const json = await res.json();
        // Handle wrapped API response format {success: true, data: [...]}
        setScenarios(json.data || json || []);
      } else {
        setMessage(t('aiSimulation.error.loadFailed'));
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : t('aiSimulation.error.loadFailed');
      setMessage(message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) void fetchScenarios();
  }, [user]);

  // 检查是否有从edit页面跳转过来的编辑请求
  useEffect(() => {
    const editId = sessionStorage.getItem('editScenarioId');
    if (editId && scenarios.length > 0) {
      const scenarioToEdit = scenarios.find((s) => s.id === editId);
      if (scenarioToEdit) {
        setEditing(scenarioToEdit);
        setShowEditor(true);
        sessionStorage.removeItem('editScenarioId');
      }
    }
  }, [scenarios]);

  const latestRun = (s: ScenarioCard): ScenarioRun | null =>
    s.runs && s.runs.length > 0 ? s.runs[0] : null;

  const handleCreate = () => {
    setEditing(null);
    setSeed(null);
    setShowEditor(true);
  };

  const handleViewDetail = (scenario: ScenarioCard) => {
    router.push(`/ai-simulation/${scenario.id}`);
  };

  const handleEdit = (scenario: ScenarioCard, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditing(scenario);
    setSeed(null);
    setShowEditor(true);
  };

  const handleDelete = async (scenario: ScenarioCard, e: React.MouseEvent) => {
    e.stopPropagation();

    if (
      !(await confirm({
        title: t('aiSimulation.confirm.delete', { name: scenario.name }),
        type: 'danger',
      }))
    ) {
      return;
    }

    try {
      const res = await fetch(
        `${config.apiUrl}/simulation/scenarios/${scenario.id}`,
        {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
        }
      );

      if (res.ok) {
        setMessage(t('aiSimulation.success.deleted'));
        setTimeout(() => setMessage(null), 3000);
        await fetchScenarios();
      } else {
        setMessage(t('aiSimulation.error.deleteFailed'));
      }
    } catch (err) {
      logger.error('Failed to delete scenario:', err);
      setMessage(t('aiSimulation.error.deleteFailed'));
    }
  };

  const handleTemplate = (template: ScenarioTemplate) => {
    setEditing(null);
    setSeed(template);
    setShowEditor(true);
  };

  const handleEditorClose = () => {
    setShowEditor(false);
    setEditing(null);
    setSeed(null);
  };

  const handleEditorSaved = () => {
    setShowEditor(false);
    setEditing(null);
    setSeed(null);
    void fetchScenarios();
  };

  const handleVisibilityChange = async (
    scenario: ScenarioCard,
    next: 'PRIVATE' | 'SHARED' | 'PUBLIC'
  ) => {
    await setVisibility(scenario.id, next);
    void fetchScenarios();
  };

  if (authLoading) return null;

  if (!user) {
    return (
      <AppShell>
        <main className="flex-1 p-12">
          <div className="mx-auto max-w-3xl rounded-2xl border border-gray-100 bg-white p-10 text-center shadow-sm">
            <h2 className="text-2xl font-semibold text-gray-800">
              {t('aiSimulation.signIn.title')}
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {t('aiSimulation.signIn.description')}
            </p>
          </div>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/50 backdrop-blur-sm">
          <PageHeaderHero
            title={t('aiSimulation.title')}
            subtitle={t('aiSimulation.subtitle')}
            icon={
              <svg
                className="h-7 w-7 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                />
              </svg>
            }
            iconGradient="from-indigo-500 to-purple-600"
            iconShadowClass="shadow-indigo-500/25"
            actions={
              <button
                onClick={handleCreate}
                className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
              >
                <Plus className="h-5 w-5" />
                {t('aiSimulation.newSimulation')}
              </button>
            }
          />
        </div>

        <div className="px-8 py-6">
          {/* Templates */}
          <div className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {t('aiSimulation.templates.title')}
                </h2>
                <p className="text-xs text-gray-500">
                  {t('aiSimulation.templates.description')}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {SCENARIO_TEMPLATES.map((template) => (
                <TemplateCard
                  key={template.name}
                  template={template}
                  onClick={() => handleTemplate(template)}
                />
              ))}
            </div>
          </div>

          {/* Message */}
          {message && (
            <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
              {message}
            </div>
          )}

          {/* Scenarios */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {t('aiSimulation.scenarios.title')}
                </h2>
                <p className="text-xs text-gray-500">
                  {t('aiSimulation.scenarios.description')}
                </p>
              </div>
              <button
                onClick={() => void fetchScenarios()}
                className="text-xs text-gray-600 hover:text-gray-800"
              >
                {t('aiSimulation.refresh')}
              </button>
            </div>
            {loading ? (
              <div className="py-10 text-center text-sm text-gray-500">
                {t('aiSimulation.loading')}
              </div>
            ) : scenarios.length === 0 ? (
              <EmptyState
                icon={<Layers className="h-12 w-12" />}
                title={t('aiSimulation.scenarios.empty.title')}
                description={t('aiSimulation.scenarios.empty.description')}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {scenarios.map((s) => (
                  <ScenarioCardItem
                    key={s.id}
                    scenario={s}
                    latestRun={latestRun(s)}
                    onView={() => handleViewDetail(s)}
                    onEdit={(e) => handleEdit(s, e)}
                    onDelete={(e) => handleDelete(s, e)}
                    onVisibilityChange={(sc, next) =>
                      void handleVisibilityChange(sc, next)
                    }
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Editor Modal */}
      {showEditor && (
        <EditorModal
          scenario={editing}
          seed={seed}
          onClose={handleEditorClose}
          onSaved={handleEditorSaved}
        />
      )}
    </AppShell>
  );
}
