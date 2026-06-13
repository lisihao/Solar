/**
 * ConsolidationController — PR-I 骨架 2026-05-15
 *
 * Admin 入口，让运维 / 产品看到 Consolidation（主动反思）的持续成果：
 *   - 历史：每轮反思 mission 的 timeline（trigger / sample / 产出 / token）
 *   - 详情：单条 RuleBase 条目的 pattern / mitigation / 来源 missions / 效用统计
 *   - 配置：cron / 抽样窗口 / token budget / 启用开关
 *
 * 路径：/api/v1/admin/dreaming/*
 * 前端：/admin/ai/dreaming（与 eval/skills/knowledge 并列，AI 元学习资产）
 *
 * 实现状态：endpoint stub + DTO 定义，PR-I.2-I.4 逐步填实现。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import {
  ReflectionMissionScheduler,
  type ConsolidationRule,
  type ConsolidationRunResult,
  type ConsolidationSchedulerConfig,
} from "../../../ai-harness/facade";
import { UpdateConsolidationConfigDto } from "./dto/update-consolidation-config.dto";

/** 历史 run 列表项 */
export interface ConsolidationRunListItem {
  id: string;
  triggeredAt: string;
  triggerKind: "cron" | "failure_threshold" | "manual";
  sampleSize: number;
  newRulesCount: number;
  rejectedCandidates: number;
  tokensUsed: number;
  durationMs: number;
  status: "success" | "failed";
}

/** 详情：单条 rule 的完整 view */
export interface ConsolidationRuleDetail extends ConsolidationRule {
  /** 衰减后的有效置信度（confidence × successRate） */
  effectiveConfidence: number;
  /** 平均 success rate */
  successRate: number;
  /** 来源 mission 详情（topic / failureCode / 摘要）*/
  derivedMissions: Array<{
    id: string;
    topic: string;
    failureCode: string;
  }>;
}

/** dashboard 顶部统计 */
export interface ConsolidationOverview {
  totalRules: number;
  activeRules: number;
  recentRunsCount: number; // 近 7d
  totalTokensSpent: number;
  averageSuccessRate: number;
  lastRunAt: string | null;
}

@ApiTags("admin/dreaming")
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/dreaming")
export class ConsolidationController {
  constructor(private readonly scheduler: ReflectionMissionScheduler) {}

  // ─── Overview ─────────────────────────────────────────────────────────────

  @Get("overview")
  @ApiOperation({
    summary: "Consolidation dashboard overview (前端 admin 进入页顶部 stat 卡)",
  })
  @ApiResponse({ status: 200 })
  async getOverview(): Promise<ConsolidationOverview> {
    return this.scheduler.getOverview();
  }

  // ─── History（持续反思成果时间线）─────────────────────────────────────────

  @Get("runs")
  @ApiOperation({
    summary: "List reflection mission runs (Consolidation 历史 timeline)",
  })
  @ApiQuery({ name: "limit", required: false })
  @ApiQuery({ name: "since", required: false, description: "ISO timestamp" })
  async listRuns(
    @Query("limit") limit?: string,
    @Query("since") since?: string,
  ): Promise<ConsolidationRunListItem[]> {
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    const parsedSince = since ? new Date(since) : undefined;
    const safeSince =
      parsedSince && !isNaN(parsedSince.getTime()) ? parsedSince : undefined;
    const runs = await this.scheduler.listRuns(parsedLimit, safeSince);
    return runs.map((r) => ({
      id: r.id,
      triggeredAt: r.triggeredAt.toISOString(),
      triggerKind: r.triggerKind as ConsolidationRunListItem["triggerKind"],
      sampleSize: r.sampledMissionIds.length,
      newRulesCount: r.newRulesCount,
      rejectedCandidates: r.rejectedCandidates,
      tokensUsed: r.tokensUsed,
      durationMs: r.durationMs,
      status: r.status as ConsolidationRunListItem["status"],
    }));
  }

  @Get("runs/:runId")
  @ApiOperation({ summary: "Single run detail" })
  async getRunDetail(@Param("runId") runId: string) {
    const run = await this.scheduler.getRunById(runId);
    if (!run) {
      throw new HttpException("Run not found", HttpStatus.NOT_FOUND);
    }
    return {
      id: run.id,
      trigger: {
        kind: run.triggerKind,
        detail: run.triggerDetail,
        triggeredAt: run.triggeredAt,
      },
      sample: {
        windowStart: run.windowStart,
        windowEnd: run.windowEnd,
        missionIds: run.sampledMissionIds,
        strategy: run.sampleStrategy,
      },
      newRulesCount: run.newRulesCount,
      rejectedCandidates: run.rejectedCandidates,
      tokensUsed: run.tokensUsed,
      durationMs: run.durationMs,
      status: run.status,
      errorMessage: run.errorMessage,
      producedRules: run.producedRules,
    };
  }

