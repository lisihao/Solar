'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Crown,
  Cpu,
  Send,
  Store,
  X,
  Brain,
  Rocket,
  Compass,
  Telescope,
  Shield,
  Sparkles,
  Flame,
  Wrench,
  Workflow,
  Settings2,
  type LucideIcon,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states';
import { Modal, ConfirmDialog } from '@/components/ui/dialogs';
import { Button } from '@/components/ui/primitives/button';
import { AssetCard } from '@/components/ui/cards/asset-card/AssetCard';
import { cn } from '@/lib/utils/common';
import { AVATAR_GRADIENTS } from '@/lib/design/tokens';
import { useCompanyStore, type Hero } from '@/stores/company/companyStore';
import { useAIModels } from '@/hooks/features/useAIModels';
import { useMarketplaceCatalog } from '@/hooks/features/useMarketplaceCatalog';
import type { WorkflowListing } from '@/components/marketplace/marketplace.types';
import { HeroSkillToolDrawer } from '@/components/me/hero/HeroSkillToolDrawer';

const CONTROL_CLS =
  'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary';

/** 按 id 哈希取头像渐变（与 store 一致的纯装饰着色）。 */
function gradientForId(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}

/**
 * 专家头像预设（cosmetic）：图标 + token 渐变（渐变取自 AVATAR_GRADIENTS，避免硬编码色）。
 * 纯展示，不影响执行。
 */
const HERO_AVATARS: { key: string; Icon: LucideIcon }[] = [
  { key: 'crown', Icon: Crown },
  { key: 'brain', Icon: Brain },
  { key: 'rocket', Icon: Rocket },
  { key: 'compass', Icon: Compass },
  { key: 'telescope', Icon: Telescope },
  { key: 'shield', Icon: Shield },
  { key: 'sparkles', Icon: Sparkles },
  { key: 'flame', Icon: Flame },
];

/** 头像 key → { 图标, 渐变 }；未选中返回 null（调用方回退到 id 哈希色 + Crown）。 */
function avatarPreset(
  key: string | undefined
): { Icon: LucideIcon; gradient: string } | null {
  const idx = HERO_AVATARS.findIndex((a) => a.key === key);
  if (idx < 0) return null;
  return {
    Icon: HERO_AVATARS[idx].Icon,
    gradient: AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length],
  };
}

/**
 * 从市场 catalog 解析 capability 的展示信息（职能名 + 阶段 chips）。
 * hero.capabilityId === workflow listing 的 missionType（不是 listing.id）。
 */
function resolveCapability(
  capabilityId: string,
  workflows: WorkflowListing[]
): { title?: string; stages: string[]; skillIds: string[]; toolIds: string[] } {
  const w = workflows.find((x) => x.missionType === capabilityId);
  if (!w) return { stages: [], skillIds: [], toolIds: [] };
  return {
    title: w.name,
    stages: w.stages ?? [],
    skillIds: w.skillIds ?? [],
    toolIds: w.toolIds ?? [],
  };
}

/**
 * HeroRosterView —— 一人公司「我的专家」。
 * 标准主页页壳（与专家市场一致）：PageHeaderHero + 居中容器 + AssetCard 网格。
 * 每位专家 = 单能力官（实例名为身份，capability 为职能），可配模型/头像/人设、下任务、移除。
 */
