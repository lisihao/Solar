import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "@/common/prisma/prisma.service";

/**
 * 人机协作审批管理服务（列待审 / 提交响应）。
 * standards/24 薄网关整改（Wave C）：原逻辑在 open-api/admin/approvals controller
 * 内直接操作 Prisma；下沉到 ai-harness（human-in-the-loop 属 agent 运行时领域）。
 * HumanApprovalTool 以 key="approval:request:{id}" 存 LongTermMemory，本服务读写之。
 */
export interface ApprovalRequestPayload {
  requestId: string;
  approvalType: "confirm" | "choose" | "input" | "review";
  prompt: string;
  context?: { summary?: string; details?: unknown; preview?: string };
  choices?: { id: string; label: string; description?: string }[];
  defaultAction?: string;
  status: "pending" | "responded";
  createdAt: string;
}

export interface ApprovalRespondInput {
  approved: boolean;
  choice?: string;
  input?: unknown;
  feedback?: string;
}

@Injectable()
export class HumanApprovalAdminService implements OnModuleInit {
  private readonly logger = new Logger(HumanApprovalAdminService.name);
  private memoryTableReady = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      const result = await this.prisma.$queryRaw<[{ exists: boolean }]>(
        Prisma.sql`SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='long_term_memories') AS "exists"`,
      );
      this.memoryTableReady = result[0]?.exists ?? false;
    } catch {
      this.memoryTableReady = false;
    }
    if (!this.memoryTableReady) {
      this.logger.warn(
        "[HumanApprovalAdmin] long_term_memories table not found — approval endpoints degraded until migration runs",
      );
    }
  }

  async listPending(): Promise<ApprovalRequestPayload[]> {
    if (!this.memoryTableReady) return [];
    const records = await this.prisma.longTermMemory.findMany({
      where: { userId: "system", key: { startsWith: "approval:request:" } },
      orderBy: { createdAt: "asc" },
    });
    return records
      .map((r) => r.value as unknown as ApprovalRequestPayload)
      .filter((v) => v?.status === "pending");
  }

  async respond(
    requestId: string,
    body: ApprovalRespondInput,
  ): Promise<{ success: boolean; requestId: string; approved: boolean }> {
    if (!this.memoryTableReady) {
      throw new ServiceUnavailableException(
        "Approval storage is not available — long_term_memories table has not been migrated yet",
      );
    }
    const RESPONSE_KEY = `approval:response:${requestId}`;
    const USER_ID = "system";
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const value = {
      approved: body.approved,
      choice: body.choice ?? null,
      input: body.input ?? null,
      feedback: body.feedback ?? null,
    } as never;

    await this.prisma.longTermMemory.upsert({
      where: { userId_key: { userId: USER_ID, key: RESPONSE_KEY } },
      create: {
        userId: USER_ID,
        key: RESPONSE_KEY,
        type: "human_approval_response",
        value,
        importance: 10,
        tags: ["human-approval", "response"],
        expiresAt,
      },
      update: { value, expiresAt },
    });

    this.logger.log(
      `[HumanApprovalAdmin] Responded to [${requestId}]: approved=${body.approved}`,
    );
    return { success: true, requestId, approved: body.approved };
  }
}
