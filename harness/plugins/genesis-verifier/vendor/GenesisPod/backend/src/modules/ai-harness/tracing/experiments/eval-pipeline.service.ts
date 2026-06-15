/**
 * EvalPipelineService
 *
 * 支柱五：AI 质量自动化评估系统
 *
 * 三层评估架构，基于 TraceCollectorService 的执行数据：
 *
 *   Layer 1: 结构化检查（同步，零 AI 成本）
 *     - Span 成功率
 *     - 工具调用成功率
 *     - 执行时长合理性
 *     - 输出非空检查
 *
 *   Layer 2: AI Judge（异步，小模型评分）
 *     - 四维评分（准确性/相关性/可读性/完整性），各 1-5 分
 *     - 使用 deterministic + short profile（成本最低）
 *     - 20% 抽样率 + 低 Layer 1 分触发全量评估
 *
 *   Layer 3: 用户信号（被动收集，当前保留接口）
 *     - 点赞/踩、复制行为，交叉验证 Layer 2 分数
 *
 * 设计原则：
 *   - Layer 1 失败 → 直接返回 0 分，不消耗 Layer 2 AI 资源
 *   - Layer 2 采样评估，默认 20%，低质量 trace 触发 100%
 *   - evaluate() 整体 fire-and-forget 调用，不阻塞主业务流程
 */

import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from "@nestjs/common";
import { AIModelType } from "@prisma/client";
import { TraceCollectorService } from "../observability/trace-collector.service";
import { TraceData, SpanData } from "../observability/trace.interface";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";

// ─────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────

/** 单维度评分（1-5） */
export interface DimensionScore {
  accuracy: number;
  relevance: number;
  readability: number;
  completeness: number;
}

/** EvalPipeline 评估结果 */
export interface EvalResult {
  /** Trace ID */
  traceId: string;
  /** Layer 1 结构检查分（0-100） */
  structuralScore: number;
  /** Layer 2 AI Judge 综合分（1-5，未评估时为 null） */
  judgeScore: number | null;
  /** 各维度分（未评估时为 null） */
  dimensions: DimensionScore | null;
  /** 综合分（Layer 1 × 0.4 + Layer 2 × 0.6，未评估时仅 Layer 1） */
  overallScore: number;
  /** Layer 1 检查详情 */
  structuralChecks: StructuralCheckResult;
  /** AI Judge 改进建议（未评估时为 null） */
  suggestions: string | null;
  /** 是否触发了 AI Judge 评估 */
  judgeEvaluated: boolean;
  /** 评估时间戳 */
  evaluatedAt: Date;
}

/** Layer 1 结构检查结果 */
export interface StructuralCheckResult {
  /** Span 成功率（0-1） */
  spanSuccessRate: number;
  /** 是否有输出 */
  hasOutput: boolean;
  /** 执行时长是否合理（≤ 10 分钟） */
  durationReasonable: boolean;
  /** 工具调用成功率（0-1，无工具调用时为 1） */
  toolSuccessRate: number;
  /** 是否通过所有检查 */
  passed: boolean;
  /** 失败原因（若未通过） */
  failReason?: string;
}

// ─────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────

interface JudgeOutput {
  accuracy: number;
  relevance: number;
  readability: number;
  completeness: number;
  suggestions: string;
}

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

/** 默认 AI Judge 抽样率（20%） */
const DEFAULT_SAMPLE_RATE = 0.2;

/** 触发全量 AI Judge 的 Layer 1 阈值（低于此分强制评估） */
const FORCE_JUDGE_THRESHOLD = 60;

/** 执行时长上限（毫秒，超过视为不合理） */
const MAX_REASONABLE_DURATION_MS = 10 * 60 * 1000; // 10 min

const JUDGE_PROMPT = `You are an AI quality evaluator for an AI Agent platform. Evaluate the Agent execution based on the trace data provided.

Rate each dimension from 1 (very poor) to 5 (excellent):
- accuracy: How factually correct and precise is the output?
- relevance: How well does the output address the original task?
- readability: How clear and well-structured is the output?
- completeness: How thoroughly does it cover the required aspects?

Also provide a brief "suggestions" string with 1-2 specific improvements.

CRITICAL: Respond ONLY with valid JSON:
{
  "accuracy": 1-5,
  "relevance": 1-5,
  "readability": 1-5,
  "completeness": 1-5,
  "suggestions": "string"
}`;

