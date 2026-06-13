import {
  IsString,
  IsOptional,
  MinLength,
  MaxLength,
  IsUrl,
  ArrayMaxSize,
  IsIn,
  Matches,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";
import { SUPPORTED_LOCALES } from "@/common/constants/locales";

/**
 * 用户偏好设置 DTO（class 形式，class-validator 才能递归校验 nested object）
 */
class UserPreferencesDto {
  @IsOptional()
  @IsIn([...SUPPORTED_LOCALES])
  language?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_+\-/]*$/, {
    message: "timezone must be valid IANA format (e.g., Asia/Shanghai)",
  })
  @Matches(/\//, { message: 'timezone must contain "/"' })
  timezone?: string;

  @IsOptional()
  @IsIn(["light", "dark", "system"])
  theme?: "light" | "dark" | "system";
}

/**
 * 更新用户个人信息 DTO
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(500)
  avatarUrl?: string;

  @IsOptional()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  @ArrayMaxSize(20)
  interests?: string[];

  // 用户偏好设置（nested class 确保 class-validator 递归校验）
  @IsOptional()
  @ValidateNested()
  @Type(() => UserPreferencesDto)
  preferences?: UserPreferencesDto;
}
