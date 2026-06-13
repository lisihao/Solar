/**
 * SearchFusionQualityGateService Unit Tests
 *
 * Coverage targets:
 * - evaluate: happy path (sufficient), all five gap checks in isolation and combination
 *   1. Minimum result count
 *   2. Source diversity (<2 types)
 *   3. Freshness (<20% dated items in last 6 months)
 *   4. Academic coverage (requireAcademic flag)
 *   5. Failed source ratio (>50% of requested sources failed)
 * - Context options: custom minResults, requireAcademic=true/false
 * - Edge cases: empty items, no metadata, no dated items, exactly at thresholds
 */

import { Test, TestingModule } from "@nestjs/testing";
import { SearchFusionQualityGateService } from "../quality-gate.service";
import { DataSourceType } from "../../../../types/data-source.types";
import type { AggregatedSearchResult } from "../../../../types/data-source.types";

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

const NOW = Date.now();
const SIX_MONTHS_MS = 6 * 30 * 24 * 60 * 60 * 1000;

const makeItem = (sourceType: DataSourceType, publishedAt?: Date) => ({
  sourceType,
  title: "Test result",
  url: "https://example.com/result",
  snippet: "snippet",
  publishedAt,
});

const makeResult = (
  overrides: Partial<AggregatedSearchResult> = {},
): AggregatedSearchResult => ({
  items: [],
  totalCount: 0,
  sources: [],
  ...overrides,
});

// ──────────────────────────────────────────────────────────────────────────────
// Test suite
// ──────────────────────────────────────────────────────────────────────────────

