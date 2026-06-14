'use client';

import AppShell from '@/components/layout/AppShell';
import { MarketplaceView } from '@/components/marketplace/MarketplaceView';

/**
 * /marketplace —— 智能体市场（平台共享一级菜单）。
 * 详见 docs/features/one-person-company-os/design.md §4.1。
 */
export default function MarketplacePage() {
  return (
    <AppShell>
      <MarketplaceView />
    </AppShell>
  );
}
