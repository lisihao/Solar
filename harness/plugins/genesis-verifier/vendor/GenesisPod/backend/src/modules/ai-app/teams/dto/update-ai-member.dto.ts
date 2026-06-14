import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  Min,
  Max,
  MaxLength,
} from "class-validator";

export class UpdateAIMemberDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  avatar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  roleDescription?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  systemPrompt?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(100)
  contextWindow?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  responseStyle?: string;

  @IsOptional()
  @IsBoolean()
  autoRespond?: boolean;

  @IsOptional()
  @IsBoolean()
  canMentionOtherAI?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  collaborationStyle?: string;
}