export function HeroRosterView({
  onDispatch,
}: {
  /** 「下任务」回调（嵌在「我的团队」双 Tab 内时切到「专家任务」Tab）；不传则跳 /missions。 */
  onDispatch?: () => void;
} = {}) {
  const { heroes, loadHeroes } = useCompanyStore();
  const { catalog } = useMarketplaceCatalog();
  const [configId, setConfigId] = useState<string | null>(null);

  useEffect(() => {
    void loadHeroes();
  }, [loadHeroes]);

  const configHero = useMemo(
    () => heroes.find((h) => h.id === configId) ?? null,
    [heroes, configId]
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl px-8 pb-12 pt-5">
        {heroes.length === 0 ? (
          <EmptyState
            type="noData"
            icon={<Crown className="h-12 w-12" />}
            title="还没有专家"
            description="去专家市场招募你的第一位单能力官"
            action={
              <Button asChild>
                <Link href="/marketplace">
                  <Store className="mr-2 h-4 w-4" />
                  去专家市场
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {heroes.map((hero) => (
              <HeroCard
                key={hero.id}
                hero={hero}
                workflows={catalog.workflow}
                onConfig={() => setConfigId(hero.id)}
                onDispatch={onDispatch}
              />
            ))}
          </div>
        )}
      </div>

      {configHero && (
        <HeroConfigModal hero={configHero} onClose={() => setConfigId(null)} />
      )}
    </div>
  );
}

/** 专家卡 —— canonical AssetCard（与专家市场同款卡）。 */
function HeroCard({
  hero,
  workflows,
  onConfig,
  onDispatch,
}: {
  hero: Hero;
  workflows: WorkflowListing[];
  onConfig: () => void;
  onDispatch?: () => void;
}) {
  const { removeHero } = useCompanyStore();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [drawerFocus, setDrawerFocus] = useState<
    null | 'skills' | 'tools' | 'workflow'
  >(null);

  const capability = useMemo(
    () => resolveCapability(hero.capabilityId, workflows),
    [hero.capabilityId, workflows]
  );
  const preset = avatarPreset(hero.avatar);
  const AvatarIcon = preset?.Icon ?? Crown;
  const gradient = preset?.gradient ?? gradientForId(hero.id);

  return (
    <>
      <AssetCard
        title={hero.name}
        description={
          hero.tagline ? `「${hero.tagline}」` : (capability.title ?? '')
        }
        icon={<AvatarIcon className="h-6 w-6 text-white" />}
        gradient={gradient}
        badges={
          capability.title
            ? [
                {
                  key: 'role',
                  label: capability.title,
                  className: 'bg-primary/10 text-primary',
                },
              ]
            : []
        }
        isOwner
        onEdit={onConfig}
        onDelete={() => setConfirmOpen(true)}
        labels={{ edit: '配置', delete: '移除' }}
        stats={[
          {
            key: 'model',
            icon: <Cpu className="h-3.5 w-3.5" />,
            text:
              hero.models.length > 0
                ? `${hero.models.length} 个模型`
                : '引擎自动择优',
          },
        ]}
        customSection={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-medium">
            {capability.stages.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerFocus('workflow');
                }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Workflow className="h-3.5 w-3.5" />
                {capability.stages.length} 步工作流
              </button>
            )}
            {capability.skillIds.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerFocus('skills');
                }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {capability.skillIds.length} 技能
              </button>
            )}
            {capability.toolIds.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDrawerFocus('tools');
                }}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                <Wrench className="h-3.5 w-3.5" />
                {capability.toolIds.length} 工具
              </button>
            )}
          </div>
        }
        footerExtra={
          <div className="flex w-full items-center gap-2">
            {onDispatch ? (
              <Button size="sm" className="flex-1" onClick={onDispatch}>
                <Send className="mr-1.5 h-4 w-4" />
                下任务
              </Button>
            ) : (
              <Button asChild size="sm" className="flex-1">
                <Link href="/missions">
                  <Send className="mr-1.5 h-4 w-4" />
                  下任务
                </Link>
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={onConfig}>
              <Settings2 className="mr-1.5 h-4 w-4" />
              配置
            </Button>
          </div>
        }
      />
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => removeHero(hero.id)}
        type="danger"
        title={`移除「${hero.name}」？`}
        description="移除后该专家将从你的团队移除，可随时再去市场招募。"
        confirmText="移除"
      />
      <HeroSkillToolDrawer
        open={drawerFocus !== null}
        onClose={() => setDrawerFocus(null)}
        expertName={hero.name}
        focus={drawerFocus ?? 'all'}
        skillIds={capability.skillIds}
        toolIds={capability.toolIds}
        stages={capability.stages}
      />
    </>
  );
}

/**
 * HeroConfigModal —— 配置专家：名称+ 头像 + 人设 + 模型 fallback 链。
 */
