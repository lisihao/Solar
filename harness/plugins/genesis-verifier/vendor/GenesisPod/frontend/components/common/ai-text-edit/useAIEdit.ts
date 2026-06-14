'use client';

/**
 * useAIEdit Hook — 通用「选中文本 → AI 改写」工作流
 *
 * 平台层 hook，**不直接调任何业务 API**，业务 API 通过 `executeEdit` 回调注入。
 * 这样 AI Writing / AI Office / Agent Playground 等模块都能复用同一个 modal +
 * 状态机，每个模块在自己的层注入自己的 endpoint。
 *
 * Usage:
 * ```tsx
 * const aiEdit = useAIEdit({
 *   executeEdit: async (req) => {
 *     // 业务方注入：可以是 aiEditReport(topicId, reportId, ...) /
 *     // 也可以是 aiOfficeRewrite(slideId, ...) 等任何 endpoint
 *     const r = await aiEditReport(topicId, reportId, {
 *       operation: req.operation,
 *       selectedText: req.selectedText,
 *       context: req.instruction,
 *       fullContent: req.fullContent,
 *       selectorPrefix: req.selectorPrefix,
 *       selectorSuffix: req.selectorSuffix,
 *     });
 *     return { editedContent: r.editedContent };
 *   },
 *   onSuccess: () => toast.success('编辑已应用'),
 * });
 *
 * <TextSelectionContextMenu onOpenAIEdit={aiEdit.handleOpenEdit} />
 * {aiEdit.renderModals()}
 * ```
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { SelectionInfo } from '@/lib/text-selection/types';
import type { AIEditOperation } from './types';
import type { EditContext } from './AIEditInputModal';

// Constants for validation
export const MAX_SELECTION_LENGTH = 2000;
export const MAX_CONTEXT_LENGTH = 3000;
export const MAX_INSTRUCTION_LENGTH = 500;

/**
 * 平台层"AI 编辑请求"契约 —— 业务方收到这个，自己决定调哪个后端。
 */
export interface AIEditRequest {
  /** AI 操作类型，如 rewrite / shorten / expand */
  operation: AIEditOperation;
  /** 用户选中的原文 */
  selectedText: string;
  /** 用户输入的额外指令（自然语言） */
  instruction: string;
  /** 选区周围的全文（已截断到 MAX_CONTEXT_LENGTH） */
  fullContent?: string;
  /** 选区前的上下文，便于 fuzzy match */
  selectorPrefix?: string;
  /** 选区后的上下文 */
  selectorSuffix?: string;
  /** 业务方可借助 AbortController 取消请求 */
  signal?: AbortSignal;
}

/** 平台层"AI 编辑响应"契约 —— 只关心 editedContent。 */
export interface AIEditResponse {
  editedContent: string;
}

export interface UseAIEditOptions {
  /**
   * ★ 业务方注入：执行实际 AI 编辑调用。
   * 平台 hook 不关心是 TI / AI Writing / Office —— 业务侧适配自己的 API。
   */
  executeEdit: (req: AIEditRequest) => Promise<AIEditResponse>;
  /** Callback when edit is successfully applied */
  onSuccess?: (editedText: string, originalText: string) => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Context information for AI */
  context?: EditContext;
  /** Full content of the current section (for better AI understanding) */
  fullContent?: string;
  /** Callback to replace selected text in the editor */
  onReplaceText?: (original: string, edited: string) => void;
}

export interface UseAIEditReturn {
  // Modal states
  isInputModalOpen: boolean;
  isPreviewModalOpen: boolean;

  // Edit data
  selectedText: string;
  editedText: string;
  selectionInfo: SelectionInfo | null;
  instruction: string;

  // Loading and error states
  isLoading: boolean;
  error: Error | null;

  // Context
  editContext: EditContext | null;

  // Validation
  validationError: string | null;

