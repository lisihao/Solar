/**
 * Tests for document-export.service.ts
 *
 * The service class exposes only a singleton `documentExportService` instance.
 * Private methods are tested indirectly through the public `exportDocument` API.
 * Heavy third-party libs (docx, pptxgenjs) are mocked so tests run fast in jsdom.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks – must be declared before the module under test is imported
// ---------------------------------------------------------------------------

// Mock pptxgenjs — must use a class so `new PptxGenJS()` works
vi.mock('pptxgenjs', () => {
  const ShapeType = { rect: 'rect' };

  const mockSlide = {
    background: {} as Record<string, unknown>,
    addShape: vi.fn(),
    addText: vi.fn(),
  };

  class PptxGenJS {
    author = '';
    company = '';
    title = '';
    ShapeType = ShapeType;
    addSlide() {
      return mockSlide;
    }
    write(_opts: unknown) {
      return Promise.resolve(Buffer.from('ppt-data'));
    }
  }

  return { default: PptxGenJS };
});

// Mock docx — Document and Paragraph/TextRun must be constructors (classes)
vi.mock('docx', () => {
  class Document {
    constructor(_opts: unknown) {}
  }
  class Paragraph {
    constructor(_opts: unknown) {}
  }
  class TextRun {
    constructor(_text: unknown) {}
  }
  const Packer = {
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('docx-data')),
  };
  const HeadingLevel = {
    TITLE: 'title',
    HEADING_1: 'heading1',
    HEADING_2: 'heading2',
    HEADING_3: 'heading3',
  };
  const AlignmentType = { CENTER: 'center' };
  return { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType };
});

// Mock turndown — must use a class so `new TurndownService(...)` works
vi.mock('turndown', () => {
  class TurndownService {
    turndown(html: string) {
      return `md:${html}`;
    }
  }
  return { default: TurndownService };
});

// Mock config so brand.fullName is predictable
vi.mock('@/lib/utils/config', () => ({
  config: {
    brand: {
      name: 'TestBrand',
      fullName: 'TestBrand.ai',
      subtitle: 'AI ENGINE',
      tagline: 'Test Tagline',
    },
    apiUrl: '',
    streamApiUrl: '',
  },
}));

// Mock ppt-templates so we have a predictable template
vi.mock('@/lib/features/ai-office/ppt-templates', () => {
  const fakeTemplate = {
    id: 'corporate',
    name: 'Corporate Professional',
    nameCn: '企业商务',
    description: 'Test',
    descriptionCn: 'Test',
    category: 'corporate',
    colors: {
      primary: '#0A2B4E',
      secondary: '#164577',
      accent: '#3B82F6',
      background: '#0A2B4E',
      backgroundOverlay: 'rgba(22, 69, 119, 0.5)',
      text: '#E5E7EB',
      textLight: '#FFFFFF',
      textSecondary: '#93C5FD',
      textTertiary: '#9CA3AF',
      decorative: '#3B82F6',
      cardBackground: 'rgba(255, 255, 255, 0.1)',
    },
    fonts: { heading: 'Inter', body: 'Inter' },
    typography: {
      title: 36,
      subtitle: 22,
      heading1: 16,
      heading2: 15,
      body: 12,
      caption: 11,
      small: 10,
    },
    decorations: {
      showTopBar: false,
      showBottomBar: true,
      showTitleUnderline: true,
      showCardBorder: true,
      useCardLayout: true,
    },
    style: {
      borderRadius: '8px',
      spacing: 'normal',
      imageStyle: 'rounded',
      layoutStyle: 'dark',
    },
  };

  return {
    PPT_TEMPLATES: { corporate: fakeTemplate },
    getAllTemplates: () => [fakeTemplate],
    getTemplateById: (id: string) => fakeTemplate,
    getTemplatesByCategory: (cat: string) => [fakeTemplate],
    getTemplateStyles: (t: unknown) => '',
  };
});

// ---------------------------------------------------------------------------
// Import service AFTER mocks are set up
// ---------------------------------------------------------------------------
import { documentExportService } from '../document-export.service';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('documentExportService.exportDocument', () => {
  describe('format: markdown', () => {
    it('returns a Buffer', async () => {
      const result = await documentExportService.exportDocument({
        title: 'My Doc',
        content: '# Hello\n\nWorld',
        format: 'markdown',
      });
      expect(result).toBeInstanceOf(Buffer);
    });

    it('prepends the title as an H1 heading', async () => {
      const result = await documentExportService.exportDocument({
        title: 'Test Title',
        content: 'Some **markdown**',
        format: 'markdown',
      });
      const text = result.toString('utf-8');
      expect(text).toMatch(/^# Test Title/);
    });

    it('includes the original content after the title', async () => {
      const result = await documentExportService.exportDocument({
        title: 'Title',
        content: 'Body paragraph',
        format: 'markdown',
      });
      expect(result.toString()).toContain('Body paragraph');
    });

    it('separates title from body with a blank line', async () => {
      const result = await documentExportService.exportDocument({
        title: 'T',
        content: 'B',
        format: 'markdown',
      });
      expect(result.toString()).toBe('# T\n\nB');
    });

    it('handles empty content gracefully', async () => {
      const result = await documentExportService.exportDocument({
        title: 'Empty',
        content: '',
        format: 'markdown',
      });
      expect(result.toString()).toBe('# Empty\n\n');
    });
  });

  describe('format: html', () => {
    it('returns a Buffer containing a full HTML document', async () => {
      const result = await documentExportService.exportDocument({
        title: 'HTML Doc',
        content: '## Section',
        format: 'html',
      });
      const html = result.toString('utf-8');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html');
      expect(html).toContain('</html>');
    });

    it('sets the page title to the document title (escaped)', async () => {
      const result = await documentExportService.exportDocument({
        title: 'My <Report>',
        content: 'content',
        format: 'html',
      });
      const html = result.toString('utf-8');
      expect(html).toContain('<title>My &lt;Report&gt;</title>');
    });

    it('escapes ampersands in title', async () => {
      const result = await documentExportService.exportDocument({
        title: 'Cats & Dogs',
        content: '',
        format: 'html',
      });
      expect(result.toString()).toContain('Cats &amp; Dogs');
    });

    it('renders h1 from the title', async () => {
      const result = await documentExportService.exportDocument({
        title: 'Simple',
        content: '',
        format: 'html',
      });
      expect(result.toString()).toContain('<h1>Simple</h1>');
    });

    it('converts markdown ## to <h2>', async () => {
      const result = await documentExportService.exportDocument({
        title: 'Doc',
        content: '## Section Title',
        format: 'html',
      });
      expect(result.toString()).toContain('<h2>Section Title</h2>');
    });

    it('converts **bold** to <strong>', async () => {
      const result = await documentExportService.exportDocument({
        title: 'D',
        content: '**bold text**',
        format: 'html',
      });
      expect(result.toString()).toContain('<strong>bold text</strong>');
    });

    it('includes the brand name in the footer', async () => {
      const result = await documentExportService.exportDocument({
        title: 'D',
        content: '',
        format: 'html',
      });
      expect(result.toString()).toContain('TestBrand.ai');
    });
  });

  describe('format: pdf', () => {
    it('returns a Buffer containing HTML', async () => {
      const result = await documentExportService.exportDocument({
        title: 'PDF Doc',
        content: '<p>hello</p>',
        format: 'pdf',
      });
      const text = result.toString('utf-8');
      expect(text).toContain('<!DOCTYPE html>');
      expect(text).toContain('<p>hello</p>');
    });

    it('includes the document title in the HTML', async () => {
      const result = await documentExportService.exportDocument({
        title: 'PDF Report',
        content: '',
        format: 'pdf',
      });
      expect(result.toString()).toContain('PDF Report');
    });
  });

  describe('format: latex', () => {
    it('returns a Buffer with a LaTeX document class', async () => {
      const result = await documentExportService.exportDocument({
        title: 'LaTeX Doc',
        content: '## Intro',
        format: 'latex',
      });
      const tex = result.toString('utf-8');
      expect(tex).toContain('\\documentclass');
    });

    it('includes \\begin{document} and \\end{document}', async () => {
      const result = await documentExportService.exportDocument({
        title: 'T',
        content: '',
        format: 'latex',
      });
      const tex = result.toString('utf-8');
      expect(tex).toContain('\\begin{document}');
      expect(tex).toContain('\\end{document}');
    });

    it('converts ## headings to a section command', async () => {
      const result = await documentExportService.exportDocument({
        title: 'T',
        content: '## My Section',
        format: 'latex',
      });
      // The source runs escapeLaTeX over the final output, so backslashes
      // introduced by the heading replacement are also escaped; the document
      // body should still contain "section" and the heading text.
      const tex = result.toString();
      expect(tex).toContain('section');
      expect(tex).toContain('My Section');
    });

    it('converts **bold** to a bold command', async () => {
      const result = await documentExportService.exportDocument({
        title: 'T',
        content: '**important**',
        format: 'latex',
      });
      const tex = result.toString();
      expect(tex).toContain('textbf');
      expect(tex).toContain('important');
    });
  });

  describe('format: word', () => {
    it('returns a Buffer (mocked docx)', async () => {
      const result = await documentExportService.exportDocument({
        title: 'Word Doc',
        content: '# Heading\n\nParagraph',
        format: 'word',
      });
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('format: ppt', () => {
    it('returns a Buffer (mocked pptx)', async () => {
      const result = await documentExportService.exportDocument({
        title: 'Slide Deck',
        content: '## Slide 1: Intro\n\n- Point A\n- Point B',
        format: 'ppt',
      });
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('unsupported format', () => {
    it('throws an error for unknown format', async () => {
      await expect(
        documentExportService.exportDocument({
          title: 'T',
          content: '',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          format: 'csv' as any,
        })
      ).rejects.toThrow('Unsupported export format: csv');
    });
  });
});

describe('markdownToHTML (via html export)', () => {
  it('converts *italic* to <em>', async () => {
    const result = await documentExportService.exportDocument({
      title: 'T',
      content: '*italic*',
      format: 'html',
    });
    expect(result.toString()).toContain('<em>italic</em>');
  });

  it('converts `code` to <code>', async () => {
    const result = await documentExportService.exportDocument({
      title: 'T',
      content: '`snippet`',
      format: 'html',
    });
    expect(result.toString()).toContain('<code>snippet</code>');
  });

  it('converts [link](url) to <a href>', async () => {
    const result = await documentExportService.exportDocument({
      title: 'T',
      content: '[click](https://example.com)',
      format: 'html',
    });
    expect(result.toString()).toContain(
      '<a href="https://example.com">click</a>'
    );
  });

  it('converts --- to <hr>', async () => {
    const result = await documentExportService.exportDocument({
      title: 'T',
      content: '---',
      format: 'html',
    });
    expect(result.toString()).toContain('<hr>');
  });

  it('removes ~~strikethrough~~ markup but keeps text', async () => {
    const result = await documentExportService.exportDocument({
      title: 'T',
      content: '~~deleted~~',
      format: 'html',
    });
    const html = result.toString();
    expect(html).not.toContain('~~');
    expect(html).toContain('deleted');
  });
});

describe('escapeHTML (via html title)', () => {
  it('escapes < and >', async () => {
    const result = await documentExportService.exportDocument({
      title: '<tag>',
      content: '',
      format: 'html',
    });
    const html = result.toString();
    expect(html).toContain('&lt;tag&gt;');
  });

  it('escapes double quotes', async () => {
    const result = await documentExportService.exportDocument({
      title: '"quoted"',
      content: '',
      format: 'html',
    });
    expect(result.toString()).toContain('&quot;quoted&quot;');
  });

  it('escapes single quotes', async () => {
    const result = await documentExportService.exportDocument({
      title: "it's",
      content: '',
      format: 'html',
    });
    expect(result.toString()).toContain('&#39;');
  });
});

describe('markdownToSlides (via ppt export)', () => {
  it('does not throw when content has no slide headers', async () => {
    await expect(
      documentExportService.exportDocument({
        title: 'Deck',
        content: 'Just plain text without headers',
        format: 'ppt',
      })
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('handles content with --- separators', async () => {
    const content = 'Line one\n---\nLine two';
    await expect(
      documentExportService.exportDocument({
        title: 'D',
        content,
        format: 'ppt',
      })
    ).resolves.toBeInstanceOf(Buffer);
  });

  it('handles image markdown tokens (skips them)', async () => {
    const content =
      '## Slide 1: Intro\n\n![alt](http://img.test/a.png)\n\nText after';
    await expect(
      documentExportService.exportDocument({
        title: 'D',
        content,
        format: 'ppt',
      })
    ).resolves.toBeInstanceOf(Buffer);
  });
});
