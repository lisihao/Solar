import { ApiProperty } from "@nestjs/swagger";

/**
 * 用户信息 DTO
 */
export class UserDto {
  @ApiProperty({ description: "用户ID" })
  id!: string;

  @ApiProperty({ description: "用户邮箱" })
  email!: string;

  @ApiProperty({ description: "用户名" })
  username!: string;

  @ApiProperty({ description: "全名", required: false })
  fullName?: string;

  @ApiProperty({ description: "用户角色", enum: ["USER", "ADMIN"] })
  role!: string;

  @ApiProperty({ description: "是否管理员" })
  isAdmin?: boolean;

  @ApiProperty({ description: "头像URL", required: false })
  avatarUrl?: string;

  @ApiProperty({ description: "个人简介", required: false })
  bio?: string;

  @ApiProperty({ description: "创建时间" })
  createdAt!: Date;
}

/**
 * 登录/注册响应 DTO
 */
export class AuthResponseDto {
  @ApiProperty({ description: "访问令牌" })
  accessToken!: string;

  @ApiProperty({ description: "刷新令牌" })
  refreshToken!: string;

  @ApiProperty({ description: "用户信息", type: UserDto })
  user!: UserDto;
}

/**
 * 刷新令牌响应 DTO
 */
export class RefreshTokenResponseDto {
  @ApiProperty({ description: "新的访问令牌" })
  accessToken!: string;

  @ApiProperty({ description: "新的刷新令牌" })
  refreshToken!: string;
}

/**
 * 授权码交换响应 DTO
 */
export class ExchangeCodeResponseDto extends AuthResponseDto {}

/**
 * 用户统计 DTO
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
