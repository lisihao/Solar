import { IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * 授权码交换 DTO
 */
export class ExchangeCodeDto {
  @ApiProperty({ description: "授权码", example: "abc123def456" })
  @IsString()
  @MinLength(1)
  code!: string;
}
