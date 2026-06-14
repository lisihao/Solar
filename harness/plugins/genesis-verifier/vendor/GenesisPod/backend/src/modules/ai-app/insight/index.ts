/**
 * Topic Insights Module - 专题洞察模块
 *
 * 独立的洞察模块，从 research 模块分离
 * 提供专题多维度研究能力 (分钟级)
 */

export { InsightModule } from "./insight.module";
export { TopicInsightsService } from "./topic-insights.service";
export {
  TopicController,
  MissionController,
  ReportController,
  CollaborationController,
  TodoController,
  ReportReviewController,
} from "./controllers";
export { TopicInsightsGateway } from "./topic-insights.gateway";
