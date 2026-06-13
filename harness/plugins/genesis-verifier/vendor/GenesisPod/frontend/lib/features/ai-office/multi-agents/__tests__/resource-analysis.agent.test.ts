import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/utils/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  ResourceAnalysisAgent,
  type ResourceAnalysis,
} from '../resource-analysis.agent';
import type { Resource } from '@/lib/types/ai-office';

// ============================================================================
// Test helpers
// ============================================================================

function makeAcademicResource(overrides: object = {}): Resource {
  return {
    id: 'res-academic-1',
    resourceType: 'academic_paper',
    url: 'https://arxiv.org/abs/2024.0001',
    metadata: {
      title: 'Deep Learning for NLP',
      authors: [
        { name: 'John Doe', affiliation: 'MIT' },
        { name: 'Jane Smith', affiliation: 'Stanford' },
      ],
      abstract:
        'A comprehensive study of deep learning methods applied to NLP tasks.',
      publishedAt: new Date('2024-01-15'),
      venue: 'Nature',
      doi: '10.1000/test',
      citations: 150,
      keywords: ['NLP', 'deep learning'],
    },
    content: {
      fullText: 'Full text of the paper about deep learning for NLP...',
      sections: [],
      figures: [],
      tables: [],
      equations: [],
      references: [],
    },
    credibilityScore: 0.95,
    relevanceScore: 0.9,
    aiAnalysis: {
      summary: '',
      contributions: [],
      methodology: '',
      results: '',
      limitations: [],
      futureWork: [],
      impact: 'high',
      field: 'AI',
      subfields: [],
    },
    ...overrides,
  } as unknown as Resource;
}

function makeWebPageResource(): Resource {
  return {
    id: 'res-web-1',
    resourceType: 'web_page',
    url: 'https://example.com/article',
    metadata: {
      title: 'AI Trends 2024',
      description: 'Top AI trends to watch in 2024.',
      publishedAt: new Date('2024-01-01'),
      language: 'en',
    },
    content: {
      cleanedText: 'AI is transforming industries at a rapid pace...',
      images: [],
      links: [],
    },
    credibilityScore: 0.7,
    relevanceScore: 0.8,
    aiAnalysis: {
      summary: '',
      mainTopics: [],
      keyInsights: [],
      credibility: 0.7,
    },
  } as unknown as Resource;
}

function makeApiResponse(overrides: object = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            insights: [
              'Deep learning improves NLP accuracy',
              'Transfer learning is key',
            ],
            findings: [
              {
                claim: 'BERT outperforms RNN by 15%',
                evidence: 'Benchmark on GLUE dataset',
                source: 'Deep Learning for NLP',
                confidence: 0.92,
              },
            ],
            visualOpportunities: [
              {
                type: 'chart',
                description: 'Accuracy comparison',
                dataHint: 'accuracy percentages',
              },
              { type: 'flow', description: 'Model architecture' },
            ],
            methodology: 'Empirical study with 10-fold cross validation',
            background: 'NLP has evolved rapidly with transformers',
            confidence: 0.88,
            ...overrides,
          }),
        },
      },
    ],
  };
}

// ============================================================================
// ResourceAnalysisAgent.analyze()
// ============================================================================

