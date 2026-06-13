/**
 * Writing Content Gate (Stage 2 - LLM Quality Scoring)
 *
 * Wraps existing quality services into a unified gate:
 * - NarrativeCraftService (ending/cliche detection)
 * - Simple structural heuristics
 *
 * Returns a QualityVerdict with pass/fail and scores.
 */

import { Injectable } from "@nestjs/common";
import { NarrativeCraftService } from "./narrative-craft.service";
import { CONTENT_GATE } from "../config/quality-thresholds.config";

export interface QualityVerdict {
  passed: boolean;
  overallScore: number;
  scores: {
    coherence: number;
    consistency: number;
    completeness: number;
    wordCount: number;
    narrativeCraft: number;
  };
  issues: QualityIssue[];
}

export interface QualityIssue {
  dimension: string;
  severity: "error" | "warning";
  message: string;
}

@Injectable()
export class WritingContentGateService {
  constructor(private readonly narrativeCraft: NarrativeCraftService) {}

  /**
   * Evaluate content quality
   */
  evaluate(
    content: string,
    _projectId: string,
    _options?: {
      chapterNumber?: number;
      characters?: Array<{ name: string; role?: string }>;
    },
  ): QualityVerdict {
    const issues: QualityIssue[] = [];

    // 1. Narrative craft check (code-based, fast)
    const narrativeReport = this.narrativeCraft.analyzeContent(content);
    const narrativeCraftScore = narrativeReport.score;

    if (!narrativeReport.passed) {
      for (const issue of narrativeReport.issues) {
        issues.push({
          dimension: "narrative_craft",
          severity: issue.type === "ending" ? "error" : "warning",
          message: `${issue.type}: ${issue.category} - ${issue.problem}`,
        });
      }
    }

    // 2. Word count score
    const wordCount = content.replace(/\s/g, "").length;
    const wordCountScore = Math.min(100, (wordCount / 2500) * 100);

    // 3. Coherence score (structural heuristics)
    const coherenceScore = this.calculateCoherenceScore(content);

    // 4. Completeness score
    const completenessScore = this.calculateCompletenessScore(content);

    // 5. Consistency placeholder (would need Story Bible context)
    const consistencyScore = 80;

    // Calculate overall score
    const weights = CONTENT_GATE.DIMENSION_WEIGHTS;
    const overallScore = Math.round(
      coherenceScore * weights.coherence +
        consistencyScore * weights.consistency +
        completenessScore * weights.completeness +
        wordCountScore * weights.wordCount +
        narrativeCraftScore * weights.narrativeCraft,
    );

    const passed = overallScore >= CONTENT_GATE.MIN_OVERALL_SCORE;

    return {
      passed,
      overallScore,
      scores: {
        coherence: coherenceScore,
        consistency: consistencyScore,
        completeness: completenessScore,
        wordCount: wordCountScore,
        narrativeCraft: narrativeCraftScore,
      },
      issues,
    };
  }

  private calculateCoherenceScore(content: string): number {
    let score = 80;
    const paragraphs = content.split(/\n\n+/).filter(Boolean);
    if (paragraphs.length < 3) score -= 20;
    // Has dialogue (Chinese quotation marks)
    if (content.includes("\u300C") || content.includes("\u201C")) score += 10;
    const avgLen = content.length / Math.max(paragraphs.length, 1);
    if (avgLen > 50 && avgLen < 500) score += 10;
    return Math.min(100, Math.max(0, score));
  }

  private calculateCompletenessScore(content: string): number {
    let score = 70;
    const wordCount = content.replace(/\s/g, "").length;
    if (wordCount >= 2500) score += 20;
    else if (wordCount >= 1500) score += 10;
    if (/^第[一二三四五六七八九十百千万\d]+章/.test(content)) score += 10;
    return Math.min(100, Math.max(0, score));
  }
}
