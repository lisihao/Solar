import { Injectable, Logger } from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import { DiscussionOrchestratorService } from "../discussion/discussion-orchestrator.service";
import { IterationCoordinatorService } from "./iteration-coordinator.service";
import { IterationFeedbackService } from "./iteration-feedback.service";
import type {
  StartIterativeResearchDto,
  IterationStartEvent,
  IterationResearchEvent,
  IterationIdeasEvent,
  IterationDemoEvent,
  IterationEvalEvent,
  IterationExitEvent,
  IterationAwaitingFeedbackEvent,
} from "./types";
import type { DeepResearchSSEEvent } from "../discussion/types";

export interface IterationSessionEvent {
  type: "iteration.session";
  data: {
    sessionId: string;
    maxIterations?: number;
    qualityThreshold?: number;
    depth?: string;
  };
}

export type IterationSSEEvent =
  | IterationStartEvent
  | IterationResearchEvent
  | IterationIdeasEvent
  | IterationDemoEvent
  | IterationEvalEvent
  | IterationExitEvent
  | IterationAwaitingFeedbackEvent
  | IterationSessionEvent;

// Re-export IterationSnapshot from types for consumers that import from the service file
export type { IterationSnapshot } from "./types";

export interface IterationMeta {
  exitReason: string | null;
  finalScore: number | null;
  totalIterations: number | null;
  maxIterations: number;
}

/**
 * Thin facade that routes research requests to the appropriate handler:
 *  - mode === 'single': delegates directly to DiscussionOrchestratorService
 *  - mode === 'iterative' / 'iterative_internal': delegates to IterationCoordinatorService
 *
 * Public API: startResearch() and submitFeedback() — unchanged for callers.
 */
@Injectable()
export class IterativeResearchService {
  private readonly logger = new Logger(IterativeResearchService.name);

  constructor(
    private readonly orchestrator: DiscussionOrchestratorService,
    private readonly coordinator: IterationCoordinatorService,
    private readonly feedbackService: IterationFeedbackService,
  ) {}

  /**
   * Start research. For mode === 'single', delegates directly to the inner
   * orchestrator. For mode === 'iterative', runs the self-iterating outer loop.
   */
  startResearch(
    projectId: string,
    dto: StartIterativeResearchDto,
  ): Observable<DeepResearchSSEEvent | IterationSSEEvent> {
    if (dto.mode === "single") {
      return this.orchestrator.startResearch(projectId, dto);
    }

    const subject = new Subject<DeepResearchSSEEvent | IterationSSEEvent>();
    void this.coordinator
      .runIterativeLoop(projectId, dto, subject)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Iterative research loop failed: ${message}`);
        subject.next({
          type: "error",
          data: {
            code: "ITERATIVE_LOOP_ERROR",
            message,
            recoverable: false,
          },
        });
        subject.complete();
      });

    return subject.asObservable();
  }

  /**
   * Called by the HTTP controller when the user submits feedback during the
   * pause window. Returns true if a waiting resolver was found and resolved.
   */
  submitFeedback(projectId: string, feedback: string): boolean {
    return this.feedbackService.submitFeedback(projectId, feedback);
  }

  /**
   * Extends the current feedback timeout by additionalMs.
   */
  extendFeedbackTimeout(projectId: string, additionalMs: number): boolean {
    return this.feedbackService.extendTimeout(projectId, additionalMs);
  }
}
