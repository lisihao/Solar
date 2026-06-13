'use client';

/**
 * LocalSkillsTable —— 技能管理 Tab 1: 内置技能（table-first）
 *
 * 2026-05-11 W4: 替代 LocalSkillsTab 的 card grid，与 knowledge / tools tab
 * 视觉对齐（table + drawer）。保留所有富功能（编辑 prompt / 版本历史 / 测试）
 * 作为抽屉内入口，沿用旧的 EditSkillModal / SkillPromptEditor / SkillTestPanel /
 * SkillVersionHistory 弹层组件，无功能回归。
 *
 * 数据来源：父 SkillsManagement 拉取的 skills[]（不在此组件 fetch，避免双源）
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, Upload, Loader2, Pencil } from 'lucide-react';
import {
  DrawerShell,
  PaginationBar,
  Row,
  Section,
  Th,
  fmtTime,
} from '../_shared/admin-tables';
import { TruncatedCell } from '@/components/common/tables';
import { EditSkillModal } from './EditSkillModal';
import { SKILL_LAYERS, type SkillLayer } from './skill-layers';
import { useTranslation } from '@/lib/i18n';
import type { SkillConfig } from './types';

const PAGE_SIZE = 50;

interface LocalSkillsTableProps {
  skills: SkillConfig[];
  onToggle: (skillId: string, enabled: boolean) => Promise<void> | void;
  onSaveSkill: (skill: SkillConfig) => Promise<void>;
  onUploadSkill?: (file: File) => Promise<void>;
  saving: boolean;
  usageCounts?: Record<string, number>;
}

export function LocalSkillsTable({
  skills,
  onToggle,
  onSaveSkill,
  onUploadSkill,
  saving,
  usageCounts = {},
}: LocalSkillsTableProps) {
  const [search, setSearch] = useState('');
  const [layerFilter, setLayerFilter] = useState<SkillLayer>('all');
  const [enabledFilter, setEnabledFilter] = useState<'' | 'true' | 'false'>('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const { t } = useTranslation();

  const layerCounts = useMemo(() => {
    const counts: Record<string, number> = { all: skills.length };
    for (const layer of SKILL_LAYERS) {
      counts[layer.id] = skills.filter((s) => s.layer === layer.id).length;
    }
    return counts;
  }, [skills]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (layerFilter !== 'all' && s.layer !== layerFilter) return false;
      if (enabledFilter && String(s.enabled) !== enabledFilter) return false;
      if (q) {
        const hit =
          s.skillId.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          (s.displayName ?? '').toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
  }, [skills, search, layerFilter, enabledFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 学 BuiltinToolsTable: layerFilter='all' 时按 layer 分组（一段一彩色头）
  // 单 layer 过滤时回到平铺单表（专注当前 layer，无需再次重复 header）。
  const groupedByLayer = useMemo(() => {
    if (layerFilter !== 'all') return null;
    const map = new Map<string, SkillConfig[]>();
    for (const s of filtered) {
      const key = s.layer || 'content';
      const arr = map.get(key) ?? [];
      arr.push(s);
      map.set(key, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        (a.displayName || a.name).localeCompare(b.displayName || b.name)
      );
    }
    const orderIndex = (layer: string) => {
      const idx = SKILL_LAYERS.findIndex((l) => l.id === layer);
      return idx === -1 ? SKILL_LAYERS.length : idx;
    };
    return Array.from(map.entries()).sort(([a], [b]) => {
      const ai = orderIndex(a);
      const bi = orderIndex(b);
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });
  }, [filtered, layerFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [page, totalPages]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUploadSkill) return;
    setUploading(true);
    try {
      await onUploadSkill(file);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const toggleSkill = async (skillId: string, next: boolean) => {
    setTogglingId(skillId);
    try {
      await onToggle(skillId, next);
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="搜索 skillId / name / tags..."
            className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
          />
        </div>
        <select
          value={layerFilter}
          onChange={(e) => {
            setLayerFilter(e.target.value as SkillLayer);
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        >
          {SKILL_LAYERS.map((l) => (
            <option key={l.id} value={l.id}>
              {t(l.labelKey)} ({layerCounts[l.id] ?? 0})
            </option>
          ))}
        </select>
        <select
          value={enabledFilter}
          onChange={(e) => {
            setEnabledFilter(e.target.value as '' | 'true' | 'false');
            setPage(1);
          }}
          className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
        >
          <option value="">全部状态</option>
          <option value="true">已启用</option>
          <option value="false">已禁用</option>
        </select>
        {onUploadSkill && (
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            上传
            <input
              type="file"
              accept=".md,.markdown"
              onChange={handleUpload}
              className="hidden"
              disabled={uploading}
            />
          </label>
        )}
        <span className="text-xs text-gray-500">
          {filtered.length} / {skills.length}
        </span>
      </div>

      {groupedByLayer ? (
        <div className="space-y-4">
          {groupedByLayer.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white py-12 text-center text-sm text-gray-500">
              暂无内置技能
            </div>
          ) : (
            groupedByLayer.map(([layerId, layerSkills]) => {
              const layerDef =
                SKILL_LAYERS.find((l) => l.id === layerId) ??
                SKILL_LAYERS.find((l) => l.id === 'content')!;
              const Icon = layerDef.icon;
              const enabledCount = layerSkills.filter((x) => x.enabled).length;
              return (
                <div
                  key={layerId}
                  className="overflow-hidden rounded-lg border border-gray-200 bg-white"
                >
                  <div
                    className={`flex items-center justify-between px-4 py-2 ${layerDef.color}`}
                  >
                    <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-800">
                      <Icon className="h-3.5 w-3.5" />
                      {t(layerDef.labelKey)}
                    </h3>
                    <div className="flex items-center gap-2 text-xs">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${layerDef.badge}`}
                      >
                        {layerSkills.length} 个
                      </span>
                      <span className="text-gray-600">
                        {enabledCount} 已启用
                      </span>
                    </div>
                  </div>
                  <SkillTableBody
                    skills={layerSkills}
                    usageCounts={usageCounts}
                    togglingId={togglingId}
                    toggleSkill={toggleSkill}
                    onSelect={setSelectedId}
                  />
                </div>
              );
            })
          )}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <SkillTableBody
              skills={pageItems}
              usageCounts={usageCounts}
              togglingId={togglingId}
              toggleSkill={toggleSkill}
              onSelect={setSelectedId}
            />
          </div>
          <PaginationBar
            page={page}
            totalPages={totalPages}
            loading={false}
            onChange={(p) => setPage(p)}
          />
        </>
      )}

      {selectedId && (
        <LocalSkillDrawer
          skillId={selectedId}
          skills={skills}
          usageCounts={usageCounts}
          saving={saving}
          onClose={() => setSelectedId(null)}
          onSaveSkill={onSaveSkill}
        />
      )}
    </div>
  );
}

/**
 * SkillTableBody — 抽出 thead+tbody，分组渲染和单表都复用，避免双源。
 */
