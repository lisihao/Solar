'use client';

import { FlaskConical } from 'lucide-react';
import { AIInsight } from '../utils/types';
import TextSelectionToolbar from '@/components/ui/content/TextSelectionToolbar';
import { useTranslation } from '@/lib/i18n/i18n-context';
import { SectionPanelCard } from '@/components/ui/cards';

interface AIMethodologyCardProps {
  aiMethodology: AIInsight[];
  resourceId?: string;
  onContextMenu?: (e: React.MouseEvent, text: string) => void;
  onAskAI?: (text: string) => void;
}

export default function AIMethodologyCard({
  aiMethodology,
  resourceId,
  onContextMenu,
  onAskAI,
}: AIMethodologyCardProps) {
  const { t } = useTranslation();

  return (
    <SectionPanelCard
      accent="blue"
      titleSize="xs"
      icon={<FlaskConical className="h-4 w-4" />}
      title={t('explore.aiCards.methodology.title') || 'Research Methodology'}
      subtitle={
        t('explore.aiCards.methodology.hint') || 'Select text for more options'
      }
    >
      <TextSelectionToolbar
        resourceId={resourceId}
        onAskAI={onAskAI}
        onAddToNotes={(text) => {
          onContextMenu?.({} as React.MouseEvent, text);
        }}
      >
        <div className="space-y-2 p-3">
          {aiMethodology.map((method, i) => (
            <div
              key={i}
              className={`group cursor-text select-text rounded-lg border-2 p-2.5 transition-all ${
                method.importance === 'high'
                  ? 'border-blue-200 bg-blue-50 hover:border-blue-300 hover:bg-blue-100'
                  : method.importance === 'medium'
                    ? 'border-cyan-200 bg-cyan-50 hover:border-cyan-300 hover:bg-cyan-100'
                    : 'border-teal-200 bg-teal-50 hover:border-teal-300 hover:bg-teal-100'
              }`}
            >
              <div className="flex items-start gap-2">
                <FlaskConical className="h-4 w-4 flex-shrink-0 text-blue-600" />
                <div className="flex-1">
                  <h4 className="text-xs font-semibold leading-snug text-gray-900">
                    {method.title}
                  </h4>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
                    {method.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </TextSelectionToolbar>
    </SectionPanelCard>
  );
}
