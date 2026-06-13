'use client';

/**
 * AI Edit Preview Modal
 *
 * A modal for previewing AI edit results before applying them:
 * - Side-by-side comparison of original and edited text
 * - Apply, regenerate, or cancel options
 * - Loading state during AI processing
 */

import { Loader2, RefreshCw, Check, X, AlertCircle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Button } from '@/components/ui/primitives/button';
import { cn } from '@/lib/utils/common';

export interface AIEditPreviewModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Original text before editing */
  originalText: string;
  /** Edited text from AI */
  editedText: string;
  /** Whether AI is processing */
  isLoading: boolean;
  /** Error state */
  error?: Error | null;
  /** Apply the edit */
  onApply: () => void;
  /** Regenerate the edit */
  onRegenerate: () => void;
  /** Clear error */
  onClearError?: () => void;
  /** Optional: The instruction used for editing (for display) */
  instruction?: string;
}

export function AIEditPreviewModal({
  isOpen,
  onClose,
  originalText,
  editedText,
  isLoading,
  error,
  onApply,
  onRegenerate,
  onClearError,
  instruction,
}: AIEditPreviewModalProps) {
  const { t } = useI18n();

  // Handle close - only allow if not loading
  const handleClose = () => {
    if (!isLoading) {
      onClearError?.();
      onClose();
    }
  };

  // Determine if we have a valid result to show
  const hasResult = !isLoading && !error && editedText;
  const hasError = !isLoading && error;

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title={t('topicResearch.aiEdit.editPreview')}
      subtitle={
        instruction
          ? `${t('topicResearch.aiEdit.customInstruction')}: ${instruction.slice(0, 50)}${instruction.length > 50 ? '...' : ''}`
          : undefined
      }
      size="xl"
      closeButtonDisabled={isLoading}
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
      footer={
        isLoading ? (
          <Button variant="outline" onClick={handleClose} disabled>
            {t('topicResearch.aiEdit.cancel')}
          </Button>
        ) : hasError ? (
          // Error state footer
          <>
            <Button variant="outline" onClick={handleClose}>
              <X className="mr-2 h-4 w-4" />
              {t('topicResearch.aiEdit.cancel')}
            </Button>
            <Button onClick={onRegenerate}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('topicResearch.aiEdit.retry')}
            </Button>
          </>
        ) : (
          // Success state footer
          <>
            <Button variant="outline" onClick={handleClose}>
              <X className="mr-2 h-4 w-4" />
              {t('topicResearch.aiEdit.cancel')}
            </Button>
            <Button variant="outline" onClick={onRegenerate}>
              <RefreshCw className="mr-2 h-4 w-4" />
              {t('topicResearch.aiEdit.regenerate')}
            </Button>
            <Button onClick={onApply} disabled={!editedText}>
              <Check className="mr-2 h-4 w-4" />
              {t('topicResearch.aiEdit.applyChanges')}
            </Button>
          </>
        )
      }
    >
      {isLoading ? (
        // Loading state
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600" />
          <p className="mt-4 text-sm text-gray-500">
            {t('topicResearch.aiEdit.aiEditing')}
          </p>
          <p className="mt-1 text-xs text-gray-400">{t('common.pleaseWait')}</p>
        </div>
      ) : hasError ? (
        // Error state
        <div className="flex flex-col items-center justify-center py-12">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <AlertCircle className="h-8 w-8 text-red-500" />
          </div>
          <p className="mt-4 text-sm font-medium text-gray-900">
            {t('topicResearch.aiEdit.editFailed')}
          </p>
          <p className="mt-2 max-w-md text-center text-sm text-gray-500">
            {error?.message || t('common.unknownError')}
          </p>
          <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <p className="whitespace-pre-line text-xs text-gray-500">
              {t('topicResearch.aiEdit.retryHint')}
            </p>
          </div>
        </div>
      ) : (
        // Preview comparison
        <div className="grid grid-cols-2 gap-4">
          {/* Original text */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700">
                {t('topicResearch.aiEdit.original')}
              </h4>
              <span className="text-xs text-gray-400">
                {originalText.length} {t('topicResearch.aiEdit.chars')}
              </span>
            </div>
            <div
              className={cn(
                'max-h-80 overflow-y-auto rounded-lg border p-4',
                'border-red-200 bg-red-50'
              )}
            >
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {originalText}
              </p>
            </div>
          </div>

          {/* Edited text */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-700">
                {t('topicResearch.aiEdit.edited')}
              </h4>
              <span className="text-xs text-gray-400">
                {editedText.length} {t('topicResearch.aiEdit.chars')}
                {editedText.length !== originalText.length && (
                  <span
                    className={cn(
                      'ml-1',
                      editedText.length > originalText.length
                        ? 'text-green-600'
                        : 'text-red-600'
                    )}
                  >
                    ({editedText.length > originalText.length ? '+' : ''}
                    {editedText.length - originalText.length})
                  </span>
                )}
              </span>
            </div>
            <div
              className={cn(
                'max-h-80 overflow-y-auto rounded-lg border p-4',
                'border-green-200 bg-green-50'
              )}
            >
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {editedText}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Change summary */}
      {!isLoading && editedText && (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs text-blue-600">
            {editedText.length === originalText.length
              ? t('topicResearch.aiEdit.lengthUnchanged')
              : editedText.length > originalText.length
                ? t('topicResearch.aiEdit.expanded', {
                    count: editedText.length - originalText.length,
                  })
                : t('topicResearch.aiEdit.condensed', {
                    count: originalText.length - editedText.length,
                  })}
            {t('topicResearch.aiEdit.applyHint')}
          </p>
        </div>
      )}
    </Modal>
  );
}

export default AIEditPreviewModal;
