'use client';

import { useState, useEffect, useCallback } from 'react';
import { config } from '@/lib/utils/config';
import MarkdownEditor from '../../common/editors/MarkdownEditor';

import { logger } from '@/lib/utils/logger';
interface Note {
  id: string;
  resourceId: string;
  content: string;
  highlights: Array<Record<string, unknown>>;
  tags: string[];
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  resource?: {
    id: string;
    type: string;
    title: string;
  };
}

interface NoteEditorProps {
  resourceId: string;
  noteId?: string;
  onSave?: (note: Note) => void;
  onCancel?: () => void;
}

/**
 * 笔记编辑器组件
 *
 * 功能：
 * - 创建新笔记或编辑现有笔记
 * - Markdown编辑
 * - 标签管理
 * - 公开/私有设置
 * - 自动保存
 */
export default function NoteEditor({
  resourceId,
  noteId,
  onSave,
  onCancel,
}: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing note
  useEffect(() => {
    if (noteId) {
      loadNote();
    }
  }, [noteId]);

  const loadNote = async () => {
    if (!noteId) return;

    try {
      setLoading(true);
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/notes/${noteId}`
      );
      if (response.ok) {
        const result = await response.json();
        // Handle wrapped response { success: true, data: {...} }
        const data = result?.data ?? result;
        setNote(data);
        setContent(data.content);
        setTags(data.tags || []);
        setIsPublic(data.isPublic);
      } else {
        setError('Failed to load note');
      }
    } catch (err) {
      setError('Error loading note');
      logger.error('Error loading note:', err);
    } finally {
      setLoading(false);
    }
  };

  // Save note
  const saveNote = useCallback(
    async (contentToSave: string) => {
      try {
        setSaving(true);
        setError(null);

        const payload = {
          resourceId,
          content: contentToSave,
          tags,
          isPublic,
        };

        let response;
        if (noteId) {
          // Update existing note
          response = await fetch(
            `${config.apiBaseUrl}/api/v1/notes/${noteId}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            }
          );
        } else {
          // Create new note
          response = await fetch(`${config.apiBaseUrl}/api/v1/notes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
        }

        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: {...} }
          const savedNote = result?.data ?? result;
          setNote(savedNote);
          onSave?.(savedNote);
        } else {
          setError('Failed to save note');
        }
      } catch (err) {
        setError('Error saving note');
        logger.error(
          'Error saving note',
          err instanceof Error ? err.message : String(err)
        );
      } finally {
        setSaving(false);
      }
    },
    [resourceId, noteId, tags, isPublic, onSave]
  );

  // Add tag
  const addTag = useCallback(() => {
    const trimmedTag = tagInput.trim();
    if (trimmedTag && !tags.includes(trimmedTag)) {
      setTags([...tags, trimmedTag]);
      setTagInput('');
    }
  }, [tagInput, tags]);

  // Remove tag
  const removeTag = useCallback(
    (tag: string) => {
      setTags(tags.filter((t) => t !== tag));
    },
    [tags]
  );

  // Handle tag input key press
  const handleTagKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="border-b border-gray-200 px-6 py-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">
            {noteId ? '编辑笔记' : '新建笔记'}
          </h2>
          <div className="flex items-center gap-2">
            {onCancel && (
              <button
                onClick={onCancel}
                className="rounded px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
              >
                取消
              </button>
            )}
            <button
              onClick={() => saveNote(content)}
              disabled={saving}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-400"
            >
              {saving ? '保存中...' : '保存'}
            </button>
          </div>
        </div>

        {/* Tags */}
        <div className="mb-3">
          <label className="mb-2 block text-sm font-medium text-gray-700">
            标签
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800"
              >
                {tag}
                <button
                  onClick={() => removeTag(tag)}
                  className="ml-1 hover:text-blue-600"
                >
                  ×
                </button>
              </span>
            ))}
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={handleTagKeyPress}
              onBlur={addTag}
              placeholder="添加标签..."
              className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Public/Private toggle */}
        <div className="flex items-center">
          <input
            type="checkbox"
            id="isPublic"
            checked={isPublic}
            onChange={(e) => setIsPublic(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <label htmlFor="isPublic" className="ml-2 text-sm text-gray-700">
            公开笔记（其他用户可见）
          </label>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-3 rounded border border-red-400 bg-red-100 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Markdown Editor */}
      <div className="flex-1 overflow-hidden">
        <MarkdownEditor
          initialContent={content}
          onChange={setContent}
          onSave={saveNote}
          autoSave={true}
          autoSaveInterval={5000}
        />
      </div>
    </div>
  );
}
