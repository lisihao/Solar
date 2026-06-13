import {
  IsString,
  IsEnum,
  IsOptional,
  IsBoolean,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { SocialContentType, SocialContentSourceType } from "@prisma/client";

export class ProcessSourceDto {
  @IsEnum(SocialContentSourceType)
  sourceType!: SocialContentSourceType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  sourceId!: string;

  @IsEnum(SocialContentType)
  targetType!: SocialContentType;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  additionalInstructions?: string;

  @IsOptional()
  @IsBoolean()
  keepFormat?: boolean;
}
