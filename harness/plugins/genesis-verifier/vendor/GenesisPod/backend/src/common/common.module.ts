import { Global, Module } from "@nestjs/common";
import { AdminAuthService } from "./services";
import { BrandLogoService } from "./config/brand-logo.service";

/**
 * 公共服务模块
 *
 * 提供全局共享的基础服务
 * 使用 @Global() 装饰器，所有模块都可以直接注入这些服务
 */
@Global()
@Module({
  providers: [AdminAuthService, BrandLogoService],
  exports: [AdminAuthService, BrandLogoService],
})
export class CommonModule {}
