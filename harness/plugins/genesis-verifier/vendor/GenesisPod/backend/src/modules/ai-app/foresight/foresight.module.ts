/**
 * ForesightModule —— AI 前瞻（判断资产 / 假设图谱）
 *
 * 2026-06-12 P0：假设卡 CRUD + 加权影响边 + 信号注入（衰减传播）+
 * 复核工作流（裁定修订置信度 + 账本）+ 决策级结论 + 示例数据 seed。
 *
 * 产品定位：深度洞察分组的存量资产层 —— 雷达（信号流）与洞察（生成引擎）
 * 的产出在此沉淀为可持续检验的判断。P2 接 Radar falsifier 订阅，P3 接
 * Playground 草稿卡投递（均走 registry / 事件，不直接 import 兄弟 app）。
 *
 * 设计来源：docs/demos/insight-graph-demo.html v0.4。
 */
import { Module } from "@nestjs/common";
import { ForesightController } from "./api/foresight.controller";
import { ForesightGraphService } from "./services/foresight-graph.service";
import { ForesightPropagationService } from "./services/foresight-propagation.service";
import { ForesightReviewService } from "./services/foresight-review.service";
import { ForesightSeedService } from "./services/foresight-seed.service";
import { ForesightIntakeService } from "./services/foresight-intake.service";

@Module({
  controllers: [ForesightController],
  providers: [
    ForesightGraphService,
    ForesightPropagationService,
    ForesightReviewService,
    ForesightSeedService,
    // P2/P3 供料：雷达扫描 + 洞察抽取（走 ContentSourceRegistry，不跨 app import）
    ForesightIntakeService,
  ],
  exports: [ForesightGraphService],
})
export class ForesightModule {}
