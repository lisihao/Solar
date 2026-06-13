'use client';

/**
 * AppSkillsPanel - Per-AI-App Skills Management Panel
 *
 * Shared component for viewing domain skills + effectiveness metrics.
 * Admin users can toggle skills per domain.
 */

import { useState, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/lib/i18n';
import { useAppSkills } from '@/hooks/domain/useAppSkills';
import {
  SKILL_LAYERS,
  type SkillLayer,
} from '@/components/admin/skills/skill-layers';
import {
  Search,
  BarChart2,
  CheckCircle,
  XCircle,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import type { DomainSkill } from './types';

interface AppSkillsPanelProps {
  domain: string;
  title?: string;
  compact?: boolean;
}

function EffectivenessBadge({ rate, count }: { rate: number; count: number }) {
  if (count === 0) {
    return <span className="text-xs text-gray-400">--</span>;
  }
  const color =
    rate >= 90
      ? 'bg-green-50 text-green-700'
      : rate >= 70
        ? 'bg-yellow-50 text-yellow-700'
        : 'bg-red-50 text-red-700';
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {rate}%
    </span>
  );
}

function SkillItemRow({
  skill,
  isAdmin,
  onToggle,
  toggling,
}: {
  skill: DomainSkill;
  isAdmin: boolean;
  onToggle: (skillId: string, enabled: boolean) => void;
  toggling: boolean;
}) {
  const layerInfo =
    SKILL_LAYERS.find((l) => l.id === skill.layer) || SKILL_LAYERS[0];
  const LayerIcon = layerInfo.icon;
  const eff = skill.effectiveness;

  return (
    <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 transition-colors last:border-b-0 hover:bg-gray-50">
      {/* Status */}
      <div className="flex-shrink-0">
        {skill.enabled ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-gray-300" />
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-gray-900">
            {skill.displayName}
          </span>
          <span
            className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-xs font-medium ${layerInfo.badge}`}
          >
            <LayerIcon className="mr-0.5 inline h-3 w-3" />
            {skill.layer ?? 'all'}
          </span>
        </div>
        <p className="truncate text-xs text-gray-500">{skill.description}</p>
      </div>

      {/* Effectiveness */}
      <div className="hidden flex-shrink-0 items-center gap-2 sm:flex">
        {eff.usageCount > 0 && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <BarChart2 className="h-3 w-3" />
            {eff.usageCount.toLocaleString()}
          </div>
        )}
        <EffectivenessBadge rate={eff.successRate} count={eff.usageCount} />
        {eff.avgDuration !== null && eff.usageCount > 0 && (
          <span className="text-xs text-gray-400">
            ~{Math.round(eff.avgDuration)}ms
          </span>
        )}
      </div>

      {/* Admin Toggle */}
      {isAdmin && (
        <button
          onClick={() => onToggle(skill.skillId, !skill.enabled)}
          disabled={toggling}
          className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors ${
            toggling ? 'cursor-not-allowed opacity-50' : ''
          } ${skill.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
        >
          <div
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
              skill.enabled ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </button>
      )}
    </div>
  );
}

export function AppSkillsPanel({
  domain,
  title,
  compact = false,
}: AppSkillsPanelProps) {
  const { t } = useTranslation();
  const { isAdmin } = useAuth();
  const { skills, stats, loading, refresh, toggleSkill, toggling } =
    useAppSkills(domain);

  const [selectedLayer, setSelectedLayer] = useState<SkillLayer>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSkills = useMemo(() => {
    let result = skills;

    if (selectedLayer !== 'all') {
      result = result.filter((s) => s.layer === selectedLayer);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }

    return result;
  }, [skills, selectedLayer, searchQuery]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      {/* Stats Summary */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {title && (
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          )}
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>
              {stats.enabled}/{stats.total}{' '}
              {t('admin.skills.enabled') || 'enabled'}
            </span>
          </div>
        </div>
        <button
          onClick={() => refresh()}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        >
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Search + Layer Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              t('admin.skills.searchPlaceholder') || 'Search skills...'
            }
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Layer Tabs */}
      {!compact && (
        <div className="flex flex-wrap gap-1">
          {SKILL_LAYERS.map((layer) => {
            const count =
              layer.id === 'all'
                ? skills.length
                : (stats.byLayer[layer.id] ?? 0);
            if (layer.id !== 'all' && count === 0) return null;
            return (
              <button
                key={layer.id}
                onClick={() => setSelectedLayer(layer.id)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedLayer === layer.id
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {t(layer.labelKey) || layer.id} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Skills List */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        {filteredSkills.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            {searchQuery
              ? t('admin.skills.noSkillsFound') || 'No skills found'
              : t('admin.skills.noSkillsFound') || 'No skills available'}
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <SkillItemRow
              key={skill.skillId}
              skill={skill}
              isAdmin={isAdmin}
              onToggle={toggleSkill}
              toggling={toggling}
            />
          ))
        )}
      </div>
    </div>
  );
}
