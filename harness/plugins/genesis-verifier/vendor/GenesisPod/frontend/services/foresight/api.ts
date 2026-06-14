/**
 * AI 前瞻（Foresight）API client
 *
 * 后端走全局 ResponseTransformInterceptor，响应被包成
 *   { success: true, data: {...}, metadata: {...} }
 * 所有调用 unwrapStandard() 取出 .data。
 */

import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

const API_BASE = `${config.apiBaseUrl}/api/v1/foresight`;

export interface ForesightSource {
  org: string;
  title: string;
  type: string;
  url: string;
}

export interface ForesightScenario {
  scenario: string;
  p: number;
  conf: number;
}

export interface ForesightCard {
  id: string;
  cardKey: string;
  layer: string;
  title: string;
  claim: string;
  conf: number;
  sens: 'high' | 'mid' | 'low';
  horizon: number;
  stage: 'current' | 'evolving' | 'exploring' | 'research';
  evidence: string[];
  falsifiers: string[];
  sources: ForesightSource[];
  scenarios: ForesightScenario[] | null;
  originType: string;
}

export interface ForesightEdge {
  id: string;
  fromCardId: string;
  toCardId: string;
  metric: string;
  type: 'flow' | 'constrain';
  weight: number;
}

export interface ForesightSignalBasis {
  falsifier?: string;
  dir?: string;
  threshold?: string;
  observed?: string;
  gradeNote?: string;
  sources?: ForesightSource[];
}

export interface ForesightSignal {
  id: string;
  name: string;
  targetCardId: string;
  direction: 'down' | 'up';
  targetConf: number;
  effect: string;
  basis: ForesightSignalBasis;
  grade: 'strong' | 'weak' | 'none';
  status: 'candidate' | 'injected' | 'archived';
  injectedAt: string | null;
}

export interface ForesightReviewItem {
  id: string;
  signalId: string;
  cardId: string;
  impact: number;
  depth: number;
  isSource: boolean;
  status: 'pending' | 'resolved';
  decision: 'adjust' | 'keep' | null;
  confFrom: number | null;
  confTo: number | null;
}

export interface ForesightConclusion {
  id: string;
  conclKey: string;
  title: string;
  body: string;
  decisions: string[];
  trigger: string;
  upstreamKeys: string[];
  conf: number;
  horizon: number;
}

export interface ForesightConfLog {
  id: string;
  fromConf: number;
  toConf: number;
  actor: string;
  reason: string;
  createdAt: string;
}

export interface ForesightLayerDef {
  id: string;
  name: string;
  en?: string;
}

export interface ForesightTopic {
  id: string;
  name: string;
  description: string | null;
  layers: ForesightLayerDef[];
  cardCount?: number;
}

export interface ForesightOverview {
  topic: ForesightTopic;
  cards: ForesightCard[];
  edges: ForesightEdge[];
  signals: ForesightSignal[];
  reviewItems: ForesightReviewItem[];
  conclusions: ForesightConclusion[];
}

export interface InjectResult {
  signalId: string;
  markedCount: number;
  observed: Array<{ cardId: string; impact: number }>;
  impact: Record<string, number>;
}

function unwrapStandard<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const wrapper = raw as { data?: unknown };
    if (wrapper.data !== undefined && wrapper.data !== null) {
      return wrapper.data as T;
    }
  }
  return raw as T;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeader(),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`foresight api ${res.status}: ${body.slice(0, 300)}`);
  }
  return unwrapStandard<T>(await res.json());
}

export function fetchTopics(): Promise<ForesightTopic[]> {
  return request<ForesightTopic[]>('/topics');
}

export interface CreateTopicInput {
  name: string;
  description?: string;
  layers: ForesightLayerDef[];
}

export function createTopic(input: CreateTopicInput): Promise<ForesightTopic> {
  return request<ForesightTopic>('/topics', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function updateTopic(
  topicId: string,
  patch: Partial<CreateTopicInput>
): Promise<ForesightTopic> {
  return request<ForesightTopic>(`/topics/${encodeURIComponent(topicId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function deleteTopic(topicId: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(
    `/topics/${encodeURIComponent(topicId)}`,
    { method: 'DELETE' }
  );
}

export function fetchOverview(topicId: string): Promise<ForesightOverview> {
  return request<ForesightOverview>(
    `/overview?topicId=${encodeURIComponent(topicId)}`
  );
}

export function seedDemo(): Promise<{ seeded: boolean }> {
  return request<{ seeded: boolean }>('/seed', { method: 'POST' });
}

export function injectSignal(signalId: string): Promise<InjectResult> {
  return request<InjectResult>(
    `/signals/${encodeURIComponent(signalId)}/inject`,
    { method: 'POST' }
  );
}

export function resolveReview(
  itemId: string,
  decision: 'adjust' | 'keep'
): Promise<{ item: ForesightReviewItem; card: ForesightCard }> {
  return request(`/review/${encodeURIComponent(itemId)}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ decision }),
  });
}

export function fetchLedger(cardId: string): Promise<ForesightConfLog[]> {
  return request<ForesightConfLog[]>(
    `/cards/${encodeURIComponent(cardId)}/ledger`
  );
}

export interface CreateCardInput {
  topicId: string;
  cardKey: string;
  layer: string;
  title: string;
  claim: string;
  conf: number;
  sens: string;
  horizon: number;
  stage: string;
  evidence?: string[];
  falsifiers?: string[];
  sources?: ForesightSource[];
  scenarios?: ForesightScenario[];
  originType?: string;
}

export function createCard(input: CreateCardInput): Promise<ForesightCard> {
  return request<ForesightCard>('/cards', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export interface CreateEdgeInput {
  topicId: string;
  fromKey: string;
  toKey: string;
  metric: string;
  type?: 'flow' | 'constrain';
  weight?: number;
}

export function createEdge(input: CreateEdgeInput): Promise<ForesightEdge> {
  return request<ForesightEdge>('/edges', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

// ── P2/P3 供料：雷达扫描 + 洞察导入 ──────────────────────────────────────

export interface RadarScanResult {
  scanned: number;
  matched: number;
  created: number;
}

export function scanRadar(topicId: string): Promise<RadarScanResult> {
  return request<RadarScanResult>(
    `/topics/${encodeURIComponent(topicId)}/intake/radar-scan`,
    { method: 'POST' }
  );
}

export interface InsightMissionItem {
  id: string;
  title: string;
  preview?: string;
  createdAt: string;
}

export function fetchInsightMissions(): Promise<InsightMissionItem[]> {
  return request<InsightMissionItem[]>('/intake/missions');
}

export interface DraftCard {
  layer: string;
  title: string;
  claim: string;
  conf: number;
  sens: 'high' | 'mid' | 'low';
  horizon: number;
  stage: 'current' | 'evolving' | 'exploring' | 'research';
  evidence: string[];
  falsifiers: string[];
  sources: ForesightSource[];
}

export function extractFromMission(
  topicId: string,
  sourceId: string
): Promise<{ drafts: DraftCard[]; missionTitle: string }> {
  return request(`/topics/${encodeURIComponent(topicId)}/intake/extract`, {
    method: 'POST',
    body: JSON.stringify({ sourceId }),
  });
}
