'use client';

/**
 * AI Slides V5.0 - Code Preview
 *
 * Displays HTML code of the current slide with:
 * - Basic syntax highlighting
 * - Line numbers
 * - Copy to clipboard
 * - Format toggle
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  Terminal,
  Code2,
  Minimize2,
  Maximize2,
  Download,
  WrapText,
} from 'lucide-react';
import { cn } from '@/lib/utils/common';
import { useSlidesStore } from '@/stores';
import { CopyButton } from '@/components/ui/primitives/CopyButton';

// ============================================
// Types
// ============================================

interface CodePreviewProps {
  html?: string;
  isVisible?: boolean;
  className?: string;
}

// ============================================
// Syntax Highlighting
// ============================================

function highlightHtml(code: string): React.ReactNode[] {
  const lines = code.split('\n');

  return lines.map((line, lineIndex) => {
    const parts: React.ReactNode[] = [];
    const remaining = line;
    const partIndex = 0;

    // Match patterns in order
    const patterns = [
      // Comments
      {
        regex: /<!--[\s\S]*?-->/g,
        className: 'text-gray-500 italic',
      },
      // DOCTYPE
      {
        regex: /<!DOCTYPE[^>]*>/gi,
        className: 'text-purple-400',
      },
      // Tags
      {
        regex: /<\/?[\w-]+/g,
        className: 'text-pink-400',
      },
      // Closing bracket
      {
        regex: /\/?>/g,
        className: 'text-pink-400',
      },
      // Attributes
      {
        regex: /[\w-]+(?==)/g,
        className: 'text-cyan-400',
      },
      // Attribute values
      {
        regex: /=["'][^"']*["']/g,
        className: 'text-amber-300',
      },
      // Strings in style
      {
        regex: /#[a-fA-F0-9]{3,8}\b/g,
        className: 'text-orange-400',
      },
      // CSS properties
      {
        regex: /[\w-]+(?=:)/g,
        className: 'text-blue-400',
      },
      // Numbers
      {
        regex: /\b\d+(?:\.?\d*)?(?:px|em|rem|%|vh|vw|deg|s|ms)?\b/g,
        className: 'text-green-400',
      },
    ];

    // Simple tokenization for basic highlighting
    const tokens: Array<{ text: string; type: string }> = [];
    let i = 0;

    while (i < line.length) {
      // Check for comment
      if (line.slice(i).startsWith('<!--')) {
        const end = line.indexOf('-->', i);
        if (end !== -1) {
          tokens.push({
            text: line.slice(i, end + 3),
            type: 'comment',
          });
          i = end + 3;
          continue;
        }
      }

      // Check for tag start
      if (line[i] === '<') {
        let j = i + 1;
        // Skip whitespace
        while (j < line.length && line[j] === ' ') j++;
        // Check for closing tag
        if (line[j] === '/') j++;
        // Get tag name
        const tagStart = j;
        while (j < line.length && /[\w-]/.test(line[j])) j++;

        if (j > tagStart) {
          tokens.push({ text: line.slice(i, j), type: 'tag' });
          i = j;
          continue;
        }
      }

      // Check for attribute
      if (/[a-zA-Z]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[\w-]/.test(line[j])) j++;
        if (line[j] === '=') {
          tokens.push({ text: line.slice(i, j), type: 'attr' });
          i = j;
          continue;
        }
        if (line[j] === ':') {
          tokens.push({ text: line.slice(i, j), type: 'css-prop' });
          i = j;
          continue;
        }
      }

      // Check for string
      if (line[i] === '"' || line[i] === "'") {
        const quote = line[i];
        let j = i + 1;
        while (j < line.length && line[j] !== quote) j++;
        if (j < line.length) {
          tokens.push({ text: line.slice(i, j + 1), type: 'string' });
          i = j + 1;
          continue;
        }
      }

      // Check for number/color
      if (/[\d#]/.test(line[i])) {
        let j = i;
        if (line[i] === '#') {
          j++;
          while (j < line.length && /[a-fA-F0-9]/.test(line[j])) j++;
          if (j > i + 1) {
            tokens.push({ text: line.slice(i, j), type: 'color' });
            i = j;
            continue;
          }
        } else {
          while (j < line.length && /[\d.]/.test(line[j])) j++;
          // Include unit
          const unitMatch = line
            .slice(j)
            .match(/^(px|em|rem|%|vh|vw|deg|s|ms)/);
          if (unitMatch) j += unitMatch[0].length;
          tokens.push({ text: line.slice(i, j), type: 'number' });
          i = j;
          continue;
        }
      }

      // Check for special chars
      if (['>', '/', '=', ':', ';', '{', '}'].includes(line[i])) {
        tokens.push({ text: line[i], type: 'punct' });
        i++;
        continue;
      }

      // Default: plain text
      tokens.push({ text: line[i], type: 'text' });
      i++;
    }

    // Convert tokens to React nodes
    return (
      <span key={lineIndex}>
        {tokens.map((token, idx) => {
          let className = 'text-slate-300';
          switch (token.type) {
            case 'comment':
              className = 'text-gray-500 italic';
              break;
            case 'tag':
              className = 'text-pink-400';
              break;
            case 'attr':
              className = 'text-cyan-400';
              break;
            case 'string':
              className = 'text-amber-300';
              break;
            case 'color':
              className = 'text-orange-400';
              break;
            case 'number':
              className = 'text-green-400';
              break;
            case 'css-prop':
              className = 'text-blue-400';
              break;
            case 'punct':
              className = 'text-gray-500';
              break;
          }
          return (
            <span key={idx} className={className}>
              {token.text}
            </span>
          );
        })}
      </span>
    );
  });
}

// ============================================
// Format HTML
// ============================================

function formatHtml(html: string): string {
  let formatted = '';
  let indent = 0;
  const indentSize = 2;

  // Split by tags while preserving them
  const parts = html.split(/(<[^>]+>)/);

  for (const part of parts) {
    if (!part.trim()) continue;

    // Check if it's a tag
    if (part.startsWith('<')) {
      const isClosing = part.startsWith('</');
      const isSelfClosing =
        part.endsWith('/>') || /^<(br|hr|img|input|meta|link)[\s>]/i.test(part);
      const isDoctype = part.startsWith('<!');

      if (isClosing) {
        indent = Math.max(0, indent - 1);
      }

      formatted += ' '.repeat(indent * indentSize) + part + '\n';

      if (!isClosing && !isSelfClosing && !isDoctype) {
        indent++;
      }
    } else {
      // Content between tags
      const content = part.trim();
      if (content) {
        formatted += ' '.repeat(indent * indentSize) + content + '\n';
      }
    }
  }

  return formatted.trim();
}

// ============================================
// Main Component
// ============================================

export function CodePreview({
  html: propHtml,
  isVisible = true,
  className,
}: CodePreviewProps) {
  const { pages, selectedPageIndex } = useSlidesStore();
  const [formatted, setFormatted] = useState(true);
  const [wordWrap, setWordWrap] = useState(true);
  const [showLineNumbers, setShowLineNumbers] = useState(true);

  const currentPage = pages[selectedPageIndex];
  const html = propHtml || currentPage?.html || '';

  // Format and highlight code
  const displayCode = useMemo(() => {
    if (!html) return '';
    return formatted ? formatHtml(html) : html;
  }, [html, formatted]);

  const highlightedLines = useMemo(() => {
    if (!displayCode) return [];
    return highlightHtml(displayCode);
  }, [displayCode]);

  const lineCount = highlightedLines.length;

  // Download as file
  const handleDownload = useCallback(() => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slide-${selectedPageIndex + 1}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [html, selectedPageIndex]);

  if (!isVisible) return null;

  return (
    <div className={cn('flex h-full flex-col bg-slate-900', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-2">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-300">HTML Code</span>
          {lineCount > 0 && (
            <span className="text-xs text-slate-500">({lineCount} lines)</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            className={cn(
              'rounded p-1.5 text-sm transition-colors',
              showLineNumbers
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-300'
            )}
            title="Toggle line numbers"
          >
            <Code2 className="h-4 w-4" />
          </button>

          <button
            onClick={() => setWordWrap(!wordWrap)}
            className={cn(
              'rounded p-1.5 text-sm transition-colors',
              wordWrap
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-300'
            )}
            title="Toggle word wrap"
          >
            <WrapText className="h-4 w-4" />
          </button>

          <button
            onClick={() => setFormatted(!formatted)}
            className={cn(
              'rounded p-1.5 text-sm transition-colors',
              formatted
                ? 'bg-slate-700 text-slate-200'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-300'
            )}
            title="Toggle formatting"
          >
            {formatted ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>

          <div className="mx-2 h-4 w-px bg-slate-700" />

          <button
            onClick={handleDownload}
            disabled={!html}
            className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-300 disabled:opacity-50"
            title="Download HTML"
          >
            <Download className="h-4 w-4" />
          </button>

          <CopyButton
            value={html}
            label="Copy"
            copiedLabel="Copied"
            disabled={!html}
            className="rounded border-0 bg-slate-700 px-2.5 py-1.5 text-slate-200 hover:bg-slate-600"
          />
        </div>
      </div>

      {/* Code Content */}
      <div className="flex-1 overflow-auto">
        {html ? (
          <div className="flex min-h-full">
            {/* Line Numbers */}
            {showLineNumbers && (
              <div className="font-mono flex-shrink-0 select-none border-r border-slate-700 bg-slate-800/50 px-3 py-4 text-right text-xs text-slate-500">
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className="leading-5">
                    {i + 1}
                  </div>
                ))}
              </div>
            )}

            {/* Code */}
            <pre
              className={cn(
                'font-mono flex-1 p-4 text-sm leading-5',
                wordWrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
              )}
            >
              <code>
                {highlightedLines.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </code>
            </pre>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center">
              <Terminal className="mx-auto mb-4 h-10 w-10 text-slate-600" />
              <p className="text-sm text-slate-500">
                {currentPage
                  ? 'Code will appear after generation'
                  : 'Select a page to view code'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default CodePreview;
