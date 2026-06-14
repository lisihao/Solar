/**
 * StoryAnalysisDashboard - 故事分析仪表板
 *
 * 展示基于 DOME/SCORE 论文的高级分析功能：
 * - 故事完成度检测
 * - 时间线冲突分析
 * - Agent 活动记录
 */

import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  MessageSquare,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  Info,
  Zap,
} from 'lucide-react';
import {
  getAnalysisDashboard,
  type AnalysisDashboard,
  type TimelineConflict,
  type CompletionSignal,
  type ScratchpadEntry,
} from '@/services/ai-writing/api';

interface StoryAnalysisDashboardProps {
  projectId: string;
  onConflictClick?: (conflict: TimelineConflict) => void;
}

export function StoryAnalysisDashboard({
  projectId,
  onConflictClick,
}: StoryAnalysisDashboardProps) {
  const [dashboard, setDashboard] = useState<AnalysisDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState({
    completion: true,
    conflicts: true,
    activity: false,
  });

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAnalysisDashboard(projectId);
      setDashboard(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analysis');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  if (loading && !dashboard) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500">Loading analysis...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center text-red-700">
          <AlertCircle className="mr-2 h-5 w-5" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchDashboard}
          className="mt-2 text-sm text-red-600 hover:text-red-800"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Story Analysis</h3>
        <button
          onClick={fetchDashboard}
          disabled={loading}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 disabled:opacity-50"
          aria-label="Refresh story analysis"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Completion Analysis */}
      {dashboard.completion ? (
        <CompletionSection
          completion={dashboard.completion}
          expanded={expandedSections.completion}
          onToggle={() => toggleSection('completion')}
        />
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-center gap-2 text-gray-500">
            <Info className="h-5 w-5" />
            <span className="text-sm">
              Story completion analysis not yet available
            </span>
          </div>
        </div>
      )}

      {/* Timeline Conflicts */}
      <ConflictsSection
        conflicts={dashboard.conflicts}
        expanded={expandedSections.conflicts}
        onToggle={() => toggleSection('conflicts')}
        onConflictClick={onConflictClick}
      />

      {/* Agent Activity */}
      <ActivitySection
        activity={dashboard.agentActivity}
        expanded={expandedSections.activity}
        onToggle={() => toggleSection('activity')}
      />

      {/* Footer */}
      <div className="text-xs text-gray-400">
        Last analyzed: {new Date(dashboard.analyzedAt).toLocaleString()}
      </div>
    </div>
  );
}

// ==================== Sub Components ====================

interface CompletionSectionProps {
  completion: NonNullable<AnalysisDashboard['completion']>;
  expanded: boolean;
  onToggle: () => void;
}

