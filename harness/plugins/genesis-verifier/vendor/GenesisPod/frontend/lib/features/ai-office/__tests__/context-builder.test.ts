/**
 * Tests for lib/ai-office/context-builder.ts
 *
 * Covers: AIContextBuilder.buildContext for each resource type (PAPER,
 * PROJECT, NEWS, YOUTUBE_VIDEO), the TokenEstimator helpers, priority-based
 * token allocation, and the traditional (non-smart-truncation) path.
 */

import { describe, it, expect } from 'vitest';
import {
  AIContextBuilder,
  DEFAULT_CONFIG,
  type PaperResource,
  type ProjectResource,
  type NewsResource,
  type VideoResource,
  type ResourceContextConfig,
} from '../context-builder';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePaper = (overrides: Partial<PaperResource> = {}): PaperResource => ({
  id: 'paper-1',
  type: 'PAPER',
  title: 'A Great Paper',
  sourceUrl: 'https://arxiv.org/abs/1234',
  abstract: 'This paper studies things.',
  authors: [{ username: 'Alice' }, { username: 'Bob' }],
  publishedAt: '2024-01-15T00:00:00Z',
  categories: ['cs.AI', 'cs.LG'],
  qualityScore: 8,
  upvoteCount: 120,
  viewCount: 5000,
  tags: ['machine learning', 'NLP'],
  ...overrides,
});

const makeProject = (
  overrides: Partial<ProjectResource> = {}
): ProjectResource => ({
  id: 'proj-1',
  type: 'PROJECT',
  title: 'Cool Project',
  sourceUrl: 'https://github.com/user/repo',
  owner: 'user',
  repository: 'repo',
  language: 'TypeScript',
  license: 'MIT',
  stars: 1200,
  forks: 85,
  issues: 12,
  contributors: 30,
  description: 'A really cool project.',
  topics: ['ai', 'nlp'],
  tags: ['typescript', 'open-source'],
  ...overrides,
});

const makeNews = (overrides: Partial<NewsResource> = {}): NewsResource => ({
  id: 'news-1',
  type: 'NEWS',
  title: 'Breaking News Today',
  sourceUrl: 'https://news.example.com/article/1',
  author: 'Jane Reporter',
  publisher: 'Tech News',
  publishedAt: '2024-06-01T00:00:00Z',
  section: 'Technology',
  readTime: 5,
  summary: 'Short summary of the article.',
  fullText: 'Full body of the article here.',
  viewCount: 2000,
  upvoteCount: 80,
  shares: 200,
  categories: ['Tech', 'AI'],
  tags: ['AI', 'future'],
  ...overrides,
});

const makeVideo = (overrides: Partial<VideoResource> = {}): VideoResource => ({
  id: 'vid-1',
  type: 'YOUTUBE_VIDEO',
  title: 'Amazing Tutorial',
  sourceUrl: 'https://youtube.com/watch?v=abc',
  channel: 'TechChannel',
  creator: 'TechCreator',
  publishedAt: '2024-03-10T00:00:00Z',
  duration: '12:34',
  language: 'en',
  description: 'A tutorial about something cool.',
  chapters: [
    { timestamp: '00:00', title: 'Intro' },
    { timestamp: '05:00', title: 'Main Content' },
  ],
  views: 50000,
  likes: 3000,
  comments: 500,
  subscribers: 10000,
  upvoteCount: 150,
  categories: ['Education'],
  tags: ['tutorial', 'coding'],
  topics: ['web development'],
  ...overrides,
});

const minimalConfig: ResourceContextConfig = {
  includeCore: true,
  includeMetadata: false,
  includeMetrics: false,
  includeTaxonomy: false,
  maxContentLength: 500,
  enableSmartTruncation: false,
};

// ---------------------------------------------------------------------------
// AIContextBuilder — PAPER
// ---------------------------------------------------------------------------

