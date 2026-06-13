/**
 * Drawer-derive —— 把 linkedAgent.trace 里的 action/observation 解析为结构化
 * 区块（参考 Topic Insights TodoDetailPanel 的 SearchResults / ToolUsage 派生）。
 *
 * 派生产物：
 *   - findings[]    研究维度的核心发现（finalize.output.findings）
 *   - toolUsage[]   按 toolId 聚合的工具调用统计 + 示例 query
 *   - sources[]     去重的引用来源 list（含 title + url + 出现次数）
 *   - searchResults[]  按时间序列出每次搜索的 query + 顶部结果（title/url/snippet）
 *
 * 不做 JSON.stringify 兜底；解析失败的字段直接 omit。
 */

import type {
  AgentLiveState,
  AgentTraceItem,
} from './mission-presentation.types';

export interface ParsedFinding {
  claim: string;
  evidence?: string;
  source?: string;
}

export interface ParsedToolUsage {
  toolId: string;
  callCount: number;
  /** 前 3 个不重复的 query/url 示例 */
  samples: string[];
  /** 累计返回结果条数（observation 里 results 的总数） */
  totalResults: number;
}

export interface ParsedSource {
  title?: string;
  url: string;
  domain?: string;
  /** 在 trace 中被引用次数 */
  hits: number;
}

export interface ParsedSearchCall {
  toolId: string;
  query?: string;
  results: { title?: string; url?: string; snippet?: string }[];
  ts: number;
  latencyMs?: number;
  errorMessage?: string;
}

export interface DrawerDerived {
  findings: ParsedFinding[];
  toolUsage: ParsedToolUsage[];
  sources: ParsedSource[];
  searchCalls: ParsedSearchCall[];
  totalTokens: number;
  /** finalize 后的整段叙述（如 researcher.summary） */
  finalizeSummary?: string;
}

