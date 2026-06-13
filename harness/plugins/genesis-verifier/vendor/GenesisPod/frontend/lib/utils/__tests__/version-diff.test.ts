/**
 * Tests for lib/utils/version-diff.ts
 *
 * Pure computation functions - no HTTP mocks needed.
 */
import { describe, it, expect } from 'vitest';

import {
  comparePPTVersions,
  compareDocVersions,
  getDiffColor,
  getDiffIcon,
  type DiffType,
} from '../version-diff';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function makeMeta(id: string, title: string) {
  return { id, timestamp: new Date('2025-01-01'), title };
}

function makePPTContent(
  slides: Array<{ title: string; content: string }>
): string {
  return slides
    .map((s) => `## 第1页：${s.title}\n${s.content}`)
    .join('\n---\n');
}

function makeDocContent(
  chapters: Array<{ title: string; content: string }>
): string {
  return chapters.map((c) => `## ${c.title}\n${c.content}`).join('\n');
}

// ---------------------------------------------------------------------------
// comparePPTVersions
// ---------------------------------------------------------------------------

describe('comparePPTVersions', () => {
  it('returns empty changes and all unchanged when content is identical', () => {
    const content = makePPTContent([
      { title: 'Introduction', content: 'Welcome slide' },
      { title: 'Agenda', content: '1. Topic A\n2. Topic B' },
    ]);

    const result = comparePPTVersions(
      content,
      content,
      makeMeta('v1', 'Deck'),
      makeMeta('v2', 'Deck')
    );

    expect(result.stats.unchanged).toBe(2);
    expect(result.stats.added).toBe(0);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.deleted).toBe(0);
    expect(result.changes.filter((c) => c.type !== 'unchanged')).toHaveLength(
      0
    );
  });

  it('detects added slides', () => {
    const oldContent = makePPTContent([{ title: 'Intro', content: 'Hello' }]);
    const newContent = makePPTContent([
      { title: 'Intro', content: 'Hello' },
      { title: 'New Slide', content: 'Extra content' },
    ]);

    const result = comparePPTVersions(
      oldContent,
      newContent,
      makeMeta('v1', 'Deck'),
      makeMeta('v2', 'Deck')
    );

    expect(result.stats.added).toBe(1);
    expect(
      result.changes.some(
        (c) => c.type === 'added' && c.sectionTitle === 'New Slide'
      )
    ).toBe(true);
  });

  it('detects deleted slides', () => {
    const oldContent = makePPTContent([
      { title: 'Intro', content: 'Hello' },
      { title: 'About', content: 'About us' },
    ]);
    const newContent = makePPTContent([{ title: 'Intro', content: 'Hello' }]);

    const result = comparePPTVersions(
      oldContent,
      newContent,
      makeMeta('v1', 'Deck'),
      makeMeta('v2', 'Deck')
    );

    expect(result.stats.deleted).toBe(1);
    expect(
      result.changes.some(
        (c) => c.type === 'deleted' && c.sectionTitle === 'About'
      )
    ).toBe(true);
  });

  it('detects modified slides when content changes significantly', () => {
    const oldContent = makePPTContent([
      { title: 'Intro', content: 'Hello world' },
    ]);
    const newContent = makePPTContent([
      {
        title: 'Intro',
        content:
          'Completely different content that is much longer and very different from the original text so that similarity is below threshold',
      },
    ]);

    const result = comparePPTVersions(
      oldContent,
      newContent,
      makeMeta('v1', 'Deck'),
      makeMeta('v2', 'Deck')
    );

    expect(result.stats.modified).toBe(1);
    const change = result.changes.find((c) => c.type === 'modified');
    expect(change).toBeDefined();
    expect(change?.sectionTitle).toBe('Intro');
  });

  it('populates version metadata correctly', () => {
    const content = makePPTContent([{ title: 'Slide', content: 'Content' }]);
    const oldMeta = makeMeta('v1', 'Version 1');
    const newMeta = makeMeta('v2', 'Version 2');

    const result = comparePPTVersions(content, content, oldMeta, newMeta);

    expect(result.oldVersion).toEqual(oldMeta);
    expect(result.newVersion).toEqual(newMeta);
  });

  it('generates correct summary string for multiple change types', () => {
    const oldContent = makePPTContent([
      { title: 'Keep', content: 'Same content' },
      { title: 'Delete me', content: 'Will be removed' },
    ]);
    const newContent = makePPTContent([
      { title: 'Keep', content: 'Same content' },
      { title: 'New Slide', content: 'Freshly added' },
    ]);

    const result = comparePPTVersions(
      oldContent,
      newContent,
      makeMeta('v1', ''),
      makeMeta('v2', '')
    );

    expect(result.summary).toContain('新增1项');
    expect(result.summary).toContain('删除1项');
  });

  it('handles empty content gracefully', () => {
    const result = comparePPTVersions(
      '',
      '',
      makeMeta('v1', ''),
      makeMeta('v2', '')
    );

    expect(result.stats.added).toBe(0);
    expect(result.stats.deleted).toBe(0);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.unchanged).toBe(0);
    expect(result.summary).toBe('无变化');
  });

  it('marks added slide change with structure type', () => {
    const oldContent = '';
    const newContent = makePPTContent([{ title: 'First', content: 'Content' }]);

    const result = comparePPTVersions(
      oldContent,
      newContent,
      makeMeta('v1', ''),
      makeMeta('v2', '')
    );

    const addedChange = result.changes.find((c) => c.type === 'added');
    expect(addedChange?.changes[0].type).toBe('structure');
  });
});

