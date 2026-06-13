'use client';

import {
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle,
  Lightbulb,
  Trash2,
  X,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import type { TableDiagnosis } from '@/hooks/domain';
import { ClientDate } from '@/components/common/ClientDate';

interface TableDiagnosisPanelProps {
  diagnosis: TableDiagnosis | null;
  loading: boolean;
  open: boolean;
  onClose: () => void;
  onCleanup?: () => void;
}

// Severity icons and colors
const SEVERITY_CONFIG = {
  info: {
    icon: Info,
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    iconColor: 'text-blue-500',
    textColor: 'text-blue-700',
  },
  warning: {
    icon: AlertTriangle,
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    iconColor: 'text-amber-500',
    textColor: 'text-amber-700',
  },
  critical: {
    icon: AlertCircle,
    bg: 'bg-red-50',
    border: 'border-red-200',
    iconColor: 'text-red-500',
    textColor: 'text-red-700',
  },
};

export default function TableDiagnosisPanel({
  diagnosis,
  loading,
  open,
  onClose,
  onCleanup,
}: TableDiagnosisPanelProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 mx-4 max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {t('admin.tables.diagnosis.title')}
            </h2>
            {diagnosis?.tableName && (
              <p className="font-mono text-sm text-gray-500">
                {diagnosis.tableName}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-80px)] overflow-y-auto px-6 py-6">
          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-600" />
                <p className="mt-3 text-sm text-gray-500">
                  {t('admin.tables.diagnosis.analyzing')}
                </p>
              </div>
            </div>
          ) : diagnosis ? (
            <div className="space-y-6">
              {/* Health Score */}
              <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div>
                  <p className="text-sm font-medium text-gray-600">
                    {t('admin.tables.diagnosis.healthScore')}
                  </p>
                  <p className="mt-1 text-3xl font-bold">
                    <span className={getScoreColor(diagnosis.healthScore)}>
                      {diagnosis.healthScore}
                    </span>
                    <span className="text-lg text-gray-400">/100</span>
                  </p>
                </div>
                <div
                  className={`flex h-16 w-16 items-center justify-center rounded-full ${
                    diagnosis.healthScore >= 80
                      ? 'bg-emerald-100'
                      : diagnosis.healthScore >= 50
                        ? 'bg-amber-100'
                        : 'bg-red-100'
                  }`}
                >
                  {diagnosis.healthScore >= 80 ? (
                    <CheckCircle className="h-8 w-8 text-emerald-500" />
                  ) : diagnosis.healthScore >= 50 ? (
                    <AlertTriangle className="h-8 w-8 text-amber-500" />
                  ) : (
                    <AlertCircle className="h-8 w-8 text-red-500" />
                  )}
                </div>
              </div>

              {/* Issues */}
              {diagnosis.issues.length > 0 ? (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    {t('admin.tables.diagnosis.issues')} (
                    {diagnosis.issues.length})
                  </h3>
                  <div className="space-y-2">
                    {diagnosis.issues.map((issue, index) => {
                      const config = SEVERITY_CONFIG[issue.severity];
                      const IconComponent = config.icon;

                      return (
                        <div
                          key={index}
                          className={`flex items-start gap-3 rounded-lg border p-3 ${config.bg} ${config.border}`}
                        >
                          <IconComponent
                            className={`mt-0.5 h-5 w-5 flex-shrink-0 ${config.iconColor}`}
                          />
                          <div className="flex-1">
                            <p
                              className={`text-sm font-medium ${config.textColor}`}
                            >
                              {issue.message}
                            </p>
                            {issue.details && (
                              <p className="mt-1 text-xs text-gray-500">
                                {JSON.stringify(issue.details)}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle className="h-5 w-5 text-emerald-500" />
                    <p className="text-sm font-medium text-emerald-700">
                      {t('admin.tables.diagnosis.noIssues')}
                    </p>
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {diagnosis.recommendations.length > 0 && (
                <div>
                  <h3 className="mb-3 text-sm font-semibold text-gray-900">
                    {t('admin.tables.diagnosis.recommendations')}
                  </h3>
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <ul className="space-y-2">
                      {diagnosis.recommendations.map((rec, index) => (
                        <li
                          key={index}
                          className="flex items-start gap-2 text-sm text-gray-600"
                        >
                          <Lightbulb className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* Cleanup Suggestion */}
              {diagnosis.cleanupSuggestion && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <h3 className="mb-2 text-sm font-semibold text-amber-900">
                    {t('admin.tables.diagnosis.cleanupSuggestion')}
                  </h3>
                  <p className="text-sm text-amber-700">
                    {diagnosis.cleanupSuggestion.description}
                  </p>
                  <div className="mt-3 flex items-center gap-4">
                    <div className="text-sm">
                      <span className="text-amber-600">
                        {t('admin.tables.diagnosis.estimatedRows')}:
                      </span>{' '}
                      <span className="font-semibold text-amber-900">
                        {diagnosis.cleanupSuggestion.estimatedRows.toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="text-amber-600">
                        {t('admin.tables.diagnosis.estimatedSpace')}:
                      </span>{' '}
                      <span className="font-semibold text-amber-900">
                        {formatBytes(
                          diagnosis.cleanupSuggestion.estimatedBytes
                        )}
                      </span>
                    </div>
                  </div>
                  {onCleanup && (
                    <button
                      onClick={onCleanup}
                      className="mt-4 flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('admin.tables.diagnosis.runCleanup')}
                    </button>
                  )}
                </div>
              )}

              {/* Analyzed Time */}
              <p className="text-center text-xs text-gray-400">
                {t('admin.tables.diagnosis.analyzedAt')}:{' '}
                <ClientDate date={diagnosis.analyzedAt} format="datetime" />
              </p>
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center text-gray-500">
              {t('admin.tables.diagnosis.noData')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Helper functions
function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600';
  if (score >= 50) return 'text-amber-600';
  return 'text-red-600';
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}
