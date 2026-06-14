'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { X, Save, Loader2, FileText, Settings2 } from 'lucide-react';
import { SKILL_LAYERS } from './skill-layers';

interface SkillPromptEditorProps {
  skillId: string;
  initialContent: string;
  initialFrontmatter: Record<string, unknown> | null;
  onSave: (
    content: string,
    frontmatter: Record<string, unknown> | null,
    changeNote: string
  ) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

const CREATIVITY_OPTIONS = [
  { value: 'deterministic', label: 'Deterministic' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

const OUTPUT_LENGTH_OPTIONS = [
  { value: 'minimal', label: 'Minimal' },
  { value: 'short', label: 'Short' },
  { value: 'medium', label: 'Medium' },
  { value: 'long', label: 'Long' },
] as const;

const LAYER_OPTIONS = SKILL_LAYERS.filter((l) => l.id !== 'all');

function extractVariables(content: string): string[] {
  const matches = content.matchAll(/\{\{(\w+)\}\}/g);
  const seen = new Set<string>();
  for (const match of matches) {
    seen.add(match[1]);
  }
  return Array.from(seen);
}

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split('\n').length;
}

/**
 * Renders the prompt textarea content with subtle highlight spans for {{variable}}
 * placeholders. Because we cannot use rich text in a plain textarea, the highlight
 * is displayed in a read-only overlay div that sits behind the textarea.
 * The textarea itself is transparent so the overlay is visible through it.
 */
function HighlightOverlay({ content }: { content: string }) {
  const parts = useMemo(() => {
    const result: Array<{ text: string; isVar: boolean }> = [];
    const regex = /\{\{(\w+)\}\}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        result.push({
          text: content.slice(lastIndex, match.index),
          isVar: false,
        });
      }
      result.push({ text: match[0], isVar: true });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      result.push({ text: content.slice(lastIndex), isVar: false });
    }

    return result;
  }, [content]);

  return (
    <div
      aria-hidden="true"
      className="font-mono pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-3 text-sm leading-relaxed text-transparent"
    >
      {parts.map((part, i) =>
        part.isVar ? (
          <mark key={i} className="rounded bg-amber-100 text-transparent">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        )
      )}
      {/* Trailing space so the overlay height matches textarea height */}
      {'\u00A0'}
    </div>
  );
}

