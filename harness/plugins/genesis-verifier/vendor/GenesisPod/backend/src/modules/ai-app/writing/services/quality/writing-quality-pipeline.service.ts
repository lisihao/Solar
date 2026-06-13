/**
 * Writing Quality Pipeline Service
 *
 * Orchestrates the three-stage quality pipeline:
 * Stage 1: WritingStructuralGate (Code Gate, 0 LLM)
 * Stage 2: WritingContentGate (heuristic scoring)
 * Stage 3: WritingCritiqueRefine (iterative improvement)
 */

import { Injectable, Logger } from "@nestjs/common";
import {
  WritingStructuralGateService,
  type StructuralGateResult,
} from "./writing-structural-gate.service";
import {
  WritingContentGateService,
  type QualityVerdict,
} from "./writing-content-gate.service";
import {
  WritingCritiqueRefineService,
  type CritiqueRefineResult,
} from "./writing-critique-refine.service";

export interface QualityPipelineResult {
  content: string;
  passed: boolean;
  structural: StructuralGateResult;
  contentGate: QualityVerdict | null;
  critiqueRefine: CritiqueRefineResult | null;
  overallScore: number;
}

@Injectable()
export class WritingQualityPipelineService {
  private readonly logger = new Logger(WritingQualityPipelineService.name);

  constructor(
    private readonly structuralGate: WritingStructuralGateService,
    private readonly contentGate: WritingContentGateService,
    private readonly critiqueRefine: WritingCritiqueRefineService,
  ) {}

  async evaluate(
    content: string,
    projectId: string,
    modelId: string,
    options?: {
      isOutline?: boolean;
      chapterNumber?: number;
      characters?: Array<{ name: string; role?: string }>;
      structuralOnly?: boolean;
    },
  ): Promise<QualityPipelineResult> {
    // Stage 1: Structural Gate (async, 0 LLM)
    const structural = await this.structuralGate.validate(content, projectId, {
      isOutline: options?.isOutline,
    });

    const currentContent = structural.fixedContent;

    if (!structural.passed) {
      this.logger.warn(
        `Stage 1 failed: ${structural.violations.map((v: { message: string }) => v.message).join(", ")}`,
      );
      return {
        content: currentContent,
        passed: false,
        structural,
        contentGate: null,
        critiqueRefine: null,
        overallScore: 0,
      };
    }

    if (options?.structuralOnly) {
      return {
        content: currentContent,
        passed: true,
        structural,
        contentGate: null,
        critiqueRefine: null,
        overallScore: 75,
      };
    }

    // Stage 2: Content Gate (heuristic scoring)
    const contentVerdict = this.contentGate.evaluate(
      currentContent,
      projectId,
      {
        chapterNumber: options?.chapterNumber,
        characters: options?.characters,
      },
    );

    if (contentVerdict.passed) {
      return {
        content: currentContent,
        passed: true,
        structural,
        contentGate: contentVerdict,
        critiqueRefine: null,
        overallScore: contentVerdict.overallScore,
      };
    }

    // Stage 3: Critique-Refine
    this.logger.log(
      `Stage 2 failed (score=${contentVerdict.overallScore}), starting critique-refine`,
    );

    const refinement = await this.critiqueRefine.refine(
      currentContent,
      contentVerdict,
      modelId,
    );

    return {
      content: refinement.content,
      passed: refinement.finalScore >= 70,
      structural,
      contentGate: contentVerdict,
      critiqueRefine: refinement,
      overallScore: refinement.finalScore,
    };
  }
}
