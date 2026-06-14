'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamicImport from 'next/dynamic';
import AppShell from '@/components/layout/AppShell';
import { config } from '@/lib/utils/config';
import { getAuthHeader, getCurrentUser } from '@/lib/utils/auth';
import { MessageSquare, X, Send, Loader2, RefreshCw, Zap } from 'lucide-react';
import { LoadingState } from '@/components/ui/states';

import { logger } from '@/lib/utils/logger';
export const dynamic = 'force-dynamic';

// 懒加载 D3 图谱组件
const KnowledgeGraphView = dynamicImport(
  () => import('@/components/common/views/KnowledgeGraphView'),
  { ssr: false, loading: () => <GraphLoadingSkeleton /> }
);

interface GraphNode {
  id: string;
  label: string;
  type:
    | 'User'
    | 'Collection'
    | 'Resource'
    | 'Note'
    | 'Author'
    | 'Topic'
    | 'Tag';
  properties: {
    title?: string;
    username?: string;
    name?: string;
    // 用户个性化数据
    readStatus?: string;
    readProgress?: number;
    userNote?: string;
    userTags?: string[];
    addedAt?: string;
    // Collection 属性
    description?: string;
    icon?: string;
    color?: string;
    itemCount?: number;
    // Note 属性
    contentPreview?: string;
  };
}

interface GraphLink {
  source: string;
  target: string;
  type: string;
  weight?: number;
}

interface GraphOverview {
  nodes: GraphNode[];
  edges: GraphLink[];
  stats: {
    totalResources: number;
    totalAuthors: number;
    totalTopics: number;
    totalTags: number;
    totalEdges: number;
    totalCollections?: number;
    totalNotes?: number;
  };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function GraphLoadingSkeleton() {
  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
      <div className="text-center">
        <div className="mx-auto h-16 w-16 animate-pulse rounded-full bg-gradient-to-r from-purple-400 to-blue-400" />
        <p className="mt-4 text-gray-600">Loading knowledge graph...</p>
      </div>
    </div>
  );
}

function EmptyState({ onBuild }: { onBuild: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="text-center">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-blue-100">
          <svg
            className="h-12 w-12 text-purple-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-gray-900">
          Knowledge Graph is Empty
        </h2>
        <p className="mt-2 max-w-md text-gray-600">
          Build connections between your resources, authors, topics, and tags to
          discover hidden relationships and insights.
        </p>
        <button
          onClick={onBuild}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-500 to-blue-500 px-6 py-3 font-medium text-white shadow-lg transition-all hover:shadow-xl"
        >
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 10V3L4 14h7v7l9-11h-7z"
            />
          </svg>
          Build Knowledge Graph
        </button>
      </div>
    </div>
  );
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  'What topics appear most frequently?',
  'Which authors have the most connections?',
  'What are the key themes in my library?',
];

interface ChatPanelProps {
  userId: string | null;
  collectionId: string | null;
  onClose: () => void;
}

