'use client';

import { Brain } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import KnowledgeManagement from '@/components/admin/knowledge/KnowledgeManagement';

export default function KnowledgeManagementPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.knowledge')}
      description={t('admin.architecture.cards.engineKnowledgeDesc')}
      icon={Brain}
      domain="ai"
    >
      <KnowledgeManagement />
    </AdminPageLayout>
  );
}