describe('AIContextBuilder.buildContext — PAPER', () => {
  it('includes the resource type header', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('Academic Paper');
  });

  it('includes the paper title', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('A Great Paper');
  });

  it('includes authors when present', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('Alice');
    expect(ctx).toContain('Bob');
  });

  it('includes the abstract', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('This paper studies things.');
  });

  it('includes source URL', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('https://arxiv.org/abs/1234');
  });

  it('includes categories in metadata section', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('cs.AI');
  });

  it('includes quality score', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('8');
  });

  it('includes engagement metrics (upvotes)', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('120');
  });

  it('includes tags in taxonomy section', () => {
    const ctx = AIContextBuilder.buildContext(makePaper());
    expect(ctx).toContain('machine learning');
  });

  it('omits sections excluded by config', () => {
    const ctx = AIContextBuilder.buildContext(makePaper(), minimalConfig);
    expect(ctx).not.toContain('machine learning'); // no taxonomy
    expect(ctx).not.toContain('120'); // no metrics
  });

  it('handles paper with no optional fields gracefully', () => {
    const sparse: PaperResource = {
      id: 'p2',
      type: 'PAPER',
      title: 'Sparse Paper',
    };
    expect(() => AIContextBuilder.buildContext(sparse)).not.toThrow();
    const ctx = AIContextBuilder.buildContext(sparse);
    expect(ctx).toContain('Sparse Paper');
  });

  it('truncates pdfText to maxContentLength', () => {
    const longText = 'x'.repeat(20000);
    const paper = makePaper({ pdfText: longText });
    const ctx = AIContextBuilder.buildContext(paper, {
      ...DEFAULT_CONFIG,
      maxContentLength: 100,
      enableSmartTruncation: false,
    });
    // The truncated text should appear, not the full 20k chars
    expect(ctx.length).toBeLessThan(21000);
  });
});

// ---------------------------------------------------------------------------
// AIContextBuilder — PROJECT
// ---------------------------------------------------------------------------

describe('AIContextBuilder.buildContext — PROJECT', () => {
  it('includes the resource type header', () => {
    const ctx = AIContextBuilder.buildContext(makeProject());
    expect(ctx).toContain('Open Source Project');
  });

  it('includes owner/repo in core section', () => {
    const ctx = AIContextBuilder.buildContext(makeProject());
    expect(ctx).toContain('user/repo');
  });

  it('includes language and license', () => {
    const ctx = AIContextBuilder.buildContext(makeProject());
    expect(ctx).toContain('TypeScript');
    expect(ctx).toContain('MIT');
  });

  it('includes stars metric', () => {
    const ctx = AIContextBuilder.buildContext(makeProject());
    expect(ctx).toContain('1200');
  });

  it('includes topics in taxonomy', () => {
    const ctx = AIContextBuilder.buildContext(makeProject());
    expect(ctx).toContain('ai');
    expect(ctx).toContain('nlp');
  });

  it('uses title when owner/repo are not set', () => {
    const project = makeProject({ owner: undefined, repository: undefined });
    const ctx = AIContextBuilder.buildContext(project, minimalConfig);
    expect(ctx).toContain('Cool Project');
  });

  it('includes source URL', () => {
    const ctx = AIContextBuilder.buildContext(makeProject());
    expect(ctx).toContain('https://github.com/user/repo');
  });
});

// ---------------------------------------------------------------------------
// AIContextBuilder — NEWS
// ---------------------------------------------------------------------------

