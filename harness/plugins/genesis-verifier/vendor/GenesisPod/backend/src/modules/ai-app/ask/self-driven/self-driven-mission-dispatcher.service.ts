/**
 * SelfDrivenMissionDispatcher — app-side detached driver for self-driven missions.
 *
 * Decouples mission execution from any HTTP connection: /run fires this in the
 * background (fire-and-forget) and returns immediately. This drives the UNCHANGED
 * SelfDrivenMissionRunner.run() async generator, relays every yielded event onto
 * the global EventBus via SelfDrivenEventRelay (→ socket room + durable buffer),
 * and arbitrates the terminal status (first-writer-wins) via the mission store.
 *
 * The 10-minute HITL gate now blocks INSIDE this detached task — it holds no
 * HTTP connection. Cancellation is cooperative via MissionAbortRegistry (not an
 * HTTP AbortController), so a /cancel request can abort a detached mission.
 *
 * Layering: lives in ai-app and reaches the harness only through the facade
 * (runner + relay + abort registry + lifecycle manager are all facade exports).
 */

import { Injectable, Logger } from "@nestjs/common";
import { withUserContext } from "@/common/context/with-user-context";
import {
  MissionAbortRegistry,
  MissionFailureCode,
  MissionLifecycleManager,
  SelfDrivenEventRelay,
  SelfDrivenMissionRunner,
} from "@/modules/ai-harness/facade";
import { ObjectStorageService } from "@/modules/platform/storage/object-store/object-storage.service";
import { LibraryExportService } from "@/modules/ai-app/library/export/library-export.service";
import { AskSelfDrivenMissionStore } from "./ask-self-driven-mission.store";

/** Object-storage key for a mission's downloadable report. */
export function selfDrivenReportKey(missionId: string): string {
  return `self-driven-reports/${missionId}/report.md`;
}

/**
 * Reject `work` after `ms`. Used to bound the best-effort report offload so an
 * external storage / Google Drive hang after the `deliverable` event can't wedge
 * the consumption loop and prevent the terminal `done` event from being relayed.
 */
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface SelfDrivenDispatchInput {
  prompt: string;
  userId: string;
  clarifications?: Record<string, string>;
  analysisDepth?: "quick" | "standard" | "deep";
  /** Target output language ('zh' | 'en' or any BCP-47 locale). */
  language?: string;
}

@Injectable()
export class SelfDrivenMissionDispatcher {
  private readonly logger = new Logger(SelfDrivenMissionDispatcher.name);

  constructor(
    private readonly runner: SelfDrivenMissionRunner,
    private readonly relay: SelfDrivenEventRelay,
    private readonly store: AskSelfDrivenMissionStore,
    private readonly abortRegistry: MissionAbortRegistry,
    private readonly lifecycle: MissionLifecycleManager,
    private readonly objectStorage: ObjectStorageService,
    private readonly libraryExport: LibraryExportService,
  ) {}

  /**
   * Drive one mission to completion in the background. Never rejects — terminal
   * failures are relayed as a `self-driven.error` event and finalized.
   */
  async runInBackground(
    missionId: string,
    input: SelfDrivenDispatchInput,
    userId: string,
  ): Promise<void> {
    // Re-establish the request-scoped user context the detached task lost when
    // execution was decoupled from the HTTP request. Without this, downstream
    // user-default resolution that reads RequestContext.getUserId() (role model
    // election via getAvailableModelsAsync, BYOK key resolution, etc.) sees no
    // user and returns empty — which left every role with modelId="" and the
    // execute phase failing with "No default AI model configured".
    await withUserContext(userId, async () => {
      await this.drive(missionId, input, userId);
    });
  }

