'use client';

import React, { useState } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { TruncatedCell } from '@/components/common/tables';
import { useRouter } from 'next/navigation';
import { safeString } from '@/lib/utils/common';
import {
  Loader2,
  RefreshCw,
  Download,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Check,
  X,
  Eye,
  EyeOff,
  Presentation,
  BookOpen,
} from 'lucide-react';
import { AudioPlayer } from './AudioPlayer';
import type { AudioOverviewScript } from './AudioPlayer';
import { SedimentToInsightsModal } from './SedimentToInsightsModal';

interface Output {
  id: string;
  type: string;
  title: string;
  status: 'PENDING' | 'GENERATING' | 'COMPLETED' | 'FAILED';
  content: string | null;
  error?: string;
  createdAt: string;
}

interface OutputViewerProps {
  output: Output;
  projectId: string;
  onRegenerate: () => void;
  onExport: (format: 'markdown' | 'json') => void;
}

// Type definitions for different output content types
interface FAQQuestion {
  question: string;
  answer: string;
}

interface FAQCategory {
  name: string;
  questions?: FAQQuestion[];
}

interface FAQData {
  categories?: FAQCategory[];
}

interface KeyTerm {
  term: string;
  definition: string;
}

interface StudyQuestion {
  question: string;
  answer: string;
}

interface StudySection {
  title: string;
  content?: string;
  keyTerms?: KeyTerm[];
  objectives?: string[];
  questions?: StudyQuestion[];
}

interface StudyGuideData {
  sections?: StudySection[];
}

interface Finding {
  importance?: 'high' | 'medium' | 'low';
  finding?: string;
}

interface Recommendation {
  action: string;
  rationale: string;
}

interface BriefingDocData {
  executiveSummary?: string;
  keyFindings?: Finding[];
  recommendations?: Recommendation[];
  nextSteps?: string[];
}

interface TimelineEvent {
  date: string;
  title: string;
  description: string;
  importance?: 'major' | 'minor';
}

interface TimelineData {
  events?: TimelineEvent[];
}

interface Trend {
  name: string;
  direction: 'rising' | 'declining' | 'stable';
  description: string;
}

interface Prediction {
  prediction: string;
  timeframe: string;
  probability: string;
}

interface TrendReportData {
  overview?: string;
  trends?: Trend[];
  predictions?: Prediction[];
}

interface DimensionValue {
  value: string;
  notes?: string;
}

interface Dimension {
  name: string;
  values?: Record<string, DimensionValue>;
}

interface ComparisonData {
  dimensions?: Dimension[];
  subjects?: string[];
  summary?: {
    rationale: string;
  };
}

interface KnowledgeNode {
  id: string;
  label: string;
  type?: 'concept' | 'entity' | 'person' | 'other';
  description?: string;
}

interface KnowledgeEdge {
  from: string;
  to: string;
  label: string;
}

interface KnowledgeGraphData {
  nodes?: KnowledgeNode[];
  edges?: KnowledgeEdge[];
}

interface AudioSegment {
  speaker: string;
  text: string;
  emotion?: string;
}

interface AudioScript {
  segments?: AudioSegment[];
}

interface AudioOverviewData {
  title?: string;
  script?: AudioScript;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category?: string;
  tags?: string[];
}

interface FlashcardStats {
  byDifficulty?: {
    easy?: number;
    medium?: number;
    hard?: number;
  };
}

interface FlashcardsData {
  title?: string;
  cards?: Flashcard[];
  stats?: FlashcardStats;
}

interface QuizOption {
  id: string;
  text: string;
}

interface QuizQuestion {
  id: string;
  question: string;
  type: 'multiple_choice' | 'true_false' | 'short_answer';
  difficulty?: 'easy' | 'medium' | 'hard';
  points?: number;
  correctAnswer?: string | boolean;
  options?: QuizOption[];
  explanation?: string;
}

interface QuizSettings {
  passingScore?: number;
}

interface QuizData {
  title?: string;
  questions?: QuizQuestion[];
  settings?: QuizSettings;
}

interface MindMapNode {
  id: string;
  label: string;
  description?: string;
  color?: string;
  children?: MindMapNode[];
}

interface MindMapCentralTopic {
  label: string;
  description?: string;
}

interface MindMapConnection {
  from: string;
  to: string;
  label: string;
}

interface MindMapLegendItem {
  color: string;
  meaning: string;
}

