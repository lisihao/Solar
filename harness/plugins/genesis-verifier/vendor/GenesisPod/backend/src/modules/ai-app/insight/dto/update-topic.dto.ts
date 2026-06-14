import {
  IsString,
  IsOptional,
  IsEnum,
  IsObject,
  MaxLength,
  IsIn,
  Validate,
} from "class-validator";
import { ResearchTopicStatus, RefreshFrequency } from "../types";
import { IsBoundedJsonObjectConstraint } from "./validators/bounded-json.validator";

export class UpdateTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50000)
  description?: string;

  @IsOptional()
  @IsEnum(ResearchTopicStatus)
  status?: ResearchTopicStatus;

  @IsOptional()
  @IsObject()
  @Validate(IsBoundedJsonObjectConstraint)
  topicConfig?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsEnum(RefreshFrequency)
  refreshFrequency?: RefreshFrequency;

  @IsOptional()
  @IsString()
  @IsIn(["zh", "en"])
  @MaxLength(10)
  language?: string;
}
