import {
  IsString,
  IsEnum,
  IsOptional,
  IsUrl,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { SocialContentType } from "@prisma/client";

export class ProcessUrlDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({}, { message: "请提供有效的 URL" })
  @MaxLength(2048, { message: "URL 过长（最大 2048 字符）" })
  url!: string;

  @IsEnum(SocialContentType)
  targetType!: SocialContentType;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  additionalInstructions?: string;
}
