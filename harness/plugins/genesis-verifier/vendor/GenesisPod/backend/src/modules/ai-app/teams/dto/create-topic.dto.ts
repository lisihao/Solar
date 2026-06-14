import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
  IsNotEmpty,
} from "class-validator";
import { Type } from "class-transformer";
import { TopicType } from "@prisma/client";

export class InitialAIMemberDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  aiModel!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  roleDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  systemPrompt?: string;
}

export class CreateTopicDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsEnum(TopicType)
  type?: TopicType;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatar?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  memberIds?: string[]; // 初始邀请的成员ID列表

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => InitialAIMemberDto)
  aiMembers?: InitialAIMemberDto[]; // 初始添加的AI成员（最多10个）
}