/** 安全提取 host */
function safeHost(u: string): string | undefined {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

/** 把 string/object 试解 JSON，失败返回原值 */
function tryParse(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const s = v.trim();
  if (
    !(
      (s.startsWith('{') && s.endsWith('}')) ||
      (s.startsWith('[') && s.endsWith(']'))
    )
  )
    return v;
  try {
    return JSON.parse(s);
  } catch {
    return v;
  }
}

/** 递归收集 search-result 形（{title?, url?, snippet|content|description?}）的对象 */
function collectSearchResults(node: unknown): {
  title?: string;
  url?: string;
  snippet?: string;
}[] {
  const out: { title?: string; url?: string; snippet?: string }[] = [];
  const visit = (n: unknown) => {
    if (!n) return;
    if (typeof n === 'string') {
      const parsed = tryParse(n);
      if (parsed !== n) visit(parsed);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (typeof o.title === 'string' || typeof o.url === 'string') {
      out.push({
        title: typeof o.title === 'string' ? o.title : undefined,
        url: typeof o.url === 'string' ? o.url : undefined,
        snippet:
          typeof o.snippet === 'string'
            ? o.snippet
            : typeof o.description === 'string'
              ? o.description
              : typeof o.content === 'string'
                ? o.content.slice(0, 280)
                : undefined,
      });
    }
    for (const k of [
      'results',
      'items',
      'hits',
      'output',
      'data',
      'preview',
      'subResults',
    ]) {
      if (o[k] !== undefined) visit(o[k]);
    }
  };
  visit(node);
  return out;
}

/** 从 trace 里提取最后一次 finalize 的 output（兼容 raw / wrapped） */
function extractFinalizeOutput(trace: AgentTraceItem[]): unknown {
  for (let i = trace.length - 1; i >= 0; i--) {
    const t = trace[i];
    if (t.kind === 'observation' && !t.error) {
      const out = tryParse(t.output);
      if (out && typeof out === 'object') return out;
    }
    if (t.kind === 'action' && (t.toolId === 'finalize' || t.toolId == null)) {
      const inp = tryParse(t.input);
      if (inp && typeof inp === 'object') return inp;
    }
  }
  return null;
}

export function deriveDrawerSections(
  agent: AgentLiveState | undefined
): DrawerDerived {
  const empty: DrawerDerived = {
    findings: [],
    toolUsage: [],
    sources: [],
    searchCalls: [],
    totalTokens: 0,
  };
  if (!agent || agent.trace.length === 0) return empty;
  const trace = agent.trace;

  // ── findings: 从 finalize output 找 .findings[] 或 .results[] ──
  const findings: ParsedFinding[] = [];
  let finalizeSummary: string | undefined;
  const finalizeOut = extractFinalizeOutput(trace);
  if (finalizeOut && typeof finalizeOut === 'object') {
    const fo = finalizeOut as Record<string, unknown>;
    if (Array.isArray(fo.findings)) {
      for (const f of fo.findings) {
        if (f && typeof f === 'object') {
          const ff = f as Record<string, unknown>;
          if (typeof ff.claim === 'string' && ff.claim.length > 0) {
            findings.push({
              claim: ff.claim,
              evidence:
                typeof ff.evidence === 'string' ? ff.evidence : undefined,
              source: typeof ff.source === 'string' ? ff.source : undefined,
            });
          }
        }
      }
    }
    if (typeof fo.summary === 'string' && fo.summary.length > 8) {
      finalizeSummary = fo.summary;
    }
  }

  // ── tool usage + search calls + sources ──
  const toolMap = new Map<string, ParsedToolUsage>();
  const sourceMap = new Map<string, ParsedSource>();
  const searchCalls: ParsedSearchCall[] = [];
  let totalTokens = 0;

  // 把 action / observation 配对（同一 toolId + 时间相邻）
  for (let i = 0; i < trace.length; i++) {
    const t = trace[i];
    if (t.kind !== 'action' || !t.toolId) continue;
    const action = t;
    // 找相邻 observation（同 toolId 或下一个 observation）
    let observation: AgentTraceItem | undefined;
    for (let j = i + 1; j < Math.min(trace.length, i + 4); j++) {
      const candidate = trace[j];
      if (candidate.kind === 'observation') {
        observation = candidate;
        break;
      }
    }
    // 解包 parallel_tool_call
    if (action.toolId === 'parallel_tool_call' && Array.isArray(action.input)) {
      const subResults =
        observation && !observation.error
          ? collectSearchResults(observation.output)
          : [];
      for (const sub of action.input as unknown[]) {
        if (!sub || typeof sub !== 'object') continue;
        const o = sub as Record<string, unknown>;
        const subToolId =
          typeof o.toolId === 'string'
            ? o.toolId
            : typeof o.tool === 'string'
              ? o.tool
              : 'unknown';
        const inp = (o.input ?? {}) as Record<string, unknown>;
        const query =
          typeof inp.query === 'string'
            ? inp.query
            : typeof inp.url === 'string'
              ? inp.url
              : undefined;
        bumpTool(toolMap, subToolId, query);
        searchCalls.push({
          toolId: subToolId,
          query,
          results: subResults,
          ts: action.ts,
          latencyMs: observation?.latencyMs,
          errorMessage: observation?.error,
        });
      }
      // sources from sub results
      for (const r of subResults)
        if (r.url) bumpSource(sourceMap, r.url, r.title);
    } else {
      const toolId = action.toolId;
      if (!toolId) continue;
      const inp = (action.input ?? {}) as Record<string, unknown>;
      const query =
        typeof inp.query === 'string'
          ? inp.query
          : typeof inp.url === 'string'
            ? inp.url
            : undefined;
      bumpTool(toolMap, toolId, query);
      let results: { title?: string; url?: string; snippet?: string }[] = [];
      if (observation && !observation.error) {
        results = collectSearchResults(observation.output);
      }
      searchCalls.push({
        toolId,
        query,
        results,
        ts: action.ts,
        latencyMs: observation?.latencyMs,
        errorMessage: observation?.error,
      });
      for (const r of results) if (r.url) bumpSource(sourceMap, r.url, r.title);
    }
  }
  for (const t of trace) {
    if (t.kind === 'observation' && t.tokensUsed) totalTokens += t.tokensUsed;
  }

  return {
    findings,
    toolUsage: [...toolMap.values()].sort((a, b) => b.callCount - a.callCount),
    sources: [...sourceMap.values()].sort((a, b) => b.hits - a.hits),
    searchCalls,
    totalTokens,
    finalizeSummary,
  };
}

function bumpTool(
  map: Map<string, ParsedToolUsage>,
  toolId: string,
  sample?: string
) {
  let cur = map.get(toolId);
  if (!cur) {
    cur = { toolId, callCount: 0, samples: [], totalResults: 0 };
    map.set(toolId, cur);
  }
  cur.callCount += 1;
  if (sample && cur.samples.length < 3 && !cur.samples.includes(sample)) {
    cur.samples.push(sample);
  }
}

function bumpSource(
  map: Map<string, ParsedSource>,
  url: string,
  title?: string
) {
  let cur = map.get(url);
  if (!cur) {
    cur = { url, title, domain: safeHost(url), hits: 0 };
    map.set(url, cur);
  }
  cur.hits += 1;
  if (!cur.title && title) cur.title = title;
}

/** 工具中文名映射（参考 TI TodoDetailPanel） */
export const TOOL_LABEL: Record<string, { label: string; emoji: string }> = {
  'web-search': { label: '网络搜索', emoji: '🔍' },
  'web-scraper': { label: '网页抓取', emoji: '🌐' },
  'arxiv-search': { label: 'arXiv 学术', emoji: '🎓' },
  'github-search': { label: 'GitHub 代码', emoji: '💻' },
  'knowledge-base': { label: '知识库', emoji: '📚' },
  'rag-search': { label: '知识库', emoji: '📚' },
  'federal-register': { label: '联邦公报', emoji: '📜' },
  'congress-gov': { label: '国会立法', emoji: '⚖️' },
  'whitehouse-news': { label: '白宫新闻', emoji: '🏛️' },
  'academic-search': { label: '学术搜索', emoji: '🎓' },
  hackernews: { label: 'HackerNews', emoji: '📰' },
  finalize: { label: '完成产出', emoji: '✅' },
};