interface MindMapStats {
  totalNodes: number;
  branchCount: number;
  maxDepth: number;
}

interface MindMapData {
  title?: string;
  centralTopic?: MindMapCentralTopic;
  branches?: MindMapNode[];
  connections?: MindMapConnection[];
  legend?: MindMapLegendItem[];
  stats?: MindMapStats;
}

type OutputContent =
  | FAQData
  | StudyGuideData
  | BriefingDocData
  | TimelineData
  | TrendReportData
  | ComparisonData
  | KnowledgeGraphData
  | AudioOverviewData
  | FlashcardsData
  | QuizData
  | MindMapData
  | { raw?: string };

export function OutputViewer({
  output,
  projectId,
  onRegenerate,
  onExport,
}: OutputViewerProps) {
  const router = useRouter();
  const [showSedimentModal, setShowSedimentModal] = useState(false);

  const handleGenerateSlides = () => {
    const params = new URLSearchParams();
    params.set('action', 'import');
    params.set('sourceType', 'research-project');
    params.set('sourceId', projectId);
    params.set('outputId', output.id);
    if (output.title) params.set('title', output.title);
    router.push(`/ai-office/slides?${params.toString()}`);
  };

  if (output.status === 'PENDING' || output.status === 'GENERATING') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
        <p className="mt-4 text-sm text-gray-500">
          {output.status === 'PENDING'
            ? 'Queued for generation...'
            : 'Generating content...'}
        </p>
      </div>
    );
  }

  if (output.status === 'FAILED') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <AlertCircle className="h-8 w-8 text-red-500" />
        <p className="mt-4 text-sm text-red-600">
          {typeof output.error === 'string'
            ? output.error
            : 'Generation failed'}
        </p>
        <button
          onClick={onRegenerate}
          className="mt-4 flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  // Parse content
  let content: OutputContent = {};
  try {
    content = JSON.parse(output.content || '{}') as OutputContent;
  } catch {
    content = { raw: output.content || '' };
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <h2 className="text-lg font-semibold text-gray-900">{output.title}</h2>
        <div className="flex items-center gap-2">
          {output.status === 'COMPLETED' && (
            <button
              onClick={handleGenerateSlides}
              className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <Presentation className="h-4 w-4" />
              生成 PPT
            </button>
          )}
          {output.status === 'COMPLETED' && (
            <button
              onClick={() => setShowSedimentModal(true)}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
            >
              <BookOpen className="h-4 w-4" />
              沉淀到洞察
            </button>
          )}
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            <RefreshCw className="h-4 w-4" />
            Regenerate
          </button>
          <button
            onClick={() => onExport('markdown')}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            <Download className="h-4 w-4" />
            Export
          </button>
        </div>
      </div>

      {/* Content based on type */}
      <div className="prose max-w-none">
        {renderOutputContent(output.type, content, output.id, projectId)}
      </div>

      <SedimentToInsightsModal
        isOpen={showSedimentModal}
        onClose={() => setShowSedimentModal(false)}
        projectId={projectId}
        outputId={output.id}
        outputTitle={output.title}
        outputContent={
          typeof output.content === 'string'
            ? output.content.slice(0, 500)
            : undefined
        }
      />
    </div>
  );
}

function renderOutputContent(
  type: string,
  content: OutputContent,
  outputId: string,
  projectId: string
) {
  switch (type) {
    case 'FAQ':
      return <FAQContent data={content as FAQData} />;
    case 'STUDY_GUIDE':
      return <StudyGuideContent data={content as StudyGuideData} />;
    case 'BRIEFING_DOC':
      return <BriefingDocContent data={content as BriefingDocData} />;
    case 'TIMELINE':
      return <TimelineContent data={content as TimelineData} />;
    case 'TREND_REPORT':
      return <TrendReportContent data={content as TrendReportData} />;
    case 'COMPARISON':
      return <ComparisonContent data={content as ComparisonData} />;
    case 'KNOWLEDGE_GRAPH':
      return <KnowledgeGraphContent data={content as KnowledgeGraphData} />;
    case 'AUDIO_OVERVIEW':
      return (
        <AudioOverviewContent
          data={content as AudioOverviewData}
          outputId={outputId}
          projectId={projectId}
        />
      );
    case 'FLASHCARDS':
      return <FlashcardsContent data={content as FlashcardsData} />;
    case 'QUIZ':
      return <QuizContent data={content as QuizData} />;
    case 'MIND_MAP':
      return <MindMapContent data={content as MindMapData} />;
    default:
      return <pre className="text-sm">{JSON.stringify(content, null, 2)}</pre>;
  }
}

