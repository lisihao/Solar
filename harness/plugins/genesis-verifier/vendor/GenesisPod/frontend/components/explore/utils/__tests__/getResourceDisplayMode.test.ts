import { getResourceDisplayMode } from '../utils';

/**
 * Comprehensive business scenario tests for getResourceDisplayMode.
 *
 * This is the SINGLE SOURCE OF TRUTH for PDF/HTML/YouTube routing.
 * Every Explore viewer component (ExploreContent, ExploreDetail, ContentPreview)
 * delegates to this function. If a test fails here, the UI is broken.
 */

// ─── Helper ───────────────────────────────────────────────────────────────────

function r(
  sourceUrl: string,
  pdfUrl?: string,
  type = 'PAPER'
): { type: string; sourceUrl: string; pdfUrl?: string } {
  return { type, sourceUrl, pdfUrl };
}

// ─── arXiv scenarios (the most common failure pattern) ────────────────────────

describe('arXiv papers', () => {
  it('abs page → PDF (pdfUrl extracted to /pdf/)', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://arxiv.org/abs/2602.14516v1',
          'https://arxiv.org/pdf/2602.14516v1.pdf'
        )
      )
    ).toBe('pdf');
  });

  it('html page with no pdfUrl → HTML', () => {
    expect(
      getResourceDisplayMode(r('https://arxiv.org/html/2602.14516v1'))
    ).toBe('html');
  });

  it('html page with pdfUrl pointing to /pdf/ → HTML (sourceUrl /html/ overrides)', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://arxiv.org/html/2602.14516v1',
          'https://arxiv.org/pdf/2602.14516v1.pdf'
        )
      )
    ).toBe('html');
  });

  it('html page where pdfUrl === sourceUrl (legacy bug data) → HTML', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://arxiv.org/html/2602.14516v1',
          'https://arxiv.org/html/2602.14516v1'
        )
      )
    ).toBe('html');
  });

  it('pdf direct link → PDF', () => {
    expect(
      getResourceDisplayMode(r('https://arxiv.org/pdf/2602.14516v1.pdf'))
    ).toBe('pdf');
  });

  it('pdf direct link with matching pdfUrl → PDF', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://arxiv.org/pdf/2602.14516v1.pdf',
          'https://arxiv.org/pdf/2602.14516v1.pdf'
        )
      )
    ).toBe('pdf');
  });
});

// ─── Other academic sources ───────────────────────────────────────────────────

describe('other academic sources', () => {
  it('OpenReview forum → HTML (no /pdf/ in either URL)', () => {
    expect(
      getResourceDisplayMode(r('https://openreview.net/forum?id=abc123'))
    ).toBe('html');
  });

  it('OpenReview with pdfUrl → PDF (pathname /pdf detected)', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://openreview.net/forum?id=abc123',
          'https://openreview.net/pdf?id=abc123'
        )
      )
    ).toBe('pdf');
  });

  it('OpenReview direct PDF link as sourceUrl → PDF', () => {
    expect(
      getResourceDisplayMode(r('https://openreview.net/pdf?id=0iLbiYYIpC'))
    ).toBe('pdf');
  });

  it('Semantic Scholar PDF → PDF', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://www.semanticscholar.org/paper/abc',
          'https://pdfs.semanticscholar.org/abc/def.pdf'
        )
      )
    ).toBe('pdf');
  });

  it('Nature HTML article → HTML', () => {
    expect(
      getResourceDisplayMode(
        r('https://www.nature.com/articles/s41586-024-07487-w')
      )
    ).toBe('html');
  });
});

// ─── Generic website scenarios ────────────────────────────────────────────────

describe('generic websites', () => {
  it('TrendForce insights (SPA) → HTML', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://www.trendforce.com/insights/memory-wall',
          undefined,
          'REPORT'
        )
      )
    ).toBe('html');
  });

  it('blog post → HTML', () => {
    expect(
      getResourceDisplayMode(
        r('https://example.com/blog/my-post', undefined, 'BLOG')
      )
    ).toBe('html');
  });

  it('news article → HTML', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://www.reuters.com/technology/ai-chips-2026/',
          undefined,
          'NEWS'
        )
      )
    ).toBe('html');
  });

  it('direct .pdf download → PDF (even non-PAPER type)', () => {
    expect(
      getResourceDisplayMode(
        r('https://example.com/reports/annual-2026.pdf', undefined, 'REPORT')
      )
    ).toBe('pdf');
  });

  it('mixed case .PDF extension → PDF', () => {
    expect(
      getResourceDisplayMode(
        r('https://example.com/file.PDF', undefined, 'REPORT')
      )
    ).toBe('pdf');
  });
});

