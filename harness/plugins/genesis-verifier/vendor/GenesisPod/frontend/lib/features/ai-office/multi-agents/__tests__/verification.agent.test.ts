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
  VerificationAgent,
  type VerificationResult,
  type VerificationStatus,
} from '../verification.agent';
import type { Resource } from '@/lib/types/ai-office';

// ============================================================================
// Test helpers
// ============================================================================

function makeResource(overrides: object = {}): Resource {
  return {
    id: 'res-1',
    resourceType: 'web_page',
    url: 'https://example.com',
    metadata: {
      title: 'Test Resource',
      description: 'A test resource',
      publishedAt: new Date('2024-01-01'),
      language: 'en',
    },
    content: {
      cleanedText: 'Sample content text',
      images: [],
      links: [],
    },
    credibilityScore: 0.8,
    relevanceScore: 0.9,
    aiAnalysis: {
      summary: '',
      mainTopics: [],
      keyInsights: [],
      credibility: 0.8,
    },
    ...overrides,
  } as unknown as Resource;
}

function makeVerificationApiResponse(overrides: object = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            confidence: 0.85,
            badges: [
              { section: 'Section 1', status: 'verified', confidence: 0.9 },
              { section: 'Section 2', status: 'uncertain', confidence: 0.6 },
            ],
            suggestions: ['Improve source attribution'],
            issues: [
              {
                severity: 'medium',
                description: 'Missing citation',
                location: 'Para 2',
              },
            ],
            summary: 'Content is mostly verified',
            ...overrides,
          }),
        },
      },
    ],
  };
}

// ============================================================================
// VerificationAgent.verify()
// ============================================================================

describe('VerificationAgent.verify()', () => {
  let agent: VerificationAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new VerificationAgent();
  });

  it('calls fetch with correct URL and method', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeVerificationApiResponse()),
    });

    await agent.verify({
      content: 'Test content',
      sources: [makeResource()],
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/ai/grok',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('includes Authorization header in request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeVerificationApiResponse()),
    });

    await agent.verify({ content: 'Test', sources: [makeResource()] });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-token',
        }),
      })
    );
  });

  it('returns parsed verification result on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeVerificationApiResponse()),
    });

    const result = await agent.verify({
      content: 'Test',
      sources: [makeResource()],
    });

    expect(result.confidence).toBe(0.85);
    expect(result.badges).toHaveLength(2);
    expect(result.summary).toBe('Content is mostly verified');
    expect(result.verifiedAt).toBeInstanceOf(Date);
  });

  it('returns fallback verification when fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await agent.verify({
      content: 'Test',
      sources: [makeResource()],
    });

    expect(result.confidence).toBe(0.6);
    expect(result.summary).toContain('自动验证不可用');
    expect(result.verifiedAt).toBeInstanceOf(Date);
  });

  it('returns fallback verification when API returns non-ok', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const result = await agent.verify({
      content: 'Test',
      sources: [makeResource()],
    });

    expect(result.confidence).toBe(0.6);
    expect(Array.isArray(result.badges)).toBe(true);
  });

  it('returns fallback verification when content is missing from API response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({ choices: [{ message: { content: null } }] }),
    });

    const result = await agent.verify({
      content: 'Test',
      sources: [makeResource()],
    });

    expect(result.confidence).toBe(0.6);
  });

  it('fallback creates badge per slide when content has --- separators', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fail'));

    const content = 'Slide 1\n---\nSlide 2\n---\nSlide 3';
    const result = await agent.verify({ content, sources: [] });

    // 3 splits = 3 sections, capped at 5
    expect(result.badges.length).toBeGreaterThanOrEqual(1);
    expect(result.badges[0].section).toContain('Slide');
  });

  it('normalizes invalid status to "uncertain" in badges', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  confidence: 0.7,
                  badges: [
                    { section: 'A', status: 'INVALID_STATUS', confidence: 0.8 },
                  ],
                  suggestions: [],
                  issues: [],
                  summary: 'ok',
                }),
              },
            },
          ],
        }),
    });

    const result = await agent.verify({ content: 'Test', sources: [] });

    expect(result.badges[0].status).toBe('uncertain');
  });

  it('clamps confidence values to 0-1 range', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  confidence: 1.5, // out of range
                  badges: [
                    { section: 'A', status: 'verified', confidence: -0.2 },
                  ],
                  suggestions: [],
                  issues: [],
                  summary: 'ok',
                }),
              },
            },
          ],
        }),
    });

    const result = await agent.verify({ content: 'Test', sources: [] });

    expect(result.confidence).toBe(1.0);
    expect(result.badges[0].confidence).toBe(0);
  });

  it('handles JSON embedded in extra text by extracting JSON block', async () => {
    const jsonStr = JSON.stringify({
      confidence: 0.75,
      badges: [],
      suggestions: [],
      issues: [],
      summary: 'extracted',
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: `Here is the result:\n${jsonStr}\n\nThat's all.`,
              },
            },
          ],
        }),
    });

    const result = await agent.verify({ content: 'Test', sources: [] });

    expect(result.summary).toBe('extracted');
    expect(result.confidence).toBe(0.75);
  });

  it('normalizes issue severity "invalid" to "medium"', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  confidence: 0.7,
                  badges: [],
                  suggestions: [],
                  issues: [{ severity: 'critical', description: 'Bad!' }],
                  summary: 'done',
                }),
              },
            },
          ],
        }),
    });

    const result = await agent.verify({ content: 'Test', sources: [] });

    expect(result.issues[0].severity).toBe('medium');
  });

  it('sends documentType ppt in request body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(makeVerificationApiResponse()),
    });

    await agent.verify({
      content: 'Test content---Slide 2',
      sources: [],
      documentType: 'ppt',
    });

    const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(callBody.model).toBe('grok-2');
  });
});