// ---------------------------------------------------------------------------
// compareDocVersions
// ---------------------------------------------------------------------------

describe('compareDocVersions', () => {
  it('returns empty changes for identical documents', () => {
    const content = makeDocContent([
      { title: 'Overview', content: 'This is the overview.' },
      { title: 'Details', content: 'These are the details.' },
    ]);

    const result = compareDocVersions(
      content,
      content,
      makeMeta('v1', 'Doc'),
      makeMeta('v2', 'Doc')
    );

    expect(result.stats.unchanged).toBe(2);
    expect(result.stats.added).toBe(0);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.deleted).toBe(0);
  });

  it('detects added chapters', () => {
    const oldContent = makeDocContent([{ title: 'Intro', content: 'Hello' }]);
    const newContent = makeDocContent([
      { title: 'Intro', content: 'Hello' },
      { title: 'New Chapter', content: 'Brand new content here' },
    ]);

    const result = compareDocVersions(
      oldContent,
      newContent,
      makeMeta('v1', 'Doc'),
      makeMeta('v2', 'Doc')
    );

    expect(result.stats.added).toBe(1);
    expect(
      result.changes.some(
        (c) => c.type === 'added' && c.sectionTitle === 'New Chapter'
      )
    ).toBe(true);
  });

  it('detects deleted chapters', () => {
    const oldContent = makeDocContent([
      { title: 'Intro', content: 'Hello' },
      { title: 'Appendix', content: 'Extra info' },
    ]);
    const newContent = makeDocContent([{ title: 'Intro', content: 'Hello' }]);

    const result = compareDocVersions(
      oldContent,
      newContent,
      makeMeta('v1', 'Doc'),
      makeMeta('v2', 'Doc')
    );

    expect(result.stats.deleted).toBe(1);
    expect(
      result.changes.some(
        (c) => c.type === 'deleted' && c.sectionTitle === 'Appendix'
      )
    ).toBe(true);
  });

  it('detects modified chapters', () => {
    const oldContent = makeDocContent([
      { title: 'Summary', content: 'Short.' },
    ]);
    const newContent = makeDocContent([
      {
        title: 'Summary',
        content:
          'This is a completely rewritten summary with much more extensive content that replaces the original.',
      },
    ]);

    const result = compareDocVersions(
      oldContent,
      newContent,
      makeMeta('v1', 'Doc'),
      makeMeta('v2', 'Doc')
    );

    expect(result.stats.modified).toBe(1);
  });

  it('stores old and new content on modified sections', () => {
    const oldContent = makeDocContent([
      { title: 'Chapter 1', content: 'Original text' },
    ]);
    const newContent = makeDocContent([
      {
        title: 'Chapter 1',
        content:
          'Completely different text that changes everything about this chapter',
      },
    ]);

    const result = compareDocVersions(
      oldContent,
      newContent,
      makeMeta('v1', 'Doc'),
      makeMeta('v2', 'Doc')
    );

    const modified = result.changes.find((c) => c.type === 'modified');
    expect(modified?.oldContent).toBeDefined();
    expect(modified?.newContent).toBeDefined();
  });

  it('provides section IDs with chapter prefix', () => {
    const oldContent = '';
    const newContent = makeDocContent([
      { title: 'Chapter A', content: 'Content A' },
    ]);

    const result = compareDocVersions(
      oldContent,
      newContent,
      makeMeta('v1', ''),
      makeMeta('v2', '')
    );

    expect(result.changes[0].section).toMatch(/^chapter-/);
  });
});

