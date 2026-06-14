import {
  IsOptional,
  IsEnum,
  IsString,
  IsInt,
  MaxLength,
  Min,
  Max,
} from "class-validator";
import { Type } from "class-transformer";
import { ResearchTopicType, ResearchTopicStatus } from "../types";

export class ListTopicsDto {
  @IsOptional()
  @IsEnum(ResearchTopicType)
  type?: ResearchTopicType;

  @IsOptional()
  @IsEnum(ResearchTopicStatus)
  status?: ResearchTopicStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;
}
