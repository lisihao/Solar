/**
 * HarnessInspectorController — 暴露内部状态给 Inspector UI / 调试
 *
 * 双重防护（建议修：单 NODE_ENV 不安全，运维错配会泄漏）：
 *   1. HarnessModule 仅在 NODE_ENV !== production 注册本 controller
 *   2. 每个 endpoint 运行时再次检查 process.env.HARNESS_INSPECTOR_ENABLED === "1"
 *      生产环境就算 NODE_ENV 被错配，第二道闸默认关闭也能挡住
 *
 * 端点（GET 只读）：
 *   /harness/inspector/agents
 *   /harness/inspector/loops
 *   /harness/inspector/skills
 *   /harness/inspector/checkpoints/:agentId
 *   /harness/inspector/events/:agentId
 *   /harness/inspector/staged-skills
 *
 * Migrated from ai-harness/agents/dev-tools/inspector.controller.ts (PR-X17).
 */

function assertInspectorEnabled(): void {
  if (process.env.NODE_ENV === "production") {
    throw new ForbiddenException("HarnessInspector is disabled in production");
  }
  if (process.env.HARNESS_INSPECTOR_ENABLED !== "1") {
    throw new ForbiddenException(
      "HarnessInspector requires HARNESS_INSPECTOR_ENABLED=1 to be set explicitly",
    );
  }
}

import {
  Controller,
  ForbiddenException,
  Get,
  Optional,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { LoopRegistry } from "../../../ai-harness/runner/loop/loop-registry";
import { BuiltinSkillCatalog } from "../../../ai-harness/facade";
import { SpecAgentRegistry } from "../../../ai-harness/agents/core/spec-agent-registry";
import { AgentStepCheckpointService } from "../../../ai-harness/facade";
import { AgentEventStore } from "../../../ai-harness/memory/checkpoint/agent-event-store";
import { SkillLearningCoordinator } from "../../../ai-harness/agents/learning/skill-learning-coordinator";

// 三层防护（S2 audit fix 2026-05-04，原 v1 仅 ENV 双闸不安全）：
//   ① 类级 @UseGuards(JwtAuthGuard, AdminGuard) — 必须 admin 身份
//   ② NODE_ENV !== production
//   ③ HARNESS_INSPECTOR_ENABLED === "1"
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("harness/inspector")
export class HarnessInspectorController {
  constructor(
    private readonly loops: LoopRegistry,
    private readonly skills: BuiltinSkillCatalog,
    private readonly specs: SpecAgentRegistry,
    @Optional() private readonly checkpoints?: AgentStepCheckpointService,
    @Optional() private readonly events?: AgentEventStore,
    @Optional() private readonly learning?: SkillLearningCoordinator,
  ) {}

  @Get("agents")
  listAgents(): { id: string }[] {
    assertInspectorEnabled();
    return this.specs.getAllIds().map((id) => ({ id }));
  }

  @Get("loops")
  listLoops(): { kinds: string[] } {
    assertInspectorEnabled();
    return { kinds: this.loops.list() };
  }

  @Get("skills")
  listSkills(): { skills: { name: string; description: string }[] } {
    assertInspectorEnabled();
    return {
      skills: this.skills.all().map((s) => ({
        name: s.frontmatter.name,
        description: s.frontmatter.description,
      })),
    };
  }

  @Get("staged-skills")
  listStagedSkills(): { staged: { name: string; score: number }[] } {
    assertInspectorEnabled();
    if (!this.learning) return { staged: [] };
    return {
      staged: this.learning
        .listStaged()
        .map((s) => ({ name: s.frontmatter.name, score: s.score })),
    };
  }

  @Get("checkpoints/:agentId")
  async listCheckpoints(@Param("agentId") agentId: string): Promise<{
    checkpoints: unknown[];
  }> {
    assertInspectorEnabled();
    if (!this.checkpoints) return { checkpoints: [] };
    return { checkpoints: [...(await this.checkpoints.listForAgent(agentId))] };
  }

  @Get("events/:agentId")
  async listEvents(
    @Param("agentId") agentId: string,
    @Query("fromSeq") fromSeq?: string,
    @Query("limit") limit?: string,
  ): Promise<{ events: unknown[] }> {
    assertInspectorEnabled();
    if (!this.events) return { events: [] };
    const stream = await this.events.readStream(agentId, {
      fromSeq: fromSeq ? Number(fromSeq) : undefined,
      limit: limit ? Number(limit) : 200,
    });
    return { events: [...stream] };
  }
}
