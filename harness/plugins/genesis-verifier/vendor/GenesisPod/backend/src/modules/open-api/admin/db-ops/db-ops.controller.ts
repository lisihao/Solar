import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Logger,
  BadRequestException,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AdminGuard } from "@/common/guards/admin.guard";
import { DbOpsService } from "@/modules/platform/db-ops/db-ops.service";
import {
  TableCategory,
  TableListQueryDto,
  TableListResponseDto,
  TableDetailDto,
  TableDiagnosisDto,
  CleanupResultDto,
  TableStatsDto,
  HealthStatus,
} from "./dto/table-info.dto";

@ApiTags("Admin - Tables")
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/tables")
export class DbOpsController {
  private readonly logger = new Logger(DbOpsController.name);

  constructor(private readonly dbGovernanceService: DbOpsService) {}

  /**
   * Get list of all tables with filtering, sorting, and pagination
   */
  @Get()
  async getTableList(
    @Query("search") search?: string,
    @Query("category") category?: TableCategory,
    @Query("sortBy") sortBy?: TableListQueryDto["sortBy"],
    @Query("sortOrder") sortOrder?: "asc" | "desc",
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Query("healthStatus") healthStatus?: HealthStatus,
  ): Promise<TableListResponseDto> {
    this.logger.log("Getting table list");

    const query: TableListQueryDto = {
      search,
      category,
      sortBy,
      sortOrder,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 50,
      healthStatus,
    };

    return this.dbGovernanceService.getTableList(query);
  }

  /**
   * Get aggregate statistics only
   */
  @Get("stats")
  async getStats(): Promise<TableStatsDto> {
    this.logger.log("Getting table statistics");
    return this.dbGovernanceService.getStats();
  }

  /**
   * Diagnose all tables with issues
   */
  @Post("batch-diagnose")
  async diagnoseBatch(): Promise<TableDiagnosisDto[]> {
    this.logger.log("Running batch diagnosis on all tables");
    return this.dbGovernanceService.diagnoseBatch();
  }

  /**
   * Cleanup all tables with cleanable data
   */
  @Post("batch-cleanup")
  async cleanupBatch(): Promise<{ results: CleanupResultDto[] }> {
    this.logger.log("Running batch cleanup on all tables");
    const results = await this.dbGovernanceService.cleanupBatch();
    return { results };
  }

  /**
   * Get detailed info for a single table
   */
  @Get(":name")
  async getTableDetail(@Param("name") name: string): Promise<TableDetailDto> {
    if (!name) {
      throw new BadRequestException("Table name is required");
    }
    this.logger.log(`Getting detail for table: ${name}`);
    return this.dbGovernanceService.getTableDetail(name);
  }

  /**
   * Get sample data from a table
   */
  @Get(":name/sample")
  async getTableSample(
    @Param("name") name: string,
    @Query("limit") limit?: string,
  ): Promise<Record<string, unknown>[]> {
    if (!name) {
      throw new BadRequestException("Table name is required");
    }
    const limitNum = limit ? parseInt(limit, 10) : 10;
    this.logger.log(
      `Getting sample data for table: ${name} (limit: ${limitNum})`,
    );
    return this.dbGovernanceService.getTableSample(name, limitNum);
  }

  /**
   * Diagnose a specific table
   */
  @Post(":name/diagnose")
  async diagnoseTable(@Param("name") name: string): Promise<TableDiagnosisDto> {
    if (!name) {
      throw new BadRequestException("Table name is required");
    }
    this.logger.log(`Diagnosing table: ${name}`);
    return this.dbGovernanceService.diagnoseTable(name);
  }

  /**
   * Execute cleanup for a specific table
   */
  @Post(":name/cleanup")
  async cleanupTable(@Param("name") name: string): Promise<CleanupResultDto> {
    if (!name) {
      throw new BadRequestException("Table name is required");
    }
    this.logger.log(`Cleaning up table: ${name}`);
    return this.dbGovernanceService.cleanupTable(name);
  }
}