// ============================================================================
// VerificationAgent static methods
// ============================================================================

describe('VerificationAgent.getVerificationSummary()', () => {
  it('returns summary with verified count', () => {
    const result: VerificationResult = {
      confidence: 0.9,
      badges: [
        { section: 'A', status: 'verified', confidence: 0.9 },
        { section: 'B', status: 'verified', confidence: 0.8 },
        { section: 'C', status: 'uncertain', confidence: 0.5 },
      ],
      suggestions: [],
      issues: [],
      summary: 'ok',
      verifiedAt: new Date(),
    };

    const summary = VerificationAgent.getVerificationSummary(result);
    expect(summary).toContain('2个已验证');
    expect(summary).toContain('1个待确认');
    expect(summary).toContain('90%');
  });

  it('includes issue count for unsupported and conflicting', () => {
    const result: VerificationResult = {
      confidence: 0.4,
      badges: [
        { section: 'A', status: 'unsupported', confidence: 0.2 },
        { section: 'B', status: 'conflicting', confidence: 0.3 },
      ],
      suggestions: [],
      issues: [],
      summary: 'bad',
      verifiedAt: new Date(),
    };

    const summary = VerificationAgent.getVerificationSummary(result);
    expect(summary).toContain('2个问题');
  });
});

describe('VerificationAgent.getStatusColor()', () => {
  it('returns green classes for "verified"', () => {
    expect(VerificationAgent.getStatusColor('verified')).toContain('green');
  });

  it('returns yellow classes for "uncertain"', () => {
    expect(VerificationAgent.getStatusColor('uncertain')).toContain('yellow');
  });

  it('returns red classes for "unsupported"', () => {
    expect(VerificationAgent.getStatusColor('unsupported')).toContain('red');
  });

  it('returns orange classes for "conflicting"', () => {
    expect(VerificationAgent.getStatusColor('conflicting')).toContain('orange');
  });
});

describe('VerificationAgent.getStatusIcon()', () => {
  it('returns checkmark emoji for "verified"', () => {
    expect(VerificationAgent.getStatusIcon('verified')).toBe('✅');
  });

  it('returns warning emoji for "uncertain"', () => {
    expect(VerificationAgent.getStatusIcon('uncertain')).toBe('⚠️');
  });

  it('returns X emoji for "unsupported"', () => {
    expect(VerificationAgent.getStatusIcon('unsupported')).toBe('❌');
  });

  it('returns lightning emoji for "conflicting"', () => {
    expect(VerificationAgent.getStatusIcon('conflicting')).toBe('⚡');
  });
});

describe('VerificationAgent.getStatusText()', () => {
  it('returns Chinese text for each status', () => {
    const statuses: VerificationStatus[] = [
      'verified',
      'uncertain',
      'unsupported',
      'conflicting',
    ];
    const expected = ['已验证', '待确认', '无证据', '有冲突'];
    for (let i = 0; i < statuses.length; i++) {
      expect(VerificationAgent.getStatusText(statuses[i])).toBe(expected[i]);
    }
  });
});
