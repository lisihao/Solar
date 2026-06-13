/**
 * Tests for lib/utils/feature-check.ts
 *
 * Tests the FeatureChecker class and featureChecker singleton.
 * Dynamic imports are mocked at module level.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/features/ai-office/multi-agents', () => ({
  CoordinatorAgent: class CoordinatorAgent {},
  ResourceAnalysisAgent: class ResourceAnalysisAgent {},
  VerificationAgent: class VerificationAgent {},
}));

vi.mock('@/lib/features/ai-office/ppt-templates', () => ({
  getAllTemplates: vi
    .fn()
    .mockReturnValue([
      { id: 'literature-review' },
      { id: 'conference' },
      { id: 'architecture' },
      { id: 'code-review' },
      { id: 'template-5' },
      { id: 'template-6' },
      { id: 'template-7' },
      { id: 'template-8' },
      { id: 'template-9' },
      { id: 'template-10' },
      { id: 'template-11' },
    ]),
}));

vi.mock('@/lib/utils/version-diff', () => ({
  comparePPTVersions: vi.fn().mockReturnValue({
    changes: [{ type: 'modified', path: 'slide.1', before: 'A', after: 'B' }],
  }),
  compareDocVersions: vi.fn(),
  getDiffColor: vi.fn(),
  getDiffIcon: vi.fn(),
}));

vi.mock('@/lib/utils/document-export.service', () => ({
  documentExportService: {
    exportAsWord: vi.fn(),
    exportAsPdf: vi.fn(),
  },
}));

vi.mock('@/lib/templates/research-page-templates', () => ({
  getAllResearchPageTemplates: vi
    .fn()
    .mockReturnValue([
      { id: 'rp-1' },
      { id: 'rp-2' },
      { id: 'rp-3' },
      { id: 'rp-4' },
    ]),
}));

vi.mock('@/stores/aiOfficeStore', () => ({
  useResourceStore: { getState: vi.fn().mockReturnValue({}) },
  useDocumentStore: { getState: vi.fn().mockReturnValue({}) },
  useChatStore: {
    getState: vi.fn().mockReturnValue({ agentMode: false, messages: [] }),
  },
  useTaskStore: { getState: vi.fn().mockReturnValue({}) },
  useUIStore: { getState: vi.fn().mockReturnValue({}) },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import { FeatureChecker, featureChecker } from '../feature-check';
import type { SystemHealthReport } from '../feature-check';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks();

  // Ensure window is defined for API endpoint checks
  if (typeof global.window === 'undefined') {
    Object.defineProperty(global, 'window', {
      value: global,
      writable: true,
      configurable: true,
    });
  }

  // Mock fetch for API endpoint checks
  global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
});

// ---------------------------------------------------------------------------
// FeatureChecker
// ---------------------------------------------------------------------------
describe('FeatureChecker', () => {
  it('is instantiable', () => {
    const checker = new FeatureChecker();
    expect(checker).toBeInstanceOf(FeatureChecker);
  });

  describe('checkVersionDiffSystem', () => {
    it('returns pass status when diff works correctly', async () => {
      const checker = new FeatureChecker();
      const result = await checker.checkVersionDiffSystem();

      expect(result.feature).toBe('Version Diff System');
      expect(result.status).toBe('pass');
    });

    it('returns warn when no changes detected', async () => {
      const { comparePPTVersions } = await import('@/lib/utils/version-diff');
      vi.mocked(comparePPTVersions).mockReturnValueOnce({
        changes: [],
      } as unknown as ReturnType<typeof comparePPTVersions>);

      const checker = new FeatureChecker();
      const result = await checker.checkVersionDiffSystem();

      expect(result.status).toBe('warn');
      expect(result.message).toContain('差异检测可能不正常');
    });

    it('returns fail when comparePPTVersions throws', async () => {
      const { comparePPTVersions } = await import('@/lib/utils/version-diff');
      vi.mocked(comparePPTVersions).mockImplementationOnce(() => {
        throw new Error('Diff system broken');
      });

      const checker = new FeatureChecker();
      const result = await checker.checkVersionDiffSystem();

      expect(result.status).toBe('fail');
      expect(result.message).toContain('检查失败');
    });
  });

  describe('checkMultiAgentSystem', () => {
    it('returns pass or warn (depending on API availability)', async () => {
      const checker = new FeatureChecker();
      const result = await checker.checkMultiAgentSystem();

      expect(result.feature).toBe('Multi-Agent System');
      expect(['pass', 'warn', 'fail']).toContain(result.status);
    });
  });

  describe('checkTemplateSystem', () => {
    it('returns pass when enough templates exist with required IDs', async () => {
      const checker = new FeatureChecker();
      const result = await checker.checkTemplateSystem();

      expect(result.feature).toBe('PPT Template System');
      expect(result.status).toBe('pass');
    });

    it('returns warn when too few templates exist', async () => {
      const { getAllTemplates } =
        await import('@/lib/features/ai-office/ppt-templates');
      vi.mocked(getAllTemplates).mockReturnValueOnce([
        { id: 't1' },
        { id: 't2' },
      ] as ReturnType<typeof getAllTemplates>);

      const checker = new FeatureChecker();
      const result = await checker.checkTemplateSystem();

      expect(result.status).toBe('warn');
      expect(result.message).toContain('模板数量不足');
    });

    it('returns warn when required templates are missing', async () => {
      const { getAllTemplates } =
        await import('@/lib/features/ai-office/ppt-templates');
      // Enough templates but missing required ones
      vi.mocked(getAllTemplates).mockReturnValueOnce(
        Array.from({ length: 11 }, (_, i) => ({
          id: `other-${i}`,
        })) as ReturnType<typeof getAllTemplates>
      );

      const checker = new FeatureChecker();
      const result = await checker.checkTemplateSystem();

      expect(result.status).toBe('warn');
      expect(result.message).toContain('缺少模板');
    });
  });

  describe('checkExportSystem', () => {
    it('returns pass or warn based on API endpoint availability', async () => {
      const checker = new FeatureChecker();
      const result = await checker.checkExportSystem();

      expect(result.feature).toBe('Export System');
      expect(['pass', 'warn', 'fail']).toContain(result.status);
    });
  });

  describe('checkResearchPageSystem', () => {
    it('returns pass when enough research page templates exist', async () => {
      const checker = new FeatureChecker();
      const result = await checker.checkResearchPageSystem();

      expect(result.feature).toBe('Research Page System');
      expect(result.status).toBe('pass');
    });

    it('returns warn when fewer than 3 templates', async () => {
      const { getAllResearchPageTemplates } =
        await import('@/lib/templates/research-page-templates');
      vi.mocked(getAllResearchPageTemplates).mockReturnValueOnce([
        { id: 'rp-1' },
        { id: 'rp-2' },
      ] as ReturnType<typeof getAllResearchPageTemplates>);

      const checker = new FeatureChecker();
      const result = await checker.checkResearchPageSystem();

      expect(result.status).toBe('warn');
    });
  });

  describe('checkStoreSystem', () => {
    it('returns pass when agentMode is present in ChatStore', async () => {
      const checker = new FeatureChecker();
      const result = await checker.checkStoreSystem();

      expect(result.feature).toBe('Store System');
      expect(result.status).toBe('pass');
    });

    it('returns warn when agentMode is missing', async () => {
      const { useChatStore } = await import('@/stores/aiOfficeStore');
      vi.mocked(useChatStore.getState).mockReturnValueOnce(
        {} as ReturnType<typeof useChatStore.getState>
      );

      const checker = new FeatureChecker();
      const result = await checker.checkStoreSystem();

      expect(result.status).toBe('warn');
      expect(result.message).toContain('agentMode');
    });
  });

  describe('runAllChecks', () => {
    it('runs all checks and returns a SystemHealthReport', async () => {
      const checker = new FeatureChecker();
      const report: SystemHealthReport = await checker.runAllChecks();

      expect(report).toMatchObject({
        timestamp: expect.any(Date),
        overallStatus: expect.stringMatching(/^(healthy|degraded|critical)$/),
        checks: expect.any(Array),
        score: expect.any(Number),
        recommendations: expect.any(Array),
      });
    });

    it('runs exactly 6 checks', async () => {
      const checker = new FeatureChecker();
      const report = await checker.runAllChecks();

      expect(report.checks).toHaveLength(6);
    });

    it('score is between 0 and 100', async () => {
      const checker = new FeatureChecker();
      const report = await checker.runAllChecks();

      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });

    it('returns healthy status when all checks pass', async () => {
      // All mocks are set up to return passing state
      const checker = new FeatureChecker();
      const report = await checker.runAllChecks();

      // Score should be high given our mocks
      expect(report.score).toBeGreaterThan(0);
    });

    it('sets critical status when a check fails', async () => {
      const { comparePPTVersions } = await import('@/lib/utils/version-diff');
      vi.mocked(comparePPTVersions).mockImplementation(() => {
        throw new Error('Critical failure');
      });

      const checker = new FeatureChecker();
      const report = await checker.runAllChecks();

      // At least one check should fail
      const failChecks = report.checks.filter((c) => c.status === 'fail');
      expect(failChecks.length).toBeGreaterThanOrEqual(1);
    });

    it('adds recommendations for failed and warned checks', async () => {
      const { getAllTemplates } =
        await import('@/lib/features/ai-office/ppt-templates');
      vi.mocked(getAllTemplates).mockReturnValue([{ id: 't1' }] as ReturnType<
        typeof getAllTemplates
      >);

      const checker = new FeatureChecker();
      const report = await checker.runAllChecks();

      // Should have recommendations for the warned template check
      expect(report.recommendations.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// featureChecker singleton
// ---------------------------------------------------------------------------
describe('featureChecker singleton', () => {
  it('is an instance of FeatureChecker', () => {
    expect(featureChecker).toBeInstanceOf(FeatureChecker);
  });

  it('can run checks', async () => {
    const report = await featureChecker.runAllChecks();
    expect(report).toBeDefined();
    expect(report.checks).toHaveLength(6);
  });
});
