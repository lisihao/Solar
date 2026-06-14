'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Play,
  Eye,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
} from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('SkillTestPanel');

// ==================== Types ====================

interface SkillTestPanelProps {
  skillId: string;
  onClose: () => void;
}

type InputFormat = 'json' | 'plain';

interface TestResult {
  success: boolean;
  output: string;
  duration: number;
  tokensUsed: number;
  promptPreview: string;
  error?: string;
}

interface DryRunResult {
  promptPreview: string;
  estimatedTokens: number;
}

interface RunState {
  status: 'idle' | 'running' | 'dry-running' | 'done' | 'error';
  result: TestResult | null;
  dryRunResult: DryRunResult | null;
}

// ==================== Helper ====================

function tryFormatJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(count: number): string {
  return count.toLocaleString();
}

// ==================== Sub-components ====================

interface ResultPanelProps {
  title: string;
  content: string;
  monospace?: boolean;
}

function ResultPanel({ title, content, monospace = true }: ResultPanelProps) {
  return (
    <div className="flex flex-col rounded-lg border border-gray-200 bg-gray-50">
      <div className="border-b border-gray-200 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          {title}
        </span>
      </div>
      <pre
        className={`max-h-96 flex-1 overflow-y-auto p-3 text-sm text-gray-800 ${
          monospace ? 'font-mono' : 'font-sans'
        } whitespace-pre-wrap break-words`}
      >
        {content || <span className="italic text-gray-400">—</span>}
      </pre>
    </div>
  );
}

// ==================== Main Component ====================

