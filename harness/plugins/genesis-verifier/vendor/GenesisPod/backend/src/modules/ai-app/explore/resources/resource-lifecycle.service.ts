import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";

export type LifecycleAction =
  | "HEALTH_CHECK_BROKEN"
  | "ARCHIVED"
  | "HARD_DELETED"
  | "RECOVERED"
  | "INGESTION_REJECTED";

export type LifecycleActor =
  | "SCHEDULER"
  | "MANUAL_SCRIPT"
  | "API_ADMIN"
  | "INGESTION_RSS";

export interface LifecycleEventInput {
  resourceId: string;
  action: LifecycleAction;
  reason: string;
  actor: LifecycleActor;
  snapshot?: {
    sourceUrl?: string | null;
    title?: string | null;
    type?: string | null;
  };
  metadata?: Record<string, unknown>;
}

@Injectable()
export class ResourceLifecycleService {
  private readonly logger = new Logger(ResourceLifecycleService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(event: LifecycleEventInput): Promise<void> {
    try {
      await this.prisma.resourceLifecycleEvent.create({
        data: {
          resourceId: event.resourceId,
          action: event.action,
          reason: event.reason.slice(0, 80),
          actor: event.actor,
          sourceUrl: event.snapshot?.sourceUrl ?? null,
          title: event.snapshot?.title?.slice(0, 1000) ?? null,
          type: event.snapshot?.type ?? null,
          metadata: (event.metadata ?? {}) as never,
        },
      });
    } catch (e) {
      this.logger.error(
        `Failed to record lifecycle event for ${event.resourceId} (${event.action}/${event.reason}): ${(e as Error).message}`,
      );
    }
  }

  async recordBatch(events: LifecycleEventInput[]): Promise<void> {
    if (events.length === 0) return;
    try {
      await this.prisma.resourceLifecycleEvent.createMany({
        data: events.map((event) => ({
          resourceId: event.resourceId,
          action: event.action,
          reason: event.reason.slice(0, 80),
          actor: event.actor,
          sourceUrl: event.snapshot?.sourceUrl ?? null,
          title: event.snapshot?.title?.slice(0, 1000) ?? null,
          type: event.snapshot?.type ?? null,
          metadata: (event.metadata ?? {}) as never,
        })),
      });
    } catch (e) {
      this.logger.error(
        `Failed to batch-record ${events.length} lifecycle events: ${(e as Error).message}`,
      );
    }
  }
}
