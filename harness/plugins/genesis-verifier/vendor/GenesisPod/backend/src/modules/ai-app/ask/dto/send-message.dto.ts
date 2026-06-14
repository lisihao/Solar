import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsBoolean,
  IsArray,
} from "class-validator";

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  modelId?: string;

  @IsOptional()
  @IsBoolean()
  webSearch?: boolean;

  /**
   * 是否启用工具调用（搜索、短期记忆等）
   * @default false
   */
  @IsOptional()
  @IsBoolean()
  enableTools?: boolean;

  /**
   * 知识库 ID 列表，用于 RAG 查询
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledgeBaseIds?: string[];
}