// ---------------------------------------------------------------------------
// Summary generation
// ---------------------------------------------------------------------------

describe('VersionComparison summary', () => {
  it('generates no-change summary when nothing changed', () => {
    // The summary function includes unchanged count, so when only unchanged items exist
    // the summary will contain "X项未变" rather than "无变化"
    // "无变化" is only returned when ALL stats are 0 (empty content)
    const result = compareDocVersions(
      '',
      '',
      makeMeta('v1', ''),
      makeMeta('v2', '')
    );

    expect(result.summary).toBe('无变化');
  });

  it('lists all changed stat types in summary', () => {
    const oldContent = makeDocContent([
      { title: 'Keep', content: 'Same' },
      { title: 'Old Chapter', content: 'Will be removed' },
    ]);
    const newContent = makeDocContent([
      { title: 'Keep', content: 'Same' },
      { title: 'New Chapter', content: 'Added content' },
    ]);

    const result = compareDocVersions(
      oldContent,
      newContent,
      makeMeta('v1', ''),
      makeMeta('v2', '')
    );

    expect(result.summary).toContain('新增1项');
    expect(result.summary).toContain('删除1项');
    expect(result.summary).toContain('1项未变');
  });
});

// ---------------------------------------------------------------------------
// getDiffColor
// ---------------------------------------------------------------------------

describe('getDiffColor', () => {
  it('returns green classes for "added" type', () => {
    const color = getDiffColor('added');
    expect(color).toContain('green');
  });

  it('returns yellow classes for "modified" type', () => {
    const color = getDiffColor('modified');
    expect(color).toContain('yellow');
  });

  it('returns red classes for "deleted" type', () => {
    const color = getDiffColor('deleted');
    expect(color).toContain('red');
  });

  it('returns gray classes for "unchanged" type', () => {
    const color = getDiffColor('unchanged');
    expect(color).toContain('gray');
  });

  it('returns a non-empty string for all diff types', () => {
    const types: DiffType[] = ['added', 'modified', 'deleted', 'unchanged'];
    types.forEach((type) => {
      expect(getDiffColor(type)).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// getDiffIcon
// ---------------------------------------------------------------------------

describe('getDiffIcon', () => {
  it('returns a string for all diff types', () => {
    const types: DiffType[] = ['added', 'modified', 'deleted', 'unchanged'];
    types.forEach((type) => {
      expect(typeof getDiffIcon(type)).toBe('string');
      expect(getDiffIcon(type).length).toBeGreaterThan(0);
    });
  });

  it('returns different icons for different types', () => {
    const icons = new Set([
      getDiffIcon('added'),
      getDiffIcon('modified'),
      getDiffIcon('deleted'),
      getDiffIcon('unchanged'),
    ]);
    expect(icons.size).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Visual markers detection (indirectly via comparePPTVersions)
// ---------------------------------------------------------------------------

describe('visual marker detection', () => {
  it('detects visual marker change as metadata change', () => {
    const oldSlide = `## 第1页：Slide\nContent\n<!-- FLOW -->`;
    const newSlide = `## 第1页：Slide\nContent\n<!-- CHART:bar -->`;
    const oldContent = oldSlide;
    const newContent = newSlide;

    const result = comparePPTVersions(
      oldContent,
      newContent,
      makeMeta('v1', ''),
      makeMeta('v2', '')
    );

    const modified = result.changes.find((c) => c.type === 'modified');
    const metaChange = modified?.changes.find((ch) => ch.type === 'metadata');
    expect(metaChange).toBeDefined();
    expect(metaChange?.description).toBe('可视化类型变更');
  });
});
