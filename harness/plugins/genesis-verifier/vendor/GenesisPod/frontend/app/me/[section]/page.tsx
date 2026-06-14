'use client';

import { useParams, notFound } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { getSettingsSection } from '@/components/me/settings-sections';

/**
 * /me/[section] — 按 section 渲染内容。非法 section → notFound()（设计 §3.3.4）。
 */
export default function MeSectionPage() {
  const { t } = useTranslation();
  const params = useParams();
  const sectionId = String(params?.section ?? '');
  const section = getSettingsSection(sectionId);

  if (!section) {
    notFound();
  }

  const Content = section.component;

  return (
    <div className="mx-auto min-w-0 max-w-7xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          {t(section.labelKey)}
        </h1>
      </header>
      <div className="min-w-0 overflow-x-auto">
        <Content />
      </div>
    </div>
  );
}
