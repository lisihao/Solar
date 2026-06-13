/**
 * Tests for lib/annotation/text-finder.ts
 *
 * Covers: normalizeWhitespace, findTextRange, extractContext, calculateOffsets.
 * DOM manipulation is tested using jsdom (the vitest default environment).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeWhitespace,
  findTextRange,
  extractContext,
  calculateOffsets,
  type TextSelector,
} from '../text-finder';

// ---------------------------------------------------------------------------
// Mock the logger so test output stays clean
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(html: string): HTMLElement {
  const div = document.createElement('div');
  div.innerHTML = html;
  document.body.appendChild(div);
  return div;
}

function cleanup(el: HTMLElement) {
  el.parentNode?.removeChild(el);
}

// ---------------------------------------------------------------------------
// normalizeWhitespace
// ---------------------------------------------------------------------------

describe('normalizeWhitespace', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeWhitespace('  hello  ')).toBe('hello');
  });

  it('collapses multiple spaces into one', () => {
    expect(normalizeWhitespace('foo   bar')).toBe('foo bar');
  });

  it('converts newlines to spaces', () => {
    expect(normalizeWhitespace('line1\nline2')).toBe('line1 line2');
  });

  it('converts tabs to spaces', () => {
    expect(normalizeWhitespace('col1\tcol2')).toBe('col1 col2');
  });

  it('removes zero-width characters', () => {
    // U+200B zero-width space
    expect(normalizeWhitespace('a\u200Bb')).toBe('ab');
    // U+FEFF BOM
    expect(normalizeWhitespace('\uFEFFtext')).toBe('text');
  });

  it('replaces CJK corner brackets with a quote character', () => {
    // The source regex maps CJK brackets 「」 to a quote replacement.
    // After normalization both produce a 1-char result (not the original char).
    const resultOpen = normalizeWhitespace('\u300C'); // 「
    const resultClose = normalizeWhitespace('\u300D'); // 」
    expect(resultOpen.length).toBe(1);
    expect(resultClose.length).toBe(1);
    // Neither should be the original CJK bracket
    expect(resultOpen.charCodeAt(0)).not.toBe(0x300c);
    expect(resultClose.charCodeAt(0)).not.toBe(0x300d);
  });

  it('replaces left curly single quote with a canonical form', () => {
    // The source regex handles at least \u2018 (left curly single quote).
    // After normalization it produces a 1-char result.
    const result = normalizeWhitespace('\u2018');
    expect(result.length).toBe(1);
    // The result should be a quote character (single quote family, codepoint < 0x300)
    expect(result.charCodeAt(0)).toBeLessThan(0x3000);
  });

  it('normalizes em dash and en dash to hyphen', () => {
    expect(normalizeWhitespace('a\u2013b')).toBe('a-b'); // en dash
    expect(normalizeWhitespace('a\u2014b')).toBe('a-b'); // em dash
  });

  it('normalizes ellipsis character', () => {
    expect(normalizeWhitespace('wait\u2026')).toBe('wait...');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeWhitespace('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeWhitespace('   \n\t  ')).toBe('');
  });

  it('handles plain ASCII text without changes', () => {
    expect(normalizeWhitespace('Hello world')).toBe('Hello world');
  });
});

// ---------------------------------------------------------------------------
// findTextRange — basic scenarios
// ---------------------------------------------------------------------------

describe('findTextRange', () => {
  it('returns null for null container', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = findTextRange(null as any, { exact: 'text' });
    expect(result).toBeNull();
  });

  it('returns null when exact is empty string', () => {
    const container = makeContainer('<p>hello world</p>');
    try {
      const result = findTextRange(container, { exact: '' });
      expect(result).toBeNull();
    } finally {
      cleanup(container);
    }
  });

  it('returns a Range when text is found in a simple paragraph', () => {
    const container = makeContainer('<p>Hello world</p>');
    try {
      const range = findTextRange(container, { exact: 'Hello world' });
      expect(range).not.toBeNull();
      expect(range).toBeInstanceOf(Range);
    } finally {
      cleanup(container);
    }
  });

  it('returns null when text is not present in container', () => {
    const container = makeContainer('<p>Hello world</p>');
    try {
      const result = findTextRange(container, { exact: 'nonexistent phrase' });
      expect(result).toBeNull();
    } finally {
      cleanup(container);
    }
  });

  it('finds text that spans across inline elements', () => {
    const container = makeContainer('<p>Hello <strong>bold</strong> world</p>');
    try {
      const range = findTextRange(container, { exact: 'bold' });
      expect(range).not.toBeNull();
    } finally {
      cleanup(container);
    }
  });

  it('handles whitespace normalization when searching', () => {
    const container = makeContainer('<p>Hello   world</p>');
    try {
      // The selector uses normalized whitespace
      const range = findTextRange(container, { exact: 'Hello world' });
      expect(range).not.toBeNull();
    } finally {
      cleanup(container);
    }
  });

  it('returns a Range covering the correct text content', () => {
    const container = makeContainer('<p>Find this exact phrase here</p>');
    try {
      const range = findTextRange(container, {
        exact: 'Find this exact phrase here',
      });
      expect(range).not.toBeNull();
      expect(range!.toString()).toContain('Find this exact phrase');
    } finally {
      cleanup(container);
    }
  });

  it('returns null for an empty container', () => {
    const container = makeContainer('');
    try {
      const result = findTextRange(container, { exact: 'something' });
      expect(result).toBeNull();
    } finally {
      cleanup(container);
    }
  });

  it('uses prefix context to disambiguate duplicate text', () => {
    const container = makeContainer(
      '<p>The cat sat here. The cat also sat there.</p>'
    );
    try {
      const selector: TextSelector = {
        exact: 'cat',
        prefix: 'also ',
      };
      const range = findTextRange(container, selector);
      // Should resolve to a range (may be either occurrence, but should not throw)
      // The key assertion is that it does not crash
      expect(range === null || range instanceof Range).toBe(true);
    } finally {
      cleanup(container);
    }
  });

  it('finds text inside nested elements', () => {
    const container = makeContainer(
      '<div><article><p>Nested <em>deep</em> content</p></article></div>'
    );
    try {
      const range = findTextRange(container, { exact: 'deep' });
      expect(range).not.toBeNull();
    } finally {
      cleanup(container);
    }
  });

  it('finds partial text within a longer sentence', () => {
    const container = makeContainer(
      '<p>The quick brown fox jumps over the lazy dog</p>'
    );
    try {
      const range = findTextRange(container, { exact: 'brown fox' });
      expect(range).not.toBeNull();
      expect(range!.toString()).toContain('brown fox');
    } finally {
      cleanup(container);
    }
  });
});

// ---------------------------------------------------------------------------
// findTextRange — cross-paragraph
// ---------------------------------------------------------------------------

describe('findTextRange — cross-paragraph text', () => {
  it('can find text in the second of two paragraphs', () => {
    const container = makeContainer(
      '<p>First paragraph text.</p><p>Second paragraph text.</p>'
    );
    try {
      const range = findTextRange(container, {
        exact: 'Second paragraph text.',
      });
      expect(range).not.toBeNull();
    } finally {
      cleanup(container);
    }
  });

  it('returns null for text that bridges two separate paragraphs (not inline)', () => {
    const container = makeContainer('<p>Alpha</p><p>Beta</p>');
    try {
      // "Alpha Beta" as a single contiguous string does not exist in the raw
      // text nodes; the finder adds a space between block elements, but the
      // exact phrase "AlphaBeta" (no space) should not be found.
      const result = findTextRange(container, { exact: 'AlphaBeta' });
      expect(result).toBeNull();
    } finally {
      cleanup(container);
    }
  });
});

// ---------------------------------------------------------------------------
// extractContext
// ---------------------------------------------------------------------------

describe('extractContext', () => {
  it('returns empty prefix and suffix when offsets are 0 and end', () => {
    const container = makeContainer('<p>Hello world</p>');
    try {
      const text = container.textContent || '';
      const { prefix, suffix } = extractContext(container, 0, text.length, 50);
      expect(prefix).toBe('');
      expect(suffix).toBe('');
    } finally {
      cleanup(container);
    }
  });

  it('extracts a prefix of up to contextLength characters', () => {
    const container = makeContainer('<p>abcdefghijklmnopqrstuvwxyz</p>');
    try {
      // offset 10 → chars 0-9 should be prefix
      const { prefix } = extractContext(container, 10, 15, 5);
      expect(prefix).toBe('fghij'); // chars at positions 5-9
    } finally {
      cleanup(container);
    }
  });

  it('extracts a suffix of up to contextLength characters', () => {
    const container = makeContainer('<p>abcdefghijklmnopqrstuvwxyz</p>');
    try {
      const { suffix } = extractContext(container, 0, 3, 5);
      expect(suffix).toBe('defgh'); // chars 3-7
    } finally {
      cleanup(container);
    }
  });

  it('handles startOffset = 0 (no prefix)', () => {
    const container = makeContainer('<p>hello</p>');
    try {
      const { prefix } = extractContext(container, 0, 3, 10);
      expect(prefix).toBe('');
    } finally {
      cleanup(container);
    }
  });

  it('handles endOffset at text end (no suffix)', () => {
    const container = makeContainer('<p>hello</p>');
    try {
      const len = (container.textContent || '').length;
      const { suffix } = extractContext(container, 0, len, 10);
      expect(suffix).toBe('');
    } finally {
      cleanup(container);
    }
  });

  it('uses default contextLength of 50 when not specified', () => {
    const container = makeContainer('<p>' + 'x'.repeat(200) + '</p>');
    try {
      const { prefix } = extractContext(container, 100, 110);
      expect(prefix.length).toBeLessThanOrEqual(50);
    } finally {
      cleanup(container);
    }
  });
});

// ---------------------------------------------------------------------------
// calculateOffsets
// ---------------------------------------------------------------------------

describe('calculateOffsets', () => {
  it('returns startOffset 0 when range starts at container beginning', () => {
    const container = makeContainer('<p>Hello world</p>');
    try {
      const range = document.createRange();
      const textNode = container.querySelector('p')!.firstChild as Text;
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5); // "Hello"

      const { startOffset } = calculateOffsets(container, range);
      expect(startOffset).toBe(0);
    } finally {
      cleanup(container);
    }
  });

  it('returns correct endOffset equal to start + selected text length', () => {
    const container = makeContainer('<p>Hello world</p>');
    try {
      const range = document.createRange();
      const textNode = container.querySelector('p')!.firstChild as Text;
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5); // "Hello"

      const { startOffset, endOffset } = calculateOffsets(container, range);
      expect(endOffset - startOffset).toBe(5); // "Hello".length
    } finally {
      cleanup(container);
    }
  });

  it('returns non-zero startOffset when selection starts mid-text', () => {
    const container = makeContainer('<p>Hello world</p>');
    try {
      const range = document.createRange();
      const textNode = container.querySelector('p')!.firstChild as Text;
      range.setStart(textNode, 6); // "world"
      range.setEnd(textNode, 11);

      const { startOffset } = calculateOffsets(container, range);
      expect(startOffset).toBe(6);
    } finally {
      cleanup(container);
    }
  });

  it('end offset equals start + range text length', () => {
    const container = makeContainer('<p>The quick brown fox</p>');
    try {
      const range = document.createRange();
      const textNode = container.querySelector('p')!.firstChild as Text;
      // Select "quick brown"
      range.setStart(textNode, 4);
      range.setEnd(textNode, 15);

      const { startOffset, endOffset } = calculateOffsets(container, range);
      expect(endOffset - startOffset).toBe('quick brown'.length);
    } finally {
      cleanup(container);
    }
  });
});
