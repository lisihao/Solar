import {
  IsEnum,
  IsOptional,
  IsEmail,
  IsArray,
  IsString,
  MaxLength,
  IsNotEmpty,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export enum CollaboratorRole {
  VIEWER = "VIEWER",
  EDITOR = "EDITOR",
  ADMIN = "ADMIN",
}

/**
 * 协作者申请状态
 */
export enum CollaboratorStatus {
  PENDING = "PENDING", // 待审核
  ACCEPTED = "ACCEPTED", // 已通过
  REJECTED = "REJECTED", // 已拒绝
}

/**
 * 专题可见性
 */
export enum TopicVisibility {
  PRIVATE = "PRIVATE", // 私有：仅所有者可见
  SHARED = "SHARED", // 共享：所有者和协作者可见
  PUBLIC = "PUBLIC", // 公开：所有人可见
}

/**
 * 添加协作者 DTO
 */
export class AddCollaboratorDto {
  @ApiProperty({ description: "用户邮箱" })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({
    description: "协作者角色",
    enum: CollaboratorRole,
    default: CollaboratorRole.VIEWER,
  })
  @IsEnum(CollaboratorRole)
  @IsOptional()
  role?: CollaboratorRole = CollaboratorRole.VIEWER;
}

/**
 * 批量添加协作者 DTO
 */
export class AddCollaboratorsBatchDto {
  @ApiProperty({ description: "用户邮箱列表", type: [String] })
  @IsArray()
  @IsEmail({}, { each: true })
  emails!: string[];

  @ApiPropertyOptional({
    description: "协作者角色",
    enum: CollaboratorRole,
    default: CollaboratorRole.VIEWER,
  })
  @IsEnum(CollaboratorRole)
  @IsOptional()
  role?: CollaboratorRole = CollaboratorRole.VIEWER;
}

/**
 * 更新协作者角色 DTO
 */
export class UpdateCollaboratorRoleDto {
  @ApiProperty({ description: "协作者角色", enum: CollaboratorRole })
  @IsEnum(CollaboratorRole)
  role!: CollaboratorRole;
}

/**
 * 协作者响应 DTO
 */
export class CollaboratorResponseDto {
  @ApiProperty({ description: "协作者ID" })
  id!: string;

  @ApiProperty({ description: "用户ID" })
  userId!: string;

  @ApiProperty({ description: "用户邮箱" })
  email!: string;

  @ApiPropertyOptional({ description: "用户名" })
  username?: string;

  @ApiPropertyOptional({ description: "头像URL" })
  avatarUrl?: string;

  @ApiProperty({ description: "角色", enum: CollaboratorRole })
  role!: CollaboratorRole;

  @ApiProperty({ description: "申请状态", enum: CollaboratorStatus })
  status!: CollaboratorStatus;

  @ApiProperty({ description: "邀请时间" })
  invitedAt!: Date;

  @ApiPropertyOptional({ description: "申请时间（用户主动申请）" })
  requestedAt?: Date;

  @ApiPropertyOptional({ description: "接受时间" })
  acceptedAt?: Date;

  @ApiPropertyOptional({ description: "审核时间" })
  reviewedAt?: Date;

  @ApiPropertyOptional({ description: "拒绝原因" })
  rejectReason?: string;

  @ApiProperty({ description: "是否激活" })
  isActive!: boolean;
}

/**
 * 申请加入 DTO
 */
export class ApplyToJoinDto {
  @ApiPropertyOptional({
    description: "申请备注信息",
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  message?: string;
}

/**
 * 审核申请 DTO
 */
export class ReviewApplicationDto {
  @ApiProperty({
    description: "审核决定",
    enum: ["ACCEPTED", "REJECTED"],
  })
  @IsEnum(CollaboratorStatus)
  decision!: "ACCEPTED" | "REJECTED";

  @ApiPropertyOptional({
    description: "拒绝原因（仅当决定为 REJECTED 时）",
    maxLength: 500,
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}

/**
 * 用户申请状态响应 DTO
 */
export class ApplicationStatusResponseDto {
  @ApiPropertyOptional({
    description: "申请状态，null 表示未申请",
    enum: CollaboratorStatus,
  })
  status: CollaboratorStatus | null = null;

  @ApiPropertyOptional({ description: "申请时间" })
  requestedAt?: Date;

  @ApiPropertyOptional({ description: "拒绝原因" })
  rejectReason?: string;
}

/**
 * 专题协作者列表响应 DTO
 */
export class TopicCollaboratorsResponseDto {
  @ApiProperty({ description: "专题ID" })
  topicId!: string;

  @ApiProperty({ description: "所有者" })
  owner!: {
    id: string;
    email: string;
    username?: string;
    avatarUrl?: string;
  };

  @ApiProperty({
    description: "协作者列表",
    type: [CollaboratorResponseDto],
  })
  collaborators!: CollaboratorResponseDto[];

  @ApiProperty({ description: "协作者总数" })
  totalCount!: number;
}

/**
 * 更新专题可见性 DTO
 */
export class UpdateTopicVisibilityDto {
  @ApiProperty({
    description: "可见性设置",
    enum: TopicVisibility,
    example: TopicVisibility.SHARED,
  })
  @IsEnum(TopicVisibility)
  visibility!: TopicVisibility;
}

/**
 * 专题共享设置响应 DTO
 */
export class TopicSharingSettingsDto {
  @ApiProperty({ description: "专题ID" })
  topicId!: string;

  @ApiProperty({ description: "可见性", enum: TopicVisibility })
  visibility!: TopicVisibility;

  @ApiProperty({ description: "协作者数量" })
  collaboratorCount!: number;

  @ApiPropertyOptional({
    description: "公开链接（仅当 visibility 为 PUBLIC 时）",
  })
  publicLink?: string;
}
