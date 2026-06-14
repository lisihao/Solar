import { Transform } from "class-transformer";
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from "class-validator";
import { RadarSourceTypeDto } from "./create-radar-source.dto";

export class RadarFeedQueryDto {
  @IsOptional()
  @IsEnum(RadarSourceTypeDto)
  type?: RadarSourceTypeDto;

  @IsOptional()
  @IsDateString()
  since?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(100)
  minRelevance?: number;

  /**
   * 仅显示通过 AI 评分的 item（accepted=true）。
   * 设计为单值开关：传 "true" 即开启，**省略 / "false" / 任何其他值都视为关闭**
   * （此处不接受 false 字面量，避免双语义；前端应只在勾选时设置 query）。
   */
  @IsOptional()
  @IsIn(["true"])
  acceptedOnly?: "true";

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
