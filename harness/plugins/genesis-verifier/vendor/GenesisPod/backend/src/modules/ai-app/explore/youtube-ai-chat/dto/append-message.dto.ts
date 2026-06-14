import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class AppendChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  videoId!: string;

  @IsString()
  @IsIn(["user", "assistant"])
  role!: "user" | "assistant";

  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  modelId?: string;
}
