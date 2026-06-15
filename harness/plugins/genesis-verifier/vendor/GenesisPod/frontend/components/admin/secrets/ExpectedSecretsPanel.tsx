'use client';

import {
  CheckCircle,
  AlertCircle,
  ExternalLink,
  Settings,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';
import {
  ExpectedSecretItem,
  ExpectedSecretsResponse,
  LlmProviderSecret,
  CustomSecret,
  ExpectedSecretsOrphan,
} from '@/hooks/domain/useAdminSecrets';

export interface ExpectedSecretsPanelProps {
  expected: ExpectedSecretsResponse | null;
  loading: boolean;
  onConfigure: (item: ExpectedSecretItem) => void;
  onDeleteOrphan: (secretId: string, name: string) => void;
}

function groupByCategory(
  items: ExpectedSecretItem[]
): Record<string, ExpectedSecretItem[]> {
  return items.reduce<Record<string, ExpectedSecretItem[]>>((acc, item) => {
    const key = item.category;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function CategoryLabel({ category }: { category: string }) {
  const labelMap: Record<string, string> = {
    AI_MODEL: 'AI Model',
    SEARCH: 'Search',
    EXTRACTION: 'Content Extraction',
    YOUTUBE: 'YouTube',
    TTS: 'Text-to-Speech',
    SKILLSMP: 'SkillsMP',
    POLICY: 'Policy Research',
    FINANCE: 'Finance Data',
    ACADEMIC: 'Academic Research',
    WEATHER: 'Weather Data',
    IMAGE_SEARCH: 'Image Search',
    DEV_TOOLS: 'Dev Tools',
    MCP: 'MCP Server',
    OTHER: 'Other',
  };
  return <>{labelMap[category] ?? category}</>;
}

function MissingSecretCard({
  item,
  onConfigure,
}: {
  item: ExpectedSecretItem;
  onConfigure: (item: ExpectedSecretItem) => void;
}) {
  const hasGuide = Boolean(item.setupGuideUrl);

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-orange-200 bg-orange-50 p-4 ">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-gray-900 ">{item.displayName}</span>
          {item.provider && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 ">
              {item.provider}
            </span>
          )}
          {item.freeTierAvailable && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700 ">
              Free tier
            </span>
          )}
        </div>
        {item.description && (
          <p className="mt-1 text-sm text-gray-500 ">{item.description}</p>
        )}
        <p className="font-mono mt-0.5 text-xs text-gray-400 ">{item.name}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
        {hasGuide ? (
          <button
            onClick={() =>
              window.open(item.setupGuideUrl, '_blank', 'noopener,noreferrer')
            }
            className="flex items-center gap-1 rounded-lg border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 "
          >
            <ExternalLink className="h-3 w-3" />
            Apply
          </button>
        ) : (
          <button
            disabled
            className="flex cursor-not-allowed items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-400 "
            title="Setup guide coming soon"
          >
            <ExternalLink className="h-3 w-3" />
            Setup guide coming soon
          </button>
        )}
        <button
          onClick={() => onConfigure(item)}
          className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          <Settings className="h-3 w-3" />
          Configure
        </button>
      </div>
    </div>
  );
}

/** Collapsible section wrapper used by all 4 blocks */
function Section({
  title,
  badge,
  variant = 'neutral',
  defaultExpanded = true,
  children,
}: {
  title: string;
  badge?: string;
  variant?: 'neutral' | 'info' | 'warning';
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const headerColors: Record<string, string> = {
    neutral: 'border-gray-200 bg-gray-50 ',
    info: 'border-blue-200 bg-blue-50 ',
    warning: 'border-yellow-200 bg-yellow-50 ',
  };

  return (
    <div className="rounded-lg border border-gray-200 ">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex w-full items-center justify-between rounded-t-lg px-4 py-3 ${headerColors[variant]}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-800 ">{title}</span>
          {badge && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600 ">
              {badge}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>
      {expanded && <div className="divide-y divide-gray-100 ">{children}</div>}
    </div>
  );
}

/** Read-only row for B and C class entries — no action buttons */
function ReadOnlySecretRow({
  name,
  displayName,
  category,
  provider,
}: {
  name: string;
  displayName: string;
  category: string;
  provider?: string | null;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-800 ">
            {displayName}
          </span>
          {provider && (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-500 ">
              {provider}
            </span>
          )}
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-400 ">
            <CategoryLabel category={category} />
          </span>
        </div>
        <p className="font-mono mt-0.5 text-xs text-gray-400 ">{name}</p>
      </div>
      <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 ">
        Active
      </span>
    </div>
  );
}

export function ExpectedSecretsPanel({
  expected,
  loading,
  onConfigure,
  onDeleteOrphan,
}: ExpectedSecretsPanelProps) {
  const [presetExpanded, setPresetExpanded] = useState(true);

  if (loading && !expected) {
    return (
      <div
        data-testid="expected-loading"
        className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4 "
      >
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <span className="text-sm text-gray-500">
          Loading expected secrets...
        </span>
      </div>
    );
  }

  if (!expected) return null;

  const { presetTools, llmProviders, customSecrets, orphans } = expected;
  const { summary } = presetTools;
  const missingItems = presetTools.items.filter((i) => i.status === 'missing');
  const allPresetConfigured = summary.missing === 0;

  // Top-level "all done" shortcut: all preset configured + no orphans
  if (
    allPresetConfigured &&
    orphans.length === 0 &&
    llmProviders.length === 0 &&
    customSecrets.length === 0
  ) {
    return (
      <div
        data-testid="expected-all-configured"
        className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 p-4 "
      >
        <CheckCircle className="h-5 w-5 shrink-0 text-green-600 " />
        <span className="text-sm font-medium text-green-700 ">
          All {summary.total} expected secrets configured
        </span>
      </div>
    );
  }

  const grouped = groupByCategory(missingItems);

  return (
    <div className="space-y-3">
      {/* Top-level overview bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm ">
        <span className="text-gray-500 ">
          Platform:{' '}
          <span className="font-semibold text-gray-800 ">
            {summary.configured}/{summary.total}
          </span>
          {summary.missing > 0 && (
            <span className="ml-1 font-semibold text-orange-600 ">
              ({summary.missing} pending)
            </span>
          )}
        </span>
        {llmProviders.length > 0 && (
          <span className="text-gray-500 ">
            Providers:{' '}
            <span className="font-semibold text-gray-800 ">
              {llmProviders.length}
            </span>
          </span>
        )}
        {customSecrets.length > 0 && (
          <span className="text-gray-500 ">
            Custom:{' '}
            <span className="font-semibold text-gray-800 ">
              {customSecrets.length}
            </span>
          </span>
        )}
      </div>

      {/* Section A: Platform Tool Keys */}
      {summary.total > 0 && (
        <div className="rounded-lg border border-gray-200 ">
          {/* Header */}
          <button
            onClick={() => setPresetExpanded((v) => !v)}
            className="flex w-full items-center justify-between rounded-t-lg border-b border-gray-200 bg-gray-50 px-4 py-3 "
          >
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-gray-400" />
              <span className="text-sm font-medium text-gray-800 ">
                Platform Tool Keys
              </span>
              <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-600 ">
                {summary.configured}/{summary.total}
              </span>
            </div>
            {presetExpanded ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </button>

          {presetExpanded && (
            <div className="p-4">
              {allPresetConfigured ? (
                <div className="flex items-center gap-2 text-sm text-green-700 ">
                  <CheckCircle className="h-4 w-4" />
                  All {summary.total} platform tool keys configured
                </div>
              ) : (
                <div className="space-y-4">
                  {Object.entries(grouped).map(([category, items]) => (
                    <div key={category}>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400 ">
                        <CategoryLabel category={category} />
                      </h4>
                      <div className="space-y-2">
                        {items.map((item) => (
                          <MissingSecretCard
                            key={item.name}
                            item={item}
                            onConfigure={onConfigure}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Section B: Model Provider Keys */}
      {llmProviders.length > 0 && (
        <Section
          title="Model Provider Keys"
          badge={String(llmProviders.length)}
          variant="info"
        >
          {llmProviders.map((p: LlmProviderSecret) => (
            <ReadOnlySecretRow
              key={p.secretId}
              name={p.name}
              displayName={p.displayName}
              category={p.category}
              provider={p.provider}
            />
          ))}
        </Section>
      )}

      {/* Section C: Custom Secrets */}
      {customSecrets.length > 0 && (
        <Section
          title="Custom Secrets"
          badge={String(customSecrets.length)}
          variant="neutral"
        >
          {customSecrets.map((c: CustomSecret) => (
            <ReadOnlySecretRow
              key={c.secretId}
              name={c.name}
              displayName={c.displayName}
              category={c.category}
              provider={c.provider}
            />
          ))}
        </Section>
      )}

      {/* Section D: Decommissioned (only shown when non-empty) */}
      {orphans.length > 0 && (
        <div
          data-testid="orphans-alert"
          className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 "
        >
          <div className="mb-2 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-yellow-600 " />
            <span className="text-sm font-medium text-yellow-700 ">
              Decommissioned — {orphans.length} secret
              {orphans.length > 1 ? 's' : ''} from retired tools
            </span>
          </div>
          <ul className="space-y-1">
            {orphans.map((orphan: ExpectedSecretsOrphan) => (
              <li
                key={orphan.secretId}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-sm text-gray-600 ">
                  {orphan.displayName}
                  <span className="font-mono ml-1 text-xs text-gray-400">
                    ({orphan.name})
                  </span>
                </span>
                <button
                  onClick={() => onDeleteOrphan(orphan.secretId, orphan.name)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 "
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