// FAQ Component
function FAQContent({ data }: { data: FAQData }) {
  if (!data.categories) return <p>No FAQ data</p>;

  return (
    <div className="space-y-6">
      {data.categories.map((cat, i) => (
        <div key={i}>
          <h3 className="mb-3 text-lg font-semibold text-purple-700">
            {cat.name}
          </h3>
          <div className="space-y-4">
            {cat.questions?.map((q, j) => (
              <div key={j} className="border-l-4 border-purple-200 pl-4">
                <p className="font-medium text-gray-900">{q.question}</p>
                <p className="mt-1 text-gray-600">{q.answer}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Study Guide Component
function StudyGuideContent({ data }: { data: StudyGuideData }) {
  if (!data.sections) return <p>No study guide data</p>;

  return (
    <div className="space-y-8">
      {data.sections.map((section, i) => (
        <div key={i}>
          <h3 className="mb-3 border-b pb-2 text-lg font-semibold text-purple-700">
            {section.title}
          </h3>

          {section.content && (
            <p className="mb-4 text-gray-700">{section.content}</p>
          )}

          {section.keyTerms && (
            <div className="grid gap-2">
              {section.keyTerms.map((term, j) => (
                <div key={j} className="rounded-lg bg-purple-50 p-3">
                  <span className="font-semibold text-purple-800">
                    {term.term}
                  </span>
                  <span className="ml-2 text-gray-600">{term.definition}</span>
                </div>
              ))}
            </div>
          )}

          {section.objectives && (
            <ul className="list-inside list-disc space-y-1">
              {section.objectives.map((obj, j) => (
                <li key={j} className="text-gray-700">
                  {obj}
                </li>
              ))}
            </ul>
          )}

          {section.questions && (
            <div className="space-y-3">
              {section.questions.map((q, j) => (
                <div key={j} className="rounded-lg bg-gray-50 p-3">
                  <p className="font-medium text-gray-900">{q.question}</p>
                  <p className="mt-1 text-sm text-gray-600">{q.answer}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Briefing Doc Component
function BriefingDocContent({ data }: { data: BriefingDocData }) {
  return (
    <div className="space-y-6">
      {data.executiveSummary && (
        <div className="rounded-lg bg-purple-50 p-4">
          <h3 className="mb-2 font-semibold text-purple-800">
            Executive Summary
          </h3>
          <p className="text-gray-700">{data.executiveSummary}</p>
        </div>
      )}

      {data.keyFindings && (
        <div>
          <h3 className="mb-3 font-semibold text-gray-900">Key Findings</h3>
          <div className="space-y-2">
            {data.keyFindings.map((f, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded border p-2"
              >
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    f.importance === 'high'
                      ? 'bg-red-100 text-red-700'
                      : f.importance === 'medium'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {safeString(f.importance)}
                </span>
                <p className="text-gray-700">{safeString(f.finding)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.recommendations && (
        <div>
          <h3 className="mb-3 font-semibold text-gray-900">Recommendations</h3>
          <div className="space-y-2">
            {data.recommendations.map((r, i) => (
              <div key={i} className="border-l-4 border-green-400 py-2 pl-4">
                <p className="font-medium text-gray-900">{r.action}</p>
                <p className="text-sm text-gray-500">{r.rationale}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.nextSteps && (
        <div>
          <h3 className="mb-3 font-semibold text-gray-900">Next Steps</h3>
          <ol className="list-inside list-decimal space-y-1">
            {data.nextSteps.map((step, i) => (
              <li key={i} className="text-gray-700">
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// Timeline Component
function TimelineContent({ data }: { data: TimelineData }) {
  if (!data.events) return <p>No timeline data</p>;

  return (
    <div className="relative">
      <div className="absolute bottom-0 left-4 top-0 w-0.5 bg-purple-200" />
      <div className="space-y-6">
        {data.events.map((event, i) => (
          <div key={i} className="relative pl-10">
            <div
              className={`absolute left-2 h-4 w-4 rounded-full ${
                event.importance === 'major' ? 'bg-purple-600' : 'bg-purple-300'
              }`}
            />
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="text-sm font-medium text-purple-600">
                {event.date}
              </div>
              <div className="font-semibold text-gray-900">{event.title}</div>
              <p className="mt-1 text-sm text-gray-600">{event.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Trend Report Component
function TrendReportContent({ data }: { data: TrendReportData }) {
  return (
    <div className="space-y-6">
      {data.overview && (
        <p className="rounded-lg bg-gray-50 p-4 text-gray-700">
          {data.overview}
        </p>
      )}

      {data.trends && (
        <div>
          <h3 className="mb-3 font-semibold text-gray-900">
            Identified Trends
          </h3>
          <div className="grid gap-4">
            {data.trends.map((trend, i) => (
              <div key={i} className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-semibold text-gray-900">
                    {trend.name}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-xs ${
                      trend.direction === 'rising'
                        ? 'bg-green-100 text-green-700'
                        : trend.direction === 'declining'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {trend.direction} ↑
                  </span>
                </div>
                <p className="text-sm text-gray-600">{trend.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.predictions && (
        <div>
          <h3 className="mb-3 font-semibold text-gray-900">Predictions</h3>
          <div className="space-y-2">
            {data.predictions.map((p, i) => (
              <div
                key={i}
                className="border-l-4 border-yellow-400 bg-yellow-50 p-3"
              >
                <p className="font-medium text-gray-900">{p.prediction}</p>
                <p className="text-sm text-gray-500">
                  {p.timeframe} • {p.probability} probability
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Comparison Component
function ComparisonContent({ data }: { data: ComparisonData }) {
  if (!data.dimensions || !data.subjects) return <p>No comparison data</p>;

  // Type assertion safe here because we checked above
  const subjects = data.subjects;

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <Table className="min-w-full border-collapse">
          <THead>
            <Tr className="bg-purple-50">
              <Th className="border p-3 text-left">Dimension</Th>
              {subjects.map((s, i) => (
                <Th key={i} className="border p-3 text-left font-semibold">
                  <TruncatedCell className="max-w-[180px] font-semibold">
                    {s}
                  </TruncatedCell>
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {data.dimensions.map((dim, i) => (
              <Tr key={i}>
                <Td className="border bg-gray-50 p-3 font-medium">
                  <TruncatedCell className="max-w-[160px] font-medium">
                    {dim.name}
                  </TruncatedCell>
                </Td>
                {subjects.map((s, j) => (
                  <Td key={j} className="border p-3">
                    <TruncatedCell
                      className="max-w-[200px] font-medium"
                      tooltip={
                        dim.values?.[s]?.notes
                          ? `${dim.values?.[s]?.value || '-'} — ${dim.values[s].notes}`
                          : dim.values?.[s]?.value || '-'
                      }
                    >
                      {dim.values?.[s]?.value || '-'}
                    </TruncatedCell>
                    {dim.values?.[s]?.notes && (
                      <div className="mt-1 line-clamp-2 text-xs text-gray-500">
                        {dim.values[s].notes}
                      </div>
                    )}
                  </Td>
                ))}
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      {data.summary && (
        <div className="rounded-lg bg-purple-50 p-4">
          <h3 className="mb-2 font-semibold text-gray-900">Summary</h3>
          <p className="text-gray-700">{data.summary.rationale}</p>
        </div>
      )}
    </div>
  );
}

// Knowledge Graph Component (简化版)
function KnowledgeGraphContent({ data }: { data: KnowledgeGraphData }) {
  if (!data.nodes) return <p>No knowledge graph data</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        {data.nodes.length} nodes, {data.edges?.length || 0} connections
      </p>

      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {data.nodes.map((node) => (
          <div key={node.id} className="rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  node.type === 'concept'
                    ? 'bg-blue-500'
                    : node.type === 'entity'
                      ? 'bg-green-500'
                      : node.type === 'person'
                        ? 'bg-yellow-500'
                        : 'bg-gray-500'
                }`}
              />
              <span className="font-medium text-gray-900">{node.label}</span>
            </div>
            {node.description && (
              <p className="mt-1 text-xs text-gray-500">{node.description}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Audio Overview Component
function AudioOverviewContent({
  data,
  outputId,
  projectId,
}: {
  data: AudioOverviewData;
  outputId: string;
  projectId: string;
}) {
  if (!data.script?.segments) return <p>No audio script data</p>;

  // Transform data to match AudioPlayer's expected type
  const audioScript: AudioOverviewScript | undefined =
    data.title && data.script
      ? {
          title: data.title,
          script: {
            segments: data.script.segments.map((seg) => ({
              speaker: seg.speaker,
              text: seg.text,
              emotion: seg.emotion,
            })),
            estimatedDuration: '0:00', // Default duration
          },
        }
      : undefined;

  return (
    <div className="space-y-4">
      {/* Audio Player */}
      <AudioPlayer
        outputId={outputId}
        projectId={projectId}
        script={audioScript}
      />

      {/* Script Transcript */}
      <div className="mt-6">
        <h4 className="mb-3 text-sm font-medium text-gray-700">Transcript</h4>
        <div className="space-y-3">
          {data.script.segments.map((seg, i) => (
            <div
              key={i}
              className={`rounded-lg p-3 ${
                seg.speaker === 'Host1'
                  ? 'ml-0 mr-12 bg-blue-50'
                  : 'ml-12 mr-0 bg-green-50'
              }`}
            >
              <div className="mb-1 text-xs font-medium text-gray-500">
                {seg.speaker} {seg.emotion && `(${seg.emotion})`}
              </div>
              <p className="text-gray-800">{seg.text}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Flashcards Component - Interactive card flipping and navigation
function FlashcardsContent({ data }: { data: FlashcardsData }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [knownCards, setKnownCards] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'study' | 'browse'>('study');

  const cards = data.cards || [];
  if (cards.length === 0) return <p>No flashcard data</p>;

  const currentCard = cards[currentIndex];
  const progress = ((currentIndex + 1) / cards.length) * 100;

  const goToNext = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev + 1) % cards.length);
  };

  const goToPrev = () => {
    setIsFlipped(false);
    setCurrentIndex((prev) => (prev - 1 + cards.length) % cards.length);
  };

  const markKnown = () => {
    setKnownCards((prev) => new Set(prev).add(currentCard.id));
    goToNext();
  };

  const resetProgress = () => {
    setKnownCards(new Set());
    setCurrentIndex(0);
    setIsFlipped(false);
  };

  const getDifficultyColor = (difficulty: string) => {
    switch (difficulty) {
      case 'easy':
        return 'bg-green-100 text-green-700';
      case 'medium':
        return 'bg-yellow-100 text-yellow-700';
      case 'hard':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-gray-100 text-gray-700';
    }
  };

  if (viewMode === 'browse') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">{data.title}</h3>
          <button
            onClick={() => setViewMode('study')}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white hover:bg-purple-700"
          >
            Study Mode
          </button>
        </div>

        {/* Stats */}
        <div className="flex gap-4 text-sm text-gray-600">
          <span>{cards.length} cards</span>
          {data.stats?.byDifficulty && (
            <>
              <span className="text-green-600">
                {data.stats.byDifficulty.easy || 0} easy
              </span>
              <span className="text-yellow-600">
                {data.stats.byDifficulty.medium || 0} medium
              </span>
              <span className="text-red-600">
                {data.stats.byDifficulty.hard || 0} hard
              </span>
            </>
          )}
        </div>

        {/* All Cards Grid */}
        <div className="grid gap-3 md:grid-cols-2">
          {cards.map((card, idx) => (
            <div
              key={card.id}
              className={`cursor-pointer rounded-lg border p-4 transition-all hover:shadow-md ${
                knownCards.has(card.id)
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-200'
              }`}
              onClick={() => {
                setCurrentIndex(idx);
                setViewMode('study');
                setIsFlipped(false);
              }}
            >
              <div className="mb-2 flex items-center justify-between">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${getDifficultyColor(card.difficulty)}`}
                >
                  {card.difficulty}
                </span>
                {card.category && (
                  <span className="text-xs text-gray-500">{card.category}</span>
                )}
              </div>
              <p className="font-medium text-gray-900">{card.front}</p>
              <p className="mt-2 line-clamp-2 text-sm text-gray-500">
                {card.back}
              </p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{data.title}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={resetProgress}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            <RotateCcw className="h-4 w-4" />
            Reset
          </button>
          <button
            onClick={() => setViewMode('browse')}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Browse All
          </button>
        </div>
      </div>

      {/* Progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-gray-500">
          <span>
            Card {currentIndex + 1} of {cards.length}
          </span>
          <span>{knownCards.size} known</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full bg-purple-600 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Card */}
      <div
        className="perspective-1000 relative min-h-[300px] cursor-pointer"
        onClick={() => setIsFlipped(!isFlipped)}
      >
        <div
          className={`absolute inset-0 rounded-xl border-2 border-purple-200 bg-white p-6 shadow-lg transition-all duration-500 ${
            isFlipped ? 'rotate-y-180 opacity-0' : ''
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="mb-4 flex items-center justify-between">
              <span
                className={`rounded px-2 py-0.5 text-xs ${getDifficultyColor(currentCard.difficulty)}`}
              >
                {currentCard.difficulty}
              </span>
              {currentCard.category && (
                <span className="text-xs text-gray-500">
                  {currentCard.category}
                </span>
              )}
            </div>
            <div className="flex flex-1 items-center justify-center">
              <p className="text-center text-xl font-medium text-gray-900">
                {currentCard.front}
              </p>
            </div>
            <p className="text-center text-xs text-gray-400">
              Click to reveal answer
            </p>
          </div>
        </div>
        <div
          className={`absolute inset-0 rounded-xl border-2 border-green-200 bg-green-50 p-6 shadow-lg transition-all duration-500 ${
            isFlipped ? '' : 'rotate-y-180 opacity-0'
          }`}
        >
          <div className="flex h-full flex-col">
            <div className="mb-4 text-center text-xs font-medium text-green-600">
              ANSWER
            </div>
            <div className="flex flex-1 items-center justify-center">
              <p className="text-center text-lg text-gray-800">
                {currentCard.back}
              </p>
            </div>
            {currentCard.tags && currentCard.tags.length > 0 && (
              <div className="mt-4 flex flex-wrap justify-center gap-1">
                {currentCard.tags.map((tag, i) => (
                  <span
                    key={i}
                    className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-center gap-4">
        <button
          onClick={goToPrev}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button
          onClick={markKnown}
          disabled={knownCards.has(currentCard.id)}
          className="flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2 text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
          {knownCards.has(currentCard.id) ? 'Known' : 'Mark as Known'}
        </button>
        <button
          onClick={goToNext}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

// Quiz Component - Interactive quiz with scoring
function QuizContent({ data }: { data: QuizData }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | boolean>>({});
  const [showResults, setShowResults] = useState(false);
  const [showExplanation, setShowExplanation] = useState<string | null>(null);

  const questions = data.questions || [];
  if (questions.length === 0) return <p>No quiz data</p>;

  const currentQuestion = questions[currentIndex];
  const isAnswered = answers[currentQuestion.id] !== undefined;
  const allAnswered = questions.every((q) => answers[q.id] !== undefined);

  const handleAnswer = (answer: string | boolean) => {
    setAnswers((prev) => ({ ...prev, [currentQuestion.id]: answer }));
  };

  const calculateScore = () => {
    let score = 0;
    let totalPoints = 0;
    questions.forEach((q) => {
      totalPoints += q.points || 1;
      const userAnswer = answers[q.id];
      if (q.type === 'multiple_choice' && userAnswer === q.correctAnswer) {
        score += q.points || 1;
      } else if (q.type === 'true_false' && userAnswer === q.correctAnswer) {
        score += q.points || 1;
      }
    });
    return {
      score,
      totalPoints,
      percentage: Math.round((score / totalPoints) * 100),
    };
  };

  const isCorrect = (questionId: string) => {
    const q = questions.find((q) => q.id === questionId);
    if (!q) return false;
    return answers[questionId] === q.correctAnswer;
  };

  if (showResults) {
    const { score, totalPoints, percentage } = calculateScore();
    const passed = percentage >= (data.settings?.passingScore || 70);

    return (
      <div className="space-y-6">
        {/* Result Header */}
        <div
          className={`rounded-xl p-6 text-center ${passed ? 'bg-green-50' : 'bg-red-50'}`}
        >
          <div
            className={`text-5xl font-bold ${passed ? 'text-green-600' : 'text-red-600'}`}
          >
            {percentage}%
          </div>
          <p
            className={`mt-2 text-lg ${passed ? 'text-green-700' : 'text-red-700'}`}
          >
            {passed
              ? 'Congratulations! You passed!'
              : 'Keep studying and try again!'}
          </p>
          <p className="mt-1 text-sm text-gray-600">
            Score: {score} / {totalPoints} points
          </p>
        </div>

        {/* Review Questions */}
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-900">Review Answers</h4>
          {questions.map((q, idx) => {
            const correct = isCorrect(q.id);
            return (
              <div
                key={q.id}
                className={`rounded-lg border p-4 ${correct ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}
              >
                <div className="flex items-start gap-2">
                  {correct ? (
                    <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" />
                  ) : (
                    <X className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600" />
                  )}
                  <div className="flex-1">
                    <p className="font-medium text-gray-900">
                      {idx + 1}. {q.question}
                    </p>
                    <p className="mt-1 text-sm text-gray-600">
                      Your answer: {String(answers[q.id])}
                      {!correct && (
                        <span className="ml-2 text-green-600">
                          Correct: {String(q.correctAnswer)}
                        </span>
                      )}
                    </p>
                    {q.explanation && (
                      <p className="mt-2 rounded bg-white/50 p-2 text-sm text-gray-700">
                        {q.explanation}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Retry Button */}
        <button
          onClick={() => {
            setAnswers({});
            setCurrentIndex(0);
            setShowResults(false);
          }}
          className="w-full rounded-lg bg-purple-600 py-3 text-white hover:bg-purple-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{data.title}</h3>
        <span className="text-sm text-gray-500">
          Question {currentIndex + 1} of {questions.length}
        </span>
      </div>

      {/* Progress */}
      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full bg-purple-600 transition-all"
          style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
        />
      </div>

      {/* Question */}
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs ${
              currentQuestion.difficulty === 'easy'
                ? 'bg-green-100 text-green-700'
                : currentQuestion.difficulty === 'medium'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-red-100 text-red-700'
            }`}
          >
            {currentQuestion.difficulty}
          </span>
          <span className="text-xs text-gray-500">
            {currentQuestion.points || 1} point(s)
          </span>
        </div>

        <p className="text-lg font-medium text-gray-900">
          {currentQuestion.question}
        </p>

        {/* Answer Options */}
        <div className="mt-6 space-y-2">
          {currentQuestion.type === 'multiple_choice' &&
            currentQuestion.options?.map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleAnswer(opt.id)}
                className={`w-full rounded-lg border p-3 text-left transition-all ${
                  answers[currentQuestion.id] === opt.id
                    ? 'border-purple-500 bg-purple-50 text-purple-900'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="font-medium">{opt.id.toUpperCase()}.</span>{' '}
                {opt.text}
              </button>
            ))}

          {currentQuestion.type === 'true_false' && (
            <div className="flex gap-4">
              <button
                onClick={() => handleAnswer(true)}
                className={`flex-1 rounded-lg border p-4 text-center font-medium transition-all ${
                  answers[currentQuestion.id] === true
                    ? 'border-green-500 bg-green-50 text-green-900'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                True
              </button>
              <button
                onClick={() => handleAnswer(false)}
                className={`flex-1 rounded-lg border p-4 text-center font-medium transition-all ${
                  answers[currentQuestion.id] === false
                    ? 'border-red-500 bg-red-50 text-red-900'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                False
              </button>
            </div>
          )}

          {currentQuestion.type === 'short_answer' && (
            <textarea
              value={String(answers[currentQuestion.id] || '')}
              onChange={(e) => handleAnswer(e.target.value)}
              placeholder="Type your answer here..."
              className="w-full rounded-lg border border-gray-200 p-3 focus:border-purple-500 focus:outline-none"
              rows={3}
            />
          )}
        </div>

        {/* Explanation Toggle */}
        {isAnswered && currentQuestion.explanation && (
          <button
            onClick={() =>
              setShowExplanation(
                showExplanation === currentQuestion.id
                  ? null
                  : currentQuestion.id
              )
            }
            className="mt-4 flex items-center gap-1 text-sm text-purple-600 hover:underline"
          >
            {showExplanation === currentQuestion.id ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
            {showExplanation === currentQuestion.id ? 'Hide' : 'Show'}{' '}
            Explanation
          </button>
        )}
        {showExplanation === currentQuestion.id && (
          <div className="mt-2 rounded-lg bg-purple-50 p-3 text-sm text-purple-900">
            {currentQuestion.explanation}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
          disabled={currentIndex === 0}
          className="flex items-center gap-1 rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-100 disabled:opacity-50"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>

        {currentIndex === questions.length - 1 ? (
          <button
            onClick={() => setShowResults(true)}
            disabled={!allAnswered}
            className="rounded-lg bg-purple-600 px-6 py-2 text-white hover:bg-purple-700 disabled:opacity-50"
          >
            Submit Quiz
          </button>
        ) : (
          <button
            onClick={() => setCurrentIndex((prev) => prev + 1)}
            className="flex items-center gap-1 rounded-lg bg-purple-600 px-4 py-2 text-white hover:bg-purple-700"
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

// Mind Map Component - Visual hierarchical display
function MindMapContent({ data }: { data: MindMapData }) {
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(
    new Set(['all'])
  );

  if (!data.centralTopic || !data.branches) return <p>No mind map data</p>;

  const toggleBranch = (id: string) => {
    setExpandedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    const allIds = new Set<string>(['all']);
    const collectIds = (children: MindMapNode[]) => {
      children?.forEach((child) => {
        allIds.add(child.id);
        if (child.children) collectIds(child.children);
      });
    };
    if (data.branches) {
      data.branches.forEach((branch) => {
        allIds.add(branch.id);
        if (branch.children) collectIds(branch.children);
      });
    }
    setExpandedBranches(allIds);
  };

  const collapseAll = () => {
    setExpandedBranches(new Set(['all']));
  };

  const renderNode = (
    node: MindMapNode,
    depth: number = 0,
    parentColor?: string
  ) => {
    const isExpanded = expandedBranches.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const color = node.color || parentColor || '#7C3AED';

    return (
      <div key={node.id} className="relative">
        <div
          className={`group flex items-start gap-2 rounded-lg p-2 transition-all ${
            hasChildren ? 'cursor-pointer hover:bg-gray-50' : ''
          }`}
          style={{ marginLeft: depth * 20 }}
          onClick={() => hasChildren && toggleBranch(node.id)}
        >
          {/* Connector line */}
          {depth > 0 && (
            <div
              className="absolute left-0 top-4 h-px"
              style={{
                width: 16,
                backgroundColor: color,
                marginLeft: (depth - 1) * 20 + 8,
              }}
            />
          )}

          {/* Expand/Collapse indicator */}
          {hasChildren && (
            <button className="mt-1 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-gray-400">
              {isExpanded ? (
                <ChevronLeft className="h-3 w-3 rotate-[-90deg]" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
            </button>
          )}
          {!hasChildren && <div className="w-4" />}

          {/* Node dot */}
          <div
            className="mt-1.5 h-3 w-3 flex-shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />

          {/* Content */}
          <div className="flex-1">
            <p className="font-medium text-gray-900">{node.label}</p>
            {node.description && (
              <p className="mt-0.5 text-sm text-gray-500">{node.description}</p>
            )}
          </div>
        </div>

        {/* Children */}
        {hasChildren && isExpanded && node.children && (
          <div className="relative">
            {/* Vertical line */}
            <div
              className="absolute left-6 top-0 w-px"
              style={{
                height: '100%',
                backgroundColor: color,
                marginLeft: depth * 20,
                opacity: 0.3,
              }}
            />
            {node.children.map((child) => renderNode(child, depth + 1, color))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">{data.title}</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={expandAll}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="rounded-lg px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Stats */}
      {data.stats && (
        <div className="flex gap-4 text-sm text-gray-500">
          <span>{data.stats.totalNodes} nodes</span>
          <span>{data.stats.branchCount} branches</span>
          <span>Max depth: {data.stats.maxDepth}</span>
        </div>
      )}

      {/* Legend */}
      {data.legend && data.legend.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {data.legend.map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <div
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <span className="text-xs text-gray-600">{item.meaning}</span>
            </div>
          ))}
        </div>
      )}

      {/* Central Topic */}
      <div className="rounded-xl border-2 border-purple-300 bg-purple-50 p-4 text-center">
        <h4 className="text-xl font-bold text-purple-900">
          {data.centralTopic.label}
        </h4>
        {data.centralTopic.description && (
          <p className="mt-1 text-sm text-purple-700">
            {data.centralTopic.description}
          </p>
        )}
      </div>

      {/* Branches */}
      <div className="space-y-2 rounded-lg border border-gray-200 bg-white p-4">
        {data.branches.map((branch) => renderNode(branch, 0))}
      </div>

      {/* Cross-connections */}
      {data.connections && data.connections.length > 0 && (
        <div className="rounded-lg bg-gray-50 p-4">
          <h4 className="mb-2 text-sm font-medium text-gray-700">
            Connections
          </h4>
          <div className="space-y-1">
            {data.connections.map((conn, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-sm text-gray-600"
              >
                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs">
                  {conn.from}
                </span>
                <span className="text-gray-400">→</span>
                <span className="italic text-gray-500">{conn.label}</span>
                <span className="text-gray-400">→</span>
                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs">
                  {conn.to}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
