'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import {
  Lightbulb,
  GitBranch,
  PenTool,
  FlaskConical,
  AlertTriangle,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import { AdminTabs, type AdminTab } from '@/components/admin/shared';
import { MarkdownViewer } from '@/components/common/markdown-viewer';
import type { AiAppCategoryId } from '@/lib/features/admin/ai-app-categories';
import type { ResolvedModuleDoc } from '@/app/admin/ai-app/[category]/page';

const MermaidDiagram = dynamic(
  () => import('@/components/ui/viewers/MermaidDiagram'),
  {
    ssr: false,
  }
);

const CATEGORY_ICON: Record<AiAppCategoryId, typeof Lightbulb> = {
  insights: Lightbulb,
  planning: GitBranch,
  content: PenTool,
  labs: FlaskConical,
};

interface AiAppCategoryViewProps {
  categoryId: AiAppCategoryId;
  titleKey: string;
  descriptionKey: string;
  overviewDiagram: string;
  modules: ResolvedModuleDoc[];
}

export default function AiAppCategoryView({
  categoryId,
  titleKey,
  descriptionKey,
  overviewDiagram,
  modules,
}: AiAppCategoryViewProps) {
  const { t } = useTranslation();
  const [activeModuleId, setActiveModuleId] = useState<string>(
    modules[0]?.id ?? ''
  );
  const activeModule =
    modules.find((m) => m.id === activeModuleId) ?? modules[0];

  const tabs: AdminTab[] = modules.map((m) => ({
    key: m.id,
    label: m.label,
  }));

  const Icon = CATEGORY_ICON[categoryId];

  return (
    <AdminPageLayout
      title={t(titleKey)}
      description={t(descriptionKey)}
      icon={Icon}
      domain="ai"
    >
      <div className="space-y-6">
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-base font-semibold text-gray-900">
            {t('admin.aiApp.categoryOverview')}
          </h2>
          <div className="max-h-[60vh] overflow-auto">
            <MermaidDiagram chart={overviewDiagram} />
          </div>
        </section>

        <section>
          <AdminTabs
            tabs={tabs}
            activeKey={activeModuleId}
            onChange={setActiveModuleId}
            mode="controlled"
          />
        </section>

        {activeModule && (
          <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-4 border-b border-gray-100 pb-4">
              <h2 className="text-lg font-semibold text-gray-900">
                {activeModule.label}
              </h2>
              <p className="mt-1 text-sm text-gray-500">{activeModule.blurb}</p>
              {!activeModule.loaded && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{t('admin.aiApp.docPlaceholderNotice')}</span>
                </div>
              )}
              {activeModule.loaded && activeModule.resolvedDocPath && (
                <details className="mt-2 text-xs text-gray-400">
                  <summary className="cursor-pointer hover:text-gray-600">
                    {t('admin.aiApp.viewSource')}
                  </summary>
                  <code className="font-mono mt-1 block">
                    docs/architecture/ai-app/{activeModule.resolvedDocPath}
                  </code>
                </details>
              )}
            </div>
            <MarkdownViewer
              content={activeModule.content}
              enableRawHtml
              className="prose-sm"
            />
          </section>
        )}
      </div>
    </AdminPageLayout>
  );
}
