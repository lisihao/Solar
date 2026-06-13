/**
 * Skills API Module (open-api/skills)
 *
 * PR-X16: SkillsController + SkillsService 从 ai-engine/skills/api/ 上提到这里。
 * HTTP Controller 应在 L4 open-api 层，不在 L2 ai-engine。
 *
 * 路由：/api/skills/*
 */

import { Module } from "@nestjs/common";
import { SkillsController } from "./skills.controller";
import { SkillsService } from "./skills.service";

@Module({
  controllers: [SkillsController],
  providers: [SkillsService],
  exports: [SkillsService],
})
export class SkillsModule {}
