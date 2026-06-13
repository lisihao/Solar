'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  BookmarkCheck,
  Calendar,
  Clock,
  Coins,
  Cpu,
  Database,
  Download,
  FileText,
  GitCompareArrows,
  History,
  ImageIcon,
  Info,
  Layers,
  List,
  RefreshCw,
  Sparkles,
  Timer,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReportArtifact } from '@/lib/features/agent-playground/report-artifact.types';
import type { DimensionPipelineState } from '@/lib/features/agent-playground/mission-presentation.types';
import { ContinuousReader } from './ContinuousReader';
import { ChapterReader } from './ChapterReader';
import { QuickReader } from './QuickReader';
import { QualityBadge } from './QualityBadge';
import { FactTablePanel } from './FactTablePanel';
import { ReconciliationPanel } from './ReconciliationPanel';
import { ToolRecallTrace } from './ToolRecallTrace';
import { ExportDialog } from '@/components/common/dialogs/ExportDialog';
import { ReportVersionDrawer } from './ReportVersionDrawer';
import { SideDrawer } from '@/components/common/drawers/SideDrawer';

type ViewMode = 'continuous' | 'chapter' | 'quick';

interface Props {
  artifact: ReportArtifact;
  defaultView?: ViewMode;
  missionId?: string;
  reconciliationReport?: {
    factTable?: unknown[];
    conflicts?: {
      factIds: string[];
      resolutionType: 'kept-both' | 'preferred-one' | 'flagged-unresolved';
      rationale: string;
    }[];
    overlaps?: {
      dimensionPair?: [string, string];
      similarityScore?: number;
      overlappingClaim?: string;
      resolutionAction?: string;
    }[];
    gaps?: {
      dimensionId?: string;
      expectedAspects?: string[];
      severity?: 'critical' | 'minor';
    }[];
    reconciliationReport?: string;
    figureCandidates?: unknown[];
    deduplicationStats?: {
      duplicatesRemoved?: number;
      termVariantsUnified?: number;
      dataInconsistenciesFlagged?: number;
    };
    termGlossary?: { canonical: string; variants: string[] }[];
  };
  toolRecallEntries?: {
    agentId: string;
    role: string;
    recalledIds: readonly string[];
    categories: readonly string[];
    source: string;
    preferIds?: readonly string[];
  }[];
  /**
   * ★ 2026-04-30: 实时章节修订状态
   * 从 view.dimensionPipelines 传进来，让 chapter 视图能看到哪些章节正在
   * writing / reviewing / revising，避免章节卡永远显示"已完成"。
   */
  dimensionPipelines?: Map<string, DimensionPipelineState>;
  /**
   * ★ 2026-05-06: 报告版本列表（含当前选中 + 切换回调）。
   * 父组件（page）维护 list + currentVersion，切换时用 getReportVersion
   * 拉新版本 reportFull 替换 artifact prop。
   * undefined = 没接版本切换；2+ 版本时 MetaTabBody 显示下拉。
   */
  reportVersions?: ReportVersionMeta[];
  currentVersion?: number;
  onSelectVersion?: (version: number) => void;
  versionSwitching?: boolean;
}

export interface ReportVersionMeta {
  version: number;
  versionLabel: string | null;
  triggerType: string;
  generatedAt: string;
  finalScore: number | null;
  leaderSigned: boolean | null;
}

/**
 * 三视图统一入口（mission-pipeline-baseline.md §8）
 *
 * - 默认连续视图（continuous）
 * - 切换 chapter / quick 不改 URL，只改本地 state（保留位置感知留待后续迭代）
 */