// ─────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────

@Injectable()
export class EvalPipelineService {
  private readonly logger = new Logger(EvalPipelineService.name);

  /** 采样率（可通过 setSampleRate 调整） */
  private sampleRate = DEFAULT_SAMPLE_RATE;

  constructor(
    private readonly traceCollector: TraceCollectorService,
    private readonly aiChatService: AiChatService,
  ) {}

  /**
   * 评估指定 Trace（通常 fire-and-forget 调用）
   */
  async evaluate(traceId: string): Promise<EvalResult> {
    const trace = this.traceCollector.getTrace(traceId);

    if (!trace) {
      this.logger.warn(`[evaluate] Trace not found: ${traceId}`);
      return this.buildNotFoundResult(traceId);
    }

    // Layer 1: 结构检查（同步）
    const structuralChecks = this.runStructuralChecks(trace);
    const structuralScore = this.computeStructuralScore(structuralChecks);

    // Layer 2: 决定是否评估
    const shouldJudge = this.shouldRunJudge(structuralChecks, structuralScore);
    let judgeScore: number | null = null;
    let dimensions: DimensionScore | null = null;
    let suggestions: string | null = null;

    if (shouldJudge) {
      const judgeResult = await this.runAiJudge(trace).catch((err) => {
        this.logger.warn(
          `[evaluate] AI Judge failed for ${traceId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });

      if (judgeResult) {
        dimensions = {
          accuracy: judgeResult.accuracy,
          relevance: judgeResult.relevance,
          readability: judgeResult.readability,
          completeness: judgeResult.completeness,
        };
        judgeScore =
          (judgeResult.accuracy +
            judgeResult.relevance +
            judgeResult.readability +
            judgeResult.completeness) /
          4;
        suggestions = judgeResult.suggestions;
      }
    }

    const overallScore = this.computeOverallScore(structuralScore, judgeScore);

    this.logger.debug(
      `[evaluate] traceId=${traceId} structural=${structuralScore} judge=${judgeScore?.toFixed(2) ?? "skipped"} overall=${overallScore.toFixed(1)}`,
    );

    return {
      traceId,
      structuralScore,
      judgeScore,
      dimensions,
      overallScore,
      structuralChecks,
      suggestions,
      judgeEvaluated: shouldJudge && judgeScore !== null,
      evaluatedAt: new Date(),
    };
  }

  /**
   * 调整 AI Judge 采样率（0-1）
   */
  setSampleRate(rate: number): void {
    this.sampleRate = Math.max(0, Math.min(1, rate));
    this.logger.log(
      `[setSampleRate] AI Judge sample rate set to ${this.sampleRate}`,
    );
  }

  // ─── Layer 1: Structural Checks ──────────────────────────

  private runStructuralChecks(trace: TraceData): StructuralCheckResult {
    const spans = trace.spans;

    // Span 成功率
    const successSpans = spans.filter((s) => s.status === "success").length;
    const spanSuccessRate = spans.length > 0 ? successSpans / spans.length : 1;

    // 工具调用成功率
    const toolSpans = spans.filter((s) => s.type === "tool_execution");
    const successToolSpans = toolSpans.filter(
      (s) => s.status === "success",
    ).length;
    const toolSuccessRate =
      toolSpans.length > 0 ? successToolSpans / toolSpans.length : 1;

    // 输出检查
    const hasOutput = spans.some(
      (s) => s.output !== null && s.output !== undefined,
    );

    // 时长检查（duration=0 或 null 表示执行未完成或数据异常，视为不合理）
    const duration = trace.duration ?? 0;
    const durationReasonable =
      duration > 0 && duration <= MAX_REASONABLE_DURATION_MS;

    // 判断是否通过
    let passed = true;
    let failReason: string | undefined;

    if (spanSuccessRate < 0.5) {
      passed = false;
      failReason = `Low span success rate: ${(spanSuccessRate * 100).toFixed(0)}%`;
    } else if (toolSuccessRate < 0.5) {
      passed = false;
      failReason = `Low tool success rate: ${(toolSuccessRate * 100).toFixed(0)}%`;
    } else if (!hasOutput) {
      passed = false;
      failReason = "No output found in any span";
    } else if (!durationReasonable) {
      passed = false;
      failReason = `Execution too slow: ${Math.round(duration / 60000)}min`;
    }

    return {
      spanSuccessRate,
      hasOutput,
      durationReasonable,
      toolSuccessRate,
      passed,
      failReason,
    };
  }

  private computeStructuralScore(checks: StructuralCheckResult): number {
    if (!checks.passed) return 0;

    let score = 100;
    // 扣分：span 成功率不足
    score -= Math.round((1 - checks.spanSuccessRate) * 40);
    // 扣分：工具成功率不足
    score -= Math.round((1 - checks.toolSuccessRate) * 30);
    // 扣分：无输出（通常 passed=false，此处作为双保险）
    if (!checks.hasOutput) score -= 30;

    return Math.max(0, score);
  }

  // ─── Layer 2: AI Judge ───────────────────────────────────

  private shouldRunJudge(
    checks: StructuralCheckResult,
    structuralScore: number,
  ): boolean {
    // Layer 1 完全失败 → 不运行 Judge，节省 AI 资源
    if (!checks.passed) return false;

    // 低 Layer 1 分强制全量评估
    if (structuralScore < FORCE_JUDGE_THRESHOLD) return true;

    // 按采样率随机决定
    return Math.random() < this.sampleRate;
  }

  private async runAiJudge(trace: TraceData): Promise<JudgeOutput> {
    // 构建 trace 摘要（限制在 2000 字符以内，避免超 token）
    const traceSummary = this.buildTraceSummary(trace);

    const result = await this.aiChatService.chat({
      model: "",
      messages: [
        { role: "system", content: JUDGE_PROMPT },
        { role: "user", content: traceSummary },
      ],
      modelType: AIModelType.CHAT,
      taskProfile: { creativity: "deterministic", outputLength: "short" },
      responseFormat: "json",
      strictMode: true,
    });

    return this.parseJudgeOutput(result.content);
  }

  private buildTraceSummary(trace: TraceData): string {
    const spanSummaries = trace.spans
      .slice(0, 10) // 最多 10 个 span
      .map((s: SpanData) => {
        const output =
          s.output !== null && s.output !== undefined
            ? String(s.output).slice(0, 200)
            : "(no output)";
        return `[${s.type}] ${s.name}: status=${s.status}, output="${output}"`;
      })
      .join("\n");

    return [
      `Trace: ${trace.name} (${trace.type})`,
      `Status: ${trace.status}`,
      `Duration: ${trace.duration ?? 0}ms`,
      `Spans (${trace.spans.length} total, showing first 10):`,
      spanSummaries,
    ]
      .join("\n")
      .slice(0, 2000);
  }

  private parseJudgeOutput(content: string): JudgeOutput {
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) {
      throw new InternalServerErrorException("No JSON in judge response");
    }

    const parsed = JSON.parse(content.slice(firstBrace, lastBrace + 1));

    const clamp = (v: unknown): number => {
      const n = typeof v === "number" ? v : 3;
      return Math.max(1, Math.min(5, n));
    };

    return {
      accuracy: clamp(parsed.accuracy),
      relevance: clamp(parsed.relevance),
      readability: clamp(parsed.readability),
      completeness: clamp(parsed.completeness),
      suggestions:
        typeof parsed.suggestions === "string"
          ? parsed.suggestions
          : "No suggestions provided.",
    };
  }

  // ─── Scoring ─────────────────────────────────────────────

  private computeOverallScore(
    structuralScore: number,
    judgeScore: number | null,
  ): number {
    if (judgeScore === null) {
      // 仅 Layer 1
      return structuralScore;
    }

    // Layer 1 (40%) + Layer 2 (60%)，将 Layer 2 的 1-5 分归一化到 0-100
    const judgeNormalized = ((judgeScore - 1) / 4) * 100;
    return Math.round(structuralScore * 0.4 + judgeNormalized * 0.6);
  }

  private buildNotFoundResult(traceId: string): EvalResult {
    return {
      traceId,
      structuralScore: 0,
      judgeScore: null,
      dimensions: null,
      overallScore: 0,
      structuralChecks: {
        spanSuccessRate: 0,
        hasOutput: false,
        durationReasonable: false,
        toolSuccessRate: 0,
        passed: false,
        failReason: "Trace not found",
      },
      suggestions: null,
      judgeEvaluated: false,
      evaluatedAt: new Date(),
    };
  }
}
