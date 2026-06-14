import { splitFullReportIntoChapters } from '../splitFullReportIntoChapters';

describe('splitFullReportIntoChapters', () => {
  it('returns empty for null/empty input', () => {
    expect(splitFullReportIntoChapters(null)).toEqual([]);
    expect(splitFullReportIntoChapters(undefined)).toEqual([]);
    expect(splitFullReportIntoChapters('')).toEqual([]);
  });

  it('returns empty when no H2 headings present', () => {
    expect(splitFullReportIntoChapters('# Title\n\nJust a paragraph.')).toEqual(
      []
    );
  });

  it('splits preface, exec summary, dimensions, and supplementary sections', () => {
    const fullReport = [
      '# Topic Title',
      '',
      '> 生成时间：2026-04-17',
      '',
      '## 前言',
      '',
      '前言内容。',
      '',
      '## 执行摘要',
      '',
      '摘要内容。',
      '',
      '## 目录',
      '',
      '1. [Foo](#1-foo)',
      '',
      '## 1. Foo',
      '',
      'Dimension 1 body.',
      '',
      '## 2. Bar',
      '',
      'Dimension 2 body.',
      '',
      '## 跨维度关联分析',
      '',
      'Cross-dimension body.',
      '',
      '## 风险评估',
      '',
      'Risks body.',
      '',
      '## 战略建议',
      '',
      'Strategy body.',
      '',
      '## 结语',
      '',
      'Conclusion body.',
      '',
      '---',
      '',
      '## 参考文献',
      '',
      '[1] Some Reference. https://example.com',
    ].join('\n');

    const result = splitFullReportIntoChapters(fullReport);
    expect(result.map((c) => c.title)).toEqual([
      '前言',
      '执行摘要',
      'Foo',
      'Bar',
      '跨维度关联分析',
      '风险评估',
      '战略建议',
      '结语',
    ]);
    expect(result.map((c) => c.type)).toEqual([
      'preface',
      'summary',
      'dimension',
      'dimension',
      'cross-dimension',
      'risk',
      'strategy',
      'conclusion',
    ]);
    // Dimension section numbers parsed correctly
    expect(result[2].sectionNumber).toBe('1');
    expect(result[3].sectionNumber).toBe('2');
    // Content preserved
    expect(result[2].content).toContain('Dimension 1 body.');
    // TOC excluded, references excluded
    expect(result.find((c) => c.title === '目录')).toBeUndefined();
    expect(result.find((c) => c.title === '参考文献')).toBeUndefined();
  });

  it('handles English titles', () => {
    const fullReport = [
      '# Title',
      '',
      '## Preface',
      '',
      'Preface.',
      '',
      '## Executive Summary',
      '',
      'Summary.',
      '',
      '## 1. Section A',
      '',
      'Body.',
      '',
      '## Conclusion',
      '',
      'Done.',
    ].join('\n');
    const result = splitFullReportIntoChapters(fullReport);
    expect(result.map((c) => c.type)).toEqual([
      'preface',
      'summary',
      'dimension',
      'conclusion',
    ]);
  });

  it('preserves chart placeholders in content', () => {
    const fullReport = [
      '# Title',
      '',
      '## 1. Dim',
      '',
      'Para.',
      '',
      '<!-- chart:d0-abc -->',
      '',
      'More.',
    ].join('\n');
    const result = splitFullReportIntoChapters(fullReport);
    expect(result[0].content).toContain('<!-- chart:d0-abc -->');
  });

  // ==== Edge cases for 100% path coverage ====

  it('preserves H3/H4 subheadings within H2 chapter content', () => {
    const fullReport = [
      '## 1. Dim',
      '',
      '### 1.1 Sub',
      '',
      'Nested.',
      '',
      '#### 1.1.1 Deep',
      '',
      'Deeper.',
      '',
      '## 2. Dim2',
      '',
      'Body2.',
    ].join('\n');
    const result = splitFullReportIntoChapters(fullReport);
    expect(result).toHaveLength(2);
    expect(result[0].content).toContain('### 1.1 Sub');
    expect(result[0].content).toContain('#### 1.1.1 Deep');
    expect(result[0].content).toContain('Nested.');
    expect(result[0].content).toContain('Deeper.');
  });

  it('handles decimal section numbers', () => {
    const fullReport = ['## 1.2 Sub-dimension', '', 'Body.'].join('\n');
    const result = splitFullReportIntoChapters(fullReport);
    expect(result[0].sectionNumber).toBe('1.2');
    expect(result[0].title).toBe('Sub-dimension');
  });

  it('returns empty when fullReport only contains title + refs', () => {
    const fullReport = [
      '# Title',
      '',
      '> 生成时间：2026',
      '',
      '---',
      '',
      '## 参考文献',
      '',
      '[1] Ref',
    ].join('\n');
    expect(splitFullReportIntoChapters(fullReport)).toEqual([]);
  });

  it('strips References section without `---` separator', () => {
    const fullReport = [
      '## 1. Foo',
      '',
      'Body.',
      '',
      '## References',
      '',
      '[1] Ref',
    ].join('\n');
    const result = splitFullReportIntoChapters(fullReport);
    expect(result.find((c) => c.title.includes('Reference'))).toBeUndefined();
    expect(result.find((c) => c.title.includes('参考文献'))).toBeUndefined();
    expect(result).toHaveLength(1);
  });

  it('returns stable IDs distinguishing identical titles', () => {
    const fullReport = ['## 1. Foo', '', 'A.', '', '## 2. Foo', '', 'B.'].join(
      '\n'
    );
    const result = splitFullReportIntoChapters(fullReport);
    expect(result[0].id).not.toBe(result[1].id);
    expect(result[0].id).toContain('1');
    expect(result[1].id).toContain('2');
  });

  it('does not mis-classify non-numbered chapters as dimensions', () => {
    const fullReport = ['## Some Custom Section', '', 'Body.'].join('\n');
    const result = splitFullReportIntoChapters(fullReport);
    expect(result[0].type).toBe('other');
    expect(result[0].sectionNumber).toBeNull();
  });

  it('trims whitespace from content but preserves empty sections', () => {
    const fullReport = [
      '## 1. Empty',
      '',
      '',
      '',
      '## 2. Non-empty',
      '',
      'x.',
    ].join('\n');
    const result = splitFullReportIntoChapters(fullReport);
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe('');
    expect(result[1].content).toBe('x.');
  });

  // Regression for the 9-章规划-只输出-2-3章 incident: recover from mid-line
  // `## N. Title` headings produced by an upstream pipeline bug (historically
  // LatexRepair's chunked path) so users never see a chapter silently vanish.
  it('recovers mid-line `## N. 标题` that is glued to previous paragraph', () => {
    const fullReport = [
      '## 1. 第一章',
      '',
      '第一章内容。',
      '',
      // Next heading deliberately glued to the prose's last character with no
      // newline — simulates the LatexRepair chunked-join bug output.
      '## 2. 第二章',
      '',
      '第二章结尾：**核心判断**。## 3. 第三章',
      '',
      '### 3.1. 子节',
      '',
      '第三章内容。',
      '',
      '## 4. 第四章',
      '',
      '第四章内容。',
    ].join('\n');
    const result = splitFullReportIntoChapters(fullReport);
    // All four dimensions must be recovered — without the defense the glued
    // `## 3.` would be swallowed into `## 2.` and we'd see only 3 chapters.
    expect(result.map((c) => c.sectionNumber)).toEqual(['1', '2', '3', '4']);
    expect(result[1].content).toContain('核心判断');
    expect(result[1].content).not.toContain('## 3.');
    expect(result[2].content).toContain('### 3.1. 子节');
  });
});