function HeroConfigModal({
  hero,
  onClose,
}: {
  hero: Hero;
  onClose: () => void;
}) {
  const { configHero } = useCompanyStore();
  const { models: aiModels } = useAIModels();
  const [name, setName] = useState(hero.name);
  const [tagline, setTagline] = useState(hero.tagline ?? '');

  const commitName = () => {
    const next = name.trim();
    if (next && next !== hero.name) void configHero(hero.id, { name: next });
    else setName(hero.name);
  };
  const commitTagline = () => {
    const next = tagline.trim();
    if (next !== (hero.tagline ?? '')) {
      void configHero(hero.id, { tagline: next });
    }
  };

  const available = aiModels
    .filter(
      (m) =>
        m.modelType !== 'IMAGE_GENERATION' && m.modelType !== 'IMAGE_EDITING'
    )
    .filter((m) => !hero.models.includes(m.modelId))
    .map((m) => ({ id: m.modelId, name: m.name }));

  const nameOf = (id: string) =>
    aiModels.find((m) => m.modelId === id)?.name ?? id;

  const setModels = (models: string[]) => void configHero(hero.id, { models });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`配置 · ${hero.name}`}
      subtitle="名称、头像、人设与模型 fallback 链"
      footer={<Button onClick={onClose}>完成</Button>}
    >
      <div className="space-y-5">
        {/* 身份：名称 + 头像 + 人设 */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Sparkles className="h-4 w-4 text-violet-500" /> 身份
          </div>
          <label className="mb-1 block text-xs font-medium text-gray-500">
            名称
          </label>
          <input
            value={name}
            maxLength={20}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitName();
            }}
            className={cn(CONTROL_CLS, 'mb-3 max-w-sm')}
          />

          <label className="mb-1 block text-xs font-medium text-gray-500">
            头像
          </label>
          <div className="mb-3 flex flex-wrap gap-2">
            {HERO_AVATARS.map(({ key, Icon }, idx) => {
              const selected = hero.avatar === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => void configHero(hero.id, { avatar: key })}
                  aria-label={`头像 ${key}`}
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br text-white transition-all',
                    AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length],
                    selected
                      ? 'ring-2 ring-primary ring-offset-2'
                      : 'opacity-80 hover:opacity-100'
                  )}
                >
                  <Icon className="h-5 w-5" />
                </button>
              );
            })}
          </div>

          <label className="mb-1 block text-xs font-medium text-gray-500">
            一句话人设（仅展示，不影响执行）
          </label>
          <input
            value={tagline}
            maxLength={40}
            onChange={(e) => setTagline(e.target.value)}
            onBlur={commitTagline}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTagline();
            }}
            placeholder="例如：只信一手数据"
            className={cn(CONTROL_CLS, 'max-w-sm')}
          />
        </div>

        {/* 模型 */}
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-900">
            <Cpu className="h-4 w-4 text-slate-500" /> 模型
            <span className="text-xs font-normal text-gray-400">
              已选 {hero.models.length}
            </span>
          </div>

          {hero.models.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {hero.models.map((id, idx) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground"
                >
                  <span className="rounded bg-white/25 px-1 text-xs">
                    {idx === 0 ? '主' : `备${idx}`}
                  </span>
                  {nameOf(id)}
                  <button
                    type="button"
                    onClick={() =>
                      setModels(hero.models.filter((m) => m !== id))
                    }
                    className="rounded-full p-0.5 hover:bg-white/20"
                    aria-label="移除"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mb-2 text-xs text-gray-400">
              未配置模型，引擎将自动择优
            </p>
          )}

          {available.length > 0 ? (
            <select
              className={cn(CONTROL_CLS, 'max-w-sm')}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  setModels([...hero.models, e.target.value]);
                }
              }}
            >
              <option value="">+ 添加模型…</option>
              {available.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          ) : (
            <p className="text-xs text-gray-300">已全部添加</p>
          )}

          <label className="mt-3 flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={hero.autoFallback}
              onChange={(e) =>
                void configHero(hero.id, { autoFallback: e.target.checked })
              }
              className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
            />
            主模型不可用时，自动按链顺序 fallback 到备用模型
          </label>
        </div>
      </div>
    </Modal>
  );
}

export default HeroRosterView;
