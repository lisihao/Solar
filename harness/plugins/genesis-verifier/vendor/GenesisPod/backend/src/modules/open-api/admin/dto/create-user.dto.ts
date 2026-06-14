import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  IsEnum,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * 管理员创建用户 DTO
 */
export class CreateUserDto {
  @ApiProperty({ description: "用户邮箱", example: "user@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: "用户名",
    example: "john_doe",
    required: false,
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    description: "用户角色",
    enum: ["USER", "ADMIN"],
    example: "USER",
    required: false,
  })
  @IsOptional()
  @IsEnum(["USER", "ADMIN"])
  role?: "USER" | "ADMIN";

  @ApiProperty({
    description: "密码",
    example: "StrongPassword123!",
    minLength: 8,
    required: false,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
