import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
// Credential-management surface: imports credentials from source (facade-boundary exempted).
import { UserToolsService } from "../../../platform/credentials/user-owned/user-tools/user-tools.service";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

/**
 * 用户工具目录端点（/me/tools 页面后端）
 *
 * 镜像 admin 工具目录，但叠加「当前用户 Key 状态」（configured / systemConfigured / granted）。
 * 只列 userConfigurable=true 且有 secretKeyName 的工具，noKeyRequired 工具不出现。
 */
@ApiTags("User Tools (BYOK)")
@Controller("user/tools")
@UseGuards(JwtAuthGuard)
export class UserToolsController {
  constructor(private readonly userTools: UserToolsService) {}

  /** 列出用户可配置的工具目录（含配置状态）。 */
  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const items = await this.userTools.listForUser(req.user.id);
    return { items };
  }
}
