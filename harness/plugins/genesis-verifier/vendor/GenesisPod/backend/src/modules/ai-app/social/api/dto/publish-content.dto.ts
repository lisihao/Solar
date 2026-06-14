import { IsString, IsOptional, IsEnum, MaxLength } from "class-validator";

export class PublishContentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  connectionId?: string;

  /**
   * 内容质量档位（PR-3 单轨化引入）
   * - quick: 4-stage fast pipeline（不改写，立即真发；省 90% LLM cost / 70% 时延）
   * - standard / deep: 13-stage AI 完整改写 + 封面 + polish
   * 缺省走 quick（保留旧 publishExecutor 同步链式的快发体验）
   */
  @IsOptional()
  @IsEnum(["quick", "standard", "deep"])
  depth?: "quick" | "standard" | "deep";
}
