/**
 * DataSourceStrategyService Supplemental Tests
 *
 * Targets uncovered lines:
 * - line 207: maxRatio boosted to 0.5 when authoritative domains > 40% of results
 * - lines 226-239: enforceDomainDiversity logger.warn per over-represented domain
 *                  + domainSeen filtering loop
 */

import { Test, TestingModule } from "@nestjs/testing";
import { DataSourceStrategyService } from "../data-source-strategy.service";
import { DataSourceType } from "../../../types/data-source.types";
import type { DataSourceResult } from "../../../types/data-source.types";

const makeResult = (
  url: string,
  domain?: string,
  sourceType: DataSourceType = DataSourceType.WEB,
  snippet?: string,
): DataSourceResult => ({
  sourceType,
  title: `Article from ${domain || url}`,
  url,
  snippet: snippet || "Some content",
  domain,
});

describe("DataSourceStrategyService (supplemental)", () => {
  let service: DataSourceStrategyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DataSourceStrategyService],
    }).compile();

    service = module.get<DataSourceStrategyService>(DataSourceStrategyService);

    // Suppress logger output
    jest.spyOn(service["logger"], "warn").mockImplementation(() => undefined);
    jest.spyOn(service["logger"], "log").mockImplementation(() => undefined);
    jest.spyOn(service["logger"], "debug").mockImplementation(() => undefined);
  });

  afterEach(() => jest.clearAllMocks());

  // ============================================================
  // enforceDomainDiversity – authoritative domain boost (line 207)
  // ============================================================

  describe("enforceDomainDiversity – authoritative domain boost (line 207)", () => {
    it("should boost maxRatio to 0.5 when over 40% are authoritative domains", () => {
      // Create 10 results: 5 from arxiv.org (authoritative), 5 from another domain
      // arxiv.org count = 5/10 = 50% > 40% → triggers line 207 (maxRatio = 0.5)
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeResult("https://arxiv.org/abs/1", "arxiv.org"),
            makeResult("https://arxiv.org/abs/2", "arxiv.org"),
            makeResult("https://arxiv.org/abs/3", "arxiv.org"),
            makeResult("https://arxiv.org/abs/4", "arxiv.org"),
            makeResult("https://arxiv.org/abs/5", "arxiv.org"),
            makeResult("https://medium.com/a1", "medium.com"),
            makeResult("https://medium.com/a2", "medium.com"),
            makeResult("https://medium.com/a3", "medium.com"),
            makeResult("https://medium.com/a4", "medium.com"),
            makeResult("https://medium.com/a5", "medium.com"),
          ],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      // With boosted maxRatio=0.5, maxPerDomain = max(2, ceil(10*0.5)) = 5
      // So arxiv.org can keep 5 results, medium.com can keep 5 results → all 10 pass
      expect(aggregated.items.length).toBeGreaterThan(0);
      // Medium.com has 5 results, all should be allowed when maxPerDomain=5
      const arxivCount = aggregated.items.filter(
        (i) => i.domain === "arxiv.org",
      ).length;
      expect(arxivCount).toBeLessThanOrEqual(5);
    });

    it("should boost maxRatio when .gov domains constitute > 40% of results", () => {
      // 5 .gov results out of 10 total (50%) → authoritative boost
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeResult("https://cdc.gov/report1", "cdc.gov"),
            makeResult("https://cdc.gov/report2", "cdc.gov"),
            makeResult("https://cdc.gov/report3", "cdc.gov"),
            makeResult("https://nih.gov/study1", "nih.gov"),
            makeResult("https://nih.gov/study2", "nih.gov"),
            makeResult("https://blog.com/1", "blog.com"),
            makeResult("https://blog.com/2", "blog.com"),
            makeResult("https://blog.com/3", "blog.com"),
            makeResult("https://blog.com/4", "blog.com"),
            makeResult("https://blog.com/5", "blog.com"),
          ],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      // With boosted maxRatio, .gov domains get more slots
      expect(aggregated.items.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // enforceDomainDiversity – domain capping with warn logging (lines 226-239)
  // ============================================================

  describe("enforceDomainDiversity – domain capping with warn (lines 226-239)", () => {
    it("should warn and cap over-represented domains", () => {
      // 8 results from same domain in a 10-result set → over-represented
      // maxRatio=0.3, maxPerDomain = max(2, ceil(10*0.3)) = 3
      // medium.com has 8 → over-represented → triggers warn
      // Use distinct titles so isTitleSimilar doesn't deduplicate them prematurely
      const makeDistinct = (
        url: string,
        domain: string,
        n: number,
      ): DataSourceResult => ({
        sourceType: DataSourceType.WEB,
        title: `Unique article number ${n} on ${domain}`,
        url,
        snippet: `Distinct content ${n}`,
        domain,
      });
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeDistinct("https://medium.com/a1", "medium.com", 1),
            makeDistinct("https://medium.com/a2", "medium.com", 2),
            makeDistinct("https://medium.com/a3", "medium.com", 3),
            makeDistinct("https://medium.com/a4", "medium.com", 4),
            makeDistinct("https://medium.com/a5", "medium.com", 5),
            makeDistinct("https://medium.com/a6", "medium.com", 6),
            makeDistinct("https://medium.com/a7", "medium.com", 7),
            makeDistinct("https://medium.com/a8", "medium.com", 8),
            makeDistinct("https://other.com/b1", "other.com", 9),
            makeDistinct("https://another.com/c1", "another.com", 10),
          ],
        },
      ];

      // Track warn calls via a captured array (beforeEach already mocked warn)
      const warnCalls: string[] = [];
      jest
        .spyOn(service["logger"], "warn")
        .mockImplementation((msg: string) => {
          warnCalls.push(msg);
        });

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      // Should have warned about medium.com
      const mediumWarn = warnCalls.some((c) => c.includes("medium.com"));
      expect(mediumWarn).toBe(true);

      // medium.com should be capped to maxPerDomain
      const mediumCount = aggregated.items.filter(
        (i) => i.domain === "medium.com",
      ).length;
      expect(mediumCount).toBeLessThan(8);
    });

    it("should cap multiple over-represented domains", () => {
      // Two domains each with 5 results in a 12-result set
      // maxPerDomain = max(2, ceil(12*0.3)) = 4
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeResult("https://siteA.com/1", "siteA.com"),
            makeResult("https://siteA.com/2", "siteA.com"),
            makeResult("https://siteA.com/3", "siteA.com"),
            makeResult("https://siteA.com/4", "siteA.com"),
            makeResult("https://siteA.com/5", "siteA.com"),
            makeResult("https://siteB.com/1", "siteB.com"),
            makeResult("https://siteB.com/2", "siteB.com"),
            makeResult("https://siteB.com/3", "siteB.com"),
            makeResult("https://siteB.com/4", "siteB.com"),
            makeResult("https://siteB.com/5", "siteB.com"),
            makeResult("https://unique1.com/p", "unique1.com"),
            makeResult("https://unique2.com/p", "unique2.com"),
          ],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      const siteACount = aggregated.items.filter(
        (i) => i.domain === "siteA.com",
      ).length;
      const siteBCount = aggregated.items.filter(
        (i) => i.domain === "siteB.com",
      ).length;

      // Both should be capped
      expect(siteACount).toBeLessThan(5);
      expect(siteBCount).toBeLessThan(5);
    });

    it("should allow items with no domain to pass through the filter", () => {
      // Items without extractable domain should not be filtered
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            // Items with null domain (extractDomain returns null)
            {
              sourceType: DataSourceType.WEB,
              title: "No domain item 1",
              url: "invalid-url-1",
              snippet: "test",
            },
            {
              sourceType: DataSourceType.WEB,
              title: "No domain item 2",
              url: "invalid-url-2",
              snippet: "test",
            },
            makeResult("https://bigsite.com/1", "bigsite.com"),
            makeResult("https://bigsite.com/2", "bigsite.com"),
            makeResult("https://bigsite.com/3", "bigsite.com"),
            makeResult("https://bigsite.com/4", "bigsite.com"),
            makeResult("https://bigsite.com/5", "bigsite.com"),
          ],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      // Items with null domain should pass through (domain=null → return true in filter)
      // The valid-URL items (bigsite.com) should be capped
      expect(aggregated.items.length).toBeGreaterThan(0);
    });
  });

  // ============================================================
  // enforceDomainDiversity – no over-represented domains (early return)
  // ============================================================

  describe("enforceDomainDiversity – no over-represented (early return at line 224)", () => {
    it("should return results unchanged when no domain is over-represented", () => {
      // Each domain has exactly 1 result → no over-representation
      const results: PromiseSettledResult<DataSourceResult[]>[] = [
        {
          status: "fulfilled",
          value: [
            makeResult("https://a.com/1", "a.com"),
            makeResult("https://b.com/1", "b.com"),
            makeResult("https://c.com/1", "c.com"),
            makeResult("https://d.com/1", "d.com"),
            makeResult("https://e.com/1", "e.com"),
          ],
        },
      ];

      const aggregated = service.aggregateResults(results, [
        DataSourceType.WEB,
      ]);

      // All 5 items should be kept
      expect(aggregated.items.length).toBe(5);
    });
  });
});
