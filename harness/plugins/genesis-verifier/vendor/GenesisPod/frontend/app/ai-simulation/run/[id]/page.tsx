'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import {
  Play,
  Pause,
  StopCircle,
  RefreshCw,
  Send,
  AlertTriangle,
  CheckCircle,
  Clock,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  List,
  Zap,
  BarChart3,
} from 'lucide-react';
import SandboxView from '@/components/ai-simulation/SandboxView';
import {
  PerspectiveSelector,
  ViewPerspective,
} from '@/components/ai-simulation/PerspectiveSelector';
import { useSimulationPerspective } from '@/hooks';
import { isContentVisible } from '@/lib/features/ai-simulation/perspectiveFilter';

import { logger } from '@/lib/utils/logger';
import ClientDate from '@/components/common/ClientDate';
// 智能解析长文本，提取结构化信息
function parseStructuredContent(text: string): {
  summary: string;
  sections: Array<{ title: string; items: string[] }>;
  hasStructure: boolean;
} {
  if (!text || text.length < 100) {
    return { summary: text, sections: [], hasStructure: false };
  }

  const sections: Array<{ title: string; items: string[] }> = [];
  let summary = '';

  // 尝试按数字编号分割 (1. 2. 3. 或 1、2、3、)
  const numberedPattern =
    /(?:^|\n)\s*(\d+)[.、)\]]\s*(.+?)(?=(?:\n\s*\d+[.、)\]])|$)/gs;
  const numberedMatches = [...text.matchAll(numberedPattern)];

  if (numberedMatches.length >= 2) {
    const firstMatchStart = text.indexOf(numberedMatches[0][0]);
    if (firstMatchStart > 20) {
      summary = text.substring(0, firstMatchStart).trim();
    }
    const items = numberedMatches.map((m) => m[2].trim().substring(0, 200));
    sections.push({ title: '主要内容', items });
    return { summary, sections, hasStructure: true };
  }

  // 尝试按 - 或 · 分割
  const bulletPattern = /(?:^|\n)\s*[-·•]\s*(.+?)(?=(?:\n\s*[-·•])|$)/gs;
  const bulletMatches = [...text.matchAll(bulletPattern)];

  if (bulletMatches.length >= 2) {
    const firstMatchStart = text.indexOf(bulletMatches[0][0]);
    if (firstMatchStart > 20) {
      summary = text.substring(0, firstMatchStart).trim();
    }
    const items = bulletMatches.map((m) => m[1].trim().substring(0, 200));
    sections.push({ title: '要点', items });
    return { summary, sections, hasStructure: true };
  }

  // 按句号分割长文本，取关键句子
  const sentences = text
    .split(/[。；！？]/)
    .filter((s) => s.trim().length > 15);
  if (sentences.length > 2) {
    summary = sentences[0].trim() + '。';
    const items = sentences.slice(1, 5).map((s) => s.trim().substring(0, 150));
    if (items.length > 0) {
      sections.push({ title: '详细内容', items });
    }
    return { summary, sections, hasStructure: true };
  }

  return { summary: text.substring(0, 300), sections: [], hasStructure: false };
}