function ChatPanel({ userId, collectionId, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const userMsg: ChatMessage = { role: 'user', content: trimmed };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const res = await fetch(`${config.apiUrl}/knowledge-graph/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ message: trimmed, userId, collectionId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.reply },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
        },
      ]);
      logger.error('Graph chat error:', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full w-80 flex-shrink-0 flex-col border-l border-gray-200 bg-white">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-semibold text-gray-800">
            Graph Chat
          </span>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              Ask me anything about your knowledge graph — connections,
              patterns, insights.
            </p>
            <div className="space-y-2">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-600 transition-colors hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-purple-500 text-white'
                    : 'bg-gray-100 text-gray-800'
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-lg bg-gray-100 px-3 py-2">
              <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
              <span className="text-xs text-gray-400">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 px-3 py-3">
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-purple-400 focus-within:bg-white">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Ask about your graph..."
            className="flex-1 bg-transparent text-xs text-gray-800 placeholder-gray-400 outline-none"
            disabled={sending}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || sending}
            className="rounded p-0.5 text-purple-500 hover:text-purple-700 disabled:opacity-30"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function KnowledgeGraphPageContent() {
  const searchParams = useSearchParams();
  const [graphData, setGraphData] = useState<GraphOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  // 从 URL 获取 collectionId 参数
  const collectionId = searchParams?.get('collectionId');

  // 获取当前用户 ID
  useEffect(() => {
    const user = getCurrentUser();
    if (user?.id) {
      setUserId(user.id);
    }
  }, []);

  const fetchGraphOverview = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      // 构建 API URL，包含用户个性化参数
      const params = new URLSearchParams();
      if (userId) {
        params.append('userId', userId);
      }
      if (collectionId) {
        params.append('collectionId', collectionId);
      }
      const queryString = params.toString();
      const url = `${config.apiUrl}/knowledge-graph/overview${queryString ? `?${queryString}` : ''}`;

      const response = await fetch(url, {
        headers: {
          ...getAuthHeader(),
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch knowledge graph');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      setGraphData(data);
    } catch (err) {
      logger.error('Error fetching graph:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [userId, collectionId]);

  const buildGraph = useCallback(async () => {
    try {
      setBuilding(true);
      setError(null);

      const response = await fetch(
        `${config.apiUrl}/knowledge-graph/build-all`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to build knowledge graph');
      }

      // Refresh the graph after building
      await fetchGraphOverview();
    } catch (err) {
      logger.error('Error building graph:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBuilding(false);
    }
  }, [fetchGraphOverview]);

  // 当 userId 或 collectionId 变化时重新获取数据
  useEffect(() => {
    // 等待 userId 加载完成后再获取数据
    if (userId !== null) {
      fetchGraphOverview();
    }
  }, [userId, collectionId, fetchGraphOverview]);

  const hasData = graphData && graphData.nodes && graphData.nodes.length > 0;

  return (
    <AppShell>
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Knowledge Graph
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Explore connections between resources, authors, topics, and tags
            </p>
          </div>
          <div className="flex items-center gap-3">
            {hasData && (
              <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
                {graphData.stats?.totalCollections !== undefined &&
                  graphData.stats.totalCollections > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-indigo-500" />
                      {graphData.stats.totalCollections} Collections
                    </span>
                  )}
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-blue-500" />
                  {graphData.stats?.totalResources || 0} Resources
                </span>
                {graphData.stats?.totalNotes !== undefined &&
                  graphData.stats.totalNotes > 0 && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />
                      {graphData.stats.totalNotes} Notes
                    </span>
                  )}
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  {graphData.stats?.totalAuthors || 0} Authors
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-orange-500" />
                  {graphData.stats?.totalTopics || 0} Topics
                </span>
              </div>
            )}
            {/* Chat toggle */}
            <button
              onClick={() => setChatOpen((v) => !v)}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                chatOpen
                  ? 'border-purple-300 bg-purple-50 text-purple-700'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              <Zap className="h-4 w-4" />
              Chat
            </button>
            <button
              onClick={buildGraph}
              disabled={building}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {building ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Building...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Rebuild
                </>
              )}
            </button>
          </div>
        </header>

        {/* Content + Chat Panel */}
        <div className="flex flex-1 overflow-hidden">
          {/* Graph area */}
          <div className="flex-1 overflow-hidden">
            {loading ? (
              <GraphLoadingSkeleton />
            ) : error ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                    <svg
                      className="h-8 w-8 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <p className="mt-4 text-gray-600">{error}</p>
                  <button
                    onClick={fetchGraphOverview}
                    className="mt-4 rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : hasData ? (
              <KnowledgeGraphView
                nodes={graphData.nodes}
                edges={graphData.edges}
              />
            ) : (
              <EmptyState onBuild={buildGraph} />
            )}
          </div>

          {/* Chat panel */}
          {chatOpen && (
            <ChatPanel
              userId={userId}
              collectionId={collectionId ?? null}
              onClose={() => setChatOpen(false)}
            />
          )}
        </div>
      </main>
    </AppShell>
  );
}

export default function KnowledgeGraphPage() {
  return (
    <Suspense fallback={<LoadingState fullScreen text="Loading..." />}>
      <KnowledgeGraphPageContent />
    </Suspense>
  );
}
