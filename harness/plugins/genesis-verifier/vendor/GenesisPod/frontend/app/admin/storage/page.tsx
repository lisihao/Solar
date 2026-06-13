'use client';

import { HardDrive } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { StorageInventoryPanel } from '@/components/admin/data-management';

export default function StorageAdminPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.storage')}
      description="数据库体积、R2 对象存储用量、Off-load 迁移进度"
      icon={HardDrive}
      domain="data"
      maxWidth="7xl"
    >
      <StorageInventoryPanel />
    </AdminPageLayout>
  );
}
