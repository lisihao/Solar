'use client';

import { Lightbulb } from 'lucide-react';
import { AIInsight } from '../utils/types';
import TextSelectionToolbar from '@/components/ui/content/TextSelectionToolbar';
import { useTranslation } from '@/lib/i18n/i18n-context';
import { SectionPanelCard } from '@/components/ui/cards';

interface AIInsightsCardProps {
  aiInsights: AIInsight[];
  resourceId?: string;
  onContextMenu?: (e: React.MouseEvent, text: string) => void;
  onAskAI?: (text: string) => void;
}

export default function AIInsightsCard({
  aiInsights,
  resourceId,
  onContextMenu,
  onAskAI,
}: AIInsightsCardProps) {
  const { t } = useTranslation();

  return (
    <SectionPanelCard
      accent="orange"
      titleSize="sm"
      icon={<Lightbulb className="h-4 w-4" />}
      title={`${aiInsights.length} ${t('explore.aiCards.insights.title') || 'Key Insights'}`}
      subtitle={
        t('explore.aiCards.insights.hint') || 'Select text for more options'
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
          {aiInsights.map((insight, i) => (
            <div
              key={i}
              className={`group cursor-text select-text rounded-lg border-2 p-2.5 transition-all ${
                insight.importance === 'high'
                  ? 'border-red-200 bg-red-50 hover:border-red-300 hover:bg-red-100'
                  : insight.importance === 'medium'
                    ? 'border-orange-200 bg-orange-50 hover:border-orange-300 hover:bg-orange-100'
                    : 'border-gray-200 bg-gray-50 hover:border-gray-300 hover:bg-gray-100'
              }`}
            >
              <div className="flex items-start">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold leading-snug text-gray-900">
                    {insight.title}
                  </h4>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600">
                    {insight.description}
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