function SkillTableBody({
  skills,
  usageCounts,
  togglingId,
  toggleSkill,
  onSelect,
}: {
  skills: SkillConfig[];
  usageCounts: Record<string, number>;
  togglingId: string | null;
  toggleSkill: (id: string, next: boolean) => Promise<void> | void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <table className="w-full table-fixed divide-y divide-gray-200">
      <colgroup>
        <col className="w-[22%]" />
        <col className="w-[20%]" />
        <col className="w-[18%]" />
        <col className="w-[8%]" />
        <col className="w-[10%]" />
        <col className="w-[14%]" />
        <col className="w-[8%]" />
      </colgroup>
      <thead className="bg-gray-50">
        <tr>
          <Th>名称</Th>
          <Th>skillId</Th>
          <Th>层 / 领域</Th>
          <Th>版本</Th>
          <Th className="text-right">使用次数</Th>
          <Th>上次使用</Th>
          <Th>启用</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 bg-white">
        {skills.length === 0 ? (
          <tr>
            <td
              colSpan={7}
              className="px-4 py-8 text-center text-sm text-gray-500"
            >
              该层暂无技能
            </td>
          </tr>
        ) : (
          skills.map((s) => {
            const layerDef = SKILL_LAYERS.find((l) => l.id === s.layer);
            const layerLabel = layerDef ? t(layerDef.labelKey) : s.layer;
            const uses = usageCounts[s.skillId] ?? s.usageCount ?? 0;
            return (
              <tr
                key={s.skillId}
                onClick={() => onSelect(s.skillId)}
                className="cursor-pointer hover:bg-gray-50"
              >
                <td className="px-4 py-3 text-sm font-medium text-gray-900">
                  <TruncatedCell className="max-w-[260px]">
                    {s.displayName || s.name}
                  </TruncatedCell>
                </td>
                <td className="font-mono px-4 py-3 text-xs text-gray-600">
                  <TruncatedCell className="max-w-[200px]">
                    {s.skillId}
                  </TruncatedCell>
                </td>
                <td className="px-4 py-3 text-xs text-gray-600">
                  <div className="flex items-center gap-1">
                    <span
                      className={`inline-flex flex-shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${layerDef?.badge ?? 'bg-purple-50 text-purple-700'}`}
                    >
                      {layerLabel}
                    </span>
                    <TruncatedCell className="max-w-[120px] text-gray-500">
                      / {s.domain}
                    </TruncatedCell>
                  </div>
                </td>
                <td className="font-mono whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                  {s.version ?? '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums text-gray-700">
                  {uses}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                  {fmtTime(s.lastUsedAt)}
                </td>
                <td
                  className="whitespace-nowrap px-4 py-3 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => void toggleSkill(s.skillId, !s.enabled)}
                    disabled={togglingId === s.skillId}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      s.enabled ? 'bg-purple-600' : 'bg-gray-300'
                    } ${togglingId === s.skillId ? 'opacity-50' : ''}`}
                    aria-label={
                      s.enabled ? '已启用，点击禁用' : '已禁用，点击启用'
                    }
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                        s.enabled ? 'translate-x-5' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </td>
              </tr>
            );
          })
        )}
      </tbody>
    </table>
  );
}

function LocalSkillDrawer({
  skillId,
  skills,
  usageCounts,
  saving,
  onClose,
  onSaveSkill,
}: {
  skillId: string;
  skills: SkillConfig[];
  usageCounts: Record<string, number>;
  saving: boolean;
  onClose: () => void;
  onSaveSkill: (skill: SkillConfig) => Promise<void>;
}) {
  const skill = skills.find((s) => s.skillId === skillId);
  const [showEdit, setShowEdit] = useState(false);

  return (
    <DrawerShell
      title={skill?.displayName || skill?.name || skillId}
      subtitle={skill?.description ?? ''}
      onClose={onClose}
    >
      {!skill ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-purple-600" />
        </div>
      ) : (
        <div className="space-y-5">
          <Section title="基本信息">
            <Row
              label="skillId"
              value={<code className="font-mono text-xs">{skill.skillId}</code>}
            />
            <Row label="层" value={skill.layer} />
            <Row label="领域" value={skill.domain} />
            <Row label="版本" value={skill.version ?? '—'} />
            <Row
              label="状态"
              value={
                skill.enabled ? (
                  <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    已启用
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                    已禁用
                  </span>
                )
              }
            />
            <Row label="作者" value={skill.author ?? '—'} />
            <Row label="来源" value={skill.source ?? '—'} />
            <Row
              label="使用次数"
              value={String(
                usageCounts[skill.skillId] ?? skill.usageCount ?? 0
              )}
            />
            <Row label="上次使用" value={fmtTime(skill.lastUsedAt)} />
          </Section>

          {skill.tags.length > 0 && (
            <Section title="标签">
              <div className="flex flex-wrap gap-1.5">
                {skill.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex whitespace-nowrap rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {(skill.requiredTools.length > 0 ||
            skill.requiredSkills.length > 0) && (
            <Section title="依赖">
              {skill.requiredTools.length > 0 && (
                <Row
                  label="工具"
                  value={
                    <span className="font-mono text-xs">
                      {skill.requiredTools.join(', ')}
                    </span>
                  }
                />
              )}
              {skill.requiredSkills.length > 0 && (
                <Row
                  label="技能"
                  value={
                    <span className="font-mono text-xs">
                      {skill.requiredSkills.join(', ')}
                    </span>
                  }
                />
              )}
            </Section>
          )}

          {skill.taskProfile && (
            <Section title="TaskProfile">
              <Row
                label="creativity"
                value={skill.taskProfile.creativity ?? '—'}
              />
              <Row
                label="outputLength"
                value={skill.taskProfile.outputLength ?? '—'}
              />
            </Section>
          )}

          <Section title="操作">
            <button
              type="button"
              onClick={() => setShowEdit(true)}
              className="inline-flex items-center gap-1 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700"
            >
              <Pencil className="h-3.5 w-3.5" />
              编辑详情（含 Prompt / 版本历史 / 测试）
            </button>
          </Section>

          {skill.examples && skill.examples.length > 0 && (
            <Section title="示例">
              <div className="space-y-2">
                {skill.examples.slice(0, 3).map((ex, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-gray-200 bg-white p-3"
                  >
                    <div className="text-xs font-medium text-gray-900">
                      {ex.title}
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      <span className="font-medium">输入:</span> {ex.input}
                    </div>
                    <div className="mt-0.5 text-xs text-gray-600">
                      <span className="font-medium">输出:</span> {ex.output}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {skill && showEdit && (
        <EditSkillModal
          skill={skill}
          onClose={() => setShowEdit(false)}
          onSave={async (updated) => {
            await onSaveSkill(updated);
            setShowEdit(false);
          }}
          saving={saving}
        />
      )}
    </DrawerShell>
  );
}
