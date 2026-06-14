/**
 * HumanApprovalPrimitiveService — the shared, GENERIC DB primitive for
 * human-in-the-loop approval (store request → poll for response → cleanup) over
 * long_term_memories. Pure I/O: NO timeout policy, NO sanitization, NO
 * mission/abort semantics — those are caller concerns (HumanApprovalTool keeps
 * its timeout=throw policy; SelfDrivenHitlGateService keeps mission mapping,
 * feedback sanitize, abort, and auto-approve-on-timeout).
 *
 * Extracted 2026-06-05 so the tool and the self-driven gate stop duplicating the
 * identical store/poll/cleanup boilerplate. Both delegate here.
 */

import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

/** Owner used for approval bookkeeping rows. */
export const HUMAN_APPROVAL_USER_ID = "system";

const DEFAULT_POLL_INTERVAL_MS = 2000;

export interface ApprovalResponseData {
  approved?: boolean;
  choice?: string;
  input?: unknown;
  feedback?: string;
}

/** Discriminated poll outcome — the caller decides what each means. */
export type ApprovalPollResult =
  | { readonly kind: "resolved"; readonly data: ApprovalResponseData }
  | { readonly kind: "aborted" }
  | { readonly kind: "timed_out" };

export const approvalRequestKey = (requestId: string): string =>
  `approval:request:${requestId}`;
export const approvalResponseKey = (requestId: string): string =>
  `approval:response:${requestId}`;

@Injectable()
export class HumanApprovalPrimitiveService {
  private readonly logger = new Logger(HumanApprovalPrimitiveService.name);
  private memoryTableReady: boolean | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Whether the long_term_memories table exists (cached after first check). */
  async tableReady(): Promise<boolean> {
    if (this.memoryTableReady !== null) return this.memoryTableReady;
    try {
      const result = await this.prisma.$queryRaw<[{ exists: boolean }]>(
        Prisma.sql`SELECT EXISTS(
          SELECT 1 FROM information_schema.tables
          WHERE table_schema='public' AND table_name='long_term_memories'
        ) AS "exists"`,
      );
      this.memoryTableReady = result[0]?.exists ?? false;
    } catch {
      this.memoryTableReady = false;
    }
    return this.memoryTableReady;
  }

  /** Upsert an `approval:request:{requestId}` row. Caller owns the payload shape. */
  async storeRequest(args: {
    requestId: string;
    payload: unknown;
    tags: readonly string[];
    expiresAt: Date;
  }): Promise<void> {
    const key = approvalRequestKey(args.requestId);
    await this.prisma.longTermMemory.upsert({
      where: { userId_key: { userId: HUMAN_APPROVAL_USER_ID, key } },
      create: {
        userId: HUMAN_APPROVAL_USER_ID,
        key,
        type: "human_approval_request",
        value: args.payload as never,
        importance: 8,
        tags: [...args.tags],
        expiresAt: args.expiresAt,
      },
      update: { value: args.payload as never, expiresAt: args.expiresAt },
    });
  }

  /**
   * Poll `approval:response:{requestId}` until it appears, the signal aborts, or
   * the timeout elapses. Does NOT clean up — the caller calls {@link cleanup}.
   */
  async pollForResponse(
    requestId: string,
    timeoutMs: number,
    signal?: AbortSignal,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ): Promise<ApprovalPollResult> {
    const key = approvalResponseKey(requestId);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (signal?.aborted) return { kind: "aborted" };
      await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
      if (signal?.aborted) return { kind: "aborted" };

      let record: { value: unknown } | null = null;
      try {
        record = await this.prisma.longTermMemory.findUnique({
          where: { userId_key: { userId: HUMAN_APPROVAL_USER_ID, key } },
        });
      } catch (err) {
        this.logger.warn(
          `[poll ${requestId}] DB error (retrying): ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
      if (record) {
        return { kind: "resolved", data: record.value as ApprovalResponseData };
      }
    }
    return { kind: "timed_out" };
  }

  /** Delete the given approval bookkeeping keys (request/response/mapping). */
  async cleanup(keys: readonly string[]): Promise<void> {
    if (keys.length === 0) return;
    await this.prisma.longTermMemory
      .deleteMany({
        where: { userId: HUMAN_APPROVAL_USER_ID, key: { in: [...keys] } },
      })
      .catch((err: unknown) =>
        this.logger.debug(
          `cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }
}