function CompletionSection({
  completion,
  expanded,
  onToggle,
}: CompletionSectionProps) {
  const getStatusColor = () => {
    if (completion.isComplete) return 'bg-green-50 border-green-200';
    if (completion.confidence > 0.5) return 'bg-yellow-50 border-yellow-200';
    return 'bg-blue-50 border-blue-200';
  };

  const getStatusIcon = () => {
    if (completion.isComplete) {
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    }
    if (completion.confidence > 0.5) {
      return <Clock className="h-5 w-5 text-yellow-500" />;
    }
    return <Zap className="h-5 w-5 text-blue-500" />;
  };

  return (
    <div className={`rounded-lg border ${getStatusColor()}`}>
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          {getStatusIcon()}
          <div className="text-left">
            <h4 className="font-medium text-gray-900">Story Completion</h4>
            <p className="text-sm text-gray-600">
              {completion.isComplete
                ? 'Story has reached a natural ending'
                : `${Math.round(completion.confidence * 100)}% towards completion`}
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-200 p-4">
          {/* Confidence Bar */}
          <div className="mb-4">
            <div className="mb-1 flex justify-between text-sm">
              <span className="text-gray-600">Completion Confidence</span>
              <span className="font-medium">
                {Math.round(completion.confidence * 100)}%
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full transition-all ${
                  completion.isComplete
                    ? 'bg-green-500'
                    : completion.confidence > 0.5
                      ? 'bg-yellow-500'
                      : 'bg-blue-500'
                }`}
                style={{ width: `${completion.confidence * 100}%` }}
              />
            </div>
          </div>

          {/* Signals */}
          {completion.signals.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-sm font-medium text-gray-700">
                Detection Signals
              </h5>
              {completion.signals.map((signal, idx) => (
                <SignalItem key={idx} signal={signal} />
              ))}
            </div>
          )}

          {/* Recommendation */}
          {completion.recommendation && (
            <div className="mt-4 rounded-md bg-gray-100 p-3">
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 text-gray-500" />
                <p className="text-sm text-gray-700">
                  {completion.recommendation}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SignalItem({ signal }: { signal: CompletionSignal }) {
  const getSignalColor = (confidence: number) => {
    if (confidence > 0.8) return 'text-green-600 bg-green-100';
    if (confidence > 0.5) return 'text-yellow-600 bg-yellow-100';
    return 'text-gray-600 bg-gray-100';
  };

  return (
    <div className="flex items-start gap-2 rounded-md bg-white p-2 text-sm">
      <span
        className={`rounded px-1.5 py-0.5 text-xs font-medium ${getSignalColor(signal.confidence)}`}
      >
        {Math.round(signal.confidence * 100)}%
      </span>
      <div className="flex-1">
        <span className="font-medium text-gray-700">{signal.type}</span>
        <p className="text-gray-500">{signal.evidence}</p>
      </div>
    </div>
  );
}

interface ConflictsSectionProps {
  conflicts: AnalysisDashboard['conflicts'];
  expanded: boolean;
  onToggle: () => void;
  onConflictClick?: (conflict: TimelineConflict) => void;
}

function ConflictsSection({
  conflicts,
  expanded,
  onToggle,
  onConflictClick,
}: ConflictsSectionProps) {
  const hasConflicts = conflicts.total > 0;

  return (
    <div
      className={`rounded-lg border ${
        hasConflicts
          ? conflicts.highSeverity > 0
            ? 'border-red-200 bg-red-50'
            : 'border-yellow-200 bg-yellow-50'
          : 'border-green-200 bg-green-50'
      }`}
    >
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          {hasConflicts ? (
            <AlertTriangle
              className={`h-5 w-5 ${
                conflicts.highSeverity > 0 ? 'text-red-500' : 'text-yellow-500'
              }`}
            />
          ) : (
            <CheckCircle className="h-5 w-5 text-green-500" />
          )}
          <div className="text-left">
            <h4 className="font-medium text-gray-900">Timeline Conflicts</h4>
            <p className="text-sm text-gray-600">
              {hasConflicts
                ? `${conflicts.total} conflict${conflicts.total > 1 ? 's' : ''} detected`
                : 'No conflicts detected'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasConflicts && (
            <div className="flex gap-1">
              {conflicts.highSeverity > 0 && (
                <span className="rounded bg-red-200 px-1.5 py-0.5 text-xs font-medium text-red-700">
                  {conflicts.highSeverity} High
                </span>
              )}
              {conflicts.mediumSeverity > 0 && (
                <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-xs font-medium text-yellow-700">
                  {conflicts.mediumSeverity} Med
                </span>
              )}
              {conflicts.lowSeverity > 0 && (
                <span className="rounded bg-gray-200 px-1.5 py-0.5 text-xs font-medium text-gray-700">
                  {conflicts.lowSeverity} Low
                </span>
              )}
            </div>
          )}
          {expanded ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </div>
      </button>

      {expanded && hasConflicts && (
        <div className="border-t border-gray-200 p-4">
          <div className="space-y-2">
            {conflicts.recentConflicts.map((conflict) => (
              <ConflictItem
                key={conflict.id}
                conflict={conflict}
                onClick={onConflictClick}
              />
            ))}
          </div>
          {conflicts.total > conflicts.recentConflicts.length && (
            <p className="mt-2 text-center text-sm text-gray-500">
              +{conflicts.total - conflicts.recentConflicts.length} more
              conflicts
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ConflictItem({
  conflict,
  onClick,
}: {
  conflict: TimelineConflict;
  onClick?: (conflict: TimelineConflict) => void;
}) {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'HIGH':
        return 'border-l-red-500 bg-red-50';
      case 'MEDIUM':
        return 'border-l-yellow-500 bg-yellow-50';
      default:
        return 'border-l-gray-400 bg-gray-50';
    }
  };

  return (
    <button
      onClick={() => onClick?.(conflict)}
      className={`w-full rounded-md border-l-4 p-3 text-left transition-colors hover:opacity-80 ${getSeverityColor(conflict.severity)}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-900">
              {conflict.subject}
            </span>
            <span className="text-xs text-gray-500">
              Ch.{conflict.sourceChapter}
              {conflict.targetChapter && ` vs Ch.${conflict.targetChapter}`}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-600">{conflict.description}</p>
        </div>
      </div>
      {conflict.suggestedResolution && (
        <div className="mt-2 text-xs text-gray-500">
          Suggestion: {conflict.suggestedResolution}
        </div>
      )}
    </button>
  );
}

interface ActivitySectionProps {
  activity: AnalysisDashboard['agentActivity'];
  expanded: boolean;
  onToggle: () => void;
}

function ActivitySection({
  activity,
  expanded,
  onToggle,
}: ActivitySectionProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between p-4"
      >
        <div className="flex items-center gap-3">
          <MessageSquare className="h-5 w-5 text-gray-500" />
          <div className="text-left">
            <h4 className="font-medium text-gray-900">Agent Activity</h4>
            <p className="text-sm text-gray-600">
              {activity.totalEntries} recent entries
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {expanded && activity.recentEntries.length > 0 && (
        <div className="border-t border-gray-200 p-4">
          <div className="space-y-2">
            {activity.recentEntries.map((entry) => (
              <ActivityItem key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityItem({ entry }: { entry: ScratchpadEntry }) {
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'WARNING':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'FACT':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'QUESTION':
        return <MessageSquare className="h-4 w-4 text-blue-500" />;
      case 'DECISION':
        return <Zap className="h-4 w-4 text-purple-500" />;
      default:
        return <Info className="h-4 w-4 text-gray-500" />;
    }
  };

  return (
    <div className="flex items-start gap-2 rounded-md bg-white p-2 text-sm">
      {getTypeIcon(entry.type)}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500">
            {entry.source}
          </span>
          <span className="text-xs text-gray-400">
            {new Date(entry.createdAt).toLocaleTimeString()}
          </span>
        </div>
        <p className="text-gray-700">{entry.content}</p>
      </div>
    </div>
  );
}

export default StoryAnalysisDashboard;
