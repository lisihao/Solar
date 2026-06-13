import { Controller, Get, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { UserByokService } from "./user-byok.service";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

/**
 * 用户 BYOK 公共接口（薄网关）：可用模型、引导状态。
 * 业务逻辑下沉 UserByokService（律4：open-api controller 不直接注入 Prisma）。
 */
@ApiTags("User - BYOK")
@Controller("user")
@UseGuards(JwtAuthGuard)
export class UserByokController {
  constructor(private readonly byok: UserByokService) {}

  @Get("available-models")
  getAvailableModels(
    @Req() req: AuthenticatedRequest,
    @Query("modelType") modelType?: string,
  ) {
    return this.byok.getAvailableModels(req.user.id, modelType);
  }

  @Patch("onboarding/complete")
  completeOnboarding(@Req() req: AuthenticatedRequest) {
    return this.byok.completeOnboarding(req.user.id);
  }

  @Get("onboarding/status")
  getOnboardingStatus(@Req() req: AuthenticatedRequest) {
    return this.byok.getOnboardingStatus(req.user.id);
  }
}
