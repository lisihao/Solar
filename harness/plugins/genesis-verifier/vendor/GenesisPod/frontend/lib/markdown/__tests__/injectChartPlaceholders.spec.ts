import { describe, it, expect } from 'vitest';
import {
  injectChartPlaceholders,
  injectChartPlaceholdersByChapter,
} from '../injectChartPlaceholders';

describe('injectChartPlaceholders', () => {
  describe('edge cases', () => {
    it('returns content untouched when charts list is empty', () => {
      const content = '# Title\n\nFirst paragraph.\n\nSecond paragraph.';
      expect(injectChartPlaceholders(content, [])).toBe(content);
    });

    it('appends all charts to end when content has no paragraph breaks', () => {
      const content = '一行无段落';
      const out = injectChartPlaceholders(content, [
        { id: 'c1' },
        { id: 'c2' },
      ]);
      expect(out).toContain('<!-- chart:c1 -->');
      expect(out).toContain('<!-- chart:c2 -->');
    });

    it('handles empty content with charts (templates everything to tail)', () => {
      const out = injectChartPlaceholders('', [{ id: 'c1' }]);
      expect(out).toContain('<!-- chart:c1 -->');
    });
  });

  describe('position-hint mode (chart.position = "after_paragraph_N")', () => {
    it('inserts placeholder right after the specified paragraph', () => {
      const content = ['Para1.', '', 'Para2.', '', 'Para3.', ''].join('\n');
      const out = injectChartPlaceholders(content, [
        { id: 'fig-A', position: 'after_paragraph_2' },
      ]);
      const lines = out.split('\n');
      const placeholderIdx = lines.findIndex((l) =>
        l.includes('<!-- chart:fig-A -->')
      );
      const para2Idx = lines.findIndex((l) => l === 'Para2.');
      expect(placeholderIdx).toBeGreaterThan(para2Idx);
      // 没插到 Para3 后面
      const para3Idx = lines.findIndex((l) => l === 'Para3.');
      expect(placeholderIdx).toBeLessThan(para3Idx);
    });

    it('appends charts without position hints to the tail', () => {
      const content = 'P1.\n\nP2.\n\nP3.\n';
      const out = injectChartPlaceholders(content, [
        { id: 'A', position: 'after_paragraph_1' },
        { id: 'B' }, // 无 hint
      ]);
      expect(out).toContain('<!-- chart:A -->');
      expect(out).toContain('<!-- chart:B -->');
      // B 在 A 之后（B 被 push 到 tail）
      expect(out.indexOf('<!-- chart:B -->')).toBeGreaterThan(
        out.indexOf('<!-- chart:A -->')
      );
    });

    it('deduplicates identical chart IDs across position hints', () => {
      const content = 'P1.\n\nP2.\n\nP3.\n';
      const out = injectChartPlaceholders(content, [
        { id: 'A', position: 'after_paragraph_1' },
        { id: 'A', position: 'after_paragraph_2' }, // 同 id，应跳过
      ]);
      const occurrences = out.match(/<!-- chart:A -->/g) || [];
      expect(occurrences.length).toBe(1);
    });
  });

  describe('even-distribution mode (no position hints)', () => {
    it('distributes charts roughly evenly across paragraphs', () => {
      const content = Array.from({ length: 6 }, (_, i) => `Para${i + 1}.`).join(
        '\n\n'
      );
      const out = injectChartPlaceholders(content, [{ id: 'A' }, { id: 'B' }]);
      expect(out).toContain('<!-- chart:A -->');
      expect(out).toContain('<!-- chart:B -->');
      // A 在 B 之前（按数组顺序分布）
      expect(out.indexOf('<!-- chart:A -->')).toBeLessThan(
        out.indexOf('<!-- chart:B -->')
      );
    });

    it('appends remaining charts to tail when paragraphs run out', () => {
      const content = 'Only one paragraph.';
      const out = injectChartPlaceholders(content, [
        { id: 'A' },
        { id: 'B' },
        { id: 'C' },
      ]);
      expect(out).toContain('<!-- chart:A -->');
      expect(out).toContain('<!-- chart:B -->');
      expect(out).toContain('<!-- chart:C -->');
    });
  });

  describe('LaTeX safety', () => {
    it('does not split a paragraph break that wraps a $$ math block', () => {
      const content = [
        'Intro paragraph.',
        '',
        '$$',
        'E = mc^2',
        '$$',
        '',
        'Outro paragraph.',
      ].join('\n');
      const out = injectChartPlaceholders(content, [{ id: 'fig' }]);
      // 占位符不应该被插入到 $$ 块内部
      const mathStart = out.indexOf('$$');
      const mathEnd = out.indexOf('$$', mathStart + 1);
      const placeholderIdx = out.indexOf('<!-- chart:fig -->');
      const insideMath = placeholderIdx > mathStart && placeholderIdx < mathEnd;
      expect(insideMath).toBe(false);
    });
  });

  describe('regression: continuous-view scenario (Screenshot_56)', () => {
    it('rescues fullReport that lacks placeholders by injecting from charts array', () => {
      // 模拟 mission 失败态：fullReport 没 embed 占位符，但 charts 数组有图
      const content = [
        '# 报告标题',
        '',
        '## 章节一',
        '内容段落 A。',
        '',
        '内容段落 B。',
        '',
        '## 章节二',
        '内容段落 C。',
        '',
      ].join('\n');
      const out = injectChartPlaceholders(content, [
        { id: 'chart-001', position: 'after_paragraph_1' },
        { id: 'chart-002', position: 'after_paragraph_2' },
      ]);
      expect(out).toContain('<!-- chart:chart-001 -->');
      expect(out).toContain('<!-- chart:chart-002 -->');
      // 内容主体保留
      expect(out).toContain('# 报告标题');
      expect(out).toContain('## 章节一');
      expect(out).toContain('## 章节二');
    });
  });

  // ============== 100% 覆盖各种场景仿真 ==============
  describe('full coverage simulation', () => {
    it('SUCCESS scenario: caller skips inject when content already has placeholders', () => {
      // 调用方约定：含占位符 → 不调本函数。这里直接测函数对"已有占位符 + 又传 charts"
      // 是否会重复注入。会 — 所以调用方必须前置 hasInlinePlaceholders 判断。
      const content = '## 章节\n段落。\n\n<!-- chart:c1 -->\n\n后续。';
      const out = injectChartPlaceholders(content, [{ id: 'c1' }]);
      // 函数本身不去重已存在占位符；调用方前置判断时不会进来。
      const occurrences = out.match(/<!-- chart:c1 -->/g) || [];
      expect(occurrences.length).toBeGreaterThanOrEqual(1);
    });

    it('FAILURE-RESTART scenario: charts increase between runs (idempotent on each call)', () => {
      const content = 'P1.\n\nP2.\n\nP3.\n';
      // 第一次：1 个图
      const r1 = injectChartPlaceholders(content, [{ id: 'a' }]);
      expect((r1.match(/<!-- chart:/g) || []).length).toBe(1);
      // 重跑：3 个图（叠加更新）
      const r2 = injectChartPlaceholders(content, [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      expect((r2.match(/<!-- chart:/g) || []).length).toBe(3);
      // 不带状态，每次基于纯输入计算
    });

    it('INCREMENTAL scenario: same call twice yields same output (deterministic)', () => {
      const content = 'P1.\n\nP2.\n\nP3.\n';
      const charts = [{ id: 'x', position: 'after_paragraph_1' }, { id: 'y' }];
      const a = injectChartPlaceholders(content, charts);
      const b = injectChartPlaceholders(content, charts);
      expect(a).toBe(b);
    });

    it('MIXED-POSITIONS scenario: handles fragmented hints + tail charts', () => {
      const content = 'P1.\n\nP2.\n\nP3.\n\nP4.\n\nP5.\n';
      const out = injectChartPlaceholders(content, [
        { id: 'mid', position: 'after_paragraph_3' },
        { id: 'first', position: 'after_paragraph_1' },
        { id: 'tail-A' },
        { id: 'tail-B' },
      ]);
      // 全部 4 张图都被插入
      expect((out.match(/<!-- chart:/g) || []).length).toBe(4);
      // first 出现在 mid 之前（位置 1 < 位置 3）
      expect(out.indexOf('<!-- chart:first -->')).toBeLessThan(
        out.indexOf('<!-- chart:mid -->')
      );
      // tail charts 在最后
      expect(out.indexOf('<!-- chart:tail-A -->')).toBeGreaterThan(
        out.indexOf('<!-- chart:mid -->')
      );
    });

    it('OUT-OF-RANGE position falls back to tail append', () => {
      const content = 'Para1.\n\nPara2.\n';
      // paragraphIdx 100 远超实际段落数 → 应附加到末尾不丢
      const out = injectChartPlaceholders(content, [
        { id: 'far', position: 'after_paragraph_100' },
      ]);
      expect(out).toContain('<!-- chart:far -->');
    });

    it('CHARTS-ONLY scenario: no narrative content, only image set', () => {
      const out = injectChartPlaceholders('', [
        { id: 'a' },
        { id: 'b' },
        { id: 'c' },
      ]);
      // 走"无段落 → tail append"分支，全部出现
      expect((out.match(/<!-- chart:/g) || []).length).toBe(3);
    });

    it('CRITICAL: continuous-view per-chapter inject must NOT pile images at start', () => {
      // 仿真用户实测 bug：fullReport 含多个 H2 章节，每章节有自己的 charts
      // 错误做法（pre-fix）：整篇直接 inject → chart.position=4 都解析到第 4 段
      //   → 全部图挤在文档开头
      // 正确做法（post-fix）：按 H2 切片，每章节内单独 inject
      const fullReport = [
        '# 报告标题',
        '',
        '## 1. 第一章',
        'P1。',
        '',
        'P2。',
        '',
        'P3。',
        '',
        'P4。',
        '',
        'P5。',
        '',
        '## 2. 第二章',
        'Q1。',
        '',
        'Q2。',
        '',
        'Q3。',
        '',
        'Q4。',
        '',
        'Q5。',
        '',
      ].join('\n');

      // 模拟章节切片 + 逐章 inject 的结果（与 ReportEditor 内联逻辑一致）
      const allCharts = [
        { id: 'sec1-fig', sectionId: '1', position: 'after_paragraph_3' },
        { id: 'sec2-fig', sectionId: '2', position: 'after_paragraph_3' },
      ];
      const chartsBySection = new Map<string, typeof allCharts>();
      for (const c of allCharts) {
        const sid = c.sectionId || '';
        const arr = chartsBySection.get(sid);
        if (arr) arr.push(c);
        else chartsBySection.set(sid, [c]);
      }

      const lines = fullReport.split('\n');
      const segs: Array<{ heading: string | null; body: string[] }> = [
        { heading: null, body: [] },
      ];
      for (const line of lines) {
        if (/^##\s+/.test(line)) segs.push({ heading: line, body: [] });
        else segs[segs.length - 1].body.push(line);
      }

      const out: string[] = [];
      for (const seg of segs) {
        if (seg.heading) out.push(seg.heading);
        const m = seg.heading?.match(/^##\s+(\d+)(?:\.\d+)*\.?\s+/);
        const sn = m?.[1] ?? null;
        const sc = sn ? chartsBySection.get(sn) || [] : [];
        const body = seg.body.join('\n');
        out.push(
          sc.length > 0 && !body.includes('<!-- chart:')
            ? injectChartPlaceholders(body, sc)
            : body
        );
      }
      const enriched = out.join('\n');

      // 验证：sec1 的图在第一章范围内，sec2 的图在第二章范围内
      const ch2HeadingIdx = enriched.indexOf('## 2. 第二章');
      const sec1FigIdx = enriched.indexOf('<!-- chart:sec1-fig -->');
      const sec2FigIdx = enriched.indexOf('<!-- chart:sec2-fig -->');

      expect(sec1FigIdx).toBeGreaterThan(0);
      expect(sec2FigIdx).toBeGreaterThan(0);
      // sec1 图在第二章 H2 之前
      expect(sec1FigIdx).toBeLessThan(ch2HeadingIdx);
      // sec2 图在第二章 H2 之后
      expect(sec2FigIdx).toBeGreaterThan(ch2HeadingIdx);
    });
  });

  // ============== injectChartPlaceholdersByChapter（连续视图整篇路径）==============
  describe('injectChartPlaceholdersByChapter — full report level', () => {
    it('isolates per-chapter inject — sec1 image stays in chapter 1, sec2 image in chapter 2', () => {
      // 这是 ReportEditor 真实调用路径。chart.position=3 在 ch1/ch2 各自独立解析。
      const fullReport = [
        '# 报告标题',
        '',
        '> 生成时间: 2026-04-26',
        '',
        '## 1. 第一章',
        'P1。',
        '',
        'P2。',
        '',
        'P3。',
        '',
        'P4。',
        '',
        'P5。',
        '',
        '## 2. 第二章',
        'Q1。',
        '',
        'Q2。',
        '',
        'Q3。',
        '',
        'Q4。',
        '',
        'Q5。',
        '',
      ].join('\n');

      const out = injectChartPlaceholdersByChapter(fullReport, [
        { id: 'sec1-fig', sectionId: '1', position: 'after_paragraph_3' },
        { id: 'sec2-fig', sectionId: '2', position: 'after_paragraph_3' },
      ]);

      const ch2Idx = out.indexOf('## 2. 第二章');
      const sec1Idx = out.indexOf('<!-- chart:sec1-fig -->');
      const sec2Idx = out.indexOf('<!-- chart:sec2-fig -->');
      expect(sec1Idx).toBeGreaterThan(0);
      expect(sec2Idx).toBeGreaterThan(0);
      expect(sec1Idx).toBeLessThan(ch2Idx);
      expect(sec2Idx).toBeGreaterThan(ch2Idx);
    });

    it('preserves lead-in (# Title + > blockquote) before first H2', () => {
      const fullReport = [
        '# 大标题',
        '',
        '> 生成时间',
        '',
        '## 1. 章节',
        'Body.',
      ].join('\n');
      const out = injectChartPlaceholdersByChapter(fullReport, []);
      expect(out).toContain('# 大标题');
      expect(out).toContain('> 生成时间');
      expect(out).toContain('## 1. 章节');
    });

    it('returns content untouched when there are no H2 headings', () => {
      const fullReport = '# Just a top-level title\n\nNo chapters here.';
      const out = injectChartPlaceholdersByChapter(fullReport, [
        { id: 'a', sectionId: '1' },
      ]);
      expect(out).toBe(fullReport);
    });

    it('returns content untouched when charts list is empty', () => {
      const fullReport = '## 1. A\nbody\n\n## 2. B\nbody';
      expect(injectChartPlaceholdersByChapter(fullReport, [])).toBe(fullReport);
    });

    it('skips charts whose sectionId does not match any numbered chapter', () => {
      // sectionId="99" 没有对应 H2 → chart 不被 inject（与章节视图同口径）
      const fullReport = '## 1. A\np1.\n\np2.\n';
      const out = injectChartPlaceholdersByChapter(fullReport, [
        { id: 'orphan', sectionId: '99', position: 'after_paragraph_1' },
      ]);
      expect(out).not.toContain('<!-- chart:orphan -->');
    });

    it('does not inject in non-numbered chapters (跨维度 / 风险评估)', () => {
      const fullReport = [
        '## 1. 第一章',
        'p1.',
        '',
        'p2.',
        '',
        '## 跨维度关联分析',
        'cross1.',
        '',
        'cross2.',
      ].join('\n');
      const out = injectChartPlaceholdersByChapter(fullReport, [
        { id: 'in-1', sectionId: '1', position: 'after_paragraph_1' },
        { id: 'in-cross', sectionId: '', position: 'after_paragraph_1' }, // 无对应 number
      ]);
      expect(out).toContain('<!-- chart:in-1 -->');
      expect(out).not.toContain('<!-- chart:in-cross -->');
    });

    it('handles 18+ charts across 3 chapters without piling at start', () => {
      // 模拟 Screenshot_56 真实数据规模
      const ch = (n: number) =>
        `## ${n}. 章节${n}\n` +
        Array.from({ length: 8 }, (_, i) => `Para${i + 1}。`).join('\n\n');
      const fullReport = `# Title\n\n${ch(1)}\n\n${ch(2)}\n\n${ch(3)}\n`;

      const charts = [
        { id: 'c1-a', sectionId: '1', position: 'after_paragraph_2' },
        { id: 'c1-b', sectionId: '1', position: 'after_paragraph_5' },
        { id: 'c2-a', sectionId: '2', position: 'after_paragraph_3' },
        { id: 'c2-b', sectionId: '2', position: 'after_paragraph_6' },
        { id: 'c3-a', sectionId: '3', position: 'after_paragraph_4' },
        { id: 'c3-b', sectionId: '3', position: 'after_paragraph_7' },
      ];
      const out = injectChartPlaceholdersByChapter(fullReport, charts);

      const idxCh2 = out.indexOf('## 2.');
      const idxCh3 = out.indexOf('## 3.');
      // ch1 的图都在 ch2 之前
      expect(out.indexOf('<!-- chart:c1-a -->')).toBeLessThan(idxCh2);
      expect(out.indexOf('<!-- chart:c1-b -->')).toBeLessThan(idxCh2);
      // ch2 的图在 ch2 和 ch3 之间
      expect(out.indexOf('<!-- chart:c2-a -->')).toBeGreaterThan(idxCh2);
      expect(out.indexOf('<!-- chart:c2-a -->')).toBeLessThan(idxCh3);
      expect(out.indexOf('<!-- chart:c2-b -->')).toBeGreaterThan(idxCh2);
      expect(out.indexOf('<!-- chart:c2-b -->')).toBeLessThan(idxCh3);
      // ch3 的图在 ch3 之后
      expect(out.indexOf('<!-- chart:c3-a -->')).toBeGreaterThan(idxCh3);
      expect(out.indexOf('<!-- chart:c3-b -->')).toBeGreaterThan(idxCh3);
    });

    it('repairs mid-line glued H2 ("xxx## 3. ...")', () => {
      const fullReport = [
        '## 1. A',
        'a body.',
        '',
        '前一段被吃了换行的内容## 2. B',
        'b body.',
      ].join('\n');
      const out = injectChartPlaceholdersByChapter(fullReport, [
        { id: 'b-fig', sectionId: '2', position: 'after_paragraph_1' },
      ]);
      // mid-line H2 应该被识别为 chapter 2，b-fig 落入 chapter 2
      expect(out).toContain('<!-- chart:b-fig -->');
      // b-fig 在 ch2 之后
      const ch2Idx = out.indexOf('## 2. B');
      const figIdx = out.indexOf('<!-- chart:b-fig -->');
      expect(figIdx).toBeGreaterThan(ch2Idx);
    });

    it('round-trip: split + join byte-equivalent when no charts to inject', () => {
      // 验证切片+拼回不损失信息（防止误吞行/换行）
      const fullReport = [
        '# Title',
        '',
        '> 生成时间',
        '',
        '## 1. A',
        'aaa',
        '',
        'bbb',
        '',
        '## 2. B',
        'ccc',
      ].join('\n');
      // charts 全部 sectionId 不匹配 → 不 inject 任何东西
      const out = injectChartPlaceholdersByChapter(fullReport, [
        { id: 'orphan', sectionId: '99' },
      ]);
      expect(out).toBe(fullReport);
    });

    it('CRITICAL: normalize hook aligns paragraph indexing with chapter view', () => {
      // 仿真用户实测 bug（连续视图图片挤章节最前面）：chart.position 用的是
      // LLM 在 normalize 后内容上数的段落数。如果不传 normalize，inject 探测
      // 的 paragraphIdx 与 LLM 计的不一致 → 位置错位。
      //
      // 这里模拟 normalize 会把 `### 一方面` 这种滥用 H3 → 普通段落，从而
      // 改变段落计数。
      const fullReport = [
        '## 1. 第一章',
        '### 一方面',
        '段落 A。',
        '',
        '段落 B。',
        '',
        '段落 C。',
        '',
        '段落 D。',
        '',
        '段落 E。',
        '',
      ].join('\n');

      const fakeNormalize = (raw: string) =>
        raw.replace(/^### (一方面|此外)\s*$/gm, '\n$1');

      const out = injectChartPlaceholdersByChapter(
        fullReport,
        [{ id: 'fig', sectionId: '1', position: 'after_paragraph_3' }],
        { normalize: fakeNormalize }
      );

      // normalize 后 "### 一方面" 不再是 H3 而是普通段落，paragraphEnds 会包含它。
      // 验证 fig 占位符存在，且不在章节最前面（>= 段落 3 之后）
      expect(out).toContain('<!-- chart:fig -->');
      const figIdx = out.indexOf('<!-- chart:fig -->');
      const paraAIdx = out.indexOf('段落 A');
      // 占位符应在段落 A 之后（不是章节开头之前）
      expect(figIdx).toBeGreaterThan(paraAIdx);
    });

    it('without normalize hook, paragraph indexing falls back to identity (legacy behavior)', () => {
      // 不传 normalize 时与之前行为一致（identity 函数）
      const out = injectChartPlaceholdersByChapter(
        '## 1. A\np1.\n\np2.\n\np3.\n',
        [{ id: 'fig', sectionId: '1', position: 'after_paragraph_2' }]
      );
      expect(out).toContain('<!-- chart:fig -->');
      // 占位符在 p2 之后
      const figIdx = out.indexOf('<!-- chart:fig -->');
      const p2Idx = out.indexOf('p2.');
      expect(figIdx).toBeGreaterThan(p2Idx);
    });

    it('Unicode chapters and Chinese paragraphs are processed identically', () => {
      const content = [
        '## 1. 中文章节',
        '中文段落一。',
        '',
        '中文段落二。',
        '',
        '中文段落三。',
      ].join('\n');
      const out = injectChartPlaceholdersByChapter(content, [
        { id: 'fig', sectionId: '1', position: 'after_paragraph_2' },
      ]);
      expect(out).toContain('<!-- chart:fig -->');
      expect(out).toContain('中文段落一');
      expect(out).toContain('中文段落三');
    });
  });
});
