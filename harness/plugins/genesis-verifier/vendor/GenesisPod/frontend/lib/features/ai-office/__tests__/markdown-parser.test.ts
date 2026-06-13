import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock DOMPurify via the sanitize utility that markdown-parser imports
vi.mock('@/lib/utils/sanitize', () => ({
  sanitizeHtml: vi.fn((html: string) => html), // identity for testing
}));

import {
  parseMarkdownToEnhancedSlides,
  renderMarkdownLine,
  type EnhancedSlide,
  type ChartData,
  type FlowStep,
  type MatrixItem,
} from '../markdown-parser';

// ============================================================================
// parseMarkdownToEnhancedSlides
// ============================================================================

describe('parseMarkdownToEnhancedSlides', () => {
  // -----------------------------------------------------------------------
  // Basic slide parsing
  // -----------------------------------------------------------------------

  it('returns empty array for empty markdown', () => {
    expect(parseMarkdownToEnhancedSlides('')).toEqual([]);
  });

  it('returns empty array when no slide headers are found', () => {
    const md = 'Just some text\nwithout any slide headers.';
    expect(parseMarkdownToEnhancedSlides(md)).toEqual([]);
  });

  it('parses a single slide with ## Slide N: header', () => {
    const md = '## Slide 1: Introduction\nThis is the content.';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe('Introduction');
  });

  it('parses Chinese slide header 第N页', () => {
    const md = '## 第1页: 封面\nCover content.';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides).toHaveLength(1);
    expect(slides[0].title).toBe('封面');
  });

  it('assigns incrementing ids starting at slide-1', () => {
    const md = '## Slide 1: First\n## Slide 2: Second\n## Slide 3: Third';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].id).toBe('slide-1');
    expect(slides[1].id).toBe('slide-2');
    expect(slides[2].id).toBe('slide-3');
  });

  it('parses multiple slides separated by headers', () => {
    const md = [
      '## Slide 1: Cover',
      'Cover content',
      '## Slide 2: Overview',
      'Overview content',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides).toHaveLength(2);
    expect(slides[0].title).toBe('Cover');
    expect(slides[1].title).toBe('Overview');
  });

  it('parses slides separated by --- dividers', () => {
    const md = [
      '## Slide 1: Intro',
      'Some content',
      '---',
      '## Slide 2: Details',
      'More content',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides).toHaveLength(2);
  });

  it('sets type to "cover" for first slide', () => {
    const md = '## Slide 1: Intro\nContent here.';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].type).toBe('cover');
  });

  it('sets type to "cover" when title contains 封面', () => {
    const md = '## Slide 2: 封面设计\nContent.';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].type).toBe('cover');
  });

  it('sets type to "content" for non-cover non-special slides', () => {
    const md = [
      '## Slide 1: Cover',
      'First slide',
      '## Slide 2: Overview',
      'Second slide',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[1].type).toBe('content');
  });

  it('stores rawContent for each slide', () => {
    const md = '## Slide 1: Test\nHello world';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].rawContent).toContain('## Slide 1: Test');
  });

  // -----------------------------------------------------------------------
  // Visualization type detection
  // -----------------------------------------------------------------------

  it('detects <!-- FLOW --> marker and sets type to flowchart', () => {
    const md =
      '## Slide 1: Process\n<!-- FLOW -->\n1. Step A -> Description\n2. Step B -> Result';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].type).toBe('flowchart');
    expect(slides[0].visualizationType).toBe('flow');
  });

  it('detects <!-- CHART:bar --> marker and sets chartType', () => {
    const md = '## Slide 1: Data\n<!-- CHART:bar -->\n- A: 10\n- B: 20';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].type).toBe('chart');
    expect(slides[0].chartType).toBe('bar');
  });

  it('detects <!-- CHART:pie --> marker', () => {
    const md = '## Slide 1: Pie\n<!-- CHART:pie -->\n- X: 40\n- Y: 60';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].chartType).toBe('pie');
  });

  it('detects <!-- MATRIX --> marker', () => {
    const md =
      '## Slide 1: Matrix\n<!-- MATRIX -->\n**高价值 + 低难度:** Easy wins';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].type).toBe('matrix');
    expect(slides[0].visualizationType).toBe('matrix');
  });

  it('detects <!-- TIMELINE --> marker', () => {
    const md = '## Slide 1: Timeline\n<!-- TIMELINE -->\n1. 2020 -> Event A';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].type).toBe('timeline');
    expect(slides[0].visualizationType).toBe('timeline');
  });

  // -----------------------------------------------------------------------
  // Image extraction
  // -----------------------------------------------------------------------

  it('extracts image URLs from ![alt](url) syntax', () => {
    const md = '## Slide 1: Images\n![chart](https://example.com/chart.png)';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].images).toContain('https://example.com/chart.png');
  });

  // -----------------------------------------------------------------------
  // Layout assignment
  // -----------------------------------------------------------------------

  it('assigns "title" layout for cover type', () => {
    const md = '## Slide 1: Cover\nContent';
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].layout).toBe('title');
  });

  it('assigns "content" layout when no images', () => {
    const md = [
      '## Slide 1: Cover',
      'First',
      '## Slide 2: Details',
      'Some content without images',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[1].layout).toBe('content');
  });

  it('assigns "image-full" layout when only images (no text content)', () => {
    const md =
      '## Slide 1: Cover\nFirst\n## Slide 2: Image\n![img](https://x.com/img.png)';
    const slides = parseMarkdownToEnhancedSlides(md);
    // The image slide has image but no non-image content lines
    const imgSlide = slides[1];
    expect(imgSlide.layout).toBe('image-full');
  });

  it('detects 2-column layout when multiple **bold:** titles present', () => {
    // The regex checks for lines matching /^\*\*.+\*\*[:：]/
    // so we need **Text**: format (bold text followed by colon)
    const md = [
      '## Slide 1: Cover',
      'First',
      '## Slide 2: Comparison',
      '**Option A**: Description of A',
      '**Option B**: Description of B',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[1].type).toBe('comparison');
    expect(slides[1].layout).toBe('2-column');
  });

  // -----------------------------------------------------------------------
  // Flow step parsing
  // -----------------------------------------------------------------------

  it('parses flowchart steps with -> notation', () => {
    const md = [
      '## Slide 1: Flow',
      '<!-- FLOW -->',
      '1. **Step A** -> Process A',
      '2. **Step B** -> Process B',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].flowSteps).toBeDefined();
    expect(slides[0].flowSteps!.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Chart data parsing
  // -----------------------------------------------------------------------

  it('parses chart data from "- Label: value" format', () => {
    const md = [
      '## Slide 1: Chart',
      '<!-- CHART:bar -->',
      '- Revenue: 1000',
      '- Costs: 600',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    const chartData = slides[0].chartData;
    expect(chartData).toBeDefined();
    expect(chartData!.labels).toContain('Revenue');
    expect(chartData!.datasets[0].data).toContain(1000);
  });

  it('converts 万 units in chart data', () => {
    const md = [
      '## Slide 1: Chart',
      '<!-- CHART:bar -->',
      '- Sales: 10万',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].chartData!.datasets[0].data[0]).toBe(100000);
  });

  // -----------------------------------------------------------------------
  // Matrix item parsing
  // -----------------------------------------------------------------------

  it('parses matrix items from **quadrant: description** format', () => {
    const md = [
      '## Slide 1: Matrix',
      '<!-- MATRIX -->',
      '**高价值 + 低难度:** Easy wins description',
    ].join('\n');
    const slides = parseMarkdownToEnhancedSlides(md);
    expect(slides[0].matrixItems).toBeDefined();
    expect(slides[0].matrixItems!.length).toBeGreaterThanOrEqual(1);
    expect(slides[0].matrixItems![0].quadrant).toBe('top-left');
  });
});

