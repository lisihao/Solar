import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

/**
 * 用户统计 DTO（内部类型，供 AuthService.getUserStats 返回结构描述使用）
 */
export class UserStatsDto {
  @ApiProperty({ description: "创建的资源数量" })
  resourcesCount!: number;

  @ApiProperty({ description: "研究项目数量" })
  researchCount!: number;

  @ApiProperty({ description: "团队数量" })
  teamsCount!: number;

  @ApiProperty({ description: "上传的文件数量" })
  uploadsCount!: number;
}

/**
 * 用户响应 DTO
 */
export class UserResponseDto {
  @ApiProperty({ description: "用户ID" })
  id!: string;

  @ApiProperty({ description: "用户邮箱" })
  email!: string;

  @ApiPropertyOptional({ description: "用户名" })
  username?: string;

  @ApiProperty({
    description: "用户角色",
    enum: ["USER", "ADMIN"],
  })
  role!: string;

  @ApiPropertyOptional({ description: "OAuth提供商" })
  oauthProvider?: string;

  @ApiProperty({ description: "订阅等级" })
  subscriptionTier!: string;

  @ApiPropertyOptional({ description: "订阅过期时间" })
  subscriptionExpiresAt?: Date;

  @ApiPropertyOptional({ description: "全名" })
  fullName?: string;

  @ApiPropertyOptional({ description: "头像URL" })
  avatarUrl?: string;

  @ApiPropertyOptional({ description: "个人简介" })
  bio?: string;

  @ApiProperty({
    description: "偏好设置",
    type: "object",
    additionalProperties: true,
  })
  preferences!: Record<string, unknown>;

  @ApiProperty({ description: "是否激活" })
  isActive!: boolean;

  @ApiProperty({ description: "是否已验证" })
  isVerified!: boolean;

  @ApiProperty({ description: "创建时间" })
  createdAt!: Date;

  @ApiProperty({ description: "更新时间" })
  updatedAt!: Date;

  @ApiPropertyOptional({ description: "最后登录时间" })
  lastLoginAt?: Date;
}

/**
 * 用户资料响应 DTO (隐藏敏感信息)
 */
export class UserProfileResponseDto {
  @ApiProperty({ description: "用户ID" })
  id!: string;

  @ApiProperty({ description: "用户邮箱" })
  email!: string;

  @ApiPropertyOptional({ description: "用户名" })
  username?: string;

  @ApiProperty({
    description: "用户角色",
    enum: ["USER", "ADMIN"],
  })
  role!: string;

  @ApiProperty({ description: "是否管理员" })
  isAdmin!: boolean;

  @ApiProperty({ description: "订阅等级" })
  subscriptionTier!: string;

  @ApiPropertyOptional({ description: "订阅过期时间" })
  subscriptionExpiresAt?: Date;

  @ApiPropertyOptional({ description: "全名" })
  fullName?: string;

  @ApiPropertyOptional({ description: "头像URL" })
  avatarUrl?: string;

  @ApiPropertyOptional({ description: "个人简介" })
  bio?: string;

  @ApiProperty({
    description: "偏好设置",
    type: "object",
    additionalProperties: true,
  })
  preferences!: Record<string, unknown>;

  @ApiProperty({ description: "创建时间" })
  createdAt!: Date;
}

/**
 * 用户列表响应 DTO
 */
export class UserListResponseDto {
  @ApiProperty({ description: "用户列表", type: [UserResponseDto] })
  items!: UserResponseDto[];

  @ApiProperty({ description: "总数" })
  total!: number;

  @ApiProperty({ description: "页码" })
  page!: number;

  @ApiProperty({ description: "每页数量" })
  pageSize!: number;
}