export function SkillTestPanel({ skillId, onClose }: SkillTestPanelProps) {
  const [inputFormat, setInputFormat] = useState<InputFormat>('json');
  const [inputValue, setInputValue] = useState('');
  const [runState, setRunState] = useState<RunState>({
    status: 'idle',
    result: null,
    dryRunResult: null,
  });

  const isRunning = runState.status === 'running';
  const isDryRunning = runState.status === 'dry-running';
  const isBusy = isRunning || isDryRunning;

  const hasResults = runState.result !== null;
  const hasDryRun = runState.dryRunResult !== null;

  // Keyboard: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isBusy]);

  const handleRunTest = async () => {
    if (isBusy) return;

    setRunState({ status: 'running', result: null, dryRunResult: null });

    try {
      const result = await apiClient.post<TestResult>(
        `/admin/ai/skills/${skillId}/test`,
        { input: inputValue }
      );
      logger.info('Skill test completed', { skillId, success: result.success });
      setRunState({ status: 'done', result, dryRunResult: null });
    } catch (error) {
      logger.error('Skill test failed', error);
      setRunState({
        status: 'error',
        result: {
          success: false,
          output: '',
          duration: 0,
          tokensUsed: 0,
          promptPreview: '',
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        dryRunResult: null,
      });
    }
  };

  const handleDryRun = async () => {
    if (isBusy) return;

    setRunState({ status: 'dry-running', result: null, dryRunResult: null });

    try {
      const result = await apiClient.post<DryRunResult>(
        `/admin/ai/skills/${skillId}/dry-run`,
        { input: inputValue }
      );
      logger.info('Skill dry-run completed', {
        skillId,
        estimatedTokens: result.estimatedTokens,
      });
      setRunState({ status: 'done', result: null, dryRunResult: result });
    } catch (error) {
      logger.error('Skill dry-run failed', error);
      setRunState({
        status: 'error',
        result: null,
        dryRunResult: null,
      });
    }
  };

  const outputContent = hasResults
    ? runState.result!.success
      ? tryFormatJson(runState.result!.output)
      : (runState.result!.error ?? '')
    : '';

  const promptContent = hasResults
    ? runState.result!.promptPreview
    : hasDryRun
      ? runState.dryRunResult!.promptPreview
      : '';

  const showResultGrid = hasResults || hasDryRun;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="skill-test-panel-title"
    >
      <div className="flex w-full max-w-4xl flex-col rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100">
              <Play className="h-4 w-4 text-purple-700" />
            </div>
            <div>
              <h2
                id="skill-test-panel-title"
                className="text-base font-semibold text-gray-900"
              >
                Test Skill:{' '}
                <span className="font-mono text-purple-700">{skillId}</span>
              </h2>
              <p className="text-xs text-gray-500">
                Run the skill in a sandbox environment
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isBusy}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close panel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-5">
            {/* Input Section */}
            <div className="space-y-3">
              {/* Format Selector */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">
                  Input Format
                </span>
                <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
                  <button
                    onClick={() => setInputFormat('json')}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                      inputFormat === 'json'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    JSON
                  </button>
                  <button
                    onClick={() => setInputFormat('plain')}
                    className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                      inputFormat === 'plain'
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    Plain Text
                  </button>
                </div>
              </div>

              {/* Textarea */}
              <textarea
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder={
                  inputFormat === 'json'
                    ? '{\n  "query": "example input"\n}'
                    : 'Enter plain text input for the skill...'
                }
                rows={6}
                className="font-mono w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
                spellCheck={false}
              />

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void handleRunTest()}
                  disabled={isBusy}
                  className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Run Test
                    </>
                  )}
                </button>
                <button
                  onClick={() => void handleDryRun()}
                  disabled={isBusy}
                  className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isDryRunning ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Previewing...
                    </>
                  ) : (
                    <>
                      <Eye className="h-4 w-4" />
                      Dry Run
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Results Grid */}
            {showResultGrid && (
              <div className="space-y-4">
                <div className="border-t border-gray-200 pt-4">
                  <h3 className="mb-3 text-sm font-semibold text-gray-700">
                    Results
                  </h3>
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    {/* Input panel */}
                    <ResultPanel
                      title="Input Sent"
                      content={
                        inputFormat === 'json'
                          ? tryFormatJson(inputValue)
                          : inputValue
                      }
                    />

                    {/* Prompt Preview panel */}
                    <ResultPanel
                      title="Prompt Preview"
                      content={promptContent}
                    />

                    {/* Output panel */}
                    {hasResults && (
                      <ResultPanel title="Output" content={outputContent} />
                    )}

                    {/* Dry-run: estimated tokens only, no output */}
                    {!hasResults && hasDryRun && (
                      <div className="flex flex-col rounded-lg border border-gray-200 bg-gray-50">
                        <div className="border-b border-gray-200 px-3 py-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Estimated
                          </span>
                        </div>
                        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                          <Zap className="h-8 w-8 text-amber-400" />
                          <p className="text-2xl font-bold text-gray-900">
                            {formatTokens(
                              runState.dryRunResult!.estimatedTokens
                            )}
                          </p>
                          <p className="text-xs text-gray-500">
                            estimated tokens
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats Bar */}
                {hasResults && runState.result && (
                  <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
                    {/* Duration */}
                    <div className="flex items-center gap-1.5 text-sm text-gray-600">
                      <Clock className="h-4 w-4 text-gray-400" />
                      <span className="font-medium text-gray-900">
                        {formatDuration(runState.result.duration)}
                      </span>
                      <span className="text-gray-400">duration</span>
                    </div>

                    <div className="h-4 w-px bg-gray-300" />

                    {/* Tokens */}
                    <div className="flex items-center gap-1.5 text-sm text-gray-600">
                      <Zap className="h-4 w-4 text-gray-400" />
                      <span className="font-medium text-gray-900">
                        {formatTokens(runState.result.tokensUsed)}
                      </span>
                      <span className="text-gray-400">tokens</span>
                    </div>

                    <div className="h-4 w-px bg-gray-300" />

                    {/* Status badge */}
                    {runState.result.success ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        <CheckCircle className="h-3.5 w-3.5" />
                        Success
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-700">
                        <XCircle className="h-3.5 w-3.5" />
                        Failed
                      </span>
                    )}

                    {/* Inline error message */}
                    {!runState.result.success && runState.result.error && (
                      <span className="text-sm text-red-600">
                        {runState.result.error}
                      </span>
                    )}
                  </div>
                )}

                {/* Dry-run stats bar */}
                {!hasResults && hasDryRun && runState.dryRunResult && (
                  <div className="flex flex-wrap items-center gap-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
                    <div className="flex items-center gap-1.5 text-sm text-gray-600">
                      <Zap className="h-4 w-4 text-gray-400" />
                      <span className="font-medium text-gray-900">
                        {formatTokens(runState.dryRunResult.estimatedTokens)}
                      </span>
                      <span className="text-gray-400">estimated tokens</span>
                    </div>
                    <div className="h-4 w-px bg-gray-300" />
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                      <Eye className="h-3.5 w-3.5" />
                      Dry Run — no LLM call made
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Network error fallback (dry-run failed but no result) */}
            {runState.status === 'error' &&
              !runState.result &&
              !runState.dryRunResult && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  <span className="font-medium">Request failed.</span> Check the
                  console for details.
                </div>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
