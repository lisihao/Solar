/**
 * Public API - Chat DTO
 * General chat request validation
 */

import {
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsIn,
  MaxLength,
  ArrayMaxSize,
  ArrayMinSize,
  ValidateNested,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

class ChatMessageDto {
  @ApiProperty({
    description: "Message role",
    enum: ["user", "assistant", "system"],
  })
  @IsIn(["user", "assistant", "system"])
  role!: "user" | "assistant" | "system";

  @ApiProperty({ description: "Message content" })
  @IsString()
  @MaxLength(50000)
  content!: string;
}

export class ChatDto {
  @ApiProperty({ description: "Chat messages", type: [ChatMessageDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  @ApiPropertyOptional({ description: "Model type preference" })
  @IsOptional()
  @IsString()
  modelType?: string;

  @ApiPropertyOptional({ description: "Whether to stream response" })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}
