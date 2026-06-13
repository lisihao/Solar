import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { KeyRequestStatus } from "@prisma/client";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
// Credential-admin surface imports credentials from source (not the engine
// facade barrel) to avoid circular-barrel DI breakage; eslint-exempted below.
import { KeyRequestsService } from "../../../platform/credentials/governance/key-requests/key-requests.service";
import {
  ApproveKeyRequestDto,
  RejectKeyRequestDto,
} from "./dto/approve-reject.dto";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

@ApiTags("Admin - Key Requests")
@Controller("admin/key-requests")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminKeyRequestsController {
  constructor(private readonly service: KeyRequestsService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("userId") userId?: string,
    @Query("provider") provider?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    const parsedStatus =
      status &&
      Object.values(KeyRequestStatus).includes(status as KeyRequestStatus)
        ? (status as KeyRequestStatus)
        : undefined;
    const items = await this.service.listAll({
      status: parsedStatus,
      userId,
      provider,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
    return { items };
  }

  @Post(":id/approve")
  async approve(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ApproveKeyRequestDto,
  ) {
    return this.service.approve(id, {
      modelDbId: dto.modelDbId,
      userQuotaCents: dto.userQuotaCents ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      approvedBy: req.user.email,
      note: dto.note,
    });
  }

  @Post(":id/reject")
  async reject(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RejectKeyRequestDto,
  ) {
    return this.service.reject(id, req.user.email, dto.reason);
  }
}
