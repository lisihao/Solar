import {
  IsEnum,
  IsString,
  IsOptional,
  IsObject,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { ResearchTopicType } from "../types";

export class GetTemplatesDto {
  @IsEnum(ResearchTopicType)
  type!: ResearchTopicType;
}

export class CreateFromTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  templateId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsObject()
  topicConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  customizations?: {
    dimensions?: {
      add?: Array<{
        name: string;
        description?: string;
        searchQueries?: string[];
      }>;
      remove?: string[];
    };
  };
}
