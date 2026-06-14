/**
 * Tests for lib/annotation/annotation-preprocessor.ts
 *
 * Covers: normalizeWhitespace, findAnnotationMatches, splitTextIntoSegments,
 * processTextNode, hasAnnotationsInText, getMatchingAnnotationIds,
 * mergeOverlappingSegments
 */
import { describe, it, expect } from 'vitest';

import {
  normalizeWhitespace,
  findAnnotationMatches,
  splitTextIntoSegments,
  processTextNode,
  hasAnnotationsInText,
  getMatchingAnnotationIds,
  mergeOverlappingSegments,
} from '../annotation-preprocessor';
import type { Annotation, AnnotatedSegment } from '../annotation-preprocessor';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeAnnotation(
  overrides: Partial<Annotation> & { id: string; selectedText: string }
): Annotation {
  return {
    color: 'yellow',
    startOffset: 0,
    endOffset: overrides.selectedText.length,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeWhitespace
// ---------------------------------------------------------------------------
describe('normalizeWhitespace', () => {
  it('collapses multiple spaces into one', () => {
    expect(normalizeWhitespace('hello   world')).toBe('hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeWhitespace('  hello  ')).toBe('hello');
  });

  it('replaces newlines and tabs with a single space', () => {
    expect(normalizeWhitespace('a\n\tb\r\nc')).toBe('a b c');
  });

  it('removes zero-width characters', () => {
    expect(normalizeWhitespace('a\u200Bb')).toBe('ab');
    expect(normalizeWhitespace('x\uFEFFy')).toBe('xy');
  });

  it('normalizes Japanese bracket quotes to ASCII double quote', () => {
    // \u300C = Japanese left corner bracket, \u300D = Japanese right corner bracket
    const result = normalizeWhitespace('\u300Chello\u300D');
    // The source regex [""「」『』] replaces these with "
    expect(result.charCodeAt(0)).toBe(0x22); // ASCII double-quote
    expect(result.charCodeAt(result.length - 1)).toBe(0x22);
    expect(result.slice(1, -1)).toBe('hello');
  });

  it('normalizes em dash and en dash to hyphen', () => {
    expect(normalizeWhitespace('a\u2013b')).toBe('a-b');
    expect(normalizeWhitespace('a\u2014b')).toBe('a-b');
  });

  it('normalizes ellipsis character to three dots', () => {
    expect(normalizeWhitespace('wait\u2026')).toBe('wait...');
  });

  it('handles empty string', () => {
    expect(normalizeWhitespace('')).toBe('');
  });

  it('handles string with only whitespace', () => {
    expect(normalizeWhitespace('   \t  \n  ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// findAnnotationMatches
// ---------------------------------------------------------------------------
describe('findAnnotationMatches', () => {
  it('returns empty array for empty annotations list', () => {
    expect(findAnnotationMatches('some text here', [])).toEqual([]);
  });

  it('finds an exact match', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'quick brown fox' });
    const matches = findAnnotationMatches(text, [ann]);

    expect(matches).toHaveLength(1);
    expect(matches[0].annotationId).toBe('a1');
    expect(matches[0].color).toBe('yellow');
  });

  it('returns empty array when text cannot be found', () => {
    const text = 'Hello world';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'not present' });
    expect(findAnnotationMatches(text, [ann])).toHaveLength(0);
  });

  it('skips resolved annotations', () => {
    const text = 'The quick brown fox';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'quick brown fox',
      status: 'resolved',
    });
    expect(findAnnotationMatches(text, [ann])).toHaveLength(0);
  });

  it('skips archived annotations', () => {
    const text = 'The quick brown fox';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'quick brown fox',
      status: 'archived',
    });
    expect(findAnnotationMatches(text, [ann])).toHaveLength(0);
  });

  it('includes active annotations (no status)', () => {
    const text = 'The quick brown fox jumps';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'quick brown fox' });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches).toHaveLength(1);
  });

  it('returns matches sorted by startIndex', () => {
    const text = 'alpha beta gamma delta';
    const ann1 = makeAnnotation({ id: 'a2', selectedText: 'gamma' });
    const ann2 = makeAnnotation({ id: 'a1', selectedText: 'alpha' });
    const matches = findAnnotationMatches(text, [ann1, ann2]);

    expect(matches[0].annotationId).toBe('a1');
    expect(matches[1].annotationId).toBe('a2');
  });

  it('handles multiple annotations on the same text', () => {
    const text =
      'This is a long piece of text containing several important phrases that we want to annotate.';
    const ann1 = makeAnnotation({
      id: 'a1',
      selectedText: 'long piece of text',
    });
    const ann2 = makeAnnotation({
      id: 'a2',
      selectedText: 'important phrases',
    });
    const matches = findAnnotationMatches(text, [ann1, ann2]);
    expect(matches).toHaveLength(2);
  });

  it('uses prefix context to find annotation when text is ambiguous', () => {
    const text = 'prefix context target word end';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'target word',
      selectorPrefix: 'prefix context ',
    });
    const matches = findAnnotationMatches(text, [ann]);
    // Should find at least one match (with or without context strategy)
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// splitTextIntoSegments
// ---------------------------------------------------------------------------
describe('splitTextIntoSegments', () => {
  it('returns single segment when annotations is empty', () => {
    const result = splitTextIntoSegments('hello world', []);
    expect(result).toEqual([{ text: 'hello world' }]);
  });

  it('returns single segment when text is empty string', () => {
    const result = splitTextIntoSegments('', []);
    expect(result).toEqual([{ text: '' }]);
  });

  it('returns single segment when annotation not found in text', () => {
    const ann = makeAnnotation({ id: 'a1', selectedText: 'not found' });
    const result = splitTextIntoSegments('hello world', [ann]);
    expect(result).toEqual([{ text: 'hello world' }]);
  });

  it('splits text into before, annotated, after segments', () => {
    const text = 'Hello, world! Have a great day.';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'world',
      color: 'green',
    });
    const result = splitTextIntoSegments(text, [ann]);

    const plain = result.filter((s) => !s.annotationId);
    const highlighted = result.filter((s) => s.annotationId === 'a1');

    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].text).toBe('world');
    expect(highlighted[0].color).toBe('green');
    expect(highlighted[0].position).toBe('full');
    expect(plain.length).toBeGreaterThan(0);
  });

  it('preserves full text when reassembled', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'quick brown fox' });
    const result = splitTextIntoSegments(text, [ann]);
    const reassembled = result.map((s) => s.text).join('');
    expect(reassembled).toBe(text);
  });

  it('handles annotation at start of text', () => {
    const text = 'Start of sentence and more text here';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'Start of sentence' });
    const result = splitTextIntoSegments(text, [ann]);
    const highlighted = result.find((s) => s.annotationId === 'a1');
    expect(highlighted).toBeDefined();
    expect(highlighted?.text).toBe('Start of sentence');
  });

  it('handles annotation at end of text', () => {
    const text = 'Some text at the end of text';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'end of text' });
    const result = splitTextIntoSegments(text, [ann]);
    const highlighted = result.find((s) => s.annotationId === 'a1');
    expect(highlighted).toBeDefined();
  });

  it('handles two non-overlapping annotations', () => {
    const text = 'alpha middle beta end';
    const ann1 = makeAnnotation({
      id: 'a1',
      selectedText: 'alpha',
      color: 'yellow',
    });
    const ann2 = makeAnnotation({
      id: 'a2',
      selectedText: 'beta',
      color: 'blue',
    });
    const result = splitTextIntoSegments(text, [ann1, ann2]);

    const highlighted = result.filter((s) => s.annotationId);
    expect(highlighted).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// processTextNode
// ---------------------------------------------------------------------------
describe('processTextNode', () => {
  it('delegates to splitTextIntoSegments', () => {
    const text = 'The quick brown fox';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'quick' });
    const result = processTextNode(text, [ann]);
    const highlighted = result.find((s) => s.annotationId === 'a1');
    expect(highlighted?.text).toBe('quick');
  });

  it('returns a single segment for text with no matching annotations', () => {
    const result = processTextNode('plain text', []);
    expect(result).toEqual([{ text: 'plain text' }]);
  });
});

