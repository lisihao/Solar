import { Controller, Get, UseGuards, Logger } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";
import { PermissionsService } from "../services/permissions.service";

@ApiTags("Admin - Permissions")
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
export class PermissionsController {
  private readonly logger = new Logger(PermissionsController.name);

  constructor(private permissionsService: PermissionsService) {}

  @Get("permissions/overview")
  async getPermissionsOverview() {
    this.logger.log("Admin: Fetching permissions overview");
    return this.permissionsService.getPermissionsOverview();
  }
}
