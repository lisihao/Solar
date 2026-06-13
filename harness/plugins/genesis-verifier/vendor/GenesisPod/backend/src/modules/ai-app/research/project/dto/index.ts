import {
  IsString,
  IsOptional,
  IsArray,
  IsEnum,
  IsUrl,
  IsBoolean,
  MaxLength,
  IsObject,
  IsNotEmpty,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

// ==================== Research Project DTOs ====================

export class CreateStudioProjectDto {
  @ApiProperty({
    description: "项目名称",
    example: "LLM 推理优化研究",
    maxLength: 500,
  })
  @IsString()
  @MaxLength(500)
  name!: string;

  @ApiPropertyOptional({
    description: "项目描述",
    example: "研究大语言模型推理性能优化的技术方案",
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: "项目图标 (emoji)",
    example: "🔬",
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  icon?: string;

  @ApiPropertyOptional({
    description: "项目颜色",
    example: "#7C3AED",
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @ApiPropertyOptional({
    description: "研究类型",
    enum: ["FAST", "DEEP"],
    default: "FAST",
    example: "FAST",
  })
  @IsOptional()
  @IsEnum(["FAST", "DEEP"])
  researchType?: "FAST" | "DEEP";

  @ApiPropertyOptional({
    description: "可见性",
    enum: ["PRIVATE", "PUBLIC"],
    default: "PRIVATE",
  })
  @IsOptional()
  @IsEnum(["PRIVATE", "PUBLIC"])
  visibility?: "PRIVATE" | "PUBLIC";

  @ApiPropertyOptional({
    description: "跨模块来源引用（从其他模块跳转创建时携带）",
  })
  @IsOptional()
  @IsObject()
  crossModuleSource?: {
    module: string;
    sourceId: string;
    dimensionId?: string;
    contextTitle: string;
    contextSummary?: string;
    linkedAt: string;
  };
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  icon?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  @IsOptional()
  @IsEnum(["ACTIVE", "ARCHIVED"])
  status?: "ACTIVE" | "ARCHIVED";

  @IsOptional()
  @IsEnum(["PRIVATE", "PUBLIC"])
  visibility?: "PRIVATE" | "PUBLIC";
}

// ==================== Source DTOs ====================

export class AddSourceDto {
  @IsString()
  @MaxLength(1000)
  title!: string;

  @IsString()
  @MaxLength(50)
  sourceType!: string; // paper, github, news, blog, video, file

  @IsOptional()
  @IsUrl()
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  abstract?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  authors?: string[];

  @IsOptional()
  @IsString()
  publishedAt?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  resourceId?: string; // Link to existing resource
}

export class AddSourcesDto {
  @IsArray()
  sources!: AddSourceDto[];
}

// ==================== Note DTOs ====================

export class CreateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  sourceType?: string; // manual, ai-chat, generated

  @IsOptional()
  @IsString()
  chatId?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;
}

// ==================== Chat DTOs ====================

export class SendChatMessageDto {
  @IsString()
  message!: string;

  @IsOptional()
  @IsArray()
  selectedSourceIds?: string[];

  @IsOptional()
  @IsString()
  model?: string;
}

// ==================== Output DTOs ====================

export type OutputTypeValue =
  | "STUDY_GUIDE"
  | "BRIEFING_DOC"
  | "FAQ"
  | "TIMELINE"
  | "AUDIO_OVERVIEW"
  | "TREND_REPORT"
  | "COMPARISON"
  | "KNOWLEDGE_GRAPH"
  | "FLASHCARDS"
  | "QUIZ"
  | "MIND_MAP"
  | "CUSTOM";

export class GenerateOutputDto {
  @IsEnum([
    "STUDY_GUIDE",
    "BRIEFING_DOC",
    "FAQ",
    "TIMELINE",
    "AUDIO_OVERVIEW",
    "TREND_REPORT",
    "COMPARISON",
    "KNOWLEDGE_GRAPH",
    "FLASHCARDS",
    "QUIZ",
    "MIND_MAP",
    "CUSTOM",
  ])
  type!: OutputTypeValue;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  customTitle?: string;

  @IsOptional()
  @IsArray()
  selectedSourceIds?: string[];

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;
}

// ==================== Sediment DTOs ====================

export class SedimentToInsightsDto {
  @IsString()
  @IsNotEmpty()
  outputId!: string;

  @IsEnum(["add_dimension", "new_topic"])
  mode!: "add_dimension" | "new_topic";

  // For add_dimension mode
  @IsOptional()
  @IsString()
  targetTopicId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dimensionName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  dimensionDescription?: string;

  // For new_topic mode
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topicName?: string;

  @IsOptional()
  @IsString()
  topicType?: string;

  @IsOptional()
  @IsString()
  topicDescription?: string;
}

// ==================== Search DTOs ====================

export class SearchSourcesDto {
  @IsString()
  query!: string;

  @IsOptional()
  @IsEnum(["quick", "deep"])
  mode?: "quick" | "deep";

  @IsOptional()
  @IsArray()
  sources?: string[]; // arxiv, github, news, blog, local

  @IsOptional()
  @IsBoolean()
  includeInternet?: boolean;
}