describe('ResourceAnalysisAgent.analyze()', () => {
  let agent: ResourceAnalysisAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new ResourceAnalysisAgent();
  });

  it('calls fetch with correct URL and method', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeApiResponse()),
    });

    await agent.analyze({
      resources: [makeAcademicResource()],
      analysisDepth: 'deep',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai/grok',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('includes Authorization header in request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeApiResponse()),
    });

    await agent.analyze({
      resources: [makeAcademicResource()],
      analysisDepth: 'shallow',
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('uses max_tokens 4000 for deep analysis', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeApiResponse()),
    });

    await agent.analyze({
      resources: [makeAcademicResource()],
      analysisDepth: 'deep',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(4000);
  });

  it('uses max_tokens 2000 for shallow analysis', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeApiResponse()),
    });

    await agent.analyze({
      resources: [makeAcademicResource()],
      analysisDepth: 'shallow',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.max_tokens).toBe(2000);
  });

  it('returns parsed analysis result on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeApiResponse()),
    });

    const result = await agent.analyze({
      resources: [makeAcademicResource()],
      analysisDepth: 'deep',
    });

    expect(result.insights).toHaveLength(2);
    expect(result.findings).toHaveLength(1);
    expect(result.visualOpportunities).toHaveLength(2);
    expect(result.confidence).toBe(0.88);
    expect(result.analyzedAt).toBeInstanceOf(Date);
  });

  it('returns fallback analysis on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await agent.analyze({
      resources: [makeAcademicResource()],
      analysisDepth: 'deep',
    });

    expect(result.confidence).toBe(0.5);
    expect(Array.isArray(result.insights)).toBe(true);
    expect(result.analyzedAt).toBeInstanceOf(Date);
  });

  it('returns fallback analysis when API response is non-ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const result = await agent.analyze({
      resources: [makeAcademicResource()],
      analysisDepth: 'deep',
    });

    expect(result.confidence).toBe(0.5);
  });

  it('returns fallback when content is null in response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: null } }] }),
    });

    const result = await agent.analyze({
      resources: [makeAcademicResource()],
      analysisDepth: 'deep',
    });

    expect(result.confidence).toBe(0.5);
  });

  it('extracts insights from resource titles in fallback', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    const result = await agent.analyze({
      resources: [makeAcademicResource(), makeWebPageResource()],
      analysisDepth: 'shallow',
    });

    // Fallback creates insights from titles
    expect(
      result.insights.some(
        (i) =>
          i.includes('Deep Learning for NLP') || i.includes('AI Trends 2024')
      )
    ).toBe(true);
  });

  it('fallback includes background with resource count', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    const result = await agent.analyze({
      resources: [makeAcademicResource(), makeWebPageResource()],
      analysisDepth: 'deep',
    });

    expect(result.background).toContain('2');
  });

  it('normalizes invalid visualOpportunity type to "chart"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  insights: [],
                  findings: [],
                  visualOpportunities: [
                    { type: 'unknown_type', description: 'test' },
                  ],
                  confidence: 0.7,
                }),
              },
            },
          ],
        }),
    });

    const result = await agent.analyze({
      resources: [],
      analysisDepth: 'deep',
    });
    expect(result.visualOpportunities[0].type).toBe('chart');
  });

  it('handles JSON embedded in surrounding text', async () => {
    const jsonStr = JSON.stringify({
      insights: ['insight 1'],
      findings: [],
      visualOpportunities: [],
      confidence: 0.75,
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: `Here's the analysis:\n${jsonStr}\nEnd of analysis.`,
              },
            },
          ],
        }),
    });

    const result = await agent.analyze({
      resources: [],
      analysisDepth: 'shallow',
    });
    expect(result.insights).toContain('insight 1');
  });

  it('includes focus in request body prompt when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeApiResponse()),
    });

    await agent.analyze({
      resources: [makeAcademicResource()],
      focus: 'machine learning efficiency',
      analysisDepth: 'deep',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const userMessage = body.messages.find(
      (m: { role: string }) => m.role === 'user'
    );
    expect(userMessage.content).toContain('machine learning efficiency');
  });

  it('filters non-string insights', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  insights: ['valid', 123, null, 'also valid'],
                  findings: [],
                  visualOpportunities: [],
                  confidence: 0.7,
                }),
              },
            },
          ],
        }),
    });

    const result = await agent.analyze({
      resources: [],
      analysisDepth: 'deep',
    });
    expect(result.insights).toEqual(['valid', 'also valid']);
  });
});

// ============================================================================
// ResourceAnalysisAgent static methods
// ============================================================================

