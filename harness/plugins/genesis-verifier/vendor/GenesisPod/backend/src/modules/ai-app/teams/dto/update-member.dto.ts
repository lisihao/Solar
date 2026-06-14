import { IsString, IsOptional, IsEnum, MaxLength } from "class-validator";
import { TopicRole } from "@prisma/client";

export class UpdateMemberDto {
  @IsOptional()
  @IsEnum(TopicRole)
  role?: TopicRole;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nickname?: string;
}
