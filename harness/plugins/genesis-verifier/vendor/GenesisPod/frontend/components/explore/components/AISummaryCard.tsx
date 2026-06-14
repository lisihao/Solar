'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText } from 'lucide-react';
import { extractImagesFromMarkdown } from '../utils';
import { Base64Image } from '../resources/Base64Image';
import TextSelectionToolbar from '@/components/ui/content/TextSelectionToolbar';
import { useTranslation } from '@/lib/i18n/i18n-context';
import { SectionPanelCard } from '@/components/ui/cards';

interface AISummaryCardProps {
  aiSummary: string;
  resourceId?: string;
  onContextMenu?: (e: React.MouseEvent, text: string) => void;
  onAskAI?: (text: string) => void;
}

export default function AISummaryCard({
  aiSummary,
  resourceId,
  onContextMenu,
  onAskAI,
}: AISummaryCardProps) {
  const { t } = useTranslation();

  return (
    <SectionPanelCard
      accent="red"
      titleSize="sm"
      icon={<FileText className="h-4 w-4" />}
      title={t('explore.aiCards.summary.title') || 'AI Summary'}
      subtitle={
        t('explore.aiCards.summary.hint') || 'Select text for more options'
      }
    >
      <TextSelectionToolbar
        resourceId={resourceId}
        onAskAI={onAskAI}
        onAddToNotes={(text, note) => {
          onContextMenu?.({} as React.MouseEvent, text);
        }}
      >
        <div className="prose prose-sm max-w-none cursor-text select-text p-3">
          {(() => {
            const { images, textContent } =
              extractImagesFromMarkdown(aiSummary);
            return (
              <>
                {images.map((img, idx) => (
                  <Base64Image key={idx} src={img.src} alt={img.alt} />
                ))}
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {textContent}
                </ReactMarkdown>
              </>
            );
          })()}
        </div>
      </TextSelectionToolbar>
    </SectionPanelCard>
  );
}
