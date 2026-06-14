'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { Block } from '@blocknote/core';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';

import { logger } from '@/lib/utils/logger';
import {
  notionBlocksToBlockNote,
  blockNoteToNotionBlocks,
} from '@/lib/features/notion/block-converter';

interface NotionBlockEditorProps {
  initialBlocks?: Array<Record<string, unknown>>;
  onChange?: (blocks: Array<Record<string, unknown>>) => void;
  onSave?: (blocks: Array<Record<string, unknown>>) => Promise<void>;
  readOnly?: boolean;
  className?: string;
}

export default function NotionBlockEditor({
  initialBlocks = [],
  onChange,
  onSave,
  readOnly = false,
  className = '',
}: NotionBlockEditorProps) {
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isInitializedRef = useRef(false);
  const onChangeRef = useRef(onChange);

  // Keep onChange ref updated
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Convert initial blocks once
  const initialContent = useRef(
    (() => {
      try {
        const converted = notionBlocksToBlockNote(
          initialBlocks as Array<{
            id: string;
            type: string;
            [key: string]: unknown;
          }>
        );
        return converted.length > 0 ? converted : undefined;
      } catch (error) {
        logger.error('Failed to convert Notion blocks:', error);
        return undefined;
      }
    })()
  ).current;

  // Create editor instance using the hook (handles SSR properly)
  const editor = useCreateBlockNote({
    initialContent,
  });

  // Handle editor changes - debounced
  const handleChange = useCallback(() => {
    if (readOnly) return;

    // Skip the initial change event
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      return;
    }

    setHasChanges(true);

    if (onChangeRef.current) {
      try {
        const blocks = editor.document;
        const notionBlocks = blockNoteToNotionBlocks(blocks as Block[]);
        onChangeRef.current(notionBlocks);
      } catch (error) {
        logger.error('Failed to convert blocks:', error);
      }
    }
  }, [editor, readOnly]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!onSave || saving) return;

    setSaving(true);
    setSaveError(null);
    try {
      const blocks = editor.document;
      const notionBlocks = blockNoteToNotionBlocks(blocks as Block[]);
      await onSave(notionBlocks);
      setHasChanges(false);
    } catch (error) {
      logger.error('Failed to save:', error);
      setSaveError(
        error instanceof Error ? error.message : 'Failed to save changes'
      );
    } finally {
      setSaving(false);
    }
  }, [editor, onSave, saving]);

  // Keyboard shortcut for save (Ctrl/Cmd + S)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (hasChanges && onSave) {
          handleSave();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasChanges, onSave, handleSave]);

  return (
    <div className={`notion-block-editor ${className}`}>
      {/* Save indicator and error message */}
      {!readOnly && (
        <div className="mb-4 space-y-2">
          {saveError && (
            <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              <svg
                className="h-4 w-4 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <span>{saveError}</span>
              <button
                onClick={() => setSaveError(null)}
                className="ml-auto text-red-500 hover:text-red-700"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          )}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              {hasChanges ? (
                <>
                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                  <span>Unsaved changes</span>
                </>
              ) : (
                <>
                  <span className="h-2 w-2 rounded-full bg-green-500" />
                  <span>All changes saved</span>
                </>
              )}
            </div>
            {onSave && (
              <button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <svg
                      className="h-4 w-4 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Saving...
                  </>
                ) : (
                  <>
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
                      />
                    </svg>
                    Save
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* BlockNote Editor with built-in Formatting Toolbar */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <BlockNoteView
          editor={editor}
          editable={!readOnly}
          onChange={handleChange}
          theme="light"
        />
      </div>

      {/* Enhanced Editor tips */}
      {!readOnly && (
        <div className="mt-4 rounded-lg bg-gray-50 p-4">
          <h4 className="mb-2 text-sm font-medium text-gray-700">
            Editing Tips
          </h4>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs text-gray-500">
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-white px-1.5 py-0.5 shadow-sm">
                /
              </kbd>
              <span>Insert block (headings, lists, code...)</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-white px-1.5 py-0.5 shadow-sm">
                Ctrl+S
              </kbd>
              <span>Save changes</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-white px-1.5 py-0.5 shadow-sm">
                Ctrl+B
              </kbd>
              <span>Bold text</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-white px-1.5 py-0.5 shadow-sm">
                Ctrl+I
              </kbd>
              <span>Italic text</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-white px-1.5 py-0.5 shadow-sm">
                Ctrl+U
              </kbd>
              <span>Underline text</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-white px-1.5 py-0.5 shadow-sm">
                Ctrl+K
              </kbd>
              <span>Insert link</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-white px-1.5 py-0.5 shadow-sm">
                Tab
              </kbd>
              <span>Indent list item</span>
            </div>
            <div className="flex items-center gap-2">
              <kbd className="rounded border bg-white px-1.5 py-0.5 shadow-sm">
                Shift+Tab
              </kbd>
              <span>Outdent list item</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Select text to see formatting options. Type{' '}
            <code className="rounded bg-white px-1">/</code> to insert blocks
            like headings, lists, code, and more.
          </p>
        </div>
      )}

      {/* Custom styles for BlockNote */}
      <style jsx global>{`
        .notion-block-editor .bn-container {
          font-family:
            ui-sans-serif,
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            Helvetica,
            'Apple Color Emoji',
            Arial,
            sans-serif,
            'Segoe UI Emoji',
            'Segoe UI Symbol';
        }

        .notion-block-editor .bn-editor {
          padding: 1.5rem;
          min-height: 400px;
        }

        .notion-block-editor .bn-block-outer {
          margin: 0.25rem 0;
        }

        .notion-block-editor [data-content-type='heading'] {
          margin-top: 1.5rem;
        }

        .notion-block-editor [data-content-type='heading'][data-level='1'] {
          font-size: 1.875rem;
          font-weight: 700;
        }

        .notion-block-editor [data-content-type='heading'][data-level='2'] {
          font-size: 1.5rem;
          font-weight: 600;
        }

        .notion-block-editor [data-content-type='heading'][data-level='3'] {
          font-size: 1.25rem;
          font-weight: 600;
        }

        .notion-block-editor [data-content-type='codeBlock'] {
          background-color: #1e1e1e;
          border-radius: 0.5rem;
          padding: 1rem;
        }

        .notion-block-editor [data-content-type='codeBlock'] code {
          color: #d4d4d4;
          font-family: 'Fira Code', 'Monaco', monospace;
        }

        /* Placeholder styling */
        .notion-block-editor .bn-inline-content[data-placeholder]::before {
          color: #9ca3af;
        }

        /* Selection styling */
        .notion-block-editor .bn-editor ::selection {
          background-color: rgba(59, 130, 246, 0.2);
        }

        /* Slash menu styling */
        .notion-block-editor .bn-slash-menu {
          border-radius: 0.5rem;
          box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1);
        }

        /* Toolbar styling */
        .notion-block-editor .bn-toolbar {
          border-radius: 0.5rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }

        /* Formatting toolbar styling */
        .notion-block-editor .bn-formatting-toolbar {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 0.5rem;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
      `}</style>
    </div>
  );
}
