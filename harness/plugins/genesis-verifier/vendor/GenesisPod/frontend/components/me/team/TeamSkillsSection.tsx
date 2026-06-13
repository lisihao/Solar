'use client';

import { useEffect, useMemo } from 'react';
import { useCompanyStore } from '@/stores/company/companyStore';
import { useMarketplaceCatalog } from '@/hooks/features/useMarketplaceCatalog';
import {
  TeamResourceSection,
  type TeamResourceCard,
} from './TeamResourceSection';

/** kebab-case / snake_case → Title Case（分组标题展示用）。 */
function formatCategory(raw: string): string {
  return raw.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * 团队技能 —— 归一后的单一源：团队技能池 = 已雇 Agent 自带技能闭包 + 从技能市场加购。
 *
 * 数据来自 `companyStore.acquiredSkillIds`（hire 时取 agent.skillIds 并集 + 市场
 * acquireSkill 追加），用智能体市场 catalog 解析展示名/描述/分类。
 * 不再读 `/user/skills` 授权系统（skills BYOK 实际未使用）—— 与团队工作流同源同构。
 */
export function TeamSkillsSection() {
  const { acquiredSkillIds, loadCompany } = useCompanyStore();
  const { catalog, loading, error, refresh } = useMarketplaceCatalog();

  // 该页是独立路由（/me/skills），不经 AgentTeamSection，需自行加载公司快照，
  // 否则 acquiredSkillIds 为空 → 页面空白。
  useEffect(() => {
    void loadCompany();
  }, [loadCompany]);

  const cards: TeamResourceCard[] = useMemo(() => {
    const byId = new Map(catalog.skill.map((s) => [s.id, s]));
    return acquiredSkillIds.map((id) => {
      const s = byId.get(id);
      return {
        id,
        name: s?.name ?? id,
        subtitle: s?.description,
        category: formatCategory(s?.category ?? 'other'),
      };
    });
  }, [acquiredSkillIds, catalog.skill]);

  return (
    <TeamResourceSection
      kind="skill"
      cards={cards}
      loading={loading}
      error={error}
      onRetry={refresh}
      unitLabel="项技能"
      marketLabel="技能市场"
      hint="团队技能 = 已雇 Agent 自带 + 从技能市场加购。"
      emptyTitle="还没有团队技能"
      emptyDesc="雇佣自带技能的 Agent，或去技能市场加购"
    />
  );
}

export default TeamSkillsSection;