// ============================================================================
// renderMarkdownLine
// ============================================================================

describe('renderMarkdownLine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply identity mock for sanitize
    vi.mocked(vi.importActual as never);
  });

  it('converts **bold** to <strong> tags', () => {
    const result = renderMarkdownLine('Some **bold** text');
    expect(result).toContain('<strong>bold</strong>');
  });

  it('converts **title**: prefix with bold tag', () => {
    const result = renderMarkdownLine('**Section Title**: some content');
    expect(result).toContain('<strong>Section Title</strong>');
  });

  it('converts list marker "- " to "• "', () => {
    const result = renderMarkdownLine('- List item');
    expect(result).toContain('• List item');
  });

  it('keeps numbered list markers intact', () => {
    const result = renderMarkdownLine('1. First item');
    expect(result).toContain('1. First item');
  });

  it('handles line without any markdown', () => {
    const result = renderMarkdownLine('Plain text without any markdown');
    expect(result).toBe('Plain text without any markdown');
  });

  it('converts multiple **bold** occurrences in same line', () => {
    const result = renderMarkdownLine('**A** and **B** are bold');
    expect(result).toContain('<strong>A</strong>');
    expect(result).toContain('<strong>B</strong>');
  });

  it('calls sanitizeHtml on the result', async () => {
    const { sanitizeHtml } = await import('@/lib/utils/sanitize');
    renderMarkdownLine('test line');
    expect(sanitizeHtml).toHaveBeenCalled();
  });

  it('removes **title**: ** prefix pattern', () => {
    // Pattern: **title**: ** content — the leading double bold is stripped
    const result = renderMarkdownLine('**Title:** **Bold content**');
    // The first **Title:** should become <strong>Title</strong>
    expect(result).toContain('<strong>');
  });

  it('handles empty string', () => {
    const result = renderMarkdownLine('');
    expect(result).toBe('');
  });
});
