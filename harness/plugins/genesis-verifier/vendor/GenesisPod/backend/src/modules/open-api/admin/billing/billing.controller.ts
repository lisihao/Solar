import { Controller, Get, Param, UseGuards, Logger } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { BillingService } from "../services/billing.service";

@ApiTags("Admin - Billing")
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class BillingController {
  private readonly logger = new Logger(BillingController.name);

  constructor(private billingService: BillingService) {}

  @Get("billing/overview")
  async getBillingOverview() {
    this.logger.log("Admin: Fetching billing overview");
    return this.billingService.getBillingOverview();
  }

  @Get("billing/daily/:date")
  async getDailyDetail(@Param("date") date: string) {
    this.logger.log(`Admin: Fetching billing detail for ${date}`);
    return this.billingService.getDailyDetail(date);
  }
}
