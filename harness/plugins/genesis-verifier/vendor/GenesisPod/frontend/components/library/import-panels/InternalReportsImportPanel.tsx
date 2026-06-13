'use client';

/**
 * InternalReportsImportPanel
 *
 * 把 Playground mission 报告 / Topic Insight 报告作为 KB 文档导入。
 * 与 UrlImportPanel / NotionImportPanel 等同层，作为 KB 详情页的「添加文档」入口之一。
 *
 * UX：
 *   1. 2 个 tab：Playground / Topic Insight
 *   2. 每个 tab 内列出当前用户所有可导入的 mission / topic（默认最新版本）
 *   3. 多选 → 「导入选中 N 项」按钮
 *   4. 逐条 POST，进度统计 success / failed
 *
 * 2026-05-19 v1 简化：默认导入"最新"版本（POST 不带 version 字段）。
 * 用户要导入历史版本走 API 直调（service 已支持 version 参数）。
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  Loader2,
  XCircle,
  History,
  Lightbulb,
  RefreshCw,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { Tabs } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { logger } from '@/lib/utils/logger';

interface PlaygroundMissionRow {
  missionId: string;
  topic: string;
  status: string;
  completedAt: string | null;
  startedAt: string;
  finalScore: number | null;
  leaderSigned: boolean | null;
  reportTitle: string | null;
  versionCount: number;
  latestVersion: number;
}

interface TopicRow {
  topicId: string;
  name: string;
  type: string;
  status: string;
  lastRefreshAt: string | null;
  totalReports: number;
  latestReportVersion: number | null;
  latestGeneratedAt: string | null;
}

interface InternalReportsImportPanelProps {
  knowledgeBaseId: string;
  onImportComplete?: (count: number) => void;
  disabled?: boolean;
  /**
   * 限定单一源时（如 AddDocumentsDialog 的主页面已用卡片分流到两个子面板），
   * 传 'playground' 或 'topic'，组件不再渲染 tab 切换；不传 = 双 tab 模式。
   */
  mode?: 'playground' | 'topic';
}

type TabKey = 'playground' | 'topic';

