/**
 * Public API - Ask DTO
 * Quick Q&A request validation
 */

import {
  IsString,
  IsOptional,
  IsArray,
  IsNotEmpty,
  IsIn,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

class MessageDto {
  @ApiProperty({
    description: "Message role: user, assistant, system",
    enum: ["user", "assistant", "system"],
  })
  @IsIn(["user", "assistant", "system"])
  role!: "user" | "assistant" | "system";

  @ApiProperty({ description: "Message content" })
  @IsString()
  @MaxLength(50000)
  content!: string;
}

export class AskDto {
  @ApiProperty({ description: "Question to ask" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50000)
  question!: string;

  @ApiPropertyOptional({ description: "Conversation history for context" })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => MessageDto)
  context?: MessageDto[];

  @ApiPropertyOptional({ description: "Model type preference" })
  @IsOptional()
  @IsString()
  modelType?: string;
}