describe("SearchFusionQualityGateService", () => {
  let service: SearchFusionQualityGateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SearchFusionQualityGateService],
    }).compile();

    service = module.get<SearchFusionQualityGateService>(
      SearchFusionQualityGateService,
    );
  });

  // ─────────────────────────── sufficient pass ──────────────────────────────

  describe("evaluate — PASS (sufficient)", () => {
    it("should return sufficient=true when all checks pass", () => {
      const recentDate = new Date(NOW - 30 * 24 * 60 * 60 * 1000); // 1 month ago
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
      ];

      const result = makeResult({
        items,
        totalCount: items.length,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
        metadata: {
          searchQuery: "test",
          executionTimeMs: 100,
          sourceResults: {
            [DataSourceType.WEB]: 3,
            [DataSourceType.ACADEMIC]: 2,
          } as Record<DataSourceType, number>,
        },
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
        minResults: 5,
      });

      expect(verdict.sufficient).toBe(true);
      expect(verdict.gaps).toHaveLength(0);
      expect(verdict.suggestedActions).toHaveLength(0);
    });

    it("should return sufficient=true with default minResults (5) when exactly 5 items", () => {
      const recentDate = new Date(NOW - 30 * 24 * 60 * 60 * 1000);
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
      ];

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      expect(verdict.sufficient).toBe(true);
    });
  });

  // ─────────────────────────── check 1: min results ────────────────────────

  describe("evaluate — Check 1: Minimum result count", () => {
    it("should fail when totalCount < minResults (default 5)", () => {
      const result = makeResult({
        items: [
          makeItem(DataSourceType.WEB),
          makeItem(DataSourceType.ACADEMIC),
        ],
        totalCount: 2,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
      });

      expect(verdict.sufficient).toBe(false);
      expect(verdict.gaps.some((g) => g.includes("Insufficient results"))).toBe(
        true,
      );
      expect(verdict.suggestedActions).toContain("add_web_fallback");
    });

    it("should fail with custom minResults", () => {
      const items = Array.from({ length: 8 }, () =>
        makeItem(DataSourceType.WEB),
      );
      const result = makeResult({
        items,
        totalCount: 8,
        sources: [DataSourceType.WEB],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 10,
      });

      expect(verdict.gaps.some((g) => g.includes("Insufficient results"))).toBe(
        true,
      );
      expect(verdict.suggestedActions).toContain("add_web_fallback");
    });

    it("should pass when totalCount equals custom minResults", () => {
      const recentDate = new Date(NOW - 30 * 24 * 60 * 60 * 1000);
      const items = Array.from({ length: 3 }, () =>
        makeItem(DataSourceType.WEB, recentDate),
      );
      const result = makeResult({
        items: [
          ...items,
          makeItem(DataSourceType.ACADEMIC, recentDate),
          makeItem(DataSourceType.ACADEMIC, recentDate),
        ],
        totalCount: 3,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 3,
      });

      expect(verdict.gaps.some((g) => g.includes("Insufficient results"))).toBe(
        false,
      );
    });

    it("should include gap message with actual and required counts", () => {
      const result = makeResult({
        items: [makeItem(DataSourceType.WEB)],
        totalCount: 1,
        sources: [DataSourceType.WEB],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 5,
      });

      const minGap = verdict.gaps.find((g) =>
        g.includes("Insufficient results"),
      );
      expect(minGap).toContain("1");
      expect(minGap).toContain("5");
    });
  });

  // ─────────────────────────── check 2: source diversity ───────────────────

  describe("evaluate — Check 2: Source diversity", () => {
    it("should fail when only 1 source type represented", () => {
      const items = Array.from({ length: 6 }, () =>
        makeItem(DataSourceType.WEB),
      );

      const result = makeResult({
        items,
        totalCount: 6,
        sources: [DataSourceType.WEB],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
      });

      expect(verdict.gaps.some((g) => g.includes("Low source diversity"))).toBe(
        true,
      );
      expect(verdict.suggestedActions).toContain("broaden_query");
    });

    it("should fail when items array is empty (0 source types)", () => {
      const result = makeResult({
        items: [],
        totalCount: 0,
        sources: [],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
      });

      expect(verdict.gaps.some((g) => g.includes("Low source diversity"))).toBe(
        true,
      );
    });

    it("should pass when at least 2 source types are represented", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = Array.from({ length: 5 }, (_, i) =>
        makeItem(
          i % 2 === 0 ? DataSourceType.WEB : DataSourceType.ACADEMIC,
          recentDate,
        ),
      );

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      expect(verdict.gaps.some((g) => g.includes("Low source diversity"))).toBe(
        false,
      );
    });

    it("should not duplicate broaden_query action when both diversity and min-results fail", () => {
      const result = makeResult({
        items: [makeItem(DataSourceType.WEB)],
        totalCount: 1,
        sources: [DataSourceType.WEB],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 10,
      });

      const broadenCount = verdict.suggestedActions.filter(
        (a) => a === "broaden_query",
      ).length;
      expect(broadenCount).toBe(1);
    });
  });

  // ─────────────────────────── check 3: freshness ───────────────────────────

  describe("evaluate — Check 3: Freshness", () => {
    it("should fail when fewer than 20% of dated items are fresh", () => {
      const oldDate = new Date(NOW - SIX_MONTHS_MS - 30 * 24 * 60 * 60 * 1000); // 7+ months ago
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);

      // 1 fresh out of 10 dated = 10% < 20%
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        ...Array.from({ length: 9 }, () =>
          makeItem(DataSourceType.ACADEMIC, oldDate),
        ),
      ];

      const result = makeResult({
        items,
        totalCount: items.length,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 1,
      });

      expect(verdict.gaps.some((g) => g.includes("Low freshness"))).toBe(true);
      expect(verdict.suggestedActions).toContain("extend_time_range");
    });

    it("should pass when exactly 20% of dated items are fresh", () => {
      const oldDate = new Date(NOW - SIX_MONTHS_MS - 30 * 24 * 60 * 60 * 1000);
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);

      // 1 fresh out of 5 dated = 20% — equals threshold, should pass
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, oldDate),
        makeItem(DataSourceType.WEB, oldDate),
        makeItem(DataSourceType.ACADEMIC, oldDate),
        makeItem(DataSourceType.WEB, oldDate),
      ];

      const result = makeResult({
        items,
        totalCount: items.length,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 1,
      });

      expect(verdict.gaps.some((g) => g.includes("Low freshness"))).toBe(false);
    });

    it("should skip freshness check when no items have publishedAt", () => {
      // No items have publishedAt, so datedItems.length === 0 — check skipped
      const items = Array.from({ length: 5 }, () =>
        makeItem(DataSourceType.WEB),
      );

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 1,
      });

      expect(verdict.gaps.some((g) => g.includes("Low freshness"))).toBe(false);
    });

    it("should not add duplicate extend_time_range action", () => {
      const oldDate = new Date(NOW - SIX_MONTHS_MS - 30 * 24 * 60 * 60 * 1000);
      const items = [
        makeItem(DataSourceType.WEB, oldDate),
        makeItem(DataSourceType.ACADEMIC, oldDate),
        makeItem(DataSourceType.WEB, oldDate),
        makeItem(DataSourceType.ACADEMIC, oldDate),
        makeItem(DataSourceType.WEB, oldDate),
      ];

      const result = makeResult({
        items,
        totalCount: items.length,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 1,
      });

      const extendCount = verdict.suggestedActions.filter(
        (a) => a === "extend_time_range",
      ).length;
      expect(extendCount).toBe(1);
    });

    it("should include freshness ratio in gap message", () => {
      const oldDate = new Date(NOW - SIX_MONTHS_MS - 30 * 24 * 60 * 60 * 1000);
      const items = [
        makeItem(DataSourceType.WEB, oldDate),
        makeItem(DataSourceType.ACADEMIC, oldDate),
        makeItem(DataSourceType.WEB, oldDate),
        makeItem(DataSourceType.ACADEMIC, oldDate),
        makeItem(DataSourceType.WEB, oldDate),
      ];

      const result = makeResult({
        items,
        totalCount: items.length,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 1,
      });

      const freshnessGap = verdict.gaps.find((g) =>
        g.includes("Low freshness"),
      );
      expect(freshnessGap).toContain("0%");
    });

    it("should treat items with publishedAt === undefined correctly", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      // Mix of dated and undated — undated not counted in freshness check
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, undefined),
        makeItem(DataSourceType.WEB, undefined),
        makeItem(DataSourceType.ACADEMIC, undefined),
        makeItem(DataSourceType.WEB, undefined),
      ];

      const result = makeResult({
        items,
        totalCount: items.length,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        minResults: 1,
      });

      // 1 dated item, 1 fresh = 100% fresh — should pass freshness
      expect(verdict.gaps.some((g) => g.includes("Low freshness"))).toBe(false);
    });
  });

  // ─────────────────────────── check 4: academic coverage ──────────────────

  describe("evaluate — Check 4: Academic coverage", () => {
    it("should fail when requireAcademic=true and no academic items present", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = Array.from({ length: 5 }, (_, i) =>
        makeItem(
          i % 2 === 0 ? DataSourceType.WEB : DataSourceType.HACKERNEWS,
          recentDate,
        ),
      );

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.HACKERNEWS],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        requireAcademic: true,
      });

      expect(verdict.gaps.some((g) => g.includes("No academic sources"))).toBe(
        true,
      );
      expect(verdict.suggestedActions).toContain("add_academic_source");
    });

    it("should pass when requireAcademic=true and ACADEMIC type present", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
      ];

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
        requireAcademic: true,
      });

      expect(verdict.gaps.some((g) => g.includes("No academic sources"))).toBe(
        false,
      );
    });

    it("should pass when requireAcademic=true and SEMANTIC_SCHOLAR type present", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.SEMANTIC_SCHOLAR, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.SEMANTIC_SCHOLAR, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
      ];

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.SEMANTIC_SCHOLAR],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.SEMANTIC_SCHOLAR],
        requireAcademic: true,
      });

      expect(verdict.gaps.some((g) => g.includes("No academic sources"))).toBe(
        false,
      );
    });

    it("should pass when requireAcademic=true and PUBMED type present", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.PUBMED, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.PUBMED, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
      ];

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.PUBMED],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.PUBMED],
        requireAcademic: true,
      });

      expect(verdict.gaps.some((g) => g.includes("No academic sources"))).toBe(
        false,
      );
    });

    it("should pass when requireAcademic=true and OPENALEX type present", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.OPENALEX, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.OPENALEX, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
      ];

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.OPENALEX],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.OPENALEX],
        requireAcademic: true,
      });

      expect(verdict.gaps.some((g) => g.includes("No academic sources"))).toBe(
        false,
      );
    });

    it("should skip academic check when requireAcademic=false (default)", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = Array.from({ length: 5 }, (_, i) =>
        makeItem(
          i % 2 === 0 ? DataSourceType.WEB : DataSourceType.HACKERNEWS,
          recentDate,
        ),
      );

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.HACKERNEWS],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        requireAcademic: false,
      });

      expect(verdict.gaps.some((g) => g.includes("No academic sources"))).toBe(
        false,
      );
    });

    it("should not add duplicate add_academic_source action", () => {
      const items = Array.from({ length: 5 }, () =>
        makeItem(DataSourceType.WEB),
      );

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.HACKERNEWS],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB],
        requireAcademic: true,
      });

      const academicCount = verdict.suggestedActions.filter(
        (a) => a === "add_academic_source",
      ).length;
      expect(academicCount).toBe(1);
    });
  });

  // ─────────────────────────── check 5: failed source ratio ────────────────

  describe("evaluate — Check 5: Failed source ratio", () => {
    it("should fail when >50% of requested sources produced no results (with metadata)", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = Array.from({ length: 6 }, () =>
        makeItem(DataSourceType.WEB, recentDate),
      );

      const result = makeResult({
        items,
        totalCount: 6,
        sources: [DataSourceType.WEB],
        metadata: {
          searchQuery: "test",
          executionTimeMs: 100,
          sourceResults: {
            [DataSourceType.WEB]: 6,
            [DataSourceType.ACADEMIC]: 0,
            [DataSourceType.GITHUB]: 0,
          } as Record<DataSourceType, number>,
        },
      });

      const verdict = service.evaluate(result, {
        requestedSources: [
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
          DataSourceType.GITHUB,
        ],
      });

      expect(
        verdict.gaps.some((g) => g.includes("High source failure rate")),
      ).toBe(true);
      expect(verdict.suggestedActions).toContain("retry_failed_sources");
    });

    it("should fail when >50% of requested sources absent from result.sources (no metadata)", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = Array.from({ length: 6 }, () =>
        makeItem(DataSourceType.WEB, recentDate),
      );

      const result = makeResult({
        items,
        totalCount: 6,
        sources: [DataSourceType.WEB], // only WEB returned, 2 of 3 requested missing
      });

      const verdict = service.evaluate(result, {
        requestedSources: [
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
          DataSourceType.GITHUB,
        ],
      });

      expect(
        verdict.gaps.some((g) => g.includes("High source failure rate")),
      ).toBe(true);
      expect(verdict.suggestedActions).toContain("retry_failed_sources");
    });

    it("should pass when exactly 50% of requested sources failed (not > 50%)", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.ACADEMIC, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
      ];

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
        metadata: {
          searchQuery: "test",
          executionTimeMs: 100,
          sourceResults: {
            [DataSourceType.WEB]: 3,
            [DataSourceType.ACADEMIC]: 2,
            [DataSourceType.GITHUB]: 0,
            [DataSourceType.HACKERNEWS]: 0,
          } as Record<DataSourceType, number>,
        },
      });

      const verdict = service.evaluate(result, {
        requestedSources: [
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
          DataSourceType.GITHUB,
          DataSourceType.HACKERNEWS,
        ],
        minResults: 1,
      });

      // 2 failed out of 4 = 50%, not > 50%
      expect(
        verdict.gaps.some((g) => g.includes("High source failure rate")),
      ).toBe(false);
    });

    it("should skip failed source check when requestedSources is empty", () => {
      const result = makeResult({
        items: [
          makeItem(DataSourceType.WEB),
          makeItem(DataSourceType.ACADEMIC),
          makeItem(DataSourceType.WEB),
          makeItem(DataSourceType.ACADEMIC),
          makeItem(DataSourceType.WEB),
        ],
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [],
      });

      expect(
        verdict.gaps.some((g) => g.includes("High source failure rate")),
      ).toBe(false);
    });

    it("should count undefined sourceResults entries as failed", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      const items = Array.from({ length: 6 }, () =>
        makeItem(DataSourceType.WEB, recentDate),
      );

      const result = makeResult({
        items,
        totalCount: 6,
        sources: [DataSourceType.WEB],
        metadata: {
          searchQuery: "test",
          executionTimeMs: 100,
          // Only WEB in sourceResults; ACADEMIC and GITHUB missing = undefined
          sourceResults: {
            [DataSourceType.WEB]: 6,
          } as Record<DataSourceType, number>,
        },
      });

      const verdict = service.evaluate(result, {
        requestedSources: [
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
          DataSourceType.GITHUB,
        ],
      });

      expect(
        verdict.gaps.some((g) => g.includes("High source failure rate")),
      ).toBe(true);
    });

    it("should include failure counts in gap message", () => {
      const items = Array.from({ length: 6 }, () =>
        makeItem(DataSourceType.WEB),
      );

      const result = makeResult({
        items,
        totalCount: 6,
        sources: [DataSourceType.WEB],
        metadata: {
          searchQuery: "test",
          executionTimeMs: 100,
          sourceResults: {
            [DataSourceType.WEB]: 6,
            [DataSourceType.ACADEMIC]: 0,
            [DataSourceType.GITHUB]: 0,
          } as Record<DataSourceType, number>,
        },
      });

      const verdict = service.evaluate(result, {
        requestedSources: [
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
          DataSourceType.GITHUB,
        ],
      });

      const failGap = verdict.gaps.find((g) =>
        g.includes("High source failure rate"),
      );
      expect(failGap).toContain("2");
      expect(failGap).toContain("3");
    });

    it("should not add duplicate retry_failed_sources action", () => {
      const items = Array.from({ length: 6 }, () =>
        makeItem(DataSourceType.WEB),
      );

      const result = makeResult({
        items,
        totalCount: 6,
        sources: [DataSourceType.WEB],
        metadata: {
          searchQuery: "test",
          executionTimeMs: 100,
          sourceResults: {
            [DataSourceType.WEB]: 6,
            [DataSourceType.ACADEMIC]: 0,
            [DataSourceType.GITHUB]: 0,
          } as Record<DataSourceType, number>,
        },
      });

      const verdict = service.evaluate(result, {
        requestedSources: [
          DataSourceType.WEB,
          DataSourceType.ACADEMIC,
          DataSourceType.GITHUB,
        ],
      });

      const retryCount = verdict.suggestedActions.filter(
        (a) => a === "retry_failed_sources",
      ).length;
      expect(retryCount).toBe(1);
    });
  });

  // ─────────────────────────── combined scenarios ───────────────────────────

  describe("evaluate — combined gap scenarios", () => {
    it("should accumulate multiple gaps and actions", () => {
      // Zero results, no diversity, no freshness (no dated items), requireAcademic
      const result = makeResult({
        items: [],
        totalCount: 0,
        sources: [],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.ACADEMIC],
        minResults: 5,
        requireAcademic: true,
      });

      expect(verdict.sufficient).toBe(false);
      expect(verdict.gaps.length).toBeGreaterThanOrEqual(3);
      // Should have: insufficient results, low diversity, no academic
      expect(verdict.gaps.some((g) => g.includes("Insufficient results"))).toBe(
        true,
      );
      expect(verdict.gaps.some((g) => g.includes("Low source diversity"))).toBe(
        true,
      );
      expect(verdict.gaps.some((g) => g.includes("No academic sources"))).toBe(
        true,
      );
    });

    it("should return sufficient=false when any gap exists", () => {
      const recentDate = new Date(NOW - 10 * 24 * 60 * 60 * 1000);
      // Enough results, 2 sources, fresh data — but requireAcademic fails
      const items = [
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.HACKERNEWS, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
        makeItem(DataSourceType.HACKERNEWS, recentDate),
        makeItem(DataSourceType.WEB, recentDate),
      ];

      const result = makeResult({
        items,
        totalCount: 5,
        sources: [DataSourceType.WEB, DataSourceType.HACKERNEWS],
      });

      const verdict = service.evaluate(result, {
        requestedSources: [DataSourceType.WEB, DataSourceType.HACKERNEWS],
        requireAcademic: true,
      });

      expect(verdict.sufficient).toBe(false);
    });

    it("should return verdict object with all required fields", () => {
      const result = makeResult({ items: [], totalCount: 0, sources: [] });

      const verdict = service.evaluate(result, {
        requestedSources: [],
      });

      expect(verdict).toHaveProperty("sufficient");
      expect(verdict).toHaveProperty("gaps");
      expect(verdict).toHaveProperty("suggestedActions");
      expect(typeof verdict.sufficient).toBe("boolean");
      expect(Array.isArray(verdict.gaps)).toBe(true);
      expect(Array.isArray(verdict.suggestedActions)).toBe(true);
    });
  });
});
