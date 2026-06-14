'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Users, Crown, ListChecks, Store } from 'lucide-react';
import { PageHeaderHero } from '@/components/ui/page-header-hero';
import { Tabs } from '@/components/ui/tabs/Tabs';
import { Button } from '@/components/ui/primitives/button';
import { HeroRosterView } from '@/components/me/hero/HeroRosterView';
import { MissionRunView } from '@/components/me/team/views/MissionRunView';

type TeamTab = 'roster' | 'missions';

/**
 * MyTeamView —— 「我的专家团」主体（heroes 双 Tab：我的专家 / 专家任务）。
 * 两个子视图以 embedded 模式渲染（收起各自页头，只出主体），避免双页头。
 *
 * - 主侧栏 /agents：完整 PageHeaderHero（标题 + 去专家市场）。
 * - 个人中心 /me/agents：传 hideHeader —— 外层已有页面标题「专家团队」，
 *   去掉重复的内层 hero 横幅，仅保留 Tab + 去专家市场。
 */
export function MyTeamView({
  hideHeader = false,
}: {
  hideHeader?: boolean;
} = {}) {
  const [tab, setTab] = useState<TeamTab>('roster');
  // 任务详情态：进入整屏 mission 详情时隐藏团队页头 + Tab，让详情全屏接管。
  const [detailOpen, setDetailOpen] = useState(false);

  const tabs = (
    <Tabs
      items={[
        { key: 'roster', label: '我的专家', icon: Crown },
        { key: 'missions', label: '专家任务', icon: ListChecks },
      ]}
      value={tab}
      onChange={(k) => setTab(k as TeamTab)}
      className={hideHeader ? 'border-b-0' : undefined}
    />
  );

  const marketBtn = (
    <Button asChild variant="outline" size="sm">
      <Link href="/marketplace">
        <Store className="mr-2 h-4 w-4" />
        去专家市场
      </Link>
    </Button>
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-gray-50/50">
      {!detailOpen && (
        <div className="flex-shrink-0">
          {hideHeader ? (
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-8">
              {tabs}
              {marketBtn}
            </div>
          ) : (
            <PageHeaderHero
              module="ask"
              icon={<Users className="h-7 w-7 text-white" />}
              title="我的专家团"
              subtitle="麾下专家各司其职，配好模型即可下任务，调遣他们替你完成深度工作"
              actions={marketBtn}
            >
              {tabs}
            </PageHeaderHero>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {tab === 'roster' ? (
          <HeroRosterView onDispatch={() => setTab('missions')} />
        ) : (
          <MissionRunView embedded onDetailOpenChange={setDetailOpen} />
        )}
      </div>
    </div>
  );
}

export default MyTeamView;
