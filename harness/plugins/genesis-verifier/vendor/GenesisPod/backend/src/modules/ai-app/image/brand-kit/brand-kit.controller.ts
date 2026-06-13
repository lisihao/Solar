/**
 * GenesisPod v2.1 - 品牌套件 API 控制器
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from "@nestjs/common";

interface AuthenticatedRequest {
  user: { id: string; email: string };
}
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import {
  BrandKitService,
  CreateBrandKitDto,
  UpdateBrandKitDto,
} from "./brand-kit.service";

@ApiTags("Brand Kit")
@Controller("brand-kit")
@UseGuards(JwtAuthGuard)
export class BrandKitController {
  constructor(private readonly brandKitService: BrandKitService) {}

  /**
   * 获取用户的所有品牌套件
   */
  @Get()
  async findAll(@Req() req: AuthenticatedRequest) {
    return this.brandKitService.findByUser(req.user.id);
  }

  /**
   * 获取预设品牌套件
   */
  @Get("presets")
  async getPresets() {
    return this.brandKitService.getPresetBrandKits();
  }

  /**
   * 获取单个品牌套件
   */
  @Get(":id")
  async findOne(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    return this.brandKitService.findById(id, req.user.id);
  }

  /**
   * 创建品牌套件
   */
  @Post()
  async create(
    @Body() dto: CreateBrandKitDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.brandKitService.create(req.user.id, dto);
  }

  /**
   * 更新品牌套件
   */
  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() dto: UpdateBrandKitDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.brandKitService.update(id, req.user.id, dto);
  }

  /**
   * 删除品牌套件
   */
  @Delete(":id")
  async delete(@Param("id") id: string, @Req() req: AuthenticatedRequest) {
    await this.brandKitService.delete(id, req.user.id);
    return { message: "Brand kit deleted successfully" };
  }
}
