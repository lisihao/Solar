'use client';

import { useState, useEffect, useMemo } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { useTranslation } from '@/lib/i18n';
import { createLogger } from '@/lib/utils/logger';
import { ClientDate } from '@/components/common/ClientDate';
import {
  Search,
  Download,
  Star,
  CheckCircle,
  Loader2,
  User,
  Calendar,
  Tag,
  RefreshCw,
  Eye,
  Package,
  Cloud,
  AlertCircle,
  Settings,
  Sparkles,
} from 'lucide-react';
import { SKILL_LAYERS } from './skill-layers';
import type { MarketplaceSkill, SkillConfig } from './types';

const logger = createLogger('SkillsMarketplaceTab');

interface SkillsMarketplaceTabProps {
  installedSkills: SkillConfig[];
  onInstall: (skillId: string) => Promise<void>;
}

interface SkillsmpConfig {
  enabled: boolean;
  hasApiKey: boolean;
  lastSync?: string;
}

export function SkillsMarketplaceTab({
  installedSkills,
  onInstall,
}: SkillsMarketplaceTabProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [marketplaceSkills, setMarketplaceSkills] = useState<
    MarketplaceSkill[]
  >([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<MarketplaceSkill | null>(
    null
  );
  const [installing, setInstalling] = useState<string | null>(null);
  const [skillsmpConfig, setSkillsmpConfig] = useState<SkillsmpConfig | null>(
    null
  );
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [syncMessage, setSyncMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Load SkillsMP config
  const loadSkillsmpConfig = async () => {
    try {
      const res = await fetch(`${config.apiUrl}/admin/skillsmp-config`, {
        headers: { ...getAuthHeader() },
      });
      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        setSkillsmpConfig(data);
      }
    } catch (err) {
      logger.error('Failed to load SkillsMP config:', err);
    }
  };

  // Load marketplace skills
  const loadMarketplaceSkills = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiUrl}/admin/skillsmp-config/skills`, {
        headers: { ...getAuthHeader() },
      });
      if (res.ok) {
        const result = await res.json();
        // Handle wrapped API response { success: true, data: T }
        const data = result?.data ?? result;
        const skills = data.skills || [];
        setLastSync(data.lastSync || null);

        // Mark installed skills
        const skillsWithStatus = skills.map((skill: MarketplaceSkill) => ({
          ...skill,
          installed: installedSkills.some(
            (s) => s.skillId === skill.id || s.name === skill.name
          ),
        }));

        setMarketplaceSkills(skillsWithStatus);
      }
    } catch (err) {
      logger.error('Failed to load marketplace skills:', err);
    } finally {
      setLoading(false);
    }
  };

  // Sync from SkillsMP
  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch(`${config.apiUrl}/admin/skillsmp-config/sync`, {
        method: 'POST',
        headers: { ...getAuthHeader() },
      });
      const result = await res.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;

      if (data.success || result.success) {
        setSyncMessage({
          type: 'success',
          text: data.message || t('admin.skills.marketplace.syncSuccess'),
        });
        // Reload skills after sync
        await loadMarketplaceSkills();
      } else {
        setSyncMessage({
          type: 'error',
          text: data.message || t('admin.skills.marketplace.syncFailed'),
        });
      }
    } catch (err) {
      logger.error('Failed to sync from SkillsMP:', err);
      setSyncMessage({
        type: 'error',
        text: t('admin.skills.marketplace.syncFailed'),
      });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  };

  useEffect(() => {
    loadSkillsmpConfig();
    loadMarketplaceSkills();
  }, [installedSkills]);

  // Filter skills
  const filteredSkills = useMemo(() => {
    if (!searchQuery) return marketplaceSkills;

    const query = searchQuery.toLowerCase();
    return marketplaceSkills.filter(
      (skill) =>
        skill.name?.toLowerCase().includes(query) ||
        skill.displayName?.toLowerCase().includes(query) ||
        skill.description?.toLowerCase().includes(query) ||
        skill.author?.toLowerCase().includes(query) ||
        skill.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  }, [marketplaceSkills, searchQuery]);

  // Handle install
  const handleInstall = async (skillId: string) => {
    setInstalling(skillId);
    try {
      await onInstall(skillId);
      // Update local state to show installed status immediately
      setMarketplaceSkills((prev) =>
        prev.map((s) => (s.id === skillId ? { ...s, installed: true } : s))
      );
    } catch (err) {
      // Installation failed - don't update local state
      logger.error('Failed to install skill:', err);
    } finally {
      setInstalling(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SkillsMP Connection Status */}
      <div
        className={`rounded-xl border p-4 ${
          skillsmpConfig?.hasApiKey
            ? 'border-green-200 bg-gradient-to-r from-green-50 to-emerald-50'
            : 'border-amber-200 bg-gradient-to-r from-amber-50 to-yellow-50'
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                skillsmpConfig?.hasApiKey ? 'bg-green-100' : 'bg-amber-100'
              }`}
            >
              {skillsmpConfig?.hasApiKey ? (
                <Cloud className="h-5 w-5 text-green-600" />
              ) : (
                <AlertCircle className="h-5 w-5 text-amber-600" />
              )}
            </div>
            <div>
              <h3 className="font-medium text-gray-900">
                {skillsmpConfig?.hasApiKey
                  ? t('admin.skills.marketplace.connected') ||
                    'Connected to SkillsMP'
                  : t('admin.skills.marketplace.notConnected') ||
                    'SkillsMP Not Configured'}
              </h3>
              <p className="text-sm text-gray-600">
                {skillsmpConfig?.hasApiKey ? (
                  lastSync ? (
                    <>
                      {t('admin.skills.marketplace.lastSync') || 'Last synced'}:{' '}
                      <ClientDate date={lastSync} format="datetime" />
                    </>
                  ) : (
                    t('admin.skills.marketplace.neverSynced') ||
                    'Never synced - click Sync to fetch skills'
                  )
                ) : (
                  t('admin.skills.marketplace.configureHint') ||
                  'Configure SkillsMP API Key in Tools Management to sync skills from the marketplace'
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {skillsmpConfig?.hasApiKey ? (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {syncing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Cloud className="h-4 w-4" />
                )}
                {t('admin.skills.marketplace.sync') || 'Sync from SkillsMP'}
              </button>
            ) : (
              <a
                href="/admin/ai/tools"
                className="flex items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50"
              >
                <Settings className="h-4 w-4" />
                {t('admin.skills.marketplace.configure') || 'Configure'}
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Sync Message */}
      {syncMessage && (
        <div
          className={`flex items-center gap-3 rounded-lg p-4 ${
            syncMessage.type === 'success'
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          {syncMessage.type === 'success' ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          <span>{syncMessage.text}</span>
        </div>
      )}

      {/* Search & Refresh */}
      <div className="flex items-center justify-between gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('admin.skills.marketplace.searchPlaceholder')}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/20"
          />
        </div>
        <button
          onClick={loadMarketplaceSkills}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('admin.skills.refresh')}
        </button>
      </div>

      {/* Skills count and source indicator */}
      {marketplaceSkills.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Sparkles className="h-4 w-4 text-purple-500" />
          <span>
            {lastSync
              ? `${marketplaceSkills.length} skills from SkillsMP`
              : `${marketplaceSkills.length} sample skills (sync to get more)`}
          </span>
        </div>
      )}

      {/* Skills Grid */}
      {filteredSkills.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <Package className="mx-auto h-12 w-12 text-gray-300" />
          <p className="mt-2 text-gray-500">
            {searchQuery
              ? t('admin.skills.noSkillsFound')
              : t('admin.skills.marketplace.noSkillsAvailable')}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSkills.map((skill) => (
            <MarketplaceSkillCard
              key={skill.id}
              skill={skill}
              onInstall={handleInstall}
              onPreview={setSelectedSkill}
              installing={installing === skill.id}
            />
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {selectedSkill && (
        <SkillPreviewModal
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onInstall={handleInstall}
          installing={installing === selectedSkill.id}
        />
      )}
    </div>
  );
}

// Marketplace Skill Card Component
function MarketplaceSkillCard({
  skill,
  onInstall,
  onPreview,
  installing,
}: {
  skill: MarketplaceSkill;
  onInstall: (skillId: string) => void;
  onPreview: (skill: MarketplaceSkill) => void;
  installing: boolean;
}) {
  const { t } = useTranslation();
  const layerInfo = SKILL_LAYERS.find((l) => l.id === skill.layer);
  const LayerIcon = layerInfo?.icon || Package;

  return (
    <div className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-4 transition-shadow hover:shadow-lg">
      {/* Installed Badge */}
      {skill.installed && (
        <div className="absolute right-3 top-3">
          <div className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-1 text-xs font-medium text-green-700">
            <CheckCircle className="h-3 w-3" />
            {t('admin.skills.marketplace.installed')}
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-3 flex items-start gap-3">
        <div className={`rounded-lg p-2 ${layerInfo?.color || 'bg-gray-100'}`}>
          <LayerIcon className="h-5 w-5 text-gray-700" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">
            {skill.displayName || skill.name}
          </h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <User className="h-3 w-3" />
            <span>{skill.author}</span>
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="mb-3 line-clamp-2 flex-1 text-sm text-gray-600">
        {skill.description}
      </p>

      {/* Stats */}
      <div className="mb-3 flex items-center gap-3 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
          <span>
            {(skill.rating ?? 0).toFixed(1)} ({skill.ratingCount ?? 0})
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Download className="h-3 w-3" />
          <span>{(skill.downloads ?? 0).toLocaleString()}</span>
        </div>
      </div>

      {/* Tags */}
      <div className="mb-3 flex flex-wrap gap-1">
        {(skill.tags ?? []).slice(0, 3).map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600"
          >
            <Tag className="mr-0.5 h-3 w-3" />
            {tag}
          </span>
        ))}
        {(skill.tags?.length ?? 0) > 3 && (
          <span className="text-xs text-gray-400">
            +{(skill.tags?.length ?? 0) - 3}
          </span>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onPreview(skill)}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <Eye className="h-4 w-4" />
          {t('admin.skills.marketplace.preview')}
        </button>
        {!skill.installed && (
          <button
            onClick={() => onInstall(skill.id)}
            disabled={installing}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {installing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {t('admin.skills.marketplace.install')}
          </button>
        )}
      </div>
    </div>
  );
}

// Skill Preview Modal Component
function SkillPreviewModal({
  skill,
  onClose,
  onInstall,
  installing,
}: {
  skill: MarketplaceSkill;
  onClose: () => void;
  onInstall: (skillId: string) => void;
  installing: boolean;
}) {
  const { t } = useTranslation();
  const layerInfo = SKILL_LAYERS.find((l) => l.id === skill.layer);
  const LayerIcon = layerInfo?.icon || Package;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-gray-200 p-6">
          <div className="flex items-start gap-4">
            <div
              className={`rounded-lg p-3 ${layerInfo?.color || 'bg-gray-100'}`}
            >
              <LayerIcon className="h-6 w-6 text-gray-700" />
            </div>
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-900">
                {skill.displayName || skill.name}
              </h2>
              <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
                <div className="flex items-center gap-1">
                  <User className="h-4 w-4" />
                  <span>{skill.author}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  <span>
                    {(skill.rating ?? 0).toFixed(1)} ({skill.ratingCount ?? 0})
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Download className="h-4 w-4" />
                  <span>{(skill.downloads ?? 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto p-6">
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 font-medium text-gray-900">Description</h3>
              <p className="text-gray-600">{skill.description}</p>
            </div>

            <div>
              <h3 className="mb-2 font-medium text-gray-900">Details</h3>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-gray-500">Version</dt>
                  <dd className="font-medium text-gray-900">{skill.version}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Layer</dt>
                  <dd className="font-medium text-gray-900">
                    {layerInfo ? t(layerInfo.labelKey) : skill.layer}
                  </dd>
                </div>
                <div>
                  <dt className="text-gray-500">Domain</dt>
                  <dd className="font-medium text-gray-900">{skill.domain}</dd>
                </div>
                <div>
                  <dt className="text-gray-500">Updated</dt>
                  <dd className="font-medium text-gray-900">
                    <ClientDate date={skill.updatedAt} format="date" />
                  </dd>
                </div>
              </dl>
            </div>

            {(skill.tags?.length ?? 0) > 0 && (
              <div>
                <h3 className="mb-2 font-medium text-gray-900">Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {(skill.tags ?? []).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {((skill.requiredTools?.length ?? 0) > 0 ||
              (skill.requiredSkills?.length ?? 0) > 0) && (
              <div>
                <h3 className="mb-2 font-medium text-gray-900">Dependencies</h3>
                {(skill.requiredTools?.length ?? 0) > 0 && (
                  <div className="mb-2">
                    <p className="mb-1 text-sm text-gray-500">
                      Required Tools:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(skill.requiredTools ?? []).map((tool) => (
                        <span
                          key={tool}
                          className="rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-700"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {(skill.requiredSkills?.length ?? 0) > 0 && (
                  <div>
                    <p className="mb-1 text-sm text-gray-500">
                      Required Skills:
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(skill.requiredSkills ?? []).map((s) => (
                        <span
                          key={s}
                          className="rounded bg-purple-100 px-2 py-0.5 text-xs text-purple-700"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 border-t border-gray-200 p-6">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
          {!skill.installed && (
            <button
              onClick={() => onInstall(skill.id)}
              disabled={installing}
              className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {installing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {t('admin.skills.marketplace.install')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