// 结构化内容显示组件
function StructuredContent({
  text,
  defaultExpanded = false,
  className = '',
}: {
  text: string;
  defaultExpanded?: boolean;
  className?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const parsed = useMemo(() => parseStructuredContent(text || ''), [text]);

  if (!text) return null;

  // 短文本直接显示
  if (text.length < 150 || !parsed.hasStructure) {
    return (
      <div className={`text-sm leading-relaxed text-gray-800 ${className}`}>
        {text.length > 250 && !isExpanded ? (
          <>
            {text.substring(0, 230)}...
            <button
              onClick={() => setIsExpanded(true)}
              className="ml-1 text-xs text-indigo-600 hover:underline"
            >
              展开全部
            </button>
          </>
        ) : (
          text
        )}
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {/* 摘要 - 突出显示 */}
      {parsed.summary && (
        <div className="rounded bg-white/50 px-2 py-1 text-sm font-medium leading-relaxed text-gray-900">
          📌 {parsed.summary}
        </div>
      )}

      {/* 结构化列表 */}
      {parsed.sections.map((section, idx) => (
        <div key={idx}>
          <ul className="space-y-1.5">
            {(isExpanded ? section.items : section.items.slice(0, 3)).map(
              (item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs text-gray-700"
                >
                  <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400" />
                  <span className="leading-relaxed">{item}</span>
                </li>
              )
            )}
          </ul>

          {/* 展开/收起 */}
          {section.items.length > 3 && (
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="mt-2 flex items-center gap-1 text-xs text-indigo-600 hover:underline"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-3 w-3" /> 收起
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3" /> 展开更多 (
                  {section.items.length - 3} 项)
                </>
              )}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

interface BlackSwanEvent {
  name: string;
  description: string;
  affectedTeams?: string[];
  triggeredAt?: string;
}

interface WorldDelta {
  blackSwan?: BlackSwanEvent;
  irrationalBias?: boolean;
  last_submissions?: number;
  [key: string]: unknown;
}

interface EvidenceRef {
  provider: string;
  note?: string;
  status?: string;
}

interface TurnSubmission {
  team: string;
  action: string;
  companyName?: string;
  role?: string;
  agentName?: string;
  publicAction?: string;
  innerMonologue?: string;
  irrational?: boolean;
  [key: string]: unknown;
}

interface TurnAdjudication {
  result: string;
  ruling?: string;
  notes?: string;
  evidenceRefs?: EvidenceRef[];
  worldDelta?: WorldDelta;
  [key: string]: unknown;
}

interface TurnEvidence {
  [key: string]: unknown;
}

interface InterventionRecord {
  message: string;
  round?: number;
  timestamp?: string;
}

interface WorldState {
  blackSwan?: BlackSwanEvent;
  irrationalBias?: boolean;
  last_submissions?: number;
  interventions?: InterventionRecord[];
  blackSwanHistory?: BlackSwanEvent[];
  [key: string]: unknown;
}

interface Turn {
  id: string;
  roundNumber: number;
  submissions?: TurnSubmission[];
  adjudication?: TurnAdjudication;
  evidence?: TurnEvidence;
  worldState?: WorldState;
  createdAt: string;
}

interface MonologueEntry {
  round: number;
  team: string;
  content: string;
  [key: string]: unknown;
}

interface Company {
  id?: string;
  name: string;
  type?: string;
  market?: string;
  metrics?: {
    cash?: number;
    share?: number;
    revenue?: number;
    profit?: number;
  };
  [key: string]: unknown;
}

interface Agent {
  id?: string;
  role: string;
  team?: 'BLUE' | 'RED' | 'GREEN' | 'WHITE' | 'CHAOS';
  company?: { name: string } | null;
  companyName?: string;
  [key: string]: unknown;
}

interface BiasDetected {
  type: string;
  description: string;
  recommendation?: string;
  round?: number;
  team?: string;
}

interface Blindspot {
  type: string;
  description: string;
  recommendation?: string;
}

interface Counterfactual {
  round: number;
  originalAction: string;
  alternative: string;
  impact: string;
  scenario?: string;
  potentialOutcome?: string;
}

interface BlackSwanEventRecord {
  round: number;
  team: string;
  event: string;
  name?: string;
  impact?: 'high' | 'medium' | 'low';
  description?: string;
  affectedTeams?: string[];
}

interface CausalChainItem {
  type: string;
  description: string;
  round?: number;
  cause?: string;
  effect?: {
    changes?: string[];
    [key: string]: unknown;
  };
}

interface SummaryReport {
  keyFindings?: string[];
  biasesDetected?: BiasDetected[];
  blindspots?: Blindspot[];
  counterfactuals?: Counterfactual[];
  blackSwanEvents?: BlackSwanEventRecord[];
  causalChain?: CausalChainItem[];
  internalReport?: SummaryReport;
  publicReport?: SummaryReport;
  monologueLog?: MonologueEntry[];
}

interface Run {
  id: string;
  scenarioId: string;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED';
  currentRound: number;
  rounds: number;
  params?: Record<string, unknown>;
  worldState?: WorldState;
  evidenceTrail?: unknown[];
  summary?: SummaryReport;
  turns?: Turn[];
  scenario?: {
    id: string;
    name: string;
    industry: string;
    companies?: Company[];
    agents?: Agent[];
  };
  createdAt: string;
  updatedAt: string;
}

export default function RunConsolePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();
  const runId = params?.id as string;

  // 从URL参数或run.params中获取用户角色
  const urlRole = searchParams?.get('role') || 'observer';

  const [run, setRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [intervening, setIntervening] = useState(false);
  const [interventionText, setInterventionText] = useState('');
  const [showGuide, setShowGuide] = useState(false);
  const [userRole, setUserRole] = useState<string>(urlRole);
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set());
  const [viewMode, setViewMode] = useState<'text' | 'sandbox'>('text');
  const timelineEndRef = useRef<HTMLDivElement>(null);

  // 视角管理 - 使用 hook 自动保存到 localStorage
  const { perspective, setPerspective } = useSimulationPerspective({
    runId: runId,
    initialPerspective: urlRole === 'observer' ? 'GOD' : 'BLUE',
  });

  // 切换回合展开/折叠状态
  const toggleRound = (roundNumber: number) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev);
      if (next.has(roundNumber)) {
        next.delete(roundNumber);
      } else {
        next.add(roundNumber);
      }
      return next;
    });
  };

  // 展开所有回合
  const expandAllRounds = () => {
    if (run?.turns) {
      setExpandedRounds(new Set(run.turns.map((t) => t.roundNumber)));
    }
  };

  // 折叠所有回合
  const collapseAllRounds = () => {
    setExpandedRounds(new Set());
  };

  useEffect(() => {
    if (user && runId) {
      void fetchRun();

      // Use polling instead of SSE to avoid auth issues
      // Poll every 2 seconds when run is active
      const pollInterval = setInterval(() => {
        void fetchRun();
      }, 2000);

      return () => {
        clearInterval(pollInterval);
      };
    }
  }, [user, runId]);

  useEffect(() => {
    // Auto-scroll to bottom when new turns are added
    timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    // 自动展开最新的回合
    if (run?.turns && run.turns.length > 0) {
      const latestRound = Math.max(...run.turns.map((t) => t.roundNumber));
      setExpandedRounds((prev) => new Set([...prev, latestRound]));
    }
  }, [run?.turns?.length]);

  const fetchRun = async () => {
    try {
      const res = await fetch(`${config.apiUrl}/simulation/runs/${runId}`, {
        headers: { ...getAuthHeader() },
      });
      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setRun(data);
      }
    } catch (err) {
      logger.error('Failed to fetch run:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleResume = async () => {
    try {
      await fetch(`${config.apiUrl}/simulation/runs/${runId}/resume`, {
        method: 'PATCH',
        headers: { ...getAuthHeader() },
      });
      await fetchRun();
    } catch (err) {
      logger.error('Failed to resume run:', err);
    }
  };

  const handlePause = async () => {
    try {
      await fetch(`${config.apiUrl}/simulation/runs/${runId}/pause`, {
        method: 'PATCH',
        headers: { ...getAuthHeader() },
      });
      await fetchRun();
    } catch (err) {
      logger.error('Failed to pause run:', err);
    }
  };

  const handleIntervention = async () => {
    if (!interventionText.trim()) return;
    setIntervening(true);
    try {
      await fetch(`${config.apiUrl}/simulation/runs/${runId}/intervene`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeader(),
        },
        body: JSON.stringify({ message: interventionText }),
      });
      setInterventionText('');
      await fetchRun();
    } catch (err) {
      logger.error('Failed to intervene:', err);
    } finally {
      setIntervening(false);
    }
  };

  if (authLoading || loading) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center">
          <div className="text-gray-500">加载中...</div>
        </main>
      </AppShell>
    );
  }

  if (!user || !run) {
    return (
      <AppShell>
        <main className="flex flex-1 items-center justify-center">
          <div className="text-gray-500">推演不存在或无权访问</div>
        </main>
      </AppShell>
    );
  }

  const progress = run.rounds > 0 ? (run.currentRound / run.rounds) * 100 : 0;

  return (
    <AppShell>
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <div className="border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push(`/ai-simulation/${run.scenarioId}`)}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                <svg
                  className="h-4 w-4 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>
              <div>
                <h1 className="text-lg font-bold text-gray-900">
                  {run.scenario?.name || 'AI Simulation'}
                </h1>
                <p className="text-xs text-gray-500">
                  Run #{run.id.slice(0, 8)} · {run.scenario?.industry}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Progress */}
              <div className="flex items-center gap-2">
                <div className="text-sm text-gray-600">
                  回合 {run.currentRound} / {run.rounds}
                </div>
                <div className="h-2 w-32 rounded-full bg-gray-200">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-indigo-500 to-purple-600 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              {/* 视角选择器 */}
              <PerspectiveSelector
                value={perspective}
                onChange={setPerspective}
                size="sm"
              />

              {/* Status */}
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  run.status === 'RUNNING'
                    ? 'bg-green-100 text-green-700'
                    : run.status === 'PAUSED'
                      ? 'bg-yellow-100 text-yellow-700'
                      : run.status === 'COMPLETED'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-700'
                }`}
              >
                {run.status}
              </span>

              {/* Controls */}
              {run.status === 'PAUSED' && (
                <button
                  onClick={handleResume}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  <Play className="h-4 w-4" />
                  继续
                </button>
              )}
              {run.status === 'RUNNING' && (
                <button
                  onClick={handlePause}
                  className="flex items-center gap-2 rounded-lg bg-yellow-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-yellow-700"
                >
                  <Pause className="h-4 w-4" />
                  暂停
                </button>
              )}
              <button
                onClick={() => void fetchRun()}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"
              >
                <RefreshCw className="h-4 w-4 text-gray-600" />
              </button>

              {/* 视图模式切换 */}
              <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                <button
                  onClick={() => setViewMode('text')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === 'text'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="文字版"
                >
                  <List className="h-3.5 w-3.5" />
                  文字
                </button>
                <button
                  onClick={() => setViewMode('sandbox')}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === 'sandbox'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                  title="可视化沙盘"
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  沙盘
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 帮助说明画板 - 可折叠 */}
        <div className="border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <button
            onClick={() => setShowGuide(!showGuide)}
            className="flex w-full items-center justify-between px-6 py-2 text-left hover:bg-white/50"
          >
            <div className="flex items-center gap-2 text-sm font-medium text-indigo-700">
              <HelpCircle className="h-4 w-4" />
              如何看懂这个推演？
            </div>
            {showGuide ? (
              <ChevronUp className="h-4 w-4 text-indigo-600" />
            ) : (
              <ChevronDown className="h-4 w-4 text-indigo-600" />
            )}
          </button>

          {showGuide && (
            <div className="border-t border-indigo-100 px-6 py-4">
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {/* 你的角色 */}
                <div
                  className={`rounded-lg border p-3 ${userRole === 'observer' ? 'border-indigo-200 bg-indigo-50' : 'border-blue-200 bg-blue-50'}`}
                >
                  <div
                    className={`mb-2 flex items-center gap-2 text-sm font-semibold ${userRole === 'observer' ? 'text-indigo-800' : 'text-blue-800'}`}
                  >
                    👤 你的角色
                  </div>
                  {userRole === 'observer' ? (
                    <p className="text-xs text-gray-600">
                      你是<strong>战略观察者</strong>（上帝视角）。
                      你可以同时看到所有阵营的行动和内心想法，发现盲点和机会。
                    </p>
                  ) : (
                    <p className="text-xs text-gray-600">
                      你正在扮演
                      <strong className="text-blue-700">{userRole}</strong>。
                      你只能看到该角色视角的信息，对手的内心想法对你隐藏。
                      在你的决策回合，请输入你的行动。
                    </p>
                  )}
                </div>

                {/* 四个阵营 */}
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                    ⚔️ 四方博弈
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                        🔵 蓝军
                      </span>
                      <span className="text-gray-600">= 我方/主角公司</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                        🔴 红军
                      </span>
                      <span className="text-gray-600">= 竞争对手/挑战者</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                        🟢 绿军
                      </span>
                      <span className="text-gray-600">= 市场/客户/供应商</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-gray-100 px-1.5 py-0.5 text-gray-700">
                        ⚪ 白方
                      </span>
                      <span className="text-gray-600">= 裁判/监管机构</span>
                    </div>
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                          🟣 黑天鹅
                        </span>
                        <span className="text-gray-600">= 随机突发事件</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 推演流程 */}
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                    🔄 推演流程
                  </div>
                  <ol className="list-inside list-decimal space-y-1 text-xs text-gray-600">
                    <li>每回合各阵营AI独立决策</li>
                    <li>裁判综合评估并更新世界状态</li>
                    <li>外部数据（市场/新闻）影响决策</li>
                    <li>你可随时暂停并注入事件</li>
                  </ol>
                </div>

                {/* 如何获得洞察 */}
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800">
                    💡 如何获得洞察
                  </div>
                  <ul className="list-inside list-disc space-y-1 text-xs text-gray-600">
                    <li>观察对手的决策思路（💭展开）</li>
                    <li>注意黑天鹅事件的连锁反应</li>
                    <li>对比各方对同一事件的反应</li>
                    <li>尝试注入不同事件测试应对</li>
                  </ul>
                </div>
              </div>

              {/* 快速提示 */}
              <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
                <span className="rounded-full bg-indigo-100 px-2 py-1 text-indigo-700">
                  💡 点击「💭 查看决策思路」可看到AI的内心独白
                </span>
                <span className="rounded-full bg-purple-100 px-2 py-1 text-purple-700">
                  🦢 紫色区域 = 黑天鹅事件正在影响局势
                </span>
                <span className="rounded-full bg-orange-100 px-2 py-1 text-orange-700">
                  ⚡ 标有"非理性"表示决策者受情绪影响
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Main Content - 视图切换 */}
        {viewMode === 'sandbox' ? (
          <div className="flex-1 overflow-hidden p-4">
            <SandboxView
              run={
                run as unknown as React.ComponentProps<
                  typeof SandboxView
                >['run']
              }
              onPause={handlePause}
              onResume={handleResume}
              onIntervene={(message) => {
                setInterventionText(message);
                void handleIntervention();
              }}
              perspective={perspective}
              onPerspectiveChange={setPerspective}
            />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Timeline (Left) */}
            <div className="flex w-2/5 flex-col border-r border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-4 py-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-gray-900">
                    推演时间线
                  </h2>
                  {run?.turns && run.turns.length > 0 && (
                    <div className="flex gap-1">
                      <button
                        onClick={expandAllRounds}
                        className="rounded px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100"
                        title="展开全部"
                      >
                        全部展开
                      </button>
                      <button
                        onClick={collapseAllRounds}
                        className="rounded px-2 py-0.5 text-[10px] text-gray-500 hover:bg-gray-100"
                        title="折叠全部"
                      >
                        全部折叠
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  {userRole === 'observer' ? (
                    <>
                      以<strong>上帝视角</strong>
                      观看各方博弈，发现盲点和战略机会
                    </>
                  ) : (
                    <>
                      你正在扮演
                      <strong className="text-blue-600">{userRole}</strong>
                      ，其他阵营的内心想法已隐藏
                    </>
                  )}
                </p>
              </div>
              {/* 角色图例 */}
              <div className="border-b border-gray-100 bg-gray-50 px-4 py-2">
                <div className="flex flex-wrap gap-2 text-[10px]">
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-blue-700">
                    🔵 蓝军=主角
                  </span>
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-red-700">
                    🔴 红军=对手
                  </span>
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700">
                    🟢 绿军=市场
                  </span>
                  <span className="rounded bg-gray-200 px-1.5 py-0.5 text-gray-700">
                    ⚪ 白方=监管
                  </span>
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-purple-700">
                    🟣 黑天鹅
                  </span>
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {run.turns && run.turns.length > 0 ? (
                  run.turns.map((turn) => {
                    const isExpanded = expandedRounds.has(turn.roundNumber);
                    const submissionCount = Array.isArray(turn.submissions)
                      ? turn.submissions.length
                      : 0;

                    return (
                      <div
                        key={turn.id}
                        className="overflow-hidden rounded-lg border border-gray-200 bg-white"
                      >
                        {/* Round Header - 可点击折叠/展开 */}
                        <button
                          onClick={() => toggleRound(turn.roundNumber)}
                          className="flex w-full items-center justify-between px-3 py-2 transition-colors hover:bg-gray-50"
                        >
                          <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
                            <Clock className="h-3 w-3 text-gray-400" />
                            <span className="font-semibold">
                              回合 {turn.roundNumber}
                            </span>
                            <span className="text-gray-400">·</span>
                            <span className="text-gray-500">
                              <ClientDate date={turn.createdAt} format="time" />
                            </span>
                            <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                              {submissionCount} 条行动
                            </span>
                            {turn.adjudication?.ruling && (
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                  turn.adjudication.ruling === 'proceed'
                                    ? 'bg-green-100 text-green-700'
                                    : 'bg-yellow-100 text-yellow-700'
                                }`}
                              >
                                {turn.adjudication.ruling}
                              </span>
                            )}
                          </div>
                          <ChevronDown
                            className={`h-4 w-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          />
                        </button>

                        {/* Agent Submissions - 折叠内容 */}
                        {isExpanded &&
                          turn.submissions &&
                          Array.isArray(turn.submissions) && (
                            <div className="ml-4 space-y-4">
                              {/* 按Team分组展示 */}
                              {['BLUE', 'RED', 'GREEN', 'WHITE', 'CHAOS'].map(
                                (teamName) => {
                                  const teamSubmissions =
                                    turn.submissions?.filter(
                                      (s) => s.team === teamName
                                    ) || [];
                                  if (teamSubmissions.length === 0) return null;

                                  const teamConfig = {
                                    BLUE: {
                                      label: '蓝军行动',
                                      sublabel: '主角',
                                      bg: 'bg-gradient-to-r from-blue-50 to-blue-100',
                                      border: 'border-blue-300',
                                      text: 'text-blue-800',
                                      icon: '🔵',
                                      accent: 'bg-blue-500',
                                    },
                                    RED: {
                                      label: '红军行动',
                                      sublabel: '对手',
                                      bg: 'bg-gradient-to-r from-red-50 to-red-100',
                                      border: 'border-red-300',
                                      text: 'text-red-800',
                                      icon: '🔴',
                                      accent: 'bg-red-500',
                                    },
                                    GREEN: {
                                      label: '绿军行动',
                                      sublabel: '市场',
                                      bg: 'bg-gradient-to-r from-green-50 to-green-100',
                                      border: 'border-green-300',
                                      text: 'text-green-800',
                                      icon: '🟢',
                                      accent: 'bg-green-500',
                                    },
                                    WHITE: {
                                      label: '白方行动',
                                      sublabel: '监管',
                                      bg: 'bg-gradient-to-r from-gray-50 to-gray-100',
                                      border: 'border-gray-300',
                                      text: 'text-gray-800',
                                      icon: '⚪',
                                      accent: 'bg-gray-500',
                                    },
                                    CHAOS: {
                                      label: '黑天鹅事件',
                                      sublabel: '意外',
                                      bg: 'bg-gradient-to-r from-purple-50 to-purple-100',
                                      border: 'border-purple-300',
                                      text: 'text-purple-800',
                                      icon: '🟣',
                                      accent: 'bg-purple-500',
                                    },
                                  }[teamName] || {
                                    label: teamName,
                                    sublabel: '',
                                    bg: 'bg-gray-50',
                                    border: 'border-gray-200',
                                    text: 'text-gray-700',
                                    icon: '👤',
                                    accent: 'bg-gray-500',
                                  };

                                  return (
                                    <div
                                      key={teamName}
                                      className={`overflow-hidden rounded-xl border-2 ${teamConfig.border} shadow-sm`}
                                    >
                                      {/* Team Header - 更突出 */}
                                      <div
                                        className={`flex items-center gap-2 ${teamConfig.bg} px-4 py-2`}
                                      >
                                        <span className="text-lg">
                                          {teamConfig.icon}
                                        </span>
                                        <div>
                                          <span
                                            className={`text-sm font-bold ${teamConfig.text}`}
                                          >
                                            {teamConfig.label}
                                          </span>
                                          <span className="ml-2 text-xs text-gray-500">
                                            ({teamConfig.sublabel})
                                          </span>
                                        </div>
                                      </div>

                                      {/* Submissions */}
                                      <div className="divide-y divide-gray-100 bg-white">
                                        {teamSubmissions.map(
                                          (submission, idx: number) => (
                                            <div key={idx} className="p-4">
                                              {/* 公司/角色信息 - 更突出显示 */}
                                              <div className="mb-3 flex items-start justify-between">
                                                <div className="flex-1">
                                                  {/* 公司名称 */}
                                                  {submission.companyName && (
                                                    <div className="mb-1 flex items-center gap-2">
                                                      <span className="text-base">
                                                        🏢
                                                      </span>
                                                      <span className="text-sm font-bold text-gray-900">
                                                        {submission.companyName}
                                                      </span>
                                                    </div>
                                                  )}
                                                  {/* 角色 */}
                                                  <div className="flex items-center gap-2">
                                                    <span
                                                      className={`inline-block h-2 w-2 rounded-full ${teamConfig.accent}`}
                                                    />
                                                    <span className="text-sm font-medium text-gray-700">
                                                      👤 {submission.role}
                                                    </span>
                                                    {submission.agentName &&
                                                      submission.agentName !==
                                                        submission.role && (
                                                        <span className="text-xs text-gray-500">
                                                          (
                                                          {submission.agentName}
                                                          )
                                                        </span>
                                                      )}
                                                  </div>
                                                </div>
                                                {/* 标签 */}
                                                <div className="flex flex-col items-end gap-1">
                                                  {submission.irrational && (
                                                    <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-bold text-orange-700">
                                                      ⚡ 非理性决策
                                                    </span>
                                                  )}
                                                </div>
                                              </div>

                                              {/* 公开行动 - 结构化显示 */}
                                              {submission.publicAction && (
                                                <div className="mb-3 rounded-lg bg-gray-50 p-3">
                                                  <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-gray-500">
                                                    📢 公开行动
                                                  </div>
                                                  {submission.publicAction.includes(
                                                    'API Error'
                                                  ) ||
                                                  submission.publicAction.includes(
                                                    'quota'
                                                  ) ? (
                                                    <span className="italic text-red-500">
                                                      [决策生成失败]
                                                    </span>
                                                  ) : (
                                                    <StructuredContent
                                                      text={
                                                        submission.publicAction
                                                      }
                                                      defaultExpanded={false}
                                                    />
                                                  )}
                                                </div>
                                              )}

                                              {/* 内心独白 - 结构化显示 */}
                                              {submission.innerMonologue &&
                                                !submission.innerMonologue.includes(
                                                  'API Error'
                                                ) &&
                                                (userRole === 'observer' ||
                                                teamName === 'BLUE' ? (
                                                  <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                                                    <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-amber-700">
                                                      💭 决策思路（内心想法）
                                                    </div>
                                                    <StructuredContent
                                                      text={
                                                        submission.innerMonologue
                                                      }
                                                      defaultExpanded={false}
                                                      className="text-xs"
                                                    />
                                                  </div>
                                                ) : (
                                                  <div className="flex items-center gap-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-400">
                                                    <span>🔒</span>
                                                    <span className="italic">
                                                      对手的决策思路在此视角下隐藏
                                                    </span>
                                                  </div>
                                                ))}
                                            </div>
                                          )
                                        )}
                                      </div>
                                    </div>
                                  );
                                }
                              )}
                            </div>
                          )}

                        {/* Adjudication */}
                        {turn.adjudication && (
                          <div className="ml-4 rounded-lg border border-indigo-200 bg-indigo-50 p-3">
                            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-indigo-700">
                              <AlertTriangle className="h-3 w-3" />
                              裁判判定
                            </div>

                            {/* Ruling */}
                            <div className="mb-2 flex items-center gap-2">
                              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                {turn.adjudication.ruling || 'proceed'}
                              </span>
                            </div>

                            {/* Notes */}
                            {turn.adjudication.notes && (
                              <div className="mb-2 text-sm text-gray-900">
                                {turn.adjudication.notes}
                              </div>
                            )}

                            {/* Evidence Refs */}
                            {turn.adjudication.evidenceRefs &&
                              Array.isArray(turn.adjudication.evidenceRefs) &&
                              turn.adjudication.evidenceRefs.length > 0 && (
                                <div className="mt-2 space-y-1">
                                  {turn.adjudication.evidenceRefs.map(
                                    (ev, idx: number) => (
                                      <div
                                        key={idx}
                                        className="flex items-start gap-2 text-xs text-gray-600"
                                      >
                                        <CheckCircle
                                          className={`mt-0.5 h-3 w-3 ${ev.status === 'missing' ? 'text-orange-600' : 'text-green-600'}`}
                                        />
                                        <span>
                                          {ev.provider}: {ev.note || ev.status}
                                        </span>
                                      </div>
                                    )
                                  )}
                                </div>
                              )}

                            {/* World Delta - 友好展示 */}
                            {turn.adjudication.worldDelta && (
                              <div className="mt-2 rounded bg-white p-2">
                                <div className="mb-1 text-xs font-medium text-gray-700">
                                  🌍 本轮世界变化:
                                </div>
                                <div className="space-y-1 text-xs">
                                  {/* 黑天鹅事件 */}
                                  {turn.adjudication.worldDelta.blackSwan && (
                                    <div className="flex items-center gap-2 rounded bg-purple-50 px-2 py-1 text-purple-700">
                                      <span>🦢</span>
                                      <span className="font-medium">
                                        {
                                          turn.adjudication.worldDelta.blackSwan
                                            .name
                                        }
                                      </span>
                                    </div>
                                  )}
                                  {/* 非理性偏见 */}
                                  {turn.adjudication.worldDelta
                                    .irrationalBias && (
                                    <div className="flex items-center gap-2 rounded bg-orange-50 px-2 py-1 text-orange-700">
                                      <Zap className="h-4 w-4" />
                                      <span>非理性因素激活</span>
                                    </div>
                                  )}
                                  {/* 提交数统计 */}
                                  {turn.adjudication.worldDelta
                                    .last_submissions && (
                                    <div className="flex items-center gap-2 text-gray-600">
                                      <BarChart3 className="h-4 w-4" />
                                      <span>
                                        本轮提交:{' '}
                                        {
                                          turn.adjudication.worldDelta
                                            .last_submissions
                                        }{' '}
                                        条行动
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div className="flex h-full flex-col items-center justify-center p-6">
                    {/* 加载动画 */}
                    <div className="relative mb-6">
                      <div className="h-16 w-16 animate-spin rounded-full border-4 border-indigo-100 border-t-indigo-500" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl">🤖</span>
                      </div>
                    </div>

                    {/* 状态文字 */}
                    <div className="text-center">
                      <div className="mb-2 text-sm font-medium text-gray-700">
                        AI 正在进行第 1 轮推演决策...
                      </div>
                      <div className="mb-4 text-xs text-gray-500">
                        每个角色都在思考和分析当前局势
                      </div>

                      {/* 进度指示 */}
                      <div className="mx-auto max-w-xs space-y-2">
                        <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                          <span>蓝军团队正在分析...</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                          <span
                            className="h-2 w-2 animate-pulse rounded-full bg-red-500"
                            style={{ animationDelay: '0.3s' }}
                          />
                          <span>红军团队正在决策...</span>
                        </div>
                        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
                          <span
                            className="h-2 w-2 animate-pulse rounded-full bg-green-500"
                            style={{ animationDelay: '0.6s' }}
                          />
                          <span>监管方正在评估...</span>
                        </div>
                      </div>

                      <p className="mt-4 text-[10px] text-gray-400">
                        首轮决策通常需要 30-60 秒，请耐心等待
                      </p>
                    </div>
                  </div>
                )}
                <div ref={timelineEndRef} />
              </div>
            </div>

            {/* World State (Middle) */}
            <div className="flex flex-1 flex-col bg-gray-50">
              <div className="border-b border-gray-200 bg-white px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  世界状态 & 态势感知
                </h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <div className="space-y-4">
                  {/* 外部数据源状态指示器 */}
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold text-gray-700">
                      <span className="flex h-5 w-5 items-center justify-center rounded bg-indigo-100">
                        <svg
                          className="h-3 w-3 text-indigo-600"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                          />
                        </svg>
                      </span>
                      外部数据源
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {['market', 'finance', 'news', 'regulation'].map(
                        (source: string) => {
                          const data = run.worldState?.[source] as
                            | Record<string, unknown>
                            | undefined;
                          const hasError =
                            (data as { error?: unknown })?.error ||
                            (data as { 'Error Message'?: unknown })?.[
                              'Error Message'
                            ];
                          const hasData = data && !hasError;
                          return (
                            <div
                              key={source}
                              className={`flex items-center gap-2 rounded-lg border p-2 text-xs ${
                                hasData
                                  ? 'border-green-200 bg-green-50'
                                  : hasError
                                    ? 'border-red-200 bg-red-50'
                                    : 'border-gray-200 bg-gray-50'
                              }`}
                            >
                              <span
                                className={`flex h-2 w-2 rounded-full ${
                                  hasData
                                    ? 'bg-green-500'
                                    : hasError
                                      ? 'bg-red-500'
                                      : 'bg-gray-400'
                                }`}
                              />
                              <span
                                className={
                                  hasData
                                    ? 'text-green-700'
                                    : hasError
                                      ? 'text-red-700'
                                      : 'text-gray-500'
                                }
                              >
                                {source === 'market' && '📈 市场'}
                                {source === 'finance' && '💰 财务'}
                                {source === 'news' && '📰 新闻'}
                                {source === 'regulation' && '⚖️ 监管'}
                              </span>
                              <span className="ml-auto text-[10px]">
                                {hasData
                                  ? '✓ 有效'
                                  : hasError
                                    ? typeof hasError === 'string'
                                      ? hasError.slice(0, 10)
                                      : '错误'
                                    : '待获取'}
                              </span>
                            </div>
                          );
                        }
                      )}
                    </div>
                  </div>

                  {/* 事件与状态 */}
                  {run.worldState && (
                    <div className="space-y-3">
                      {/* 黑天鹅事件 */}
                      {run.worldState.blackSwan && (
                        <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-purple-700">
                            🦢 黑天鹅事件触发
                          </div>
                          <div className="text-sm font-medium text-purple-900">
                            {run.worldState.blackSwan.name}
                          </div>
                          <p className="mt-1 text-xs text-purple-700">
                            {run.worldState.blackSwan.description}
                          </p>
                          {run.worldState.blackSwan.affectedTeams && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {run.worldState.blackSwan.affectedTeams.map(
                                (team: string) => (
                                  <span
                                    key={team}
                                    className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                      team === 'BLUE'
                                        ? 'bg-blue-100 text-blue-700'
                                        : team === 'RED'
                                          ? 'bg-red-100 text-red-700'
                                          : team === 'GREEN'
                                            ? 'bg-green-100 text-green-700'
                                            : 'bg-purple-100 text-purple-700'
                                    }`}
                                  >
                                    {team}
                                  </span>
                                )
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 非理性偏见 */}
                      {run.worldState.irrationalBias && (
                        <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                          <div className="flex items-center gap-2 text-xs font-semibold text-orange-700">
                            ⚡ 非理性因素激活
                          </div>
                          <p className="mt-1 text-xs text-orange-600">
                            部分决策者受情绪影响，可能做出非最优决策
                          </p>
                        </div>
                      )}

                      {/* 回合统计 */}
                      <div className="rounded-lg border border-gray-200 bg-white p-3">
                        <div className="mb-2 text-xs font-semibold text-gray-700">
                          📊 本轮统计
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-gray-500">提交数:</span>
                            <span className="font-medium">
                              {run.worldState.last_submissions || 0}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-500">累计轮次:</span>
                            <span className="font-medium">
                              {run.currentRound}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* 各方态势总览 - 从最新回合提取 */}
                      {run.turns && run.turns.length > 0 && (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                          <div className="mb-3 text-xs font-semibold text-blue-700">
                            🎯 各方态势总览（第 {run.currentRound} 轮）
                          </div>
                          <div className="space-y-3">
                            {/* 按团队分组显示最新动态 */}
                            {['BLUE', 'RED', 'GREEN', 'WHITE'].map((team) => {
                              const latestTurn =
                                run.turns?.[run.turns.length - 1];
                              const teamSubmissions =
                                latestTurn?.submissions?.filter(
                                  (s) => s.team === team
                                ) || [];
                              if (teamSubmissions.length === 0) return null;

                              const teamNames: Record<
                                string,
                                { name: string; color: string; bg: string }
                              > = {
                                BLUE: {
                                  name: '蓝军（主角）',
                                  color: 'text-blue-700',
                                  bg: 'bg-blue-100',
                                },
                                RED: {
                                  name: '红军（对手）',
                                  color: 'text-red-700',
                                  bg: 'bg-red-100',
                                },
                                GREEN: {
                                  name: '绿军（市场）',
                                  color: 'text-green-700',
                                  bg: 'bg-green-100',
                                },
                                WHITE: {
                                  name: '白方（监管）',
                                  color: 'text-gray-700',
                                  bg: 'bg-gray-100',
                                },
                              };
                              const config = teamNames[team];

                              return (
                                <div
                                  key={team}
                                  className={`rounded-lg ${config.bg} p-2`}
                                >
                                  <div
                                    className={`mb-1 text-xs font-semibold ${config.color}`}
                                  >
                                    {config.name}
                                  </div>
                                  <div className="space-y-1">
                                    {teamSubmissions
                                      .slice(0, 2)
                                      .map((s, i: number) => (
                                        <div
                                          key={i}
                                          className="text-[11px] text-gray-700"
                                        >
                                          <span className="font-medium">
                                            {s.companyName || s.role}:
                                          </span>{' '}
                                          <span className="text-gray-600">
                                            {s.publicAction?.substring(0, 80) ||
                                              '...'}
                                            {(s.publicAction?.length ?? 0) >
                                              80 && '...'}
                                          </span>
                                        </div>
                                      ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* 人类干预历史 */}
                      {run.worldState.interventions &&
                        run.worldState.interventions.length > 0 && (
                          <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                            <div className="mb-2 text-xs font-semibold text-cyan-700">
                              🧑‍💼 人类干预记录
                            </div>
                            <div className="space-y-2">
                              {run.worldState.interventions.map(
                                (iv, idx: number) => (
                                  <div
                                    key={idx}
                                    className="rounded bg-white p-2 text-xs"
                                  >
                                    <div className="font-medium text-cyan-800">
                                      {iv.message}
                                    </div>
                                    {iv.round && (
                                      <div className="mt-1 text-[10px] text-gray-500">
                                        第 {iv.round} 轮干预
                                      </div>
                                    )}
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )}

                      {/* 黑天鹅历史 */}
                      {run.worldState.blackSwanHistory &&
                        run.worldState.blackSwanHistory.length > 0 && (
                          <div className="rounded-lg border border-gray-200 bg-white p-3">
                            <div className="mb-2 text-xs font-semibold text-gray-700">
                              🦢 事件历史
                            </div>
                            <div className="space-y-1.5">
                              {run.worldState.blackSwanHistory.map(
                                (event, idx: number) => (
                                  <div
                                    key={idx}
                                    className="flex items-center gap-2 text-xs text-gray-600"
                                  >
                                    <span className="text-purple-600">•</span>
                                    <span className="font-medium">
                                      {event.name}
                                    </span>
                                    <span className="ml-auto text-[10px] text-gray-400">
                                      {event.triggeredAt ? (
                                        <ClientDate
                                          date={event.triggeredAt}
                                          format="time"
                                        />
                                      ) : (
                                        ''
                                      )}
                                    </span>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )}

                      {/* 原始数据折叠 */}
                      <details className="rounded-lg border border-gray-200 bg-white">
                        <summary className="cursor-pointer p-3 text-xs font-semibold text-gray-700 hover:bg-gray-50">
                          🔍 原始世界状态 (JSON)
                        </summary>
                        <div className="border-t border-gray-200 p-3">
                          <pre className="font-mono max-h-60 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-2 text-[10px] text-gray-600">
                            {JSON.stringify(run.worldState, null, 2)}
                          </pre>
                        </div>
                      </details>
                    </div>
                  )}

                  {!run.worldState && (
                    <div className="flex h-40 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-sm text-gray-500">
                      推演开始后将显示世界状态
                    </div>
                  )}

                  {/* 复盘报告 - 推演完成后显示 */}
                  {run.status === 'COMPLETED' && run.summary && (
                    <div className="mt-6 space-y-4">
                      <div className="rounded-xl border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-purple-50 p-4">
                        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-indigo-800">
                          📋 推演复盘报告
                        </h3>

                        {/* 从 publicReport 或 internalReport 或直接从 summary 获取数据 */}
                        {(() => {
                          const report =
                            run.summary?.internalReport ||
                            run.summary?.publicReport ||
                            run.summary;
                          const keyFindings = report?.keyFindings || [];
                          const biasesDetected = report?.biasesDetected || [];
                          const blindspots = report?.blindspots || [];
                          const blackSwanEvents = report?.blackSwanEvents || [];
                          const counterfactuals = report?.counterfactuals || [];
                          const causalChain = report?.causalChain || [];

                          return (
                            <>
                              {/* 关键发现 */}
                              {keyFindings.length > 0 && (
                                <div className="mb-4">
                                  <div className="mb-2 text-xs font-semibold text-indigo-700">
                                    💡 关键发现
                                  </div>
                                  <ul className="space-y-1">
                                    {keyFindings.map(
                                      (finding: string, idx: number) => (
                                        <li
                                          key={idx}
                                          className="flex items-start gap-2 text-xs text-gray-700"
                                        >
                                          <span className="mt-1 text-indigo-500">
                                            •
                                          </span>
                                          {finding}
                                        </li>
                                      )
                                    )}
                                  </ul>
                                </div>
                              )}

                              {/* 因果链 */}
                              {causalChain.length > 0 && (
                                <div className="mb-4">
                                  <div className="mb-2 text-xs font-semibold text-cyan-700">
                                    🔗 因果链分析
                                  </div>
                                  <div className="space-y-2">
                                    {causalChain.map((item, idx: number) => (
                                      <div
                                        key={idx}
                                        className="rounded-lg border border-cyan-200 bg-cyan-50 p-2 text-xs"
                                      >
                                        <div className="font-medium text-cyan-800">
                                          回合 {item.round}: {item.cause}
                                        </div>
                                        {item.effect && (
                                          <p className="mt-1 text-cyan-700">
                                            → 影响:{' '}
                                            {item.effect.changes?.join(', ') ||
                                              JSON.stringify(item.effect)}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 偏见识别 */}
                              {biasesDetected.length > 0 && (
                                <div className="mb-4">
                                  <div className="mb-2 text-xs font-semibold text-amber-700">
                                    ⚠️ 偏见识别
                                  </div>
                                  <div className="space-y-2">
                                    {biasesDetected.map((bias, idx: number) => (
                                      <div
                                        key={idx}
                                        className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs"
                                      >
                                        <div className="flex items-center gap-2">
                                          <span className="font-medium text-amber-800">
                                            {bias.type}
                                          </span>
                                          {bias.round && (
                                            <span className="rounded bg-amber-200 px-1 text-[10px]">
                                              回合{bias.round}
                                            </span>
                                          )}
                                          {bias.team && (
                                            <span className="rounded bg-amber-200 px-1 text-[10px]">
                                              {bias.team}
                                            </span>
                                          )}
                                        </div>
                                        <p className="mt-1 text-amber-700">
                                          {bias.description}
                                        </p>
                                        {bias.recommendation && (
                                          <p className="mt-1 italic text-amber-600">
                                            💡 建议: {bias.recommendation}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 盲点 */}
                              {blindspots.length > 0 && (
                                <div className="mb-4">
                                  <div className="mb-2 text-xs font-semibold text-red-700">
                                    🚨 识别盲点
                                  </div>
                                  <div className="space-y-2">
                                    {blindspots.map((spot, idx: number) => (
                                      <div
                                        key={idx}
                                        className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs"
                                      >
                                        <div className="font-medium text-red-800">
                                          {spot.type}
                                        </div>
                                        <p className="text-red-700">
                                          {spot.description}
                                        </p>
                                        {spot.recommendation && (
                                          <p className="mt-1 italic text-red-600">
                                            💡 建议: {spot.recommendation}
                                          </p>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 黑天鹅事件 */}
                              {blackSwanEvents.length > 0 && (
                                <div className="mb-4">
                                  <div className="mb-2 text-xs font-semibold text-purple-700">
                                    🦢 黑天鹅事件记录
                                  </div>
                                  <div className="space-y-1">
                                    {blackSwanEvents.map(
                                      (event, idx: number) => (
                                        <div
                                          key={idx}
                                          className="rounded bg-purple-100 p-2 text-xs"
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className="font-bold text-purple-800">
                                              {event.name}
                                            </span>
                                            <span
                                              className={`rounded px-1 text-[10px] ${
                                                event.impact === 'high'
                                                  ? 'bg-red-200 text-red-700'
                                                  : event.impact === 'medium'
                                                    ? 'bg-orange-200 text-orange-700'
                                                    : 'bg-gray-200 text-gray-700'
                                              }`}
                                            >
                                              {event.impact === 'high'
                                                ? '高影响'
                                                : event.impact === 'medium'
                                                  ? '中影响'
                                                  : '低影响'}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-purple-700">
                                            {event.description}
                                          </p>
                                          {event.affectedTeams && (
                                            <div className="mt-1 flex gap-1">
                                              {event.affectedTeams.map(
                                                (team: string) => (
                                                  <span
                                                    key={team}
                                                    className={`rounded px-1 text-[10px] ${
                                                      team === 'BLUE'
                                                        ? 'bg-blue-200 text-blue-700'
                                                        : team === 'RED'
                                                          ? 'bg-red-200 text-red-700'
                                                          : team === 'GREEN'
                                                            ? 'bg-green-200 text-green-700'
                                                            : team === 'WHITE'
                                                              ? 'bg-gray-200 text-gray-700'
                                                              : 'bg-purple-200 text-purple-700'
                                                    }`}
                                                  >
                                                    {team}
                                                  </span>
                                                )
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* 反事实推理 */}
                              {counterfactuals.length > 0 && (
                                <div className="mb-4">
                                  <div className="mb-2 text-xs font-semibold text-blue-700">
                                    🔮 反事实推理（如果...会怎样）
                                  </div>
                                  <div className="space-y-2">
                                    {counterfactuals.map((cf, idx: number) => (
                                      <div
                                        key={idx}
                                        className="rounded-lg border border-blue-200 bg-blue-50 p-2 text-xs"
                                      >
                                        <div className="font-medium text-blue-800">
                                          回合{cf.round}：{cf.scenario}
                                        </div>
                                        <p className="mt-1 text-blue-700">
                                          → {cf.potentialOutcome}
                                        </p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* 如果没有任何报告内容 */}
                              {keyFindings.length === 0 &&
                                biasesDetected.length === 0 &&
                                blindspots.length === 0 &&
                                blackSwanEvents.length === 0 &&
                                counterfactuals.length === 0 &&
                                causalChain.length === 0 && (
                                  <div className="text-center text-xs text-gray-500">
                                    推演数据分析中，复盘报告即将生成...
                                  </div>
                                )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {/* 推演完成但无报告 */}
                  {run.status === 'COMPLETED' && !run.summary && (
                    <div className="mt-6 rounded-lg border-2 border-dashed border-gray-300 p-4 text-center">
                      <div className="text-sm text-gray-500">推演已完成</div>
                      <div className="mt-1 text-xs text-gray-400">
                        复盘报告生成中或暂无数据...
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Controls (Right) */}
            <div className="flex w-1/4 flex-col border-l border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-gray-900">
                  人类干预
                </h2>
              </div>
              <div className="flex flex-1 flex-col overflow-y-auto p-4">
                <div className="flex-1 space-y-4">
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800">
                    <p className="font-medium">干预说明：</p>
                    <ul className="mt-2 list-inside list-disc space-y-1">
                      <li>暂停推演并注入事件</li>
                      <li>修改约束条件</li>
                      <li>触发黑天鹅事件</li>
                      <li>调整 agent 状态</li>
                    </ul>
                  </div>

                  {run.params?.humanBreakEvery != null && (
                    <div className="text-xs text-gray-600">
                      <p>
                        每 {String(run.params.humanBreakEvery)}{' '}
                        回合自动暂停等待干预
                      </p>
                    </div>
                  )}

                  {/* 干预历史记录 */}
                  {run.worldState?.interventions &&
                    run.worldState.interventions.length > 0 && (
                      <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3">
                        <div className="mb-2 flex items-center justify-between text-xs">
                          <span className="font-semibold text-cyan-700">
                            📝 干预历史
                          </span>
                          <span className="rounded-full bg-cyan-200 px-2 py-0.5 text-[10px] font-medium text-cyan-700">
                            {run.worldState.interventions.length} 次
                          </span>
                        </div>
                        <div className="max-h-32 space-y-2 overflow-y-auto">
                          {run.worldState.interventions.map(
                            (iv, idx: number) => (
                              <div
                                key={idx}
                                className="rounded bg-white p-2 text-xs"
                              >
                                <div className="text-gray-800">
                                  {iv.message}
                                </div>
                                {iv.round && (
                                  <div className="mt-1 text-[10px] text-gray-400">
                                    第 {iv.round} 轮 ·{' '}
                                    {iv.timestamp ? (
                                      <ClientDate
                                        date={iv.timestamp}
                                        format="time"
                                      />
                                    ) : (
                                      ''
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}
                </div>

                <div className="space-y-2">
                  <textarea
                    value={interventionText}
                    onChange={(e) => setInterventionText(e.target.value)}
                    placeholder="输入干预指令或事件描述..."
                    rows={4}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <button
                    onClick={handleIntervention}
                    disabled={intervening || !interventionText.trim()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    {intervening ? '发送中...' : '发送干预'}
                  </button>

                  {/* Quick Actions */}
                  <div className="border-t border-gray-200 pt-2">
                    <div className="mb-2 text-xs font-medium text-gray-700">
                      快速注入事件
                    </div>
                    <div className="space-y-1">
                      <button
                        onClick={() =>
                          setInterventionText(
                            '[黑天鹅] 供应链中断：主要芯片供应商遭遇产能危机，交付周期延长至6个月'
                          )
                        }
                        className="w-full rounded border border-gray-200 px-2 py-1.5 text-left text-xs text-gray-700 hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
                      >
                        🌪️ 供应链中断
                      </button>
                      <button
                        onClick={() =>
                          setInterventionText(
                            '[舆情事件] 某大厂被曝AI训练数据合规问题，股价下跌15%，监管介入调查'
                          )
                        }
                        className="w-full rounded border border-gray-200 px-2 py-1.5 text-left text-xs text-gray-700 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700"
                      >
                        📰 重大新闻曝光
                      </button>
                      <button
                        onClick={() =>
                          setInterventionText(
                            '[监管政策] 出口管制升级：高端AI芯片出口许可范围扩大，部分区域全面禁售'
                          )
                        }
                        className="w-full rounded border border-gray-200 px-2 py-1.5 text-left text-xs text-gray-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                      >
                        ⚖️ 出口管制升级
                      </button>
                      <button
                        onClick={() =>
                          setInterventionText(
                            '[市场剧变] GPU现货价格暴涨40%，算力租赁成本飙升，中小客户纷纷寻找替代方案'
                          )
                        }
                        className="w-full rounded border border-gray-200 px-2 py-1.5 text-left text-xs text-gray-700 hover:border-green-300 hover:bg-green-50 hover:text-green-700"
                      >
                        💰 价格剧烈波动
                      </button>
                      <button
                        onClick={() =>
                          setInterventionText(
                            '[技术突破] 竞争对手发布新一代芯片，能效比提升2倍，市场格局面临洗牌'
                          )
                        }
                        className="w-full rounded border border-gray-200 px-2 py-1.5 text-left text-xs text-gray-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                      >
                        🚀 技术突破
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  );
}
