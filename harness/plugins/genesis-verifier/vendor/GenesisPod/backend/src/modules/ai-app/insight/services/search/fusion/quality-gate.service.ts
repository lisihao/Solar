/**
 * Quality Gate Service
 *
 * Evaluates whether aggregated search results are sufficient for report writing.
 * Returns a structured verdict with identified gaps and suggested remedial actions.
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  DataSourceType,
  type AggregatedSearchResult,
} from "../../../types/data-source.types";
import type { QualityVerdict, SuggestedAction } from "../search.types";

/** Default minimum number of results required to pass the quality gate */
const DEFAULT_MIN_RESULTS = 5;

/** Minimum fraction of items with publishedAt in the last 6 months to pass freshness check */
const FRESHNESS_RATIO_THRESHOLD = 0.2;

import { DATA_FRESHNESS } from "../../../config/health-monitoring.config";

/** Six months expressed in milliseconds */
const SIX_MONTHS_MS = DATA_FRESHNESS.SIX_MONTHS_MS;

/** Fraction of requested sources that may fail before triggering a retry recommendation */
const FAILED_SOURCE_RATIO_THRESHOLD = 0.5;

/** Academic source types recognised for the requireAcademic check */
const ACADEMIC_SOURCE_TYPES = new Set<DataSourceType>([
  DataSourceType.ACADEMIC,
  DataSourceType.OPENALEX,
  DataSourceType.SEMANTIC_SCHOLAR,
  DataSourceType.PUBMED,
]);

@Injectable()
export class SearchFusionQualityGateService {
  private readonly logger = new Logger(SearchFusionQualityGateService.name);

  /**
   * Evaluate the quality of aggregated search results.
   *
   * Checks (in order):
   *  1. Minimum result count
   *  2. Source diversity (at least 2 source types)
   *  3. Freshness (≥20% of timestamped items within last 6 months)
   *  4. Academic coverage (if requireAcademic is set)
   *  5. Failed source ratio (>50% sources errored → suggest retry)
   *
   * @param result           - Aggregated search results to evaluate
   * @param context          - Evaluation context (requested sources, thresholds)
   * @returns                QualityVerdict with sufficient flag, gaps, and suggested actions
   */
  evaluate(
    result: AggregatedSearchResult,
    context: {
      requestedSources: DataSourceType[];
      minResults?: number;
      requireAcademic?: boolean;
    },
  ): QualityVerdict {
    const {
      requestedSources,
      minResults = DEFAULT_MIN_RESULTS,
      requireAcademic = false,
    } = context;

    const gaps: string[] = [];
    const suggestedActions: SuggestedAction[] = [];

    // ------------------------------------------------------------------
    // 1. Minimum result count
    // ------------------------------------------------------------------
    if (result.totalCount < minResults) {
      const gap = `Insufficient results: ${result.totalCount} found, ${minResults} required`;
      gaps.push(gap);
      suggestedActions.push("add_web_fallback");
      this.logger.debug(`Quality gap — ${gap}`);
    }

    // ------------------------------------------------------------------
    // 2. Source diversity — at least 2 distinct source types in results
    // ------------------------------------------------------------------
    const representedSources = new Set(
      result.items.map((item) => item.sourceType),
    );

    if (representedSources.size < 2) {
      const gap = `Low source diversity: only ${representedSources.size} source type(s) represented`;
      gaps.push(gap);
      if (!suggestedActions.includes("broaden_query")) {
        suggestedActions.push("broaden_query");
      }
      this.logger.debug(`Quality gap — ${gap}`);
    }

    // ------------------------------------------------------------------
    // 3. Freshness — ≥20% of items with publishedAt in last 6 months
    // ------------------------------------------------------------------
    const datedItems = result.items.filter(
      (item) => item.publishedAt !== undefined,
    );

    if (datedItems.length > 0) {
      const cutoff = new Date(Date.now() - SIX_MONTHS_MS);
      const freshItems = datedItems.filter(
        (item) => item.publishedAt !== undefined && item.publishedAt >= cutoff,
      );
      const freshRatio = freshItems.length / datedItems.length;

      if (freshRatio < FRESHNESS_RATIO_THRESHOLD) {
        const gap = `Low freshness: only ${(freshRatio * 100).toFixed(0)}% of dated items are within the last 6 months`;
        gaps.push(gap);
        if (!suggestedActions.includes("extend_time_range")) {
          suggestedActions.push("extend_time_range");
        }
        this.logger.debug(`Quality gap — ${gap}`);
      }
    }

    // ------------------------------------------------------------------
    // 4. Academic coverage (when requireAcademic is requested)
    // ------------------------------------------------------------------
    if (requireAcademic) {
      const hasAcademic = result.items.some((item) =>
        ACADEMIC_SOURCE_TYPES.has(item.sourceType),
      );

      if (!hasAcademic) {
        const gap = "No academic sources present despite requireAcademic flag";
        gaps.push(gap);
        if (!suggestedActions.includes("add_academic_source")) {
          suggestedActions.push("add_academic_source");
        }
        this.logger.debug(`Quality gap — ${gap}`);
      }
    }

    // ------------------------------------------------------------------
    // 5. Failed sources — if >50% of requested sources produced errors
    // ------------------------------------------------------------------
    if (requestedSources.length > 0) {
      const sourceResults = result.metadata?.sourceResults;
      let failedCount = 0;

      if (sourceResults) {
        // A source is considered failed if it is in requestedSources but absent
        // from sourceResults (no results map entry) or returned 0 items.
        for (const source of requestedSources) {
          const count = sourceResults[source];
          if (count === undefined || count === 0) {
            failedCount++;
          }
        }
      } else {
        // No metadata — infer from missing source types in result
        for (const source of requestedSources) {
          if (!result.sources.includes(source)) {
            failedCount++;
          }
        }
      }

      const failedRatio = failedCount / requestedSources.length;

      if (failedRatio > FAILED_SOURCE_RATIO_THRESHOLD) {
        const gap = `High source failure rate: ${failedCount}/${requestedSources.length} sources produced no results`;
        gaps.push(gap);
        if (!suggestedActions.includes("retry_failed_sources")) {
          suggestedActions.push("retry_failed_sources");
        }
        this.logger.debug(`Quality gap — ${gap}`);
      }
    }

    const verdict: QualityVerdict = {
      sufficient: gaps.length === 0,
      gaps,
      suggestedActions,
    };

    this.logger.debug(
      `Quality gate result: ${verdict.sufficient ? "PASS" : "FAIL"} — ${gaps.length} gap(s) identified`,
    );

    return verdict;
  }
}