export default function InternalReportsImportPanel({
  knowledgeBaseId,
  onImportComplete,
  disabled = false,
  mode,
}: InternalReportsImportPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>(mode ?? 'playground');
  const [missions, setMissions] = useState<PlaygroundMissionRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMissionIds, setSelectedMissionIds] = useState<Set<string>>(
    new Set()
  );
  const [selectedTopicIds, setSelectedTopicIds] = useState<Set<string>>(
    new Set()
  );
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: number;
    failed: { id: string; error: string }[];
  } | null>(null);

  // ─── Data fetchers ────────────────────────────────────────────────

  const fetchMissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(
        `${config.apiBaseUrl}/api/v1/rag/importable-playground-missions?limit=100`,
        { headers: getAuthHeader() }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const payload = (data?.data ?? data) as {
        missions?: PlaygroundMissionRow[];
      };
      setMissions(payload.missions ?? []);
    } catch (e) {
      logger.error('[InternalReportsImportPanel] fetchMissions failed', e);
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTopics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(
        `${config.apiBaseUrl}/api/v1/rag/importable-topic-reports?limit=100`,
        { headers: getAuthHeader() }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const payload = (data?.data ?? data) as { topics?: TopicRow[] };
      setTopics(payload.topics ?? []);
    } catch (e) {
      logger.error('[InternalReportsImportPanel] fetchTopics failed', e);
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'playground') void fetchMissions();
    else void fetchTopics();
  }, [activeTab, fetchMissions, fetchTopics]);

  // ─── Selection ────────────────────────────────────────────────────

  const toggleMission = useCallback((id: string) => {
    setSelectedMissionIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleTopic = useCallback((id: string) => {
    setSelectedTopicIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Import action ────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (disabled) return;
    setImporting(true);
    setImportResult(null);
    const result = {
      success: 0,
      failed: [] as { id: string; error: string }[],
    };

    if (activeTab === 'playground') {
      for (const missionId of selectedMissionIds) {
        try {
          const resp = await fetch(
            `${config.apiBaseUrl}/api/v1/rag/knowledge-bases/${knowledgeBaseId}/import-playground-mission`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
              },
              body: JSON.stringify({ missionId }),
            }
          );
          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            const message =
              (errData?.message as string) ||
              (errData?.data?.message as string) ||
              `HTTP ${resp.status}`;
            result.failed.push({ id: missionId, error: message });
          } else {
            result.success++;
          }
        } catch (e) {
          result.failed.push({
            id: missionId,
            error: e instanceof Error ? e.message : '网络错误',
          });
        }
      }
    } else {
      for (const topicId of selectedTopicIds) {
        try {
          const resp = await fetch(
            `${config.apiBaseUrl}/api/v1/rag/knowledge-bases/${knowledgeBaseId}/import-topic-report`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...getAuthHeader(),
              },
              body: JSON.stringify({ topicId }),
            }
          );
          if (!resp.ok) {
            const errData = await resp.json().catch(() => ({}));
            const message =
              (errData?.message as string) ||
              (errData?.data?.message as string) ||
              `HTTP ${resp.status}`;
            result.failed.push({ id: topicId, error: message });
          } else {
            result.success++;
          }
        } catch (e) {
          result.failed.push({
            id: topicId,
            error: e instanceof Error ? e.message : '网络错误',
          });
        }
      }
    }

    setImportResult(result);
    setImporting(false);
    if (result.success > 0) {
      // 清空已成功选中项 + 通知父级刷新 KB documents 列表
      if (activeTab === 'playground') setSelectedMissionIds(new Set());
      else setSelectedTopicIds(new Set());
      onImportComplete?.(result.success);
    }
  }, [
    activeTab,
    disabled,
    knowledgeBaseId,
    onImportComplete,
    selectedMissionIds,
    selectedTopicIds,
  ]);

  const selectedCount =
    activeTab === 'playground'
      ? selectedMissionIds.size
      : selectedTopicIds.size;

  // ─── Render ───────────────────────────────────────────────────────

  // standalone = 独立挂载（/library/rag 详情页）有外层卡片 + tab；
  // !standalone = 作为 AddDocumentsDialog 的子面板，外层 modal 已提供框架 + 标题，
  //               只渲染列表 + 操作栏
  const standalone = mode === undefined;

  return (
    <div
      className={
        standalone ? 'rounded-lg border border-gray-200 bg-white p-6' : ''
      }
    >
      {standalone && (
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">从内部报告导入</h3>
          <button
            type="button"
            onClick={() =>
              activeTab === 'playground'
                ? void fetchMissions()
                : void fetchTopics()
            }
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      )}

      {standalone && (
        <Tabs
          className="mb-4"
          items={[
            {
              key: 'playground',
              label: 'Playground 报告',
              iconNode: <Brain className="h-3.5 w-3.5" />,
              count: missions.length > 0 ? missions.length : undefined,
            },
            {
              key: 'topic',
              label: 'Topic Insight 报告',
              iconNode: <Lightbulb className="h-3.5 w-3.5" />,
              count: topics.length > 0 ? topics.length : undefined,
            },
          ]}
          value={activeTab}
          onChange={(k) => setActiveTab(k as TabKey)}
        />
      )}

      {/* Status / error */}
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <XCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* List */}
      <div className="max-h-96 overflow-y-auto rounded-md border border-gray-100">
        {loading && (
          <div className="flex items-center justify-center py-10 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!loading && activeTab === 'playground' && missions.length === 0 && (
          <EmptyState
            size="sm"
            title="还没有可导入的 Playground 报告"
            description="先在 Playground 完成一次 mission"
          />
        )}

        {!loading && activeTab === 'topic' && topics.length === 0 && (
          <EmptyState
            size="sm"
            title="还没有可导入的 Topic Insight 报告"
            description="先在 Topic Insight 生成一份报告"
          />
        )}

        {!loading &&
          activeTab === 'playground' &&
          missions.map((m) => (
            <MissionRow
              key={m.missionId}
              mission={m}
              checked={selectedMissionIds.has(m.missionId)}
              onToggle={() => toggleMission(m.missionId)}
              disabled={disabled || importing}
            />
          ))}

        {!loading &&
          activeTab === 'topic' &&
          topics.map((t) => (
            <TopicListRow
              key={t.topicId}
              topic={t}
              checked={selectedTopicIds.has(t.topicId)}
              onToggle={() => toggleTopic(t.topicId)}
              disabled={disabled || importing}
            />
          ))}
      </div>

      {/* Action bar */}
      <div className="mt-4 flex items-center justify-between">
        <div className="text-xs text-gray-500">
          {selectedCount > 0
            ? `已选 ${selectedCount} 项`
            : '勾选后导入最新版本'}
        </div>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={disabled || importing || selectedCount === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {importing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              导入中…
            </>
          ) : (
            <>
              <ChevronRight className="h-4 w-4" />
              导入选中 {selectedCount > 0 ? `(${selectedCount})` : ''}
            </>
          )}
        </button>
      </div>

      {/* Import result */}
      {importResult && (
        <div className="mt-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
          {importResult.success > 0 && (
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              成功导入 {importResult.success}{' '}
              份报告，请回到顶部点击"处理文档"生成向量
            </div>
          )}
          {importResult.failed.length > 0 && (
            <div className="mt-1">
              <div className="flex items-center gap-2 text-red-700">
                <XCircle className="h-4 w-4" />
                {importResult.failed.length} 份失败：
              </div>
              <ul className="ml-6 list-disc text-xs text-gray-600">
                {importResult.failed.slice(0, 5).map((f, i) => (
                  <li key={i}>
                    {f.id.slice(0, 8)}…: {f.error}
                  </li>
                ))}
                {importResult.failed.length > 5 && (
                  <li>… 还有 {importResult.failed.length - 5} 个</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────

function MissionRow({
  mission,
  checked,
  onToggle,
  disabled,
}: {
  mission: PlaygroundMissionRow;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const dt = mission.completedAt ?? mission.startedAt;
  const title = mission.reportTitle || mission.topic;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-start gap-3 border-b border-gray-100 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
        checked ? 'bg-violet-50' : 'hover:bg-gray-50'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-violet-600"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">
          {title}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
          <span>{new Date(dt).toLocaleDateString('zh-CN')}</span>
          {mission.finalScore != null && (
            <>
              <span>·</span>
              <span
                className={
                  mission.finalScore >= 80
                    ? 'text-emerald-600'
                    : mission.finalScore >= 60
                      ? 'text-amber-600'
                      : 'text-red-600'
                }
              >
                {mission.finalScore} 分
              </span>
            </>
          )}
          {mission.leaderSigned && (
            <>
              <span>·</span>
              <span className="text-emerald-600">已签字</span>
            </>
          )}
          {mission.versionCount > 1 && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5">
                <History className="h-3 w-3" />v{mission.latestVersion}（共{' '}
                {mission.versionCount} 版）
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}

function TopicListRow({
  topic,
  checked,
  onToggle,
  disabled,
}: {
  topic: TopicRow;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={`flex w-full items-start gap-3 border-b border-gray-100 px-3 py-2.5 text-left transition-colors last:border-b-0 ${
        checked ? 'bg-violet-50' : 'hover:bg-gray-50'
      } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
    >
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-violet-600"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-gray-900">
          {topic.name}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-500">
          <span>{topic.type}</span>
          {topic.lastRefreshAt && (
            <>
              <span>·</span>
              <span>
                {new Date(topic.lastRefreshAt).toLocaleDateString('zh-CN')} 刷新
              </span>
            </>
          )}
          {topic.latestReportVersion != null && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-0.5">
                <History className="h-3 w-3" />v{topic.latestReportVersion}（共{' '}
                {topic.totalReports} 版）
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