describe('ResourceAnalysisAgent.getAnalysisSummary()', () => {
  const makeAnalysis = (
    overrides: Partial<ResourceAnalysis> = {}
  ): ResourceAnalysis => ({
    insights: ['insight 1', 'insight 2'],
    findings: [
      {
        claim: 'claim 1',
        evidence: 'evidence',
        source: 'source',
        confidence: 0.8,
      },
    ],
    visualOpportunities: [{ type: 'chart', description: 'chart' }],
    confidence: 0.82,
    analyzedAt: new Date(),
    ...overrides,
  });

  it('includes insight count', () => {
    const summary = ResourceAnalysisAgent.getAnalysisSummary(makeAnalysis());
    expect(summary).toContain('2个核心洞察');
  });

  it('includes findings count', () => {
    const summary = ResourceAnalysisAgent.getAnalysisSummary(makeAnalysis());
    expect(summary).toContain('1个关键发现');
  });

  it('includes visual opportunities count', () => {
    const summary = ResourceAnalysisAgent.getAnalysisSummary(makeAnalysis());
    expect(summary).toContain('1个可视化机会');
  });

  it('includes confidence percentage', () => {
    const summary = ResourceAnalysisAgent.getAnalysisSummary(makeAnalysis());
    expect(summary).toContain('82%');
  });

  it('omits zero-count sections', () => {
    const summary = ResourceAnalysisAgent.getAnalysisSummary(
      makeAnalysis({ insights: [], findings: [], visualOpportunities: [] })
    );
    expect(summary).not.toContain('核心洞察');
    expect(summary).not.toContain('关键发现');
    expect(summary).not.toContain('可视化机会');
    expect(summary).toContain('%');
  });
});

describe('ResourceAnalysisAgent.toPromptEnhancement()', () => {
  const makeAnalysis = (
    overrides: Partial<ResourceAnalysis> = {}
  ): ResourceAnalysis => ({
    insights: ['Deep learning works', 'Transfer learning is key'],
    findings: [
      {
        claim: 'BERT improves accuracy',
        evidence: 'GLUE benchmark',
        source: 'Test paper',
        confidence: 0.9,
      },
    ],
    visualOpportunities: [
      { type: 'chart', description: 'Accuracy chart', dataHint: 'metrics' },
    ],
    methodology: 'Cross-validation',
    confidence: 0.85,
    analyzedAt: new Date(),
    ...overrides,
  });

  it('includes 核心洞察 section', () => {
    const enhancement =
      ResourceAnalysisAgent.toPromptEnhancement(makeAnalysis());
    expect(enhancement).toContain('【核心洞察】');
    expect(enhancement).toContain('Deep learning works');
  });

  it('includes 关键发现 section with evidence', () => {
    const enhancement =
      ResourceAnalysisAgent.toPromptEnhancement(makeAnalysis());
    expect(enhancement).toContain('【关键发现】');
    expect(enhancement).toContain('BERT improves accuracy');
    expect(enhancement).toContain('GLUE benchmark');
  });

  it('includes 可视化建议 section', () => {
    const enhancement =
      ResourceAnalysisAgent.toPromptEnhancement(makeAnalysis());
    expect(enhancement).toContain('【可视化建议】');
    expect(enhancement).toContain('Accuracy chart');
  });

  it('includes 研究方法 section when methodology present', () => {
    const enhancement =
      ResourceAnalysisAgent.toPromptEnhancement(makeAnalysis());
    expect(enhancement).toContain('【研究方法】');
    expect(enhancement).toContain('Cross-validation');
  });

  it('omits 研究方法 section when methodology is undefined', () => {
    const enhancement = ResourceAnalysisAgent.toPromptEnhancement(
      makeAnalysis({ methodology: undefined })
    );
    expect(enhancement).not.toContain('【研究方法】');
  });

  it('includes confidence percentage in findings', () => {
    const enhancement =
      ResourceAnalysisAgent.toPromptEnhancement(makeAnalysis());
    expect(enhancement).toContain('90%');
  });

  it('returns empty string for empty analysis', () => {
    const enhancement = ResourceAnalysisAgent.toPromptEnhancement({
      insights: [],
      findings: [],
      visualOpportunities: [],
      confidence: 0.5,
      analyzedAt: new Date(),
    });
    expect(enhancement).toBe('');
  });
});
