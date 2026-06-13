import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  HumanApprovalAdminService,
  ApprovalRequestPayload,
  ApprovalRespondInput,
} from "@/modules/ai-harness/facade";

/**
 * 人机协作审批 Admin 控制器（薄 HTTP，逻辑在 ai-harness/HumanApprovalAdminService）。
 * - GET  /admin/approvals/pending     → 列出等待人类审批的请求
 * - POST /admin/approvals/:id/respond → 提交人类审批响应
 */
@ApiTags("Admin - Human Approvals")
@Controller("admin/approvals")
@UseGuards(JwtAuthGuard, AdminGuard)
export class ApprovalsController {
  constructor(
    private readonly humanApprovalService: HumanApprovalAdminService,
  ) {}

  @Get("pending")
  @ApiOperation({ summary: "List all pending human approval requests" })
  @ApiResponse({
    status: 200,
    description: "Array of pending approval payloads",
  })
  listPending(): Promise<ApprovalRequestPayload[]> {
    return this.humanApprovalService.listPending();
  }

  @Post(":requestId/respond")
  @ApiOperation({ summary: "Respond to a pending human approval request" })
  @ApiResponse({ status: 201, description: "Response recorded" })
  respond(
    @Param("requestId") requestId: string,
    @Body() body: ApprovalRespondInput,
  ): Promise<{ success: boolean; requestId: string; approved: boolean }> {
    return this.humanApprovalService.respond(requestId, body);
  }
}
