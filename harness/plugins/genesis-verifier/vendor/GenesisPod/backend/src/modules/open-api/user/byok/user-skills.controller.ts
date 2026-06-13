import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { UserSkillsService } from "./user-skills.service";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

/**
 * 2026-05-28 BYOK「我的技能」(授权版)：系统技能目录 + 当前用户授权状态。
 * 申请授权走既有 POST /user/authorization/requests（type=SKILL_GRANT）。
 */
@ApiTags("User Skills (BYOK)")
@Controller("user/skills")
@UseGuards(JwtAuthGuard)
export class UserSkillsController {
  constructor(private readonly userSkills: UserSkillsService) {}

  @Get()
  async list(@Req() req: AuthenticatedRequest) {
    const items = await this.userSkills.listForUser(req.user.id);
    return { items };
  }
}