// ─── YouTube ──────────────────────────────────────────────────────────────────

describe('YouTube', () => {
  it('YOUTUBE type → youtube', () => {
    expect(
      getResourceDisplayMode(
        r('https://www.youtube.com/watch?v=abc123', undefined, 'YOUTUBE')
      )
    ).toBe('youtube');
  });

  it('YOUTUBE_VIDEO type → youtube', () => {
    expect(
      getResourceDisplayMode(
        r('https://youtu.be/abc123', undefined, 'YOUTUBE_VIDEO')
      )
    ).toBe('youtube');
  });

  it('YouTube URL but type=BLOG → HTML (type matters)', () => {
    expect(
      getResourceDisplayMode(
        r('https://www.youtube.com/watch?v=abc123', undefined, 'BLOG')
      )
    ).toBe('html');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('no sourceUrl → none', () => {
    expect(
      getResourceDisplayMode({
        type: 'PAPER',
        sourceUrl: '',
        pdfUrl: undefined,
      })
    ).toBe('none');
  });

  it('pdfUrl set but not a PDF pattern → HTML', () => {
    expect(
      getResourceDisplayMode(
        r('https://example.com/paper', 'https://example.com/paper')
      )
    ).toBe('html');
  });

  it('pdfUrl with /pdf/ in path → PDF', () => {
    expect(
      getResourceDisplayMode(
        r('https://example.com/paper', 'https://example.com/pdf/12345')
      )
    ).toBe('pdf');
  });

  it('GitHub repo → HTML', () => {
    expect(
      getResourceDisplayMode(
        r('https://github.com/user/repo', undefined, 'GITHUB')
      )
    ).toBe('html');
  });

  it('WeChat article → HTML', () => {
    expect(
      getResourceDisplayMode(
        r('https://mp.weixin.qq.com/s/abc123', undefined, 'BLOG')
      )
    ).toBe('html');
  });

  it('sourceUrl with /html/ path segment always → HTML even with .pdf pdfUrl', () => {
    // Edge case: someone has an /html/ page but backend somehow set a .pdf pdfUrl
    expect(
      getResourceDisplayMode(
        r('https://example.com/html/paper-123', 'https://example.com/file.pdf')
      )
    ).toBe('html');
  });

  it('pdfUrl with /html/ path but sourceUrl is normal → HTML', () => {
    // Defensive: even if pdfUrl somehow has /html/ in it
    expect(
      getResourceDisplayMode(
        r('https://example.com/paper', 'https://arxiv.org/html/2602.14516v1')
      )
    ).toBe('html');
  });
});

// ─── Backend extractPdfUrl parity ─────────────────────────────────────────────

describe('backend parity: expected DB state after import', () => {
  it('arxiv /abs/ import → sourceUrl=abs, pdfUrl=pdf → PDF', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://arxiv.org/abs/2311.12345v1',
          'https://arxiv.org/pdf/2311.12345v1.pdf'
        )
      )
    ).toBe('pdf');
  });

  it('arxiv /html/ import → sourceUrl=html, pdfUrl=null → HTML', () => {
    expect(
      getResourceDisplayMode(
        r('https://arxiv.org/html/2311.12345v1', undefined)
      )
    ).toBe('html');
  });

  it('arxiv /pdf/ direct import → sourceUrl=pdf, pdfUrl=pdf → PDF', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://arxiv.org/pdf/2311.12345v1.pdf',
          'https://arxiv.org/pdf/2311.12345v1.pdf'
        )
      )
    ).toBe('pdf');
  });

  it('generic HTML website import → sourceUrl=url, pdfUrl=null → HTML', () => {
    expect(
      getResourceDisplayMode(
        r(
          'https://www.trendforce.com/insights/memory-wall',
          undefined,
          'REPORT'
        )
      )
    ).toBe('html');
  });
});
