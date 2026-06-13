/**
 * Health Check Runner
 *
 * Reusable interval-based health check loop.
 * Replaces hand-written setInterval + isRunning + clearInterval patterns
 * found in ResearchMissionHealthService, SlidesMissionHealthService, etc.
 *
 * Non-Injectable (pure class) — consumers new() it in their constructor.
 */

import { Logger } from "@nestjs/common";

export interface HealthCheckRunnerConfig {
  /** Name used in log messages */
  name: string;
  /** Interval between checks in milliseconds */
  intervalMs: number;
  /** Whether to run immediately on start (default: true) */
  runImmediately?: boolean;
}

export class HealthCheckRunner {
  private readonly logger: Logger;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly config: HealthCheckRunnerConfig) {
    this.logger = new Logger(`HealthCheckRunner:${config.name}`);
  }

  /**
   * Start the periodic health check loop.
   * No-op if already started.
   */
  start(checkFn: () => Promise<void>): void {
    if (this.intervalHandle) {
      return;
    }

    const wrappedCheck = async () => {
      if (this.running) {
        this.logger.debug("Check already running, skipping");
        return;
      }
      this.running = true;
      try {
        await checkFn();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Check failed: ${msg}`);
      } finally {
        this.running = false;
      }
    };

    // Run immediately if configured (default: true)
    if (this.config.runImmediately !== false) {
      void wrappedCheck();
    }

    this.intervalHandle = setInterval(() => {
      void wrappedCheck();
    }, this.config.intervalMs);

    // Unref so the timer doesn't prevent process exit
    if (
      typeof this.intervalHandle === "object" &&
      "unref" in this.intervalHandle
    ) {
      this.intervalHandle.unref();
    }

    this.logger.log(`Started with ${this.config.intervalMs / 1000}s interval`);
  }

  /**
   * Stop the periodic loop.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.log("Stopped");
    }
  }

  /**
   * Run the check function once (outside the interval).
   */
  async runOnce(checkFn: () => Promise<void>): Promise<void> {
    if (this.running) {
      this.logger.debug("Check already running, skipping runOnce");
      return;
    }
    this.running = true;
    try {
      await checkFn();
    } finally {
      this.running = false;
    }
  }

  /**
   * Whether the runner's interval is active.
   */
  isStarted(): boolean {
    return this.intervalHandle !== null;
  }

  /**
   * Whether a check is currently in progress.
   */
  isRunning(): boolean {
    return this.running;
  }
}