  // ─── Rules（持续反思产出的规则详情）────────────────────────────────────────

  @Get("rules")
  @ApiOperation({ summary: "List all rules sorted by effective confidence" })
  @ApiQuery({ name: "includeDisabled", required: false })
  async listRules(
    @Query("includeDisabled") includeDisabled?: string,
  ): Promise<ConsolidationRuleDetail[]> {
    const rules = await this.scheduler.listRules(includeDisabled === "true");
    return rules.map((r) => {
      const successRate =
        r.applicationCount > 0 ? r.successCount / r.applicationCount : 0;
      return {
        id: r.id,
        pattern: r.pattern,
        mitigation: r.mitigation,
        failureCodes: r.failureCodes,
        derivedFromMissionIds: r.derivedFromMissionIds,
        confidence: r.confidence,
        createdAt: r.createdAt,
        applicationCount: r.applicationCount,
        successCount: r.successCount,
        disabled: r.disabled,
        effectiveConfidence: r.confidence * successRate,
        successRate,
        derivedMissions: r.derivedFromMissionIds.map((id) => ({
          id,
          topic: "",
          failureCode: "",
        })),
      };
    });
  }

  @Get("rules/:ruleId")
  @ApiOperation({
    summary: "Single rule detail (含来源 mission / 效用历史 / 衰减曲线)",
  })
  async getRuleDetail(
    @Param("ruleId") ruleId: string,
  ): Promise<ConsolidationRuleDetail> {
    const r = await this.scheduler.getRuleById(ruleId);
    if (!r) {
      throw new HttpException("Rule not found", HttpStatus.NOT_FOUND);
    }
    const successRate =
      r.applicationCount > 0 ? r.successCount / r.applicationCount : 0;
    return {
      id: r.id,
      pattern: r.pattern,
      mitigation: r.mitigation,
      failureCodes: r.failureCodes,
      derivedFromMissionIds: r.derivedFromMissionIds,
      confidence: r.confidence,
      createdAt: r.createdAt,
      applicationCount: r.applicationCount,
      successCount: r.successCount,
      disabled: r.disabled,
      effectiveConfidence: r.confidence * successRate,
      successRate,
      derivedMissions: r.derivedFromMissionIds.map((id) => ({
        id,
        topic: "",
        failureCode: "",
      })),
    };
  }

  @Patch("rules/:ruleId/disable")
  @ApiOperation({ summary: "Admin 禁用某条 rule（保留历史不删）" })
  async disableRule(@Param("ruleId") ruleId: string): Promise<{ ok: true }> {
    await this.scheduler.disableRule(ruleId);
    return { ok: true };
  }

  @Patch("rules/:ruleId/enable")
  @ApiOperation({ summary: "重新启用 rule" })
  async enableRule(@Param("ruleId") ruleId: string): Promise<{ ok: true }> {
    await this.scheduler.enableRule(ruleId);
    return { ok: true };
  }

  @Delete("rules/:ruleId")
  @ApiOperation({
    summary: "硬删除 rule（仅 admin 手动确认；通常用 disable 即可）",
  })
  async deleteRule(@Param("ruleId") ruleId: string): Promise<{ ok: true }> {
    await this.scheduler.deleteRule(ruleId);
    return { ok: true };
  }

  // ─── Config ───────────────────────────────────────────────────────────────

  @Get("config")
  @ApiOperation({ summary: "Get Consolidation scheduler config" })
  getConfig(): ConsolidationSchedulerConfig {
    return this.scheduler.getConfig();
  }

  @Patch("config")
  @ApiOperation({
    summary: "Update scheduler config (cron / sampleSize / etc.)",
  })
  // 2026-05-15 Round 2 安全评审 Medium 修复：DTO + ValidationPipe(whitelist) 强制
  // 校验 + 剔除多余字段，防止 admin token 泄漏后任意值灌进 scheduler config。
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  async updateConfig(
    @Body() updates: UpdateConsolidationConfigDto,
  ): Promise<ConsolidationSchedulerConfig> {
    await this.scheduler.setConfig(updates);
    return this.scheduler.getConfig();
  }

  // ─── Manual trigger ───────────────────────────────────────────────────────

  @Post("runs/trigger")
  @ApiOperation({
    summary: "手动触发一次 Consolidation run（admin 调试 / 紧急反思）",
  })
  async triggerRun(): Promise<ConsolidationRunResult> {
    return this.scheduler.runOnce({
      kind: "manual",
      detail: "admin-triggered",
      triggeredAt: new Date(),
    });
  }
}
