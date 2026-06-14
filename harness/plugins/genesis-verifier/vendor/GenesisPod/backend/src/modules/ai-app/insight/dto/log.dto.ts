import { IsOptional, IsInt, IsEnum, Min, Max } from "class-validator";
import { Type } from "class-transformer";

export class ListLogsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(["completed", "failed", "running"])
  status?: "completed" | "failed" | "running";
}
