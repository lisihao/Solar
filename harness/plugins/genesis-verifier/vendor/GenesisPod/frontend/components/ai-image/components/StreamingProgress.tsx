import type { ProcessingStep, StreamingInsights } from '../types';

interface StreamingProgressProps {
  streamingSteps: ProcessingStep[];
  streamingInsights: StreamingInsights | null;
}

// Agent step identifiers
const AGENT_STEPS = [
  'agent_content',
  'agent_layout',
  'agent_visual',
  'agent_style',
];
const TEAM_STEP = 'team_collaboration';

// Agent icons and colors
const AGENT_CONFIG: Record<
  string,
  { icon: string; color: string; bgColor: string }
> = {
  agent_content: {
    icon: '📊',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50 border-blue-200',
  },
  agent_layout: {
    icon: '📐',
    color: 'text-emerald-700',
    bgColor: 'bg-emerald-50 border-emerald-200',
  },
  agent_visual: {
    icon: '🎨',
    color: 'text-amber-700',
    bgColor: 'bg-amber-50 border-amber-200',
  },
  agent_style: {
    icon: '✨',
    color: 'text-pink-700',
    bgColor: 'bg-pink-50 border-pink-200',
  },
};

export function StreamingProgress({
  streamingSteps,
  streamingInsights,
}: StreamingProgressProps) {
  // Separate agent steps from regular steps
  const agentSteps = streamingSteps.filter((step) =>
    AGENT_STEPS.includes(step.step)
  );
  const teamStep = streamingSteps.find((step) => step.step === TEAM_STEP);
  const regularSteps = streamingSteps.filter(
    (step) => !AGENT_STEPS.includes(step.step) && step.step !== TEAM_STEP
  );

  const isTeamMode = teamStep || agentSteps.length > 0;

  return (
    <div className="flex-1 overflow-auto border-b border-gray-200 p-4">
      <div className="space-y-3">
        {/* Header */}
        <div className="flex items-center gap-2">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600" />
          <span className="text-sm font-medium text-gray-700">
            Creating your image...
          </span>
        </div>
        {streamingInsights?.textModelUsed && (
          <p className="text-xs text-gray-500">
            {streamingInsights.textModelUsed.includes('4-Agent')
              ? '🤖 Visual Design Team (4-Agent Collaboration)'
              : `Text Model: ${streamingInsights.textModelUsed}`}
          </p>
        )}

        {/* Team Collaboration Section */}
        {isTeamMode && (
          <div className="rounded-lg border border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-base">🎭</span>
              <span className="text-xs font-semibold text-purple-800">
                Visual Design Team 协作
              </span>
              {teamStep?.status === 'processing' && (
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600" />
              )}
              {teamStep?.status === 'completed' && (
                <svg
                  className="h-3 w-3 text-green-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              )}
            </div>

            {/* 4-Agent Pipeline */}
            <div className="flex items-center justify-between gap-1">
              {AGENT_STEPS.map((agentId, index) => {
                const step = agentSteps.find((s) => s.step === agentId);
                const config = AGENT_CONFIG[agentId];
                const isActive = step?.status === 'processing';
                const isCompleted = step?.status === 'completed';
                const isFailed = step?.status === 'error';

                return (
                  <div key={agentId} className="flex flex-1 items-center">
                    {/* Agent Node */}
                    <div
                      className={`flex flex-col items-center rounded-lg border p-2 transition-all ${
                        isActive
                          ? `${config.bgColor} ring-2 ring-purple-300`
                          : isCompleted
                            ? config.bgColor
                            : isFailed
                              ? 'border-red-200 bg-red-50'
                              : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <span className="text-lg">{config.icon}</span>
                      {isActive && (
                        <div className="mt-1 h-2 w-2 animate-pulse rounded-full bg-purple-500" />
                      )}
                      {isCompleted && (
                        <svg
                          className="mt-1 h-2 w-2 text-green-500"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                      {isFailed && (
                        <svg
                          className="mt-1 h-2 w-2 text-red-500"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>

                    {/* Connector Arrow */}
                    {index < AGENT_STEPS.length - 1 && (
                      <div className="flex-1 px-1">
                        <div
                          className={`h-0.5 ${isCompleted ? 'bg-green-300' : 'bg-gray-200'}`}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Agent Labels */}
            <div className="mt-1 flex justify-between text-[9px] text-gray-500">
              <span>Content</span>
              <span>Layout</span>
              <span>Visual</span>
              <span>Style</span>
            </div>

            {/* Current Agent Detail */}
            {agentSteps
              .filter(
                (s) => s.status === 'processing' || s.status === 'completed'
              )
              .slice(-1)
              .map((step) => (
                <div
                  key={step.step}
                  className="mt-2 rounded bg-white/50 p-2 text-[10px] text-gray-600"
                >
                  <span className="font-medium">{step.title}</span>
                  {step.content && (
                    <p className="mt-0.5 truncate text-gray-500">
                      {step.content.slice(0, 100)}
                    </p>
                  )}
                </div>
              ))}
          </div>
        )}

        {/* Regular Steps (excluding team/agent steps shown above) */}
        {regularSteps.length > 0 && (
          <div className="space-y-2">
            {regularSteps.map((step) => (
              <div
                key={step.step}
                className={`flex items-start gap-2 rounded-lg p-2 text-xs transition-all ${
                  step.status === 'processing'
                    ? 'border border-purple-200 bg-purple-50'
                    : step.status === 'completed'
                      ? 'border border-green-200 bg-green-50'
                      : step.status === 'error'
                        ? 'border border-red-200 bg-red-50'
                        : 'bg-gray-50'
                }`}
              >
                {/* Status Icon */}
                <div className="mt-0.5 flex-shrink-0">
                  {step.status === 'processing' ? (
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-purple-300 border-t-purple-600" />
                  ) : step.status === 'completed' ? (
                    <svg
                      className="h-3 w-3 text-green-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : step.status === 'error' ? (
                    <svg
                      className="h-3 w-3 text-red-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  ) : (
                    <div className="h-3 w-3 rounded-full bg-gray-300" />
                  )}
                </div>

                {/* Content */}
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-medium ${
                      step.status === 'processing'
                        ? 'text-purple-700'
                        : step.status === 'completed'
                          ? 'text-green-700'
                          : step.status === 'error'
                            ? 'text-red-700'
                            : 'text-gray-700'
                    }`}
                  >
                    {step.title}
                  </p>
                  {step.content && (
                    <p className="mt-0.5 truncate text-[10px] text-gray-500">
                      {step.content.slice(0, 80)}
                      {step.content.length > 80 ? '...' : ''}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
