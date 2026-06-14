/**
 * 用户自定义 AI Provider 控制器（薄网关，PR-3 2026-05-05）
 *
 * 让用户在 UI "+ 添加自定义 provider" 表单提交后，往 ai_providers 表
 * scope=user/ownerUserId=<self> 写入条目。立刻在自家 BYOK 卡片列表里出现。
 *
 * 隔离：仅看见 / 改自己的 user-scope provider。
 * 业务逻辑下沉 UserProvidersService（律4：open-api controller 不直接注入 Prisma）。
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { UpsertCustomProviderDto } from "./user-providers.dto";
import { UserProvidersService } from "./user-providers.service";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

@UseGuards(JwtAuthGuard)
@Controller("user/providers")
export class UserProvidersController {
  constructor(private readonly providers: UserProvidersService) {}

  @Get()
  list(@Req() req: AuthenticatedRequest) {
    return this.providers.list(req.user.id);
  }

  @Post()
  create(
    @Body() dto: UpsertCustomProviderDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.providers.create(req.user.id, dto);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: Partial<UpsertCustomProviderDto>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.providers.update(req.user.id, id, dto);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.providers.remove(req.user.id, id);
  }
}
