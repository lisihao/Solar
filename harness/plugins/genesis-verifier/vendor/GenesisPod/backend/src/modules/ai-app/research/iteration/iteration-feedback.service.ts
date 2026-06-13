import { Injectable, Logger } from "@nestjs/common";

/**
 * Manages the feedback pause mechanism used between iterative research rounds.
 *
 * Callers can register a pending "wait" Promise via waitForFeedback(), and
 * external actors (e.g. an HTTP controller) can resolve that Promise by calling
 * submitFeedback(). If no feedback arrives within the timeout window, the
 * Promise resolves with null and the loop auto-continues.
 */
@Injectable()
export class IterationFeedbackService {
  private readonly logger = new Logger(IterationFeedbackService.name);

  private readonly feedbackResolvers = new Map<
    string,
    {
      resolve: (feedback: string | null) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  /**
   * Called by the HTTP controller when the user submits feedback during the
   * pause window. Returns true if a waiting resolver was found and resolved.
   */
  submitFeedback(projectId: string, feedback: string): boolean {
    const entry = this.feedbackResolvers.get(projectId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    entry.resolve(feedback);
    this.feedbackResolvers.delete(projectId);
    return true;
  }

  /**
   * Returns a Promise that resolves with the user's feedback string, or null
   * if no feedback is submitted within timeoutMs.
   */
  waitForFeedback(
    projectId: string,
    timeoutMs: number,
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.feedbackResolvers.delete(projectId);
        resolve(null);
      }, timeoutMs);
      this.feedbackResolvers.set(projectId, { resolve, timer });
    });
  }

  /**
   * Extends the current feedback timeout by additionalMs. Returns true if a
   * pending resolver was found and the timer was reset.
   */
  extendTimeout(projectId: string, additionalMs: number): boolean {
    const entry = this.feedbackResolvers.get(projectId);
    if (!entry) return false;
    clearTimeout(entry.timer);
    const newTimer = setTimeout(() => {
      this.feedbackResolvers.delete(projectId);
      entry.resolve(null);
    }, additionalMs);
    this.feedbackResolvers.set(projectId, {
      resolve: entry.resolve,
      timer: newTimer,
    });
    this.logger.debug(
      `Extended feedback timeout for project ${projectId} by ${additionalMs}ms`,
    );
    return true;
  }

  /**
   * Cleans up any pending feedback resolver for the given project. Called when
   * the iteration loop exits (e.g. on early termination) to avoid timer leaks.
   */
  clearPendingFeedback(projectId: string): void {
    const pending = this.feedbackResolvers.get(projectId);
    if (pending) {
      this.logger.debug(
        `Clearing pending feedback resolver for project ${projectId}`,
      );
      clearTimeout(pending.timer);
      this.feedbackResolvers.delete(projectId);
    }
  }
}
