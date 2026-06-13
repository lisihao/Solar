/**
 * Skills Mock for Slides Tests
 *
 * Provides mock implementations of AI skills used in slides module.
 */

import { jest } from "@jest/globals";

type LayoutFixerResult = {
  success: boolean;
  data: {
    originalHtml: string;
    fixedHtml: string;
    stats: {
      totalIssues: number;
      fixedIssues: number;
      criticalIssues: number;
    };
    issues: unknown[];
  };
};

type ContentPolisherResult = {
  success: boolean;
  data: {
    pages: { index: number; title: string; content: string }[];
    stats: {
      pagesPolished: number;
      totalChanges: number;
    };
  };
};

type FactCheckerResult = {
  success: boolean;
  data: {
    results: {
      pageIndex: number;
      overallScore: number;
      credibilityLevel: string;
      claims: unknown[];
    }[];
    summary: {
      totalClaims: number;
      verifiedCount: number;
      disputedCount: number;
      needsCitationCount: number;
      overallCredibility: number;
    };
  };
};

/**
 * Create a mock LayoutFixerSkill
 */
export function createMockLayoutFixerSkill() {
  return {
    execute: jest.fn<() => Promise<LayoutFixerResult>>().mockResolvedValue({
      success: true,
      data: {
        originalHtml: "<div>original</div>",
        fixedHtml: "<div>fixed</div>",
        stats: {
          totalIssues: 2,
          fixedIssues: 2,
          criticalIssues: 0,
        },
        issues: [],
      },
    }),
  };
}

/**
 * Create a mock ContentPolisherSkill
 */
export function createMockContentPolisherSkill() {
  return {
    execute: jest.fn<() => Promise<ContentPolisherResult>>().mockResolvedValue({
      success: true,
      data: {
        pages: [{ index: 0, title: "Page 1", content: "Polished content" }],
        stats: {
          pagesPolished: 1,
          totalChanges: 5,
        },
      },
    }),
  };
}

/**
 * Create a mock FactCheckerSkill
 */
export function createMockFactCheckerSkill() {
  return {
    execute: jest.fn<() => Promise<FactCheckerResult>>().mockResolvedValue({
      success: true,
      data: {
        results: [
          {
            pageIndex: 0,
            overallScore: 0.9,
            credibilityLevel: "high",
            claims: [],
          },
        ],
        summary: {
          totalClaims: 5,
          verifiedCount: 4,
          disputedCount: 0,
          needsCitationCount: 1,
          overallCredibility: 0.9,
        },
      },
    }),
  };
}

export type MockLayoutFixerSkill = ReturnType<
  typeof createMockLayoutFixerSkill
>;
export type MockContentPolisherSkill = ReturnType<
  typeof createMockContentPolisherSkill
>;
export type MockFactCheckerSkill = ReturnType<
  typeof createMockFactCheckerSkill
>;
