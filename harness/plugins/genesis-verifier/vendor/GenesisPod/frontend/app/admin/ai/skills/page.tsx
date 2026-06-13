'use client';

import { Sparkles } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import SkillsManagement from '@/components/admin/SkillsManagement';

export default function SkillsManagementPage() {
  const { t } = useTranslation();

  return (
    <AdminPageLayout
      title={t('admin.nav.skills')}
      description={t('admin.skills.description')}
      icon={Sparkles}
      domain="ai"
    >
      <SkillsManagement />
    </AdminPageLayout>
  );
}