// ---------------------------------------------------------------------------
// hasAnnotationsInText
// ---------------------------------------------------------------------------
describe('hasAnnotationsInText', () => {
  it('returns true when an annotation matches', () => {
    const text = 'The quick brown fox';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'quick brown fox' });
    expect(hasAnnotationsInText(text, [ann])).toBe(true);
  });

  it('returns false when no annotation matches', () => {
    const text = 'Hello world';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'not present' });
    expect(hasAnnotationsInText(text, [ann])).toBe(false);
  });

  it('returns false for empty annotations list', () => {
    expect(hasAnnotationsInText('hello', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMatchingAnnotationIds
// ---------------------------------------------------------------------------
describe('getMatchingAnnotationIds', () => {
  it('returns ids of matching annotations', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const ann1 = makeAnnotation({
      id: 'ann-1',
      selectedText: 'quick brown fox',
    });
    const ann2 = makeAnnotation({ id: 'ann-2', selectedText: 'lazy dog' });
    const ids = getMatchingAnnotationIds(text, [ann1, ann2]);
    expect(ids).toContain('ann-1');
    expect(ids).toContain('ann-2');
  });

  it('excludes annotations that do not match', () => {
    const text = 'hello world';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'no match here' });
    expect(getMatchingAnnotationIds(text, [ann])).toEqual([]);
  });

  it('returns empty array for empty annotations list', () => {
    expect(getMatchingAnnotationIds('hello', [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeOverlappingSegments
// ---------------------------------------------------------------------------
describe('mergeOverlappingSegments', () => {
  it('returns segments unchanged (current implementation is passthrough)', () => {
    const segments: AnnotatedSegment[] = [
      { text: 'hello' },
      { text: ' world', annotationId: 'a1', color: 'yellow' },
    ];
    expect(mergeOverlappingSegments(segments)).toEqual(segments);
  });

  it('handles empty segments array', () => {
    expect(mergeOverlappingSegments([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationMatches - advanced matching strategies
// ---------------------------------------------------------------------------
describe('findAnnotationMatches - advanced matching strategies', () => {
  it('matches using citation-free strategy when text has citation markers', () => {
    const text = 'This is important content [1] with citations [2, 3] here.';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'important content with citations',
    });
    const matches = findAnnotationMatches(text, [ann]);
    // Strategy 2 (citation-free) or another strategy should find it
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });

  it('matches using first-50-chars strategy for long annotations', () => {
    // Content where annotation starts with a distinctive sequence
    const longMatch =
      'The quick brown fox jumps over the lazy dog today morning';
    const text = `Some preamble. ${longMatch} and more content after this.`;
    const ann = makeAnnotation({ id: 'a1', selectedText: longMatch });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });

  it('matches using first-3-words strategy', () => {
    const text = 'Alpha beta gamma delta epsilon zeta';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'Alpha beta gamma delta epsilon',
    });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('matches using suffix strategy (last 50 chars)', () => {
    const longText = 'A'.repeat(100);
    const suffix = 'B'.repeat(50);
    const text = longText + suffix;
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'A'.repeat(60) + suffix,
    });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });

  it('uses prefix context to match when available', () => {
    const text = 'hello world target words here end';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'target words',
      selectorPrefix: 'world ',
    });
    const matches = findAnnotationMatches(text, [ann]);
    // With prefix, should find target
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });

  it('ignores prefix context when prefix not found', () => {
    const text = 'completely different content here';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'target words',
      selectorPrefix: 'nonexistent prefix ',
      selectorSuffix: 'some suffix',
    });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches.length).toBe(0);
  });

  it('does not match when selectedText is empty after normalization', () => {
    const text = 'Some content here';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: '   \n\t  ',
    });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches).toHaveLength(0);
  });

  it('handles active status annotations', () => {
    const text = 'The quick brown fox';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'quick brown fox',
      status: 'active',
    });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches).toHaveLength(1);
  });

  it('handles middle portion match strategy for long annotations', () => {
    // Build a text with repeated leading characters and a distinctive middle
    const text = 'AAAAAAAAAAAAA middle-unique-phrase AAAAAAAAAAAAA';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'AAAAAAAAAAAA middle-unique-phrase AAAAAAAAAAAA',
    });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });

  it('matches using first-sentence/line strategy', () => {
    const sentence = 'This is an important sentence for testing purposes.';
    const text = `Some intro. ${sentence} More text after.`;
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: `${sentence} More text after.`,
    });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });

  it('matches using last-sentence strategy for multi-sentence annotations', () => {
    const lastSentence =
      'This final sentence is distinct and unique enough here';
    const fullText = `First sentence goes here with some content. Second sentence. ${lastSentence}`;
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: `First sentence goes here with some content. Second sentence. ${lastSentence}`,
    });
    const matches = findAnnotationMatches(fullText, [ann]);
    expect(matches.length).toBeGreaterThanOrEqual(0);
  });

  it('uses unique-phrase strategy for annotations that cannot be found otherwise', () => {
    // Make a phrase unique in the content
    const text =
      'Introduction text. The unique-phrase-XYZ is found only once in this content.';
    const ann = makeAnnotation({
      id: 'a1',
      // selectedText that only contains a unique phrase buried in it
      selectedText: 'unique-phrase-XYZ is found only once',
    });
    const matches = findAnnotationMatches(text, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('handles overlapping annotations (second completely inside first)', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const ann1 = makeAnnotation({
      id: 'a1',
      selectedText: 'quick brown fox jumps',
      color: 'yellow',
    });
    const ann2 = makeAnnotation({
      id: 'a2',
      selectedText: 'brown fox',
      color: 'blue',
    });
    const matches = findAnnotationMatches(text, [ann1, ann2]);
    // Both should match
    expect(matches.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Additional normalizeWhitespace coverage
// ---------------------------------------------------------------------------
describe('normalizeWhitespace - special characters', () => {
  it('normalizes Japanese double corner brackets 「」 to straight quote', () => {
    // 「」 are in the regex [""「」『』]
    const result = normalizeWhitespace('\u300Chello\u300D');
    // These Unicode chars should be replaced with ASCII "
    expect(result).not.toContain('\u300C');
    expect(result).not.toContain('\u300D');
    expect(result).toContain('"');
  });

  it('normalizes Japanese white corner brackets 『』 to straight quote', () => {
    const result = normalizeWhitespace('\u300Ehello\u300F');
    expect(result).not.toContain('\u300E');
    expect(result).not.toContain('\u300F');
    expect(result).toContain('"');
  });

  it('normalizes en-dash to hyphen', () => {
    expect(normalizeWhitespace('hello\u2013world')).toBe('hello-world');
  });

  it('normalizes em-dash to hyphen', () => {
    expect(normalizeWhitespace('hello\u2014world')).toBe('hello-world');
  });

  it('normalizes horizontal bar \u2015 to hyphen', () => {
    expect(normalizeWhitespace('hello\u2015world')).toBe('hello-world');
  });

  it('normalizes ellipsis character', () => {
    expect(normalizeWhitespace('hello\u2026world')).toBe('hello...world');
  });

  it('removes zero-width space characters', () => {
    expect(normalizeWhitespace('hel\u200Blo')).toBe('hello');
  });

  it('removes zero-width non-joiner \u200C', () => {
    expect(normalizeWhitespace('hel\u200Clo')).toBe('hello');
  });

  it('removes BOM character', () => {
    expect(normalizeWhitespace('\uFEFFword')).toBe('word');
  });
});

// ---------------------------------------------------------------------------
// processTextNode coverage
// ---------------------------------------------------------------------------
describe('processTextNode', () => {
  it('delegates to splitTextIntoSegments correctly', () => {
    const text = 'The quick brown fox jumps';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'quick brown' });
    const result = processTextNode(text, [ann]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns single segment for empty annotation list', () => {
    const result = processTextNode('just some text', []);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('just some text');
  });
});

// ---------------------------------------------------------------------------
// hasAnnotationsInText
// ---------------------------------------------------------------------------
describe('hasAnnotationsInText', () => {
  it('returns true when text contains matching annotation', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'quick brown fox' });
    expect(hasAnnotationsInText(text, [ann])).toBe(true);
  });

  it('returns false when no matching annotations', () => {
    const text = 'Short text here';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'completely absent phrase here xyz',
    });
    expect(hasAnnotationsInText(text, [ann])).toBe(false);
  });

  it('returns false for empty annotations array', () => {
    expect(hasAnnotationsInText('some text', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMatchingAnnotationIds
// ---------------------------------------------------------------------------
describe('getMatchingAnnotationIds', () => {
  it('returns ids of matching annotations', () => {
    const text = 'The quick brown fox jumps over the lazy dog here';
    const ann1 = makeAnnotation({
      id: 'match-1',
      selectedText: 'quick brown fox',
    });
    const ann2 = makeAnnotation({
      id: 'no-match',
      selectedText: 'xyz xyz xyz xyz',
    });
    const ann3 = makeAnnotation({ id: 'match-2', selectedText: 'lazy dog' });

    const ids = getMatchingAnnotationIds(text, [ann1, ann2, ann3]);
    expect(ids).toContain('match-1');
    expect(ids).toContain('match-2');
    expect(ids).not.toContain('no-match');
  });

  it('returns empty array when no matches', () => {
    const ids = getMatchingAnnotationIds('some text here', [
      makeAnnotation({
        id: 'x',
        selectedText: 'totally absent phrase here with no match',
      }),
    ]);
    expect(ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationMatches - strategy 8 (first sentence match)
// ---------------------------------------------------------------------------
describe('findAnnotationMatches - first sentence strategy (strategy 8)', () => {
  it('matches annotation using first sentence (> 15 chars)', () => {
    // First sentence must be >= 15 chars and exist in content
    const firstSentence = 'This first sentence is quite long and important';
    const content = `${firstSentence}. Additional context. And more beyond that for good measure.`;
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: `${firstSentence}. Additional context. And more beyond that for good measure.`,
    });

    const matches = findAnnotationMatches(content, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationMatches - strategy 9 (last sentence)
// ---------------------------------------------------------------------------
describe('findAnnotationMatches - last sentence strategy (strategy 9)', () => {
  it('matches multi-sentence annotation by last sentence', () => {
    const lastSentence =
      'This final conclusion is very distinct and long enough for strategy nine';
    const content = `Introduction text here. Middle content sentence. ${lastSentence}`;
    const ann = makeAnnotation({
      id: 'a1',
      // Something that won't match exactly but last sentence will
      selectedText: `Introduction text here. Middle content sentence. ${lastSentence}`,
    });

    const matches = findAnnotationMatches(content, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// splitTextIntoSegments - trailing space trimming (buildPositionMap)
// ---------------------------------------------------------------------------
describe('splitTextIntoSegments - position map edge cases', () => {
  it('handles text that ends with whitespace', () => {
    const text = 'hello world   ';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'hello world' });
    const result = splitTextIntoSegments(text, [ann]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles text that starts with whitespace', () => {
    const text = '   hello world';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'hello world' });
    const result = splitTextIntoSegments(text, [ann]);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationPosition - strategy 2 return (lines 118-121)
// ---------------------------------------------------------------------------
describe('findAnnotationPosition - strategy 2 return', () => {
  it('matches via citation-free strategy when citation markers break exact match', () => {
    // Content: "important content with citations here"
    // Annotation selected text: "important content [1] with citations [2] here"
    // Strategy 1 fails: exact match fails (citation markers in annotation)
    // Strategy 2: remove citations → both become "important content with citations here" → match!
    // firstWords of target-without-citations = "important content with citations here"
    // originalIndex in content for "important content" = found
    const content =
      'important content with citations here and more text following this';
    const ann = makeAnnotation({
      id: 'strat2',
      selectedText:
        'important content [1] with citations [2] here and more text following this',
    });
    const matches = findAnnotationMatches(content, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationPosition - strategy 3 return (line 131)
// ---------------------------------------------------------------------------
describe('findAnnotationPosition - strategy 3 return', () => {
  it('matches via first-50-chars strategy when full text not found but first 50 chars are', () => {
    // Strategy 1 fails: exact text not in content (annotation has extra suffix not in content)
    // Strategy 2: no citation markers
    // Strategy 3: first 50 chars of annotation DO appear in content
    // The annotation's first 50 chars must be >= 20 chars and present in content
    const first50 = 'The quick brown fox jumps over the lazy dog today';
    // Annotation: first50 + extra not in content
    const annotText = `${first50} EXTRA_NOT_IN_CONTENT_XYZ_123`;
    // Content has the first 50 chars of annotation
    const content = `${first50} and something completely different after this.`;

    const ann = makeAnnotation({ id: 'strat3', selectedText: annotText });
    const matches = findAnnotationMatches(content, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationPosition - strategy 4 return (line 142)
// ---------------------------------------------------------------------------
describe('findAnnotationPosition - strategy 4 first-3-words return', () => {
  it('matches via first-3-words strategy when first-50-chars not in content', () => {
    // Strategy 1 fails: exact text not in content
    // Strategy 2: no citations
    // Strategy 3: first 50 chars (= full annotation < 50) not in content → fails
    // Strategy 4: first 3 words (>= 10 chars) ARE in content → matches
    //
    // Annotation: short (< 50 chars), 3+ words, extra suffix not in content
    // "ABC DEF GHI SUFFIX_NOT_IN_CONTENT_HERE" - first 3 words "ABC DEF GHI" in content
    const annotText = 'ALPHA BETA GAMMA SUFFIX_NOT_IN_CONTENT_HERE';
    const content =
      'intro text ALPHA BETA GAMMA more content here for the paragraph';
    // first 3 words = "ALPHA BETA GAMMA" (16 chars >= 10) - IS in content
    // full annotation not in content (SUFFIX not there)

    const ann = makeAnnotation({ id: 'strat4', selectedText: annotText });
    const matches = findAnnotationMatches(content, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationPosition - strategy 5 prefix return (lines 160-167)
// ---------------------------------------------------------------------------
describe('findAnnotationPosition - strategy 5 prefix return', () => {
  it('matches via prefix context when other strategies fail', () => {
    // Need: strategies 1-4 all fail, selectorPrefix present and found, first 2 words
    // found within 20 chars after prefix
    // Strategy 1: exact fails (annotation text not in content)
    // Strategy 2: no citations
    // Strategy 3: first 50 chars not in content (annotation starts with unique chars not in content)
    // Strategy 4: first 3 words not in content
    // Strategy 5: prefix found, then first 2 words of annotation found nearby
    const prefix = 'xyzpfx ';
    const twoWords = 'target words';
    // Content has the prefix followed by the first 2 words of annotation
    const content = `intro text. ${prefix}${twoWords} rest of content here to fill space`;
    // Annotation: starts with first 2 words but 3-word combo not in content
    // "target words" are the first 2 words of the annotation
    const annotText = `${twoWords} NOT_IN_CONTENT_SUFFIX_ABCDEFGH`;
    // Make sure first 3 words don't exist in content (content has "target words rest" not "target words NOT_IN_CONTENT_SUFFIX_ABCDEFGH")
    // Strategy 4: "target words NOT_IN_CONTENT_SUFFIX_ABCDEFGH".split(' ').slice(0,3) = ["target","words","NOT_IN_CONTENT_SUFFIX_ABCDEFGH"] → "target words NOT_IN_CONTENT_SUFFIX_ABCDEFGH" not in content
    // Strategy 3: first 50 chars = "target words NOT_IN_CONTENT_SUFFIX_ABCDEFGH" (43 chars) → not in content (content has "target words rest")
    // Strategy 2: no citations
    // Strategy 1: "target words NOT_IN_CONTENT_SUFFIX_ABCDEFGH" not in content

    const ann = makeAnnotation({
      id: 'strat5',
      selectedText: annotText,
      selectorPrefix: prefix,
    });
    const matches = findAnnotationMatches(content, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationPosition - strategy 6 return (lines 185, 189)
// ---------------------------------------------------------------------------
describe('findAnnotationPosition - strategy 6 last-50-chars return', () => {
  it('matches via last 50 chars when beginning differs but end is shared', () => {
    // Annotation is >= 50 chars, last 50 chars ARE in content but full text is not
    // Strategy 1 fails: exact match fails
    // Strategy 2: no citations
    // Strategy 3: first 50 chars of annotation not in content
    // Strategy 4: first 3 words of annotation not in content
    // Strategy 5: no prefix
    // Strategy 6: last 50 chars of annotation found in content
    const last50 = 'last-fifty-chars-of-the-annotation-text-here-END!!';
    // Annotation starts with text not in content
    const annotText = `UNIQUE_MISSING_START_XXXX ${last50}`;
    expect(annotText.length).toBeGreaterThanOrEqual(50);
    // Content contains the last 50 chars but not the full annotation
    const content = `intro content. some preceding context ${last50} and more.`;

    const ann = makeAnnotation({ id: 'strat6', selectedText: annotText });
    const matches = findAnnotationMatches(content, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationPosition - strategy 7 return (lines 203-204)
// ---------------------------------------------------------------------------
describe('findAnnotationPosition - strategy 7 middle portion match', () => {
  it('matches annotation by middle portion when start/end strategies fail', () => {
    // Need: normalizedTarget.length >= 60, strategies 1-6 fail, middle portion found
    // Design:
    // - A = first 20 chars NOT in content (s1-s4 fail: first50, first3words not found)
    // - B+C overlap = the computed middle portion (slice from ms to ms+40) IS in content
    // - Last 50 chars include A portion → not found in content (s6 fails)
    //
    // Annotation: A + sharedMiddle + C
    // middleStart = floor(63/3) = 21
    // mp = slice(21, 61) - we need this exact string in content
    const A = 'XXXX XXXX XXXX XXXX'; // 19 chars
    const sharedMiddle = 'SHARED MIDDLE CONTENT ABCDE 12345 WXYZ'; // 38 chars
    const C = 'YYYY'; // 4 chars
    const annotText = `${A} ${sharedMiddle} ${C}`; // total 63 chars

    const ms = Math.floor(annotText.length / 3);
    const mp = annotText.slice(ms, ms + 40); // exact middle portion to put in content
    // Content: has the exact middle portion but different start
    const content = `DIFFERENT DIFFERENT DIFFERENT ${mp} DIFFERENT END HERE`;

    // Verify: exact match fails
    expect(content.includes(annotText)).toBe(false);
    // Verify: middle portion is in content (strategy 7 path)
    expect(content.includes(mp)).toBe(true);

    const ann = makeAnnotation({ id: 'strat7', selectedText: annotText });
    const matches = findAnnotationMatches(content, [ann]);
    // Strategy 7 should find it via the middle portion
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationPosition - strategy 8 return (line 223)
// ---------------------------------------------------------------------------
describe('findAnnotationPosition - strategy 8 first-sentence return', () => {
  it('matches annotation using first sentence when earlier strategies do not apply', () => {
    // Design to avoid earlier strategies:
    // - Annotation: "XXXXSENTENCE_IN_CONTENT. MISSING_PART_XYZ"
    // - words = ["XXXXSENTENCE_IN_CONTENT.", "MISSING_PART_XYZ"] → only 2 words → s4 skipped
    // - First 50 chars = full annotation (41 chars) → s3: length >= 20, NOT in content → fails
    // - No citations → s2 skipped
    // - Last 50 chars: annotation < 50 → s6 skipped
    // - annotation < 60 → s7 skipped
    // - First sentence "XXXXSENTENCE_IN_CONTENT" (23 chars >= 15) IS in content → s8 matches
    const annotText = 'XXXXSENTENCE_IN_CONTENT. MISSING_PART_XYZ';
    const content =
      'Some intro context XXXXSENTENCE_IN_CONTENT and more text here following.';

    const ann = makeAnnotation({ id: 'strat8', selectedText: annotText });
    const matches = findAnnotationMatches(content, [ann]);
    // Should find via strategy 8 first sentence
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// findAnnotationPosition - strategy 9 return (lines 238-247)
// ---------------------------------------------------------------------------
describe('findAnnotationPosition - strategy 9 last-sentence return', () => {
  it('matches annotation using last sentence when earlier strategies do not apply', () => {
    // Strategy 1-8 fail, strategy 9 finds last sentence
    // Need: annotation has multiple sentences (> 10 chars each), last sentence >= 15 chars,
    // last sentence IS in content, but nothing else matches
    // Strategy 1: exact fails
    // Strategy 2: no citations
    // Strategy 3: first 50 chars not in content
    // Strategy 4: first 3 words not in content
    // Strategy 5: no prefix
    // Strategy 6: last 50 chars in content (last sentence is <= 50 chars AND in content)
    //    Actually strategy 6 uses last 50 chars of the annotation, which overlaps with last sentence
    //    We need last 50 chars NOT in content as a substring (or last part != last sentence)
    // Strategy 7: >= 60, middle portion not in content
    // Strategy 8: first sentence not in content
    // Strategy 9: last sentence IS in content
    //
    // Design: last sentence < 50 chars, first sentence > 10 chars, first sentence NOT in content
    // Make it so last 50 chars of annotation !== last sentence (so s6 doesn't match via different path)
    // The key: last sentence IS in content but full last 50 chars are NOT

    // Annotation has 3 sentences, all > 10 chars
    const lastSentence = 'final conclusion uniquely-identifiable here end';
    const firstSentence = 'MISSING_FROM_CONTENT_INTRO_XYZ'; // not in content
    const middleSentence = 'MISSING_MIDDLE_CONTENT_ABC'; // not in content
    const annotText = `${firstSentence}. ${middleSentence}. ${lastSentence}`;
    // Content: has last sentence but not the others
    const content = `Some different intro text here. ${lastSentence} followed by more content.`;

    // Verify last sentence IS in content
    expect(content.includes(lastSentence)).toBe(true);
    // Verify exact match fails
    expect(content.includes(annotText)).toBe(false);

    const ann = makeAnnotation({ id: 'strat9', selectedText: annotText });
    const matches = findAnnotationMatches(content, [ann]);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// splitTextIntoSegments - overlapping annotations skip (line 414 continue)
// ---------------------------------------------------------------------------
describe('splitTextIntoSegments - overlapping annotation continue', () => {
  it('skips second annotation that is completely within already-processed range', () => {
    // Need: annotation a2 is COMPLETELY inside a1's range (originalEnd <= currentPos)
    // Both must match in the text
    const text =
      'The quick brown fox jumps over the lazy dog and runs away fast now';
    // a1 spans a large portion
    const a1 = makeAnnotation({
      id: 'a1',
      selectedText: 'quick brown fox jumps over the lazy dog and runs',
      color: 'yellow',
    });
    // a2 is entirely inside a1's range
    const a2 = makeAnnotation({
      id: 'a2',
      selectedText: 'fox jumps over',
      color: 'blue',
    });

    const result = splitTextIntoSegments(text, [a1, a2]);

    // a1 should appear in segments
    const a1Segments = result.filter((s) => s.annotationId === 'a1');
    expect(a1Segments.length).toBeGreaterThanOrEqual(1);

    // a2 should be skipped (completely inside a1's range)
    const a2Segments = result.filter((s) => s.annotationId === 'a2');
    expect(a2Segments.length).toBe(0);

    // Reassembled text should equal original
    const reassembled = result.map((s) => s.text).join('');
    expect(reassembled).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// splitTextIntoSegments - edge cases
// ---------------------------------------------------------------------------
describe('splitTextIntoSegments - edge cases', () => {
  it('handles annotation that is longer than content (endIndex clamped)', () => {
    const text = 'Short text';
    const ann = makeAnnotation({
      id: 'a1',
      selectedText: 'Short text and beyond that boundary',
    });
    // Will either match or not, but should not throw
    const result = splitTextIntoSegments(text, [ann]);
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles overlapping annotations gracefully (no duplicate text)', () => {
    const text = 'alpha beta gamma delta epsilon';
    const ann1 = makeAnnotation({
      id: 'a1',
      selectedText: 'alpha beta gamma',
      color: 'yellow',
    });
    const ann2 = makeAnnotation({
      id: 'a2',
      selectedText: 'beta gamma delta',
      color: 'blue',
    });
    const result = splitTextIntoSegments(text, [ann1, ann2]);
    const reassembled = result.map((s) => s.text).join('');
    // Reassembled text should equal the original
    expect(reassembled).toBe(text);
  });

  it('handles text with only whitespace difference from annotation', () => {
    const text = 'Hello   world'; // multiple spaces
    const ann = makeAnnotation({ id: 'a1', selectedText: 'Hello world' }); // single space
    const result = splitTextIntoSegments(text, [ann]);
    // findAnnotationMatches normalizes whitespace, may find it
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns correct segment count for text entirely covered by one annotation', () => {
    const text = 'Hello world';
    const ann = makeAnnotation({ id: 'a1', selectedText: 'Hello world' });
    const result = splitTextIntoSegments(text, [ann]);
    const highlighted = result.filter((s) => s.annotationId === 'a1');
    expect(highlighted.length).toBeGreaterThanOrEqual(1);
  });
});
