import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
  Request,
  Ip,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { CreditsService } from "@/modules/platform/credits/credits.service";
import { CheckinService } from "@/modules/platform/credits/rewards/checkin.service";
import { CreditRulesService } from "@/modules/platform/credits/policies/credit-rules.service";
import { TransactionQueryDto } from "./dto/transaction-query.dto";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}

/**
 * 积分控制器
 */
@ApiTags("Credits")
@Controller("credits")
@UseGuards(JwtAuthGuard)
export class CreditsController {
  constructor(
    private creditsService: CreditsService,
    private checkinService: CheckinService,
    private creditRulesService: CreditRulesService,
  ) {}

  /**
   * 获取积分账户信息
   */
  @Get()
  async getAccount(@Request() req: AuthenticatedRequest) {
    return this.creditsService.getOrCreateAccount(req.user.id);
  }

  /**
   * 获取积分余额（轻量级）
   */
  @Get("balance")
  async getBalance(@Request() req: AuthenticatedRequest) {
    return this.creditsService.getBalance(req.user.id);
  }

  /**
   * 获取积分统计
   */
  @Get("stats")
  async getStats(@Request() req: AuthenticatedRequest) {
    return this.creditsService.getCreditsStats(req.user.id);
  }

  /**
   * 获取交易记录
   */
  @Get("transactions")
  async getTransactions(
    @Request() req: AuthenticatedRequest,
    @Query() query: TransactionQueryDto,
  ) {
    return this.creditsService.getTransactions(req.user.id, query);
  }

  /**
   * 获取签到状态
   */
  @Get("checkin/status")
  async getCheckinStatus(@Request() req: AuthenticatedRequest) {
    return this.checkinService.getCheckinStatus(req.user.id);
  }

  /**
   * 执行签到
   */
  @Post("checkin")
  @HttpCode(HttpStatus.OK)
  async performCheckin(@Request() req: AuthenticatedRequest, @Ip() ip: string) {
    return this.checkinService.performCheckin(req.user.id, ip);
  }

  /**
   * 获取签到历史
   */
  @Get("checkin/history")
  async getCheckinHistory(
    @Request() req: AuthenticatedRequest,
    @Query("limit") limit?: number,
  ) {
    return this.checkinService.getCheckinHistory(req.user.id, limit || 30);
  }

  /**
   * 获取积分规则
   */
  @Get("rules")
  async getRules() {
    const rules = await this.creditRulesService.getAllRules();
    return rules.map((r) => ({
      moduleType: r.moduleType,
      operationType: r.operationType,
      baseCredits: r.baseCredits,
      name: r.name,
      isActive: r.isActive,
    }));
  }

  /**
   * 预估积分消耗
   */
  @Get("estimate")
  async estimateCredits(
    @Query("moduleType") moduleType: string,
    @Query("operationType") operationType: string,
    @Query("tokenCount") tokenCount?: number,
    @Query("modelName") modelName?: string,
  ) {
    const credits = await this.creditsService.estimateCredits(
      moduleType,
      operationType,
      tokenCount ? Number(tokenCount) : undefined,
      modelName,
    );
    return {
      estimatedCredits: credits,
      moduleType,
      operationType,
    };
  }
}
