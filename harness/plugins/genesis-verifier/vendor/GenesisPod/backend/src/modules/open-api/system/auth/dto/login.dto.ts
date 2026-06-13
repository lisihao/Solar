import { IsString, IsEmail, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * 用户登录 DTO
 */
export class LoginDto {
  @ApiProperty({ description: "用户邮箱", example: "user@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: "密码", example: "StrongPassword123!" })
  @IsString()
  @MinLength(6)
  password!: string;
}
