'use client';

/**
 * AI Edit Input Modal
 *
 * A modal for users to input their editing intent with:
 * - Selected text preview
 * - Quick operation tags (rewrite/polish/expand/compress)
 * - Custom instruction text input
 * - Cancel and submit buttons
 */

import { useState, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  Sparkles,
  Expand,
  Minimize2,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Modal } from '@/components/ui/dialogs/Modal';
import { Button } from '@/components/ui/primitives/button';
import { cn } from '@/lib/utils/common';
import type { AIEditOperation } from './types';

// Validation constants
const MAX_SELECTION_LENGTH = 2000;
const MAX_INSTRUCTION_LENGTH = 500;

// Preset operation icon mapping
const OPERATION_ICONS: Record<
  AIEditOperation,
  React.ComponentType<{ className?: string }>
> = {
  rewrite: RefreshCw,
  polish: Sparkles,
  expand: Expand,
  compress: Minimize2,
  style: Sparkles,
};

export interface EditContext {
  sectionTitle?: string;
  dimensionName?: string;
  topicName?: string;
  fullContent?: string;
}

export interface AIEditInputModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** The selected text to edit */
  selectedText: string;
  /** Submit callback with instruction and optional operation */
  onSubmit: (instruction: string, operation?: AIEditOperation) => void;
  /** Whether AI is processing */
  isLoading?: boolean;
  /** Context information for better AI understanding */
  context?: EditContext;
}

