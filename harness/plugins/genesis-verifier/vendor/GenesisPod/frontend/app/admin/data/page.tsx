'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { Database, HardDrive, Layers, Sparkles } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { AdminTabs, type AdminTab } from '@/components/admin/shared';
import {
  StorageInventoryPanel,
  TableManagementContent,
} from '@/components/admin/data-management';
import DataQualityManagement from '@/components/admin/data-management/DataQualityManagement';
import { toast } from '@/stores';

/**
 * 数据管理（L1 Infrastructure 4 卡之一）
 *
 * Wave 4 修订（2026-05-11）：从 4 Tab 精简为 3 Tab。
 *
 * - assets（数据资产）：表清单管理 + 诊断 + 清理（首个 Tab，最常用）
 * - storage（存储状态）：4 卡总览 + Offload Pipeline 主表 + R2 详情抽屉
 *   （去掉原 inner-tab pipeline/catalog/database/trend，趋势转为 stats 内嵌 30 天 delta）
 * - governance（数据治理）：质量指标主表 + 顶部治理操作按钮（白名单/失效清理/采集源）
 *   原 sources Tab 合并到此
 *
 * 子路由（/admin/storage、/admin/data-management、/admin/resources、/admin/data/{collection,whitelists,quality}）
 * 保留可用作 deep-link 兜底（独立页含 AdminPageLayout 包装）。
 */

type DataTab = 'assets' | 'storage' | 'governance';

function DataPageInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const tabs: AdminTab[] = [
    { key: 'assets', label: t('admin.data.groups.asset'), icon: Layers },
    {
      key: 'storage',
      label: t('admin.data.groups.storage'),
      icon: HardDrive,
    },
    {
      key: 'governance',
      label: t('admin.data.groups.governance'),
      icon: Sparkles,
    },
  ];

  const rawTab = searchParams?.get('tab');
  // 旧 sources tab 透明 redirect 到 governance + toast
  const tab: DataTab =
    rawTab === 'storage' || rawTab === 'governance' || rawTab === 'assets'
      ? rawTab
      : 'assets';

  useEffect(() => {
    if (rawTab === 'sources') {
      toast.info(t('admin.redirect.title'), t('admin.redirect.sources'));
      const params = new URLSearchParams(searchParams?.toString() ?? '');
      params.set('tab', 'governance');
      router.replace(`${pathname ?? '/admin/data'}?${params.toString()}`, {
        scroll: false,
      });
    }
  }, [rawTab, searchParams, router, pathname, t]);

  return (
    <AdminPageLayout
      title={t('admin.nav.dataManagementHub')}
      description={t('admin.data.description')}
      icon={Database}
      domain="data"
    >
      <div className="mb-6">
        <AdminTabs tabs={tabs} mode="route" />
      </div>

      {tab === 'assets' && <TableManagementContent />}

      {tab === 'storage' && <StorageInventoryPanel />}

      {tab === 'governance' && <DataQualityManagement />}
    </AdminPageLayout>
  );
}

export default function DataManagementPage() {
  return (
    <Suspense fallback={null}>
      <DataPageInner />
    </Suspense>
  );
}