  private async drive(
    missionId: string,
    input: SelfDrivenDispatchInput,
    userId: string,
  ): Promise<void> {
    const controller = this.abortRegistry.register(missionId);
    let failureMessage: string | undefined;

    // Independent heartbeat (not event-driven): the mission can sit idle for up
    // to 10 min at the HITL gate without emitting events, so we keep the DB
    // heartbeat fresh on a timer. Liveness reclaim then fires ONLY when this
    // stops (pod dead), never merely because the human is still deciding.
    void this.store.markHeartbeat(missionId);
    const heartbeat = setInterval(() => {
      void this.store.markHeartbeat(missionId);
    }, 30_000);

    try {
      for await (const event of this.runner.run(
        missionId,
        {
          prompt: input.prompt,
          userId,
          clarifications: input.clarifications,
          analysisDepth: input.analysisDepth,
          language: input.language,
        },
        controller.signal,
      )) {
        await this.relay.emitMissionEvent(event, userId);
        if (event.type === "error") {
          failureMessage = event.message;
        }
        // Offload the final report to external object storage so it becomes a
        // durable, downloadable deliverable (reuses the platform object store,
        // same pattern as TopicReport offload). Best-effort: a storage failure
        // never fails the mission — the report also lives in the event journal,
        // which the download endpoint falls back to.
        if (
          event.type === "deliverable" &&
          event.deliverableType === "report" &&
          event.content
        ) {
          // Best-effort and strictly non-fatal: the deliverable is already
          // relayed (above) and lives in the event journal, so a slow/failing
          // offload must never break this loop or it would starve the terminal
          // `done` event and leave the UI stuck "running".
          await this.offloadReport(missionId, event.content, userId).catch(
            (err: unknown) => {
              this.logger.warn(
                `[self-driven ${missionId}] report offload errored (ignored): ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            },
          );
        }
      }
    } catch (err) {
      failureMessage = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[self-driven ${missionId}] runner threw: ${failureMessage}`,
      );
      // The generator died before yielding a terminal event — surface one so
      // the UI unsticks even though run() never reached its own error yield.
      await this.relay
        .emitMissionEvent(
          { type: "error", missionId, message: failureMessage },
          userId,
        )
        .catch(() => undefined);
    } finally {
      clearInterval(heartbeat);
      this.abortRegistry.unregister(missionId);
    }

    await this.finalize(missionId, failureMessage);
  }

  /**
   * Upload the final report markdown to external object storage and record the
   * key on the mission row. No-op (and not an error) when object storage is
   * disabled — the report stays available via the event journal fallback.
   *
   * Also performs a best-effort save to the user's connected cloud storage
   * (Google Drive) via the sanctioned LibraryExportService facade. Failures
   * are logged as warnings and never surface to the caller.
   */
  private async offloadReport(
    missionId: string,
    content: string,
    userId: string,
  ): Promise<void> {
    // Platform object-storage offload (unchanged).
    if (this.objectStorage.isEnabled()) {
      try {
        const key = selfDrivenReportKey(missionId);
        const res = await this.objectStorage.uploadText(content, key);
        if (res.success && res.key) {
          await this.store.setReportRef(
            missionId,
            res.key,
            Buffer.byteLength(content, "utf-8"),
          );
        } else {
          this.logger.warn(
            `[self-driven ${missionId}] report offload skipped: ${res.error ?? "unknown"}`,
          );
        }
      } catch (err) {
        this.logger.warn(
          `[self-driven ${missionId}] report offload failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Cloud storage save (best-effort, via library/export facade). Bounded +
    // guarded: a Google Drive token-refresh / upload hang here previously had no
    // timeout and was not wrapped, so it could wedge the loop before `done`.
    const fileName = `self-driven-report-${missionId}.md`;
    try {
      const result = await withTimeout(
        this.libraryExport.saveMarkdownToUserStorage(userId, fileName, content),
        20_000,
      );
      if (result.saved) {
        this.logger.log(
          `[self-driven ${missionId}] report saved to ${result.provider} for user ${userId}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `[self-driven ${missionId}] cloud report save failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async finalize(
    missionId: string,
    failureMessage: string | undefined,
  ): Promise<void> {
    const intent = failureMessage
      ? {
          status: "failed" as const,
          failureCode: MissionFailureCode.runtime_crashed,
          errorMessage: failureMessage,
        }
      : { status: "completed" as const };

    await this.lifecycle
      .finalize({
        missionId,
        intent,
        arbiter: this.store,
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `[self-driven ${missionId}] finalize failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return { won: false };
      });
  }
}
