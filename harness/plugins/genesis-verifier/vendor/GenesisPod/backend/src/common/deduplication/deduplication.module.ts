import { Module } from "@nestjs/common";
import { GlobalDeduplicationService } from "./deduplication.service";
import { UnifiedDeduplicationService } from "./unified-deduplication.service";

/**
 * 全局去重模块
 *
 * 提供 URL 规范化、内容指纹和相似度检测功能
 * 用于在跨源采集中识别和移除重复数据
 *
 * 服务说明：
 * - UnifiedDeduplicationService: 统一的去重服务（推荐使用）
 * - GlobalDeduplicationService: 原有的全局去重服务（保留兼容）
 */
@Module({
  providers: [GlobalDeduplicationService, UnifiedDeduplicationService],
  exports: [GlobalDeduplicationService, UnifiedDeduplicationService],
})
export class DeduplicationModule {}
