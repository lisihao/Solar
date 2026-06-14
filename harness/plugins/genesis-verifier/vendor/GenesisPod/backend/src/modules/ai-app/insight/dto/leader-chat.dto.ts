import {
  IsString,
  IsOptional,
  IsNotEmpty,
  MaxLength,
  Matches,
} from "class-validator";
import { Transform } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class LeaderChatDto {
  @ApiProperty({ description: "用户消息内容" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  @Transform(({ value }: { value: string }) => value?.trim())
  message!: string;

  @ApiPropertyOptional({ description: "关联的 Mission ID" })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{20,36}$/, {
    message: "missionId must be a valid CUID or UUID",
  })
  missionId?: string;
}