  // Actions
  /** Called when user clicks "AI Edit" in context menu */
  handleOpenEdit: (selection: SelectionInfo) => void;
  /** Called when user submits the edit instruction */
  handleSubmitEdit: (
    instruction: string,
    operation?: AIEditOperation
  ) => Promise<void>;
  /** Called when user applies the edit */
  handleApplyEdit: () => void;
  /** Called to regenerate with same instruction */
  handleRegenerate: () => Promise<void>;
  /** Close input modal */
  closeInputModal: () => void;
  /** Close preview modal */
  closePreviewModal: () => void;
  /** Clear error state */
  clearError: () => void;
  /** Reset all state */
  reset: () => void;
}

/**
 * Get user-friendly error message
 */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes('403') || message.includes('forbidden')) {
      return '您没有权限编辑此报告';
    }
    if (message.includes('404') || message.includes('not found')) {
      return '报告不存在或已被删除';
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return 'AI 处理超时，请稍后重试';
    }
    if (message.includes('network') || message.includes('fetch')) {
      return '网络连接失败，请检查网络后重试';
    }
    if (message.includes('conflict') || message.includes('version')) {
      return '报告已被其他用户修改，请刷新后重试';
    }
    return error.message;
  }
  return '编辑失败，请重试';
}

export function useAIEdit({
  executeEdit,
  onSuccess,
  onError,
  context,
  fullContent,
  onReplaceText,
}: UseAIEditOptions): UseAIEditReturn {
  // Modal states
  const [isInputModalOpen, setIsInputModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);

  // Edit data
  const [selectedText, setSelectedText] = useState('');
  const [editedText, setEditedText] = useState('');
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(
    null
  );
  const [instruction, setInstruction] = useState('');
  const [lastOperation, setLastOperation] = useState<
    AIEditOperation | undefined
  >();

  // Loading and error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Ref for preventing concurrent requests (debounce protection)
  const pendingRequestRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Cancel any pending request
      pendingRequestRef.current?.abort();
    };
  }, []);

  // Memoized context
  const editContext = useMemo(() => context || null, [context]);

  // Validate selection
  const validateSelection = useCallback((text: string): string | null => {
    if (!text || text.trim().length === 0) {
      return '请选择要编辑的文本';
    }
    if (text.length > MAX_SELECTION_LENGTH) {
      return `选中文本过长（${text.length} 字），最多支持 ${MAX_SELECTION_LENGTH} 字`;
    }
    return null;
  }, []);

  // Handle opening the edit input modal
  const handleOpenEdit = useCallback(
    (selection: SelectionInfo) => {
      // Validate selection first
      const validationErr = validateSelection(selection.text);
      if (validationErr) {
        setValidationError(validationErr);
        onError?.(new Error(validationErr));
        return;
      }

      setSelectedText(selection.text);
      setSelectionInfo(selection);
      setEditedText('');
      setInstruction('');
      setError(null);
      setValidationError(null);
      setIsInputModalOpen(true);
    },
    [validateSelection, onError]
  );

  // Handle submitting the edit instruction
  const handleSubmitEdit = useCallback(
    async (editInstruction: string, operation?: AIEditOperation) => {
      // Prevent concurrent requests
      if (isLoading || !selectedText) {
        return;
      }

      // Cancel any pending request
      pendingRequestRef.current?.abort();
      const ctrl = new AbortController();
      pendingRequestRef.current = ctrl;

      setInstruction(editInstruction);
      setLastOperation(operation);
      setIsInputModalOpen(false);
      setIsPreviewModalOpen(true);
      setIsLoading(true);
      setError(null);
      setEditedText(''); // Clear previous result

      try {
        const result = await executeEdit({
          operation: operation || 'rewrite',
          selectedText,
          instruction: editInstruction,
          fullContent: fullContent?.slice(0, MAX_CONTEXT_LENGTH),
          selectorPrefix: selectionInfo?.selectorPrefix,
          selectorSuffix: selectionInfo?.selectorSuffix,
          signal: ctrl.signal,
        });

        // Only update state if still mounted
        if (isMountedRef.current) {
          setEditedText(result.editedContent || '');
        }
      } catch (err) {
        // Only update state if still mounted and not aborted
        if (
          isMountedRef.current &&
          !(err instanceof DOMException && err.name === 'AbortError')
        ) {
          const error =
            err instanceof Error ? err : new Error(getErrorMessage(err));
          setError(error);
          onError?.(error);
          // Keep preview modal open for retry - don't close it
        }
      } finally {
        if (isMountedRef.current) {
          setIsLoading(false);
        }
      }
    },
    [isLoading, selectedText, selectionInfo, fullContent, executeEdit, onError]
  );

  // Handle applying the edit
  const handleApplyEdit = useCallback(() => {
    if (editedText && selectedText) {
      // Call the replace callback if provided
      onReplaceText?.(selectedText, editedText);
      onSuccess?.(editedText, selectedText);
    }
    setIsPreviewModalOpen(false);
    // Reset after successful apply
    setSelectedText('');
    setEditedText('');
    setSelectionInfo(null);
    setInstruction('');
    setLastOperation(undefined);
    setError(null);
  }, [editedText, selectedText, onReplaceText, onSuccess]);

  // Handle regenerating with the same instruction
  const handleRegenerate = useCallback(async () => {
    if (!instruction && !lastOperation) {
      return;
    }

    // Prevent concurrent requests
    if (isLoading) {
      return;
    }

    // Cancel any pending request
    pendingRequestRef.current?.abort();
    const ctrl = new AbortController();
    pendingRequestRef.current = ctrl;

    setIsLoading(true);
    setError(null);
    setEditedText(''); // Clear previous result

    try {
      const result = await executeEdit({
        operation: lastOperation || 'rewrite',
        selectedText,
        instruction,
        fullContent: fullContent?.slice(0, MAX_CONTEXT_LENGTH),
        selectorPrefix: selectionInfo?.selectorPrefix,
        selectorSuffix: selectionInfo?.selectorSuffix,
        signal: ctrl.signal,
      });

      if (isMountedRef.current) {
        setEditedText(result.editedContent || '');
      }
    } catch (err) {
      if (
        isMountedRef.current &&
        !(err instanceof DOMException && err.name === 'AbortError')
      ) {
        const error =
          err instanceof Error ? err : new Error(getErrorMessage(err));
        setError(error);
        onError?.(error);
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [
    selectedText,
    selectionInfo,
    instruction,
    lastOperation,
    fullContent,
    executeEdit,
    onError,
    isLoading,
  ]);

  // Close input modal
  const closeInputModal = useCallback(() => {
    setIsInputModalOpen(false);
  }, []);

  // Close preview modal
  const closePreviewModal = useCallback(() => {
    if (!isLoading) {
      // Cancel any pending request
      pendingRequestRef.current?.abort();
      setIsPreviewModalOpen(false);
      // Reset state
      setSelectedText('');
      setEditedText('');
      setSelectionInfo(null);
      setInstruction('');
      setLastOperation(undefined);
      setError(null);
    }
  }, [isLoading]);

  // Clear error state
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Reset all state
  const reset = useCallback(() => {
    pendingRequestRef.current?.abort();
    setSelectedText('');
    setEditedText('');
    setSelectionInfo(null);
    setInstruction('');
    setLastOperation(undefined);
    setIsLoading(false);
    setError(null);
    setValidationError(null);
  }, []);

  return {
    // Modal states
    isInputModalOpen,
    isPreviewModalOpen,

    // Edit data
    selectedText,
    editedText,
    selectionInfo,
    instruction,

    // Loading and error states
    isLoading,
    error,

    // Context
    editContext,

    // Validation
    validationError,

    // Actions
    handleOpenEdit,
    handleSubmitEdit,
    handleApplyEdit,
    handleRegenerate,
    closeInputModal,
    closePreviewModal,
    clearError,
    reset,
  };
}

export default useAIEdit;
