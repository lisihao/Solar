/**
 * AskSelfDrivenApprovalService — owner-scoped HITL approval resolution.
 *
 * The self-driven `awaiting_approval` event carries requestId="" (the runner
 * yields it before the gate generates an id), and the admin /approvals endpoint
 * is admin-only — so a normal mission owner could never actually approve their
 * own plan; it would only ever auto-approve on the 10-minute timeout. This
 * service closes that gap: it resolves the open gate by missionId (via the
 * mission->requestId mapping the gate writes) and records the human response in
 * the same long_term_memories row the gate polls, exactly like the admin path.
 *
 * Ownership is asserted by the controller before this is called.
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import {
  HITL_APPROVAL_USER_ID,
  HumanApprovalAdminService,
  selfDrivenMissionGateKey,
} from "@/modules/ai-harness/facade";

@Injectable()
export class AskSelfDrivenApprovalService {
  private readonly logger = new Logger(AskSelfDrivenApprovalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly humanApprovalAdmin: HumanApprovalAdminService,
  ) {}

  /**
   * Resolve the mission's currently open gate by missionId (owner-scoped lookup
   * the admin endpoint does not do), then DELEGATE the response write to the
   * shared HumanApprovalAdminService — the same canonical path /admin/approvals
   * uses, which the SelfDrivenHitlGateService poll picks up within ~2s. No
   * hand-rolled long_term_memories upsert. Throws NotFound if no gate is open.
   */
  async approve(
    missionId: string,
    approved: boolean,
    feedback?: string,
    analysisDepth?: "quick" | "standard" | "deep",
    choice?: string,
    choices?: string[],
  ): Promise<{ requestId: string }> {
    const mapping = await this.prisma.longTermMemory.findUnique({
      where: {
        userId_key: {
          userId: HITL_APPROVAL_USER_ID,
          key: selfDrivenMissionGateKey(missionId),
        },
      },
    });
    const requestId = (mapping?.value as { requestId?: string } | null)
      ?.requestId;
    if (!requestId) {
      throw new NotFoundException("No open approval gate for this mission");
    }

    // Depth and multi-select choice ids are carried opaquely through the generic
    // approval `input` field so HumanApprovalAdminService stays self-driven-agnostic;
    // the self-driven gate decodes them. feedback stays the append-instruction channel.
    // choice (single, back-compat) and choices (multi-select array) are both forwarded;
    // the gate poller prefers choiceIds (from choices) over the single choice.
    const inputPayload: Record<string, unknown> = {};
    if (analysisDepth) inputPayload["analysisDepth"] = analysisDepth;
    if (choices && choices.length > 0) inputPayload["choiceIds"] = choices;
    await this.humanApprovalAdmin.respond(requestId, {
      approved,
      feedback: feedback ?? undefined,
      input: Object.keys(inputPayload).length > 0 ? inputPayload : undefined,
      choice: choice ?? undefined,
    });

    this.logger.log(
      `[approve] mission=${missionId} requestId=${requestId} approved=${approved} ` +
        `choice=${choice ?? "none"} choices=${choices ? JSON.stringify(choices) : "none"}`,
    );
    return { requestId };
  }
}