export function SkillPromptEditor({
  skillId,
  initialContent,
  initialFrontmatter,
  onSave,
  onClose,
  saving,
}: SkillPromptEditorProps) {
  // --- Frontmatter state ---
  const fm = initialFrontmatter ?? {};
  const [name, setName] = useState<string>(
    typeof fm.name === 'string' ? fm.name : ''
  );
  const [description, setDescription] = useState<string>(
    typeof fm.description === 'string' ? fm.description : ''
  );
  const [domain, setDomain] = useState<string>(
    typeof fm.domain === 'string' ? fm.domain : ''
  );
  const [layer, setLayer] = useState<string>(
    typeof fm.layer === 'string' ? fm.layer : ''
  );
  const [tagsInput, setTagsInput] = useState<string>(
    Array.isArray(fm.tags)
      ? (fm.tags as string[]).join(', ')
      : typeof fm.tags === 'string'
        ? fm.tags
        : ''
  );

  // taskProfile fields
  const taskProfile =
    fm.taskProfile && typeof fm.taskProfile === 'object'
      ? (fm.taskProfile as Record<string, unknown>)
      : {};
  const [creativity, setCreativity] = useState<string>(
    typeof taskProfile.creativity === 'string' ? taskProfile.creativity : ''
  );
  const [outputLength, setOutputLength] = useState<string>(
    typeof taskProfile.outputLength === 'string' ? taskProfile.outputLength : ''
  );

  // --- Prompt body state ---
  const [content, setContent] = useState<string>(initialContent);
  const [changeNote, setChangeNote] = useState<string>('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keyboard support: Escape to close (only when not saving)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, saving]);

  // --- Derived stats ---
  const lineCount = useMemo(() => countLines(content), [content]);
  const tokenEstimate = useMemo(() => estimateTokenCount(content), [content]);
  const variables = useMemo(() => extractVariables(content), [content]);

  // --- Save handler ---
  const handleSave = async () => {
    const tags = tagsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const builtFrontmatter: Record<string, unknown> = {};

    if (name) builtFrontmatter.name = name;
    if (description) builtFrontmatter.description = description;
    if (domain) builtFrontmatter.domain = domain;
    if (layer) builtFrontmatter.layer = layer;
    if (tags.length > 0) builtFrontmatter.tags = tags;

    const tp: Record<string, unknown> = {};
    if (creativity) tp.creativity = creativity;
    if (outputLength) tp.outputLength = outputLength;
    if (Object.keys(tp).length > 0) builtFrontmatter.taskProfile = tp;

    // Preserve any other fields from the original frontmatter that we don't manage
    for (const key of Object.keys(fm)) {
      if (!(key in builtFrontmatter) && key !== 'taskProfile') {
        builtFrontmatter[key] = fm[key];
      }
    }

    const finalFrontmatter =
      Object.keys(builtFrontmatter).length > 0 ? builtFrontmatter : null;

    await onSave(content, finalFrontmatter, changeNote);
  };

  const inputClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';
  const selectClass =
    'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white';
  const labelClass = 'mb-1.5 block text-xs font-medium text-gray-600';

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-editor-title"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-shrink-0 items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
            <FileText className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h2
              id="prompt-editor-title"
              className="text-sm font-semibold text-gray-900"
            >
              Prompt Editor
            </h2>
            <p className="font-mono text-xs text-gray-500">{skillId}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Change note input */}
          <input
            type="text"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder="Change note (optional)"
            className="w-64 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />

          {/* Save button */}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {saving ? 'Saving...' : 'Save'}
          </button>

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Close editor"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Left panel — Frontmatter fields (~40%) */}
        <div className="flex w-2/5 flex-shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-gray-50">
          {/* Panel header */}
          <div className="flex items-center gap-2 border-b border-gray-200 bg-white px-5 py-3">
            <Settings2 className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              Frontmatter
            </span>
          </div>

          <div className="flex-1 space-y-4 px-5 py-4">
            {/* Name */}
            <div>
              <label className={labelClass}>Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. research-outline"
                className={inputClass}
              />
            </div>

            {/* Description */}
            <div>
              <label className={labelClass}>Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of what this skill does"
                rows={3}
                className={`${inputClass} resize-none`}
              />
            </div>

            {/* Domain */}
            <div>
              <label className={labelClass}>Domain</label>
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder="e.g. research, writing, coding"
                className={inputClass}
              />
            </div>

            {/* Layer */}
            <div>
              <label className={labelClass}>Layer</label>
              <select
                value={layer}
                onChange={(e) => setLayer(e.target.value)}
                className={selectClass}
              >
                <option value="">— Select layer —</option>
                {LAYER_OPTIONS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id.charAt(0).toUpperCase() + l.id.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div>
              <label className={labelClass}>
                Tags{' '}
                <span className="font-normal text-gray-400">
                  (comma-separated)
                </span>
              </label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. outline, planning, gpt"
                className={inputClass}
              />
            </div>

            {/* Divider — Task Profile */}
            <div className="border-t border-gray-200 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                Task Profile
              </p>

              {/* Creativity */}
              <div className="mb-4">
                <label className={labelClass}>Creativity</label>
                <select
                  value={creativity}
                  onChange={(e) => setCreativity(e.target.value)}
                  className={selectClass}
                >
                  <option value="">— Select creativity —</option>
                  {CREATIVITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {creativity && (
                  <p className="mt-1 text-xs text-gray-400">
                    {creativity === 'deterministic' &&
                      'temperature ~0.1 — classification, extraction, JSON'}
                    {creativity === 'low' &&
                      'temperature ~0.3 — analysis, summaries'}
                    {creativity === 'medium' &&
                      'temperature ~0.7 — dialogue, research'}
                    {creativity === 'high' &&
                      'temperature ~0.9 — creative writing'}
                  </p>
                )}
              </div>

              {/* Output Length */}
              <div>
                <label className={labelClass}>Output Length</label>
                <select
                  value={outputLength}
                  onChange={(e) => setOutputLength(e.target.value)}
                  className={selectClass}
                >
                  <option value="">— Select output length —</option>
                  {OUTPUT_LENGTH_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {outputLength && (
                  <p className="mt-1 text-xs text-gray-400">
                    {outputLength === 'minimal' &&
                      'max ~500 tokens — labels, flags'}
                    {outputLength === 'short' && 'max ~1500 tokens — summaries'}
                    {outputLength === 'medium' &&
                      'max ~4000 tokens — standard analysis'}
                    {outputLength === 'long' &&
                      'max ~8000 tokens — reports, chapters'}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — Prompt body editor (~60%) */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-gray-200 bg-white px-5 py-3">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">
                Prompt Body
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-gray-400">
              <span>{lineCount} lines</span>
              <span className="text-gray-300">|</span>
              <span>~{tokenEstimate} tokens</span>
            </div>
          </div>

          {/* Textarea area with highlight overlay */}
          <div className="relative min-h-0 flex-1">
            {/* Highlight overlay — rendered behind the textarea */}
            <HighlightOverlay content={content} />

            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              spellCheck={false}
              className="font-mono absolute inset-0 h-full w-full resize-none bg-transparent p-3 text-sm leading-relaxed text-gray-900 caret-gray-900 focus:outline-none"
              placeholder="Enter the prompt body here. Use {{variable}} syntax for dynamic placeholders."
            />
          </div>

          {/* Bottom toolbar */}
          <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-3 border-t border-gray-200 bg-gray-50 px-5 py-3">
            {/* Token and line stats */}
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span>
                <span className="font-medium text-gray-700">{lineCount}</span>{' '}
                lines
              </span>
              <span>
                <span className="font-medium text-gray-700">
                  ~{tokenEstimate}
                </span>{' '}
                estimated tokens
              </span>
              <span>
                <span className="font-medium text-gray-700">
                  {content.length}
                </span>{' '}
                characters
              </span>
            </div>

            {/* Variables extracted from content */}
            {variables.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-gray-400">Variables:</span>
                {variables.map((v) => (
                  <span
                    key={v}
                    className="font-mono rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700"
                  >
                    {`{{${v}}}`}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-gray-400">
                No {`{{variables}}`} found
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