export function ArtifactReader({
  artifact,
  defaultView = 'continuous',
  missionId,
  reconciliationReport,
  toolRecallEntries,
  dimensionPipelines,
  reportVersions,
  currentVersion,
  onSelectVersion,
  versionSwitching,
}: Props) {
  // ★ 2026-04-30: 收集所有正在修订/写作/评审的章节，给 ChapterReader 渲染状态徽标，
  //   并在工具栏下方加"修订中"banner。chapter:writing:started / chapter:revision /
  //   chapter:rewritten 事件触发 derive.ts 更新 dimensionPipelines.chapters[].status，
  //   这里反查得到 live status，避免章节卡永远停在"已完成"假象。
  const liveActivity = useMemo(() => {
    if (!dimensionPipelines || dimensionPipelines.size === 0) {
      return {
        revising: [] as {
          dim: string;
          idx: number;
          heading: string;
          status: string;
        }[],
      };
    }
    const revising: {
      dim: string;
      idx: number;
      heading: string;
      status: string;
    }[] = [];
    for (const [dim, p] of dimensionPipelines.entries()) {
      for (const ch of p.chapters) {
        if (
          ch.status === 'writing' ||
          ch.status === 'reviewing' ||
          ch.status === 'revising'
          // 'done' / 'failed-finalized' / 'passed' / 'failed' 已落地，不进修订列表
        ) {
          revising.push({
            dim,
            idx: ch.index,
            heading: ch.heading,
            status: ch.status,
          });
        }
      }
    }
    return { revising };
  }, [dimensionPipelines]);
  // ★ 2026-04-30 (#51 报告极简化): 元信息抽屉
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insightsTab, setInsightsTab] = useState<
    'quality' | 'meta' | 'fact' | 'recon' | 'tool'
  >('quality');
  // ★ 2026-05-07 学 TI 版本历史抽屉（替代 MetaTabBody 里的 select）
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  // ★ 2026-05-27 WYSIWYG 修复：lift 导出对话框 open state，给 hidden Continuous
  //   mirror 做 lazy mount —— 用户没点导出时，chapter / quick tab 下不需要双倍
  //   渲染 ContinuousReader；导出 dialog 打开时挂上 mirror 让 selector 命中。
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  // Phase P16-7: 视图切换持久到 URL hash
  // ★ 2026-05-27 Hydration 修复 (React #418/#423)：useState lazy initializer 不能读
  //   window.location.hash —— 服务端 typeof window === 'undefined' 永远 fallback 到
  //   defaultView；客户端读 hash 拿到 'chapter'/'quick'。两端 view 不同 → 渲染不同子
  //   组件 → DOM 不一致 → hydration fail。改为：初始永远用 defaultView，hash 同步走 effect。
  const [view, setView] = useState<ViewMode>(defaultView);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // mount 后立刻读 hash 并应用（只看初始 hash，不订阅 hashchange —— 用户在页内用
    // ViewBtn 切换走 setView 路径，已经会 push hash）
    const m = window.location.hash.match(/^#view=(continuous|chapter|quick)/);
    if (m?.[1] && m[1] !== view) setView(m[1] as ViewMode);
    // 仅在 mount 时执行；后续 view 变化由下面 effect 写回 hash
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const newHash = `#view=${view}`;
    if (window.location.hash !== newHash) {
      window.history.replaceState(null, '', newHash);
    }
  }, [view]);
  return (
    <div className="space-y-4">
      {/* Sticky 单条工具栏：视图切换 + 质量评分缩略 + 元信息 + 导出 */}
      <div className="sticky top-0 z-10 -mx-2 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white/95 px-2 py-2 backdrop-blur-sm">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
          <ViewBtn
            active={view === 'continuous'}
            onClick={() => setView('continuous')}
            icon={<BookOpen className="h-3.5 w-3.5" />}
          >
            连续视图
          </ViewBtn>
          <ViewBtn
            active={view === 'chapter'}
            onClick={() => setView('chapter')}
            icon={<List className="h-3.5 w-3.5" />}
          >
            章节视图
          </ViewBtn>
          <ViewBtn
            active={view === 'quick'}
            onClick={() => setView('quick')}
            icon={<Sparkles className="h-3.5 w-3.5" />}
          >
            快速视图
          </ViewBtn>
        </div>
        {/* ★ 2026-04-30 (#51): 工具栏右侧只保留 报告分析 / 导出 两个按钮，
            质量分数 / metadata / 事实表 / 对账 / 工具召回 全移到右侧 slide-over */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          <button
            type="button"
            onClick={() => {
              setInsightsTab('quality');
              setInsightsOpen(true);
            }}
            className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-100"
            title="查看质量评分 / 元信息 / 事实表 / 对账 / 工具召回"
          >
            <Info className="h-3.5 w-3.5" />
            <span className="font-medium">报告分析</span>
            <span
              className={`font-mono ml-1 font-bold ${
                artifact.quality.overall >= 80
                  ? 'text-emerald-600'
                  : artifact.quality.overall >= 65
                    ? 'text-amber-600'
                    : 'text-red-600'
              }`}
            >
              {artifact.quality.overall}
            </span>
          </button>
          {/* ★ 2026-05-07 版本历史按钮（学 TI TopicContentPanel:1544 sidePanelType='history'） */}
          {reportVersions && reportVersions.length > 0 && onSelectVersion && (
            <button
              type="button"
              onClick={() => setVersionPanelOpen(true)}
              className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-1 text-gray-700 ring-1 ring-gray-200 transition-colors hover:bg-gray-100"
              title="查看历史版本"
            >
              <History className="h-3.5 w-3.5" />
              <span className="font-medium">版本历史</span>
              <span className="font-mono ml-1 rounded bg-violet-100 px-1 text-[10.5px] font-bold text-violet-700">
                v{currentVersion ?? artifact.metadata.version}
              </span>
              {reportVersions.length > 1 && (
                <span className="ml-0.5 text-[10px] text-gray-500">
                  / {reportVersions.length}
                </span>
              )}
            </button>
          )}
          {missionId && (
            <ExportMenu
              missionId={missionId}
              title={artifact.metadata.topic}
              dialogOpen={exportDialogOpen}
              onDialogOpenChange={setExportDialogOpen}
            />
          )}
        </div>
      </div>

      {/* ★ 2026-04-30: 修订进行中 banner —— 用户能看到"哪些章节正在被改" */}
      {liveActivity.revising.length > 0 && (
        <div className="-mx-2 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-amber-600" />
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 font-medium">
              正在修订 {liveActivity.revising.length} 个章节 · Revising{' '}
              {liveActivity.revising.length} chapter
              {liveActivity.revising.length > 1 ? 's' : ''}
            </div>
            <div className="space-y-0.5 text-[11px] leading-relaxed text-amber-800/90">
              {liveActivity.revising.slice(0, 6).map((c, i) => {
                const statusLabel =
                  c.status === 'revising'
                    ? '修订中 · revising'
                    : c.status === 'reviewing'
                      ? '评审中 · reviewing'
                      : '写作中 · writing';
                return (
                  <div key={i} className="truncate">
                    <span className="font-mono mr-1.5 inline-block min-w-[2rem] rounded bg-amber-200/60 px-1 text-center text-amber-900">
                      {c.idx + 1}
                    </span>
                    <span className="text-amber-900">[{c.dim}]</span>{' '}
                    <span className="text-amber-800">{c.heading}</span>{' '}
                    <span className="text-[10px] text-amber-700">
                      ({statusLabel})
                    </span>
                  </div>
                );
              })}
              {liveActivity.revising.length > 6 && (
                <div className="text-[10px] text-amber-700">
                  …还有 {liveActivity.revising.length - 6} 个章节进行中
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ★ 2026-04-30 (#51): 主区只渲染报告正文 —— 元信息全在右侧抽屉 */}
      {view === 'continuous' && <ContinuousReader artifact={artifact} />}
      {view === 'chapter' && (
        <ChapterReader
          artifact={artifact}
          dimensionPipelines={dimensionPipelines}
        />
      )}
      {view === 'quick' && (
        <QuickReader
          artifact={artifact}
          onSwitchToFull={() => setView('continuous')}
        />
      )}

      {/*
        ★ 2026-05-27 WYSIWYG 修复（v2 lazy mount）：
        data-export-content="playground-report" 只挂在 ContinuousReader 根 div
        上；用户在 chapter / quick tab 下点导出，HtmlCaptureService 的
        querySelector 找不到该选择器，会静默 fallback 到 editable 模式
        （mission-transformer 编辑路径），旧 v1 row 拿不到 fullMarkdown 只剩
        reportSummary 摘要 → PDF / HTML 主体缺失。

        baseline a5fa48664 同样存在此 bug —— 之所以"基线好"是因为用户当时只
        在 Continuous tab 测过；切到 chapter / quick 也会观察到同症状。本修复
        彻底消除该路径，无回归概念，只是补一直没补的 bug。

        约定（语义诚实）：PDF / HTML 永远输出完整 Continuous 视图内容，不论
        当前 tab。三视图共享同一份 reportFull / canonical artifact，Continuous
        是 canonical 完整呈现；Chapter（章节列表 / 单章）与 Quick（精简卡片）
        属于浏览态便利视图，不作为导出源。按钮 tooltip 已对齐为"导出完整报告"。

        Lazy mount：mirror 只在 ExportDialog 打开时挂载，避免 chapter / quick
        tab 长报告浏览时双倍渲染开销（react-markdown + sup 解析 +
        renumberHeadings）。外层 opacity-0 / pointer-events-none 让 mirror 视觉
        无感；capture 时 getComputedStyle 只取被命中元素自身（root div opacity=1），
        clone + inlineCriticalStyles 不会带上外层 opacity 0。
      */}
      {view !== 'continuous' && exportDialogOpen && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 -z-10 w-full opacity-0"
        >
          <ContinuousReader artifact={artifact} />
        </div>
      )}

      {/* ★ 2026-04-30 (#51): 报告分析 slide-over —— 元信息抽屉 */}
      <SideDrawer
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        title="报告分析"
        widthPx={480}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1 text-[11px]">
            {(
              [
                { key: 'quality', label: '质量' },
                { key: 'meta', label: '元信息' },
                ...(artifact.factTable.length > 0
                  ? [{ key: 'fact', label: '事实表' } as const]
                  : []),
                ...(reconciliationReport
                  ? [{ key: 'recon', label: '对账' } as const]
                  : []),
                ...(toolRecallEntries && toolRecallEntries.length > 0
                  ? [{ key: 'tool', label: '工具召回' } as const]
                  : []),
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setInsightsTab(t.key)}
                className={
                  insightsTab === t.key
                    ? 'rounded-md bg-blue-50 px-2 py-1 font-medium text-blue-700 ring-1 ring-blue-200'
                    : 'rounded-md px-2 py-1 text-gray-600 hover:bg-gray-50'
                }
              >
                {t.label}
              </button>
            ))}
          </div>
          <div>
            {insightsTab === 'quality' && (
              <QualityTabBody artifact={artifact} />
            )}
            {insightsTab === 'meta' && (
              <MetaTabBody
                artifact={artifact}
                currentVersion={currentVersion}
              />
            )}
            {insightsTab === 'fact' && artifact.factTable.length > 0 && (
              <FactTablePanel
                factTable={artifact.factTable}
                citations={artifact.citations}
              />
            )}
            {insightsTab === 'recon' && reconciliationReport && (
              <ReconciliationPanel report={reconciliationReport} />
            )}
            {insightsTab === 'tool' &&
              toolRecallEntries &&
              toolRecallEntries.length > 0 && (
                <ToolRecallTrace entries={toolRecallEntries} />
              )}
          </div>
        </div>
      </SideDrawer>

      {/* ★ 2026-05-07 版本历史抽屉 —— 学 TI ReportRevisionHistory 卡片样式 */}
      {reportVersions && onSelectVersion && (
        <ReportVersionDrawer
          open={versionPanelOpen}
          versions={reportVersions}
          currentVersion={currentVersion}
          versionSwitching={versionSwitching}
          onSelectVersion={(v) => {
            onSelectVersion(v);
          }}
          onClose={() => setVersionPanelOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * ★ 2026-05-07 重构：彻底走 TI WYSIWYG 路径
 *
 * 1) 报告导出（PDF / HTML）→ 弹 ExportDialog（TI 同款）
 *    - HtmlCaptureService 抓 [data-export-content="playground-report"] 的 HTML+CSS
 *    - POST /api/export 带 renderMode=wysiwyg + wysiwygHtml + wysiwygCss
 *    - 后端 ExportOrchestrator 走 WysiwygRenderService → puppeteer page.pdf()
 *    → 输出完整 Continuous 视图（PDF / HTML 永远走完整报告，不论用户当前 tab；
 *       chapter / quick 是浏览便利视图，不作为导出源 —— Continuous DOM 在
 *       chapter / quick 下通过 hidden mirror 维持可用，由 ArtifactReader 控制 lazy mount）
 *
 * 2) DOCX / PPTX 已删（用户要求暂不支持）：availableFormats={['PDF','HTML']} 限制
 *
 * 3) 原始数据（Markdown / CSV / JSON）保留为次要二级菜单 —— 这是 playground 独有的
 *    "原始数据"通道（事实表 / 引用表 / 完整 JSON），TI 没有对等能力。
 */
function ExportMenu({
  missionId,
  title,
  dialogOpen,
  onDialogOpenChange,
}: {
  missionId: string;
  title: string;
  /**
   * ★ 2026-05-27 WYSIWYG 修复 (v2): 报告导出对话框 open state 由父级 ArtifactReader
   *   控制 —— 父级要据此 lazy mount hidden Continuous mirror，让 chapter / quick
   *   tab 下导出也能命中 data-export-content selector。
   */
  dialogOpen: boolean;
  onDialogOpenChange: (open: boolean) => void;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // 同步导出 —— playground 独有的"原始数据"通道（Markdown/CSV/JSON 即取即用）
  const handleSyncExport = async (format: string) => {
    setRawOpen(false);
    setBusy(format);
    try {
      const { config } = await import('@/lib/utils/config');
      const { getAuthHeader } = await import('@/lib/utils/auth');
      const url = `${config.apiBaseUrl}/api/v1/playground/missions/${missionId}/export?format=${format}`;
      const resp = await fetch(url, { headers: getAuthHeader() });
      if (!resp.ok) throw new Error(`Export failed: ${resp.status}`);
      const data = await resp.json();
      const payload = (data?.data ?? data) as {
        filename: string;
        mimeType: string;
        content: string;
      };
      const blob = new Blob([payload.content], { type: payload.mimeType });
      const a = document.createElement('a');
      const objUrl = URL.createObjectURL(blob);
      a.href = objUrl;
      a.download = payload.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('export failed', e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1">
        {/* 主按钮：报告导出（PDF / HTML，永远输出完整 Continuous 视图） */}
        <button
          type="button"
          onClick={() => onDialogOpenChange(true)}
          disabled={busy != null}
          className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          title="导出完整报告（PDF / HTML，输出 Continuous 视图全文，不论当前 tab）"
        >
          <Download className="h-3 w-3" />
          导出报告
        </button>

        {/* 次按钮：原始数据（playground 独有） */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setRawOpen((v) => !v)}
            disabled={busy != null}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="原始数据（Markdown / CSV / JSON）"
          >
            <FileText className="h-3 w-3" />
            {busy ? `导出中…(${busy})` : '原始数据'}
          </button>
          {rawOpen && (
            <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              <button
                type="button"
                onClick={() => void handleSyncExport('markdown')}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                完整 Markdown
              </button>
              <button
                type="button"
                onClick={() => void handleSyncExport('csv-facts')}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                事实表 CSV
              </button>
              <button
                type="button"
                onClick={() => void handleSyncExport('csv-citations')}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                引用表 CSV
              </button>
              <button
                type="button"
                onClick={() => void handleSyncExport('json')}
                className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
              >
                完整 JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {/* WYSIWYG 报告导出对话框 —— PDF / HTML 走 puppeteer 截屏，
          DOCX / PPTX 用 availableFormats 屏蔽（用户要求暂不支持） */}
      <ExportDialog
        isOpen={dialogOpen}
        onClose={() => onDialogOpenChange(false)}
        contentSelector='[data-export-content="playground-report"]'
        contentTitle={title?.trim() || 'Mission Report'}
        moduleType="playground"
        sourceId={missionId}
        availableFormats={['PDF', 'HTML']}
      />
    </>
  );
}

function ViewBtn({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-violet-100 text-violet-700'
          : 'text-gray-600 hover:bg-gray-50'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/* ============================================================
 * 报告分析 slide-over —— 紧凑版面（专为 480px 窄面板设计）
 *   2026-05-06 重构：原来塞了主区域用的 ReportHeroStrip 6-cell grid，
 *   在 sidebar 里挤成一坨。换成单列 stat row + 版本徽章。
 * ============================================================ */

const VERDICT_LABEL: Record<
  string,
  { label: string; tone: string; hint: string }
> = {
  excellent: {
    label: '优秀',
    tone: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    hint: '10 维全部达标，可直接交付。',
  },
  good: {
    label: '良好',
    tone: 'bg-blue-50 text-blue-700 ring-blue-200',
    hint: '主要维度通过，少量提醒可酌情处理。',
  },
  acceptable: {
    label: '合格',
    tone: 'bg-amber-50 text-amber-700 ring-amber-200',
    hint: '基本可用，建议针对弱项补强后再交付。',
  },
  poor: {
    label: '不达标',
    tone: 'bg-red-50 text-red-700 ring-red-200',
    hint: '存在硬卡违规或严重弱项，建议 rerun。',
  },
};

function QualityTabBody({ artifact }: { artifact: ReportArtifact }) {
  const verdict = artifact.quality.finalVerdict;
  const v = verdict ? VERDICT_LABEL[verdict] : undefined;
  return (
    <div className="space-y-3">
      {v && (
        <div
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12px] ring-1 ${v.tone}`}
        >
          <span className="mt-0.5 inline-flex h-5 items-center rounded px-1.5 text-[11px] font-semibold">
            {v.label}
          </span>
          <span className="leading-relaxed">{v.hint}</span>
        </div>
      )}
      <QualityBadge quality={artifact.quality} defaultOpen />
    </div>
  );
}

const TRIGGER_LABEL: Record<string, string> = {
  initial: '首次生成',
  'rerun-fresh': '全量重跑',
  'rerun-incremental': '增量重跑',
  'todo-rerun': 'Todo 修订',
};

const SEARCH_TIME_RANGE_LABEL: Record<string, string> = {
  '30d': '1 个月',
  '90d': '3 个月',
  '180d': '6 个月',
  '365d': '12 个月',
  '730d': '24 个月',
  all: '不限',
};

function MetaTabBody({
  artifact,
  currentVersion,
}: {
  artifact: ReportArtifact;
  currentVersion?: number;
}) {
  const m = artifact.metadata;
  // ★ 2026-05-07：版本切换器已移到顶部工具栏 → ReportVersionDrawer 抽屉。
  //   元信息 tab 只展示"当前版本"徽章，避免双源（feedback_no_dual_sources）。
  const selectedVersion = currentVersion ?? m.version;
  // ★ 2026-05-27 Hydration 修复 (React #418)：原本用 d.getFullYear()/Month/Date/Hours
  //   会按运行时本地时区格式化 —— Node 服务端通常是 UTC，客户端是 GMT+8 → 同一 ISO
  //   产出不同字符串 → hydration mismatch。改为直接切 ISO 串前 16 位（YYYY-MM-DDTHH:MM）
  //   再把 T 换成空格，结果只依赖 ISO 字符串本身，与时区无关。
  const generatedAt =
    typeof m.generatedAt === 'string' && m.generatedAt.length >= 16
      ? m.generatedAt.slice(0, 16).replace('T', ' ')
      : m.generatedAt;
  const tokens = m.totalTokens.total;
  const cost = (m.costCents / 100).toFixed(2);
  const seconds = Math.round(m.generationTimeMs / 1000);
  const wordValue =
    m.wordCount >= 1000
      ? `${(m.wordCount / 1000).toFixed(1)}k`
      : String(m.wordCount);

  // changesFromPrev 来自 ReportArtifact metadata（有的话），不是来自 mission_report_versions 表
  const changeCount = m.changesFromPrev?.length ?? 0;

  return (
    <div className="space-y-4">
      {/* 版本头部条 */}
      <div className="rounded-lg border border-gray-200 bg-gradient-to-r from-violet-50/40 to-sky-50/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono inline-flex items-center rounded-md bg-violet-100 px-2 py-0.5 text-[12px] font-bold text-violet-800">
            v{selectedVersion}
          </span>
          {m.versionLabel && (
            <span className="rounded-md bg-gray-100 px-1.5 py-0.5 text-[10.5px] text-gray-700">
              {m.versionLabel}
            </span>
          )}
          {m.isIncremental && (
            <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700">
              <GitCompareArrows className="h-2.5 w-2.5" />
              增量
            </span>
          )}
          {changeCount > 0 && (
            <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10.5px] text-amber-800">
              vs 前一版：{changeCount} 处变更
            </span>
          )}
        </div>
        <p className="mt-1.5 line-clamp-2 text-[12px] font-medium text-gray-800">
          {m.topic}
        </p>

        <p className="mt-0.5 text-[11px] text-gray-500">
          点击顶部「版本历史」按钮查看 / 切换历史版本
        </p>
      </div>

      {/* 内容统计 */}
      <StatGroup title="内容统计">
        <StatRow Icon={FileText} label="总字数" value={wordValue} />
        <StatRow
          Icon={Layers}
          label="章节数"
          value={artifact.sections.length}
        />
        <StatRow Icon={BookmarkCheck} label="引用源" value={m.sourceCount} />
        <StatRow Icon={ImageIcon} label="图表" value={m.figureCount} />
        <StatRow Icon={Database} label="事实条目" value={m.factCount} />
        <StatRow
          Icon={Clock}
          label="阅读时长"
          value={`${m.readingTimeMinutes} 分钟`}
        />
        <StatRow
          Icon={Sparkles}
          label="研究维度"
          value={m.dimensionCount || '—'}
        />
      </StatGroup>

      {/* 生成元数据 */}
      <StatGroup title="生成元数据">
        <StatRow Icon={Calendar} label="生成时间" value={generatedAt} />
        <StatRow Icon={Timer} label="耗时" value={`${seconds}s`} />
        <StatRow Icon={Zap} label="Tokens" value={tokens.toLocaleString()} />
        <StatRow Icon={Coins} label="成本" value={`$${cost}`} />
        {m.modelTrail.length > 0 && (
          <StatRow
            Icon={Cpu}
            label="模型链路"
            value={
              <span
                className="font-mono text-[11px] text-gray-700"
                title={m.modelTrail.join(', ')}
              >
                {m.modelTrail.length <= 3
                  ? m.modelTrail.join(' › ')
                  : `${m.modelTrail.slice(0, 3).join(' › ')} +${m.modelTrail.length - 3}`}
              </span>
            }
          />
        )}
      </StatGroup>

      {/* 配置画像 */}
      <StatGroup title="配置画像">
        <StatRow label="风格" value={m.styleProfile} />
        <StatRow label="长度" value={m.lengthProfile} />
        <StatRow label="受众" value={m.audienceProfile} />
        <StatRow label="语言" value={m.language} />
        {m.searchTimeRange && (
          <StatRow
            label="时效窗口"
            value={
              SEARCH_TIME_RANGE_LABEL[m.searchTimeRange] ?? m.searchTimeRange
            }
          />
        )}
      </StatGroup>

      {/* triggerType 不在 ArtifactMetadata 内，但 versionLabel 可能含线索；仅当显式标 trigger 才显示 */}
      {m.versionLabel && TRIGGER_LABEL[m.versionLabel] && (
        <p className="text-[11px] text-gray-500">
          触发类型：{TRIGGER_LABEL[m.versionLabel]}
        </p>
      )}
    </div>
  );
}

function StatGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        {title}
      </p>
      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {children}
      </div>
    </div>
  );
}

function StatRow({
  Icon,
  label,
  value,
}: {
  Icon?: LucideIcon;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-[12px]">
      <span className="flex items-center gap-2 text-gray-500">
        {Icon && (
          <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-600 ring-1 ring-violet-100">
            <Icon className="h-3 w-3" />
          </span>
        )}
        {label}
      </span>
      <span className="truncate text-right font-medium text-gray-900">
        {value}
      </span>
    </div>
  );
}
