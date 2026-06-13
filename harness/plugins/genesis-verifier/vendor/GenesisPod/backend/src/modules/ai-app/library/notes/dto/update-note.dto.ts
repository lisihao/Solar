import { IsString, IsOptional, IsArray, IsBoolean } from "class-validator";
import { Prisma } from "@prisma/client";

/**
 * 更新笔记DTO
 */
export class UpdateNoteDto {
  @IsOptional()
  @IsString()
  content?: string;

  @IsOptional()
  @IsArray()
  highlights?: Prisma.InputJsonValue[];

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @IsOptional()
  aiInsights?: Prisma.InputJsonValue;

  @IsOptional()
  @IsArray()
  graphNodes?: Prisma.InputJsonValue[];
}