export function AIEditInputModal({
  isOpen,
  onClose,
  selectedText,
  onSubmit,
  isLoading = false,
  context,
}: AIEditInputModalProps) {
  const { t } = useI18n();
  const [selectedOperations, setSelectedOperations] = useState<
    AIEditOperation[]
  >([]);
  const [customInstruction, setCustomInstruction] = useState('');

  // Preset operations with i18n
  const presetOperations: Array<{
    id: AIEditOperation;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
  }> = [
    {
      id: 'rewrite',
      label: t('topicResearch.aiEdit.rewrite'),
      icon: OPERATION_ICONS.rewrite,
      description: t('topicResearch.aiEdit.rewriteDesc'),
    },
    {
      id: 'polish',
      label: t('topicResearch.aiEdit.polish'),
      icon: OPERATION_ICONS.polish,
      description: t('topicResearch.aiEdit.polishDesc'),
    },
    {
      id: 'expand',
      label: t('topicResearch.aiEdit.expand'),
      icon: OPERATION_ICONS.expand,
      description: t('topicResearch.aiEdit.expandDesc'),
    },
    {
      id: 'compress',
      label: t('topicResearch.aiEdit.compress'),
      icon: OPERATION_ICONS.compress,
      description: t('topicResearch.aiEdit.compressDesc'),
    },
  ];

  // Toggle operation selection
  const toggleOperation = useCallback((operation: AIEditOperation) => {
    setSelectedOperations((prev) =>
      prev.includes(operation)
        ? prev.filter((op) => op !== operation)
        : [...prev, operation]
    );
  }, []);

  // Validation
  const validation = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check selection length
    if (selectedText.length > MAX_SELECTION_LENGTH) {
      errors.push(
        t('topicResearch.aiEdit.textTooLong', {
          length: selectedText.length,
          maxLength: MAX_SELECTION_LENGTH,
        })
      );
    } else if (selectedText.length > MAX_SELECTION_LENGTH * 0.8) {
      warnings.push(
        t('topicResearch.aiEdit.textLengthWarning', {
          length: selectedText.length,
        })
      );
    }

    // Check instruction length
    if (customInstruction.length > MAX_INSTRUCTION_LENGTH) {
      errors.push(
        t('topicResearch.aiEdit.instructionTooLong', {
          length: customInstruction.length,
          maxLength: MAX_INSTRUCTION_LENGTH,
        })
      );
    }

    return {
      errors,
      warnings,
      isValid: errors.length === 0,
    };
  }, [selectedText.length, customInstruction.length, t]);

  // Handle submit
  const handleSubmit = useCallback(() => {
    // Validate before submit
    if (!validation.isValid || isLoading) {
      return;
    }

    // Build the instruction from selected operations and custom text
    const parts: string[] = [];

    // Add selected operations
    if (selectedOperations.length > 0) {
      const opLabels = selectedOperations
        .map((op) => presetOperations.find((p) => p.id === op)?.label)
        .filter(Boolean)
        .join('、');
      parts.push(opLabels);
    }

    // Add custom instruction
    if (customInstruction.trim()) {
      parts.push(customInstruction.trim());
    }

    const instruction = parts.join('，');

    // Use the primary operation if only one is selected
    const primaryOperation =
      selectedOperations.length === 1 ? selectedOperations[0] : undefined;

    onSubmit(instruction, primaryOperation);
  }, [
    selectedOperations,
    customInstruction,
    onSubmit,
    validation.isValid,
    isLoading,
  ]);

  // Check if submit is enabled
  const canSubmit =
    validation.isValid &&
    (selectedOperations.length > 0 || customInstruction.trim().length > 0);

  // Reset state when modal opens/closes
  const handleClose = useCallback(() => {
    setSelectedOperations([]);
    setCustomInstruction('');
    onClose();
  }, [onClose]);

  // Count characters
  const textLength = selectedText.length;

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title={t('topicResearch.contentPanel.aiEdit')}
      subtitle={context?.sectionTitle || context?.dimensionName}
      size="md"
      closeButtonDisabled={isLoading}
      closeOnOverlayClick={!isLoading}
      closeOnEscape={!isLoading}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            {t('topicResearch.aiEdit.cancel')}
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('topicResearch.aiEdit.aiEditing')}
              </>
            ) : (
              t('topicResearch.aiEdit.startEditing')
            )}
          </Button>
        </>
      }
    >
      {/* Validation errors */}
      {validation.errors.length > 0 && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
            <div>
              {validation.errors.map((error, idx) => (
                <p key={idx} className="text-sm text-red-600">
                  {error}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Validation warnings */}
      {validation.warnings.length > 0 && validation.errors.length === 0 && (
        <div className="mb-4 rounded-lg border border-yellow-200 bg-yellow-50 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-yellow-500" />
            <div>
              {validation.warnings.map((warning, idx) => (
                <p key={idx} className="text-sm text-yellow-600">
                  {warning}
                </p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Selected text preview */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('topicResearch.aiEdit.selectedText')}
        </label>
        <div
          className={cn(
            'max-h-32 overflow-y-auto rounded-lg border p-3',
            validation.errors.some((e) =>
              e.includes(t('topicResearch.aiEdit.selectedText'))
            )
              ? 'border-red-300 bg-red-50'
              : 'border-gray-200 bg-gray-50'
          )}
        >
          <p className="whitespace-pre-wrap text-sm text-gray-600">
            {selectedText.length > 300
              ? selectedText.slice(0, 300) + '...'
              : selectedText}
          </p>
        </div>
        <p
          className={cn(
            'mt-1 text-right text-xs',
            textLength > MAX_SELECTION_LENGTH
              ? 'text-red-500'
              : textLength > MAX_SELECTION_LENGTH * 0.8
                ? 'text-yellow-500'
                : 'text-gray-400'
          )}
        >
          {t('topicResearch.aiEdit.totalChars', { count: textLength })}
          {textLength > MAX_SELECTION_LENGTH &&
            t('topicResearch.aiEdit.exceedsBy', {
              count: textLength - MAX_SELECTION_LENGTH,
            })}
        </p>
      </div>

      {/* Quick operations */}
      <div className="mb-6">
        <label className="mb-2 block text-sm font-medium text-gray-700">
          {t('topicResearch.aiEdit.quickOperations')}
          <span className="ml-1 font-normal text-gray-400">
            {t('topicResearch.aiEdit.quickOperationsMulti')}
          </span>
        </label>
        <div className="flex flex-wrap gap-2">
          {presetOperations.map((op) => {
            const Icon = op.icon;
            const isSelected = selectedOperations.includes(op.id);
            return (
              <button
                key={op.id}
                type="button"
                onClick={() => toggleOperation(op.id)}
                disabled={isLoading}
                title={op.description}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition-colors',
                  'border hover:border-purple-300',
                  isSelected
                    ? 'border-purple-500 bg-purple-50 text-purple-700'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
                  isLoading && 'cursor-not-allowed opacity-50'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {op.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom instruction */}
      <div>
        <label
          htmlFor="custom-instruction"
          className="mb-2 block text-sm font-medium text-gray-700"
        >
          {t('topicResearch.aiEdit.editRequirements')}
        </label>
        <textarea
          id="custom-instruction"
          value={customInstruction}
          onChange={(e) => setCustomInstruction(e.target.value)}
          disabled={isLoading}
          placeholder={t('topicResearch.aiEdit.editRequirementsPlaceholder')}
          rows={3}
          maxLength={MAX_INSTRUCTION_LENGTH + 50} // Allow slight overflow to show warning
          className={cn(
            'w-full resize-none rounded-lg border p-3 text-sm',
            'placeholder:text-gray-400',
            'focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500',
            'disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-50',
            customInstruction.length > MAX_INSTRUCTION_LENGTH
              ? 'border-red-300'
              : 'border-gray-200'
          )}
        />
        <p
          className={cn(
            'mt-1 text-right text-xs',
            customInstruction.length > MAX_INSTRUCTION_LENGTH
              ? 'text-red-500'
              : customInstruction.length > MAX_INSTRUCTION_LENGTH * 0.8
                ? 'text-yellow-500'
                : 'text-gray-400'
          )}
        >
          {customInstruction.length} / {MAX_INSTRUCTION_LENGTH}
        </p>
      </div>

      {/* Context hint */}
      {context && (context.topicName || context.dimensionName) && (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs text-blue-600">
            {t('topicResearch.aiEdit.contextHint', {
              topicName: context.topicName ? `「${context.topicName}」` : '',
              dimensionName: context.dimensionName
                ? `「${context.dimensionName}」`
                : '',
            })}
          </p>
        </div>
      )}
    </Modal>
  );
}

export default AIEditInputModal;
