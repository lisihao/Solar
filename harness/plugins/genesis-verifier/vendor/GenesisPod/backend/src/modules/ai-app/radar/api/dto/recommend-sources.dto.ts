import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { CreatableRadarSourceTypeDto } from "./create-radar-source.dto";

/**
 * 推荐入口 body 占位 DTO。当前 dispatcher 不接受 perTypeLimit 等任何参数
 * （prompt 固定策略）—— 历史 `perTypeLimit` 字段 2026-05-17 R3 评审认定为
 * dead 校验（DTO 校验存在但 0 消费），已删，避免给前端"参数有效"的误导。
 * 未来 stage 真接入数量限制再加字段（不接入 prompt 就别加 DTO）。
 */
export class RecommendSourcesDto {}

/**
 * 单个 AI 推荐候选项（前端把 LLM 返回的 RecommendedSource 原样回传，
 * service 层入库；nested class-validator 校验避免 SSRF / 注入）。
 */
export class RecommendedSourceCandidateDto {
  @IsEnum(CreatableRadarSourceTypeDto)
  type!: CreatableRadarSourceTypeDto;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  identifier!: string;

  @IsString()
  @MaxLength(200)
  label!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  rationale?: string;

  /**
   * LLM 推荐把握度，**0-1 浮点**（与 radar-discovery.stage.ts prompt + clamp 一致）。
   * 历史 bug：DTO 误写 @IsInt() @Max(100)，撞 LLM 实际返回 0.85 类 float 导致
   * /recommend/accept 400 风暴（iPhone 用户重试循环）。本次统一 contract：
   *   - prompt: "confidence 为 0-1 浮点数"
   *   - SKILL.md: "confidence (0-1): 你对推荐质量的把握度"
   *   - DTO: @IsNumber({ allowNaN: false }) @Min(0) @Max(1)
   * service 入库不消费此字段，DTO 校验仅防 LLM hallucinate string / out-of-range。
   */
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class AcceptRecommendedSourcesDto {
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RecommendedSourceCandidateDto)
  candidates!: RecommendedSourceCandidateDto[];
}