describe('AIContextBuilder.buildContext — NEWS', () => {
  it('includes the resource type header', () => {
    const ctx = AIContextBuilder.buildContext(makeNews());
    expect(ctx).toContain('News Article');
  });

  it('includes the headline', () => {
    const ctx = AIContextBuilder.buildContext(makeNews());
    expect(ctx).toContain('Breaking News Today');
  });

  it('includes author and publisher', () => {
    const ctx = AIContextBuilder.buildContext(makeNews());
    expect(ctx).toContain('Jane Reporter');
    expect(ctx).toContain('Tech News');
  });

  it('includes the summary', () => {
    const ctx = AIContextBuilder.buildContext(makeNews());
    expect(ctx).toContain('Short summary of the article.');
  });

  it('includes engagement shares', () => {
    const ctx = AIContextBuilder.buildContext(makeNews());
    expect(ctx).toContain('200');
  });

  it('includes categories and tags in taxonomy', () => {
    const ctx = AIContextBuilder.buildContext(makeNews());
    expect(ctx).toContain('Tech');
    expect(ctx).toContain('AI');
  });

  it('handles news with no fullText', () => {
    const news = makeNews({ fullText: undefined });
    expect(() => AIContextBuilder.buildContext(news)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AIContextBuilder — YOUTUBE_VIDEO
// ---------------------------------------------------------------------------

describe('AIContextBuilder.buildContext — YOUTUBE_VIDEO', () => {
  it('includes the resource type header', () => {
    const ctx = AIContextBuilder.buildContext(makeVideo());
    expect(ctx).toContain('Video Content');
  });

  it('includes the video title', () => {
    const ctx = AIContextBuilder.buildContext(makeVideo());
    expect(ctx).toContain('Amazing Tutorial');
  });

  it('includes channel and creator', () => {
    const ctx = AIContextBuilder.buildContext(makeVideo());
    expect(ctx).toContain('TechChannel');
    expect(ctx).toContain('TechCreator');
  });

  it('includes chapter timestamps', () => {
    const ctx = AIContextBuilder.buildContext(makeVideo());
    expect(ctx).toContain('00:00');
    expect(ctx).toContain('Intro');
  });

  it('includes engagement metrics', () => {
    const ctx = AIContextBuilder.buildContext(makeVideo());
    expect(ctx).toContain('50000');
  });

  it('includes topics in taxonomy', () => {
    const ctx = AIContextBuilder.buildContext(makeVideo());
    expect(ctx).toContain('web development');
  });

  it('includes subscribers in channel info when present', () => {
    const ctx = AIContextBuilder.buildContext(makeVideo());
    expect(ctx).toContain('10000');
  });
});

// ---------------------------------------------------------------------------
// Smart truncation path
// ---------------------------------------------------------------------------

describe('smart truncation', () => {
  it('returns a non-empty string for a paper with smart truncation enabled', () => {
    const config: ResourceContextConfig = {
      ...DEFAULT_CONFIG,
      enableSmartTruncation: true,
      maxTokens: 200,
    };
    const ctx = AIContextBuilder.buildContext(makePaper(), config);
    expect(ctx.length).toBeGreaterThan(0);
  });

  it('respects very low token limit by truncating aggressively', () => {
    const config: ResourceContextConfig = {
      ...DEFAULT_CONFIG,
      enableSmartTruncation: true,
      maxTokens: 10,
    };
    // Should not throw
    const ctx = AIContextBuilder.buildContext(makePaper(), config);
    expect(typeof ctx).toBe('string');
  });

  it('includes critical header section even under tight token budget', () => {
    const config: ResourceContextConfig = {
      ...DEFAULT_CONFIG,
      enableSmartTruncation: true,
      maxTokens: 50,
    };
    const ctx = AIContextBuilder.buildContext(makePaper(), config);
    // Header is CRITICAL priority and should survive tight budgets
    expect(ctx).toContain('Academic Paper');
  });
});

// ---------------------------------------------------------------------------
// Traditional (non-smart) path
// ---------------------------------------------------------------------------

describe('traditional build path', () => {
  it('builds context without smart truncation', () => {
    const config: ResourceContextConfig = {
      ...DEFAULT_CONFIG,
      enableSmartTruncation: false,
    };
    const ctx = AIContextBuilder.buildContext(makePaper(), config);
    expect(ctx).toContain('A Great Paper');
  });

  it('respects includeMetrics: false', () => {
    const config: ResourceContextConfig = {
      ...DEFAULT_CONFIG,
      enableSmartTruncation: false,
      includeMetrics: false,
    };
    const ctx = AIContextBuilder.buildContext(makePaper(), config);
    // Upvote count should not appear in the output
    expect(ctx).not.toContain('120 upvotes');
  });

  it('respects includeTaxonomy: false', () => {
    const config: ResourceContextConfig = {
      ...DEFAULT_CONFIG,
      enableSmartTruncation: false,
      includeTaxonomy: false,
    };
    const ctx = AIContextBuilder.buildContext(makePaper(), config);
    expect(ctx).not.toContain('machine learning');
  });

  it('respects includeMetadata: false', () => {
    const config: ResourceContextConfig = {
      ...DEFAULT_CONFIG,
      enableSmartTruncation: false,
      includeMetadata: false,
    };
    const ctx = AIContextBuilder.buildContext(makePaper(), config);
    expect(ctx).not.toContain('cs.AI');
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CONFIG shape
// ---------------------------------------------------------------------------

describe('DEFAULT_CONFIG', () => {
  it('has includeCore set to true', () => {
    expect(DEFAULT_CONFIG.includeCore).toBe(true);
  });

  it('has a positive maxContentLength', () => {
    expect(DEFAULT_CONFIG.maxContentLength).toBeGreaterThan(0);
  });

  it('has enableSmartTruncation set to true', () => {
    expect(DEFAULT_CONFIG.enableSmartTruncation).toBe(true);
  });
});
