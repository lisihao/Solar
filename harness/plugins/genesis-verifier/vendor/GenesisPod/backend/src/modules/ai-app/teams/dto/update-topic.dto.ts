import { IsString, IsOptional, IsEnum, MaxLength } from "class-validator";
import { TopicType } from "@prisma/client";

export class UpdateTopicDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- open-ended settings bag; shape varies by team configuration
  settings?: Record<string, any>;
}
