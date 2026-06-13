import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
// Credential-management surface: imports credentials from source (the engine
// facade barrel would circular-load); facade-boundary exempted for ai-app/byok.
import { AuthorizationService } from "../../../platform/credentials/governance/authorization/authorization.service";
import {
  ApproveAuthorizationDto,
  CreateAuthorizationRequestDto,
  RejectAuthorizationDto,
} from "./dto/authorization.dto";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

/**
 * 2026-05-27 BYOK：用户「向系统申请授权」（每页一个按钮）。工具/技能授权工单。
 */
@ApiTags("User Authorization (BYOK)")
@Controller("user/authorization")
@UseGuards(JwtAuthGuard)
export class UserAuthorizationController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post("requests")
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateAuthorizationRequestDto,
  ) {
    return this.authorization.createRequest(req.user.id, dto);
  }

  @Get("requests")
  async myRequests(@Req() req: AuthenticatedRequest) {
    const items = await this.authorization.listMyRequests(req.user.id);
    return { items };
  }

  @Get("grants")
  async myGrants(@Req() req: AuthenticatedRequest) {
    const items = await this.authorization.listMyGrants(req.user.id);
    return { items };
  }

  @Delete("requests/:id")
  async cancel(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.authorization.cancelRequest(req.user.id, id);
  }
}

/**
 * 管理员审批授权申请。
 */
@ApiTags("Admin Authorization (BYOK)")
@Controller("admin/authorization")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminAuthorizationController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get("requests/pending")
  async pending() {
    const items = await this.authorization.listPending();
    return { items };
  }

  @Post("requests/:id/approve")
  async approve(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: ApproveAuthorizationDto,
  ) {
    return this.authorization.approve(req.user.id, id, dto);
  }

  @Post("requests/:id/reject")
  async reject(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RejectAuthorizationDto,
  ) {
    return this.authorization.reject(req.user.id, id, dto);
  }

  @Delete("grants/:id")
  async revoke(@Req() req: AuthenticatedRequest, @Param("id") id: string) {
    return this.authorization.revokeGrant(id, req.user.id);
  }
}
