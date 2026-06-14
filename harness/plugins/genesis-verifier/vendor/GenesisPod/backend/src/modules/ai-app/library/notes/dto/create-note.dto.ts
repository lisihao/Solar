import {
  IsString,
  IsUUID,
  IsOptional,
  IsArray,
  IsBoolean,
} from "class-validator";
import { Prisma } from "@prisma/client";

/**
 * 创建笔记DTO
 */
export class CreateNoteDto {
  @IsOptional()
  @IsUUID()
  resourceId?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsArray()
  highlights?: Prisma.InputJsonValue[];

  @IsOptional()
  @IsArray()
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;
}
