import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { KeyAssignmentStatus } from "@prisma/client";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
// Credential-admin surface imports credentials from source (not the engine
// facade barrel) to avoid circular-barrel DI breakage; eslint-exempted below.
import { KeyAssignmentsService } from "../../../platform/credentials/governance/key-assignments/key-assignments.service";
import { RevokeAssignmentDto, UpdateAssignmentDto } from "./dto";

/**
 * 模型粒度批量授权 DTO（v5 重构）
 *
 * ★ P0-S2 修复（评审 round 1）：从 plain interface 改为 class + class-validator，
 *   防止 user-controlled userId 等字段绕过验证。NestJS ValidationPipe (whitelist:true,
 *   transform:true) 仅对 class 生效，对 interface 静默放行。
 */
class GrantBatchModelDto {
  @ApiProperty({ description: "AIModel.id (cuid/uuid)" })
  @IsString()
  @MaxLength(64)
  modelDbId!: string;

  @ApiPropertyOptional({ description: "User-level quota in cents" })
  @IsOptional()
  @IsInt()
  @Min(0)
  userQuotaCents?: number | null;
}

class GrantBatchDto {
  @ApiProperty({ description: "Target user id" })
  @IsString()
  @MaxLength(64)
  userId!: string;

  @ApiProperty({ type: [GrantBatchModelDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => GrantBatchModelDto)
  models!: GrantBatchModelDto[];

  @ApiProperty({ enum: ["ONE_TIME", "RECURRING"] })
  @IsIn(["ONE_TIME", "RECURRING"])
  validityType!: "ONE_TIME" | "RECURRING";

  @ApiPropertyOptional({ description: "ONE_TIME 用，ISO date string" })
  @IsOptional()
  @IsDateString()
  expiresAt?: string | null;

  @ApiPropertyOptional({ enum: ["WEEK", "MONTH", "YEAR"] })
  @IsOptional()
  @IsIn(["WEEK", "MONTH", "YEAR"])
  recurrenceUnit?: "WEEK" | "MONTH" | "YEAR";

  @ApiPropertyOptional({ description: "RECURRING interval >= 1" })
  @IsOptional()
  @IsInt()
  @Min(1)
  recurrenceInterval?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

@ApiTags("Admin - Key Assignments")
@Controller("admin/key-assignments")
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminKeyAssignmentsController {
  constructor(private readonly service: KeyAssignmentsService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("provider") provider?: string,
    @Query("userId") userId?: string,
    @Query("take") take?: string,
    @Query("skip") skip?: string,
  ) {
    const parsedStatus =
      status &&
      Object.values(KeyAssignmentStatus).includes(status as KeyAssignmentStatus)
        ? (status as KeyAssignmentStatus)
        : undefined;
    const items = await this.service.listAll({
      status: parsedStatus,
      provider,
      userId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
    return { items };
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() dto: UpdateAssignmentDto) {
    const status: KeyAssignmentStatus | undefined =
      dto.status === "ACTIVE" || dto.status === "SUSPENDED"
        ? (dto.status as KeyAssignmentStatus)
        : undefined;
    return this.service.update(id, {
      userQuotaCents:
        dto.userQuotaCents === undefined ? undefined : dto.userQuotaCents,
      expiresAt:
        dto.expiresAt === undefined
          ? undefined
          : dto.expiresAt === null
            ? null
            : new Date(dto.expiresAt),
      note: dto.note === undefined ? undefined : dto.note,
      status,
    });
  }

  @Delete(":id")
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param("id") id: string,
    @Body() dto: RevokeAssignmentDto,
  ) {
    return this.service.revoke(id, req.user.email, dto.reason);
  }

  /**
   * 模型粒度批量授权（v5 重构）
   *
   * Admin 在用户列表行内点 🔑 → 选 N 个具体 AIModel 行 → 一次提交。
   * 后端按 modelDbId 直查 AIModel 派生 provider/modelId → 创建 KeyAssignment。
   * 单 model 失败不阻塞其他，返回 succeeded[] + failed[]。
   *
   * Body 示例：
   * {
   *   "userId": "alice-uuid",
   *   "models": [
   *     { "modelDbId": "ai-model-uuid-1", "userQuotaCents": 2000 },
   *     { "modelDbId": "ai-model-uuid-2", "userQuotaCents": 3000 }
   *   ],
   *   "validityType": "RECURRING",
   *   "recurrenceUnit": "MONTH",
   *   "recurrenceInterval": 1,
   *   "note": "VIP 季度套餐"
   * }
   */
  @Post("grant")
  async grant(@Req() req: AuthenticatedRequest, @Body() dto: GrantBatchDto) {
    return this.service.grantBatch({
      userId: dto.userId,
      models: dto.models,
      validityType: dto.validityType,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      recurrenceUnit: dto.recurrenceUnit,
      recurrenceInterval: dto.recurrenceInterval,
      assignedBy: req.user.email,
      note: dto.note,
    });
  }
}
