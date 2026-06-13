/**
 * AI Teams Utils - 重新导出 common/content-processing 服务
 *
 * 这些服务和类型已迁移到 common/content-processing 模块，
 * 这里保留向后兼容的导出。
 */

// 从 common 模块导入并重新导出 URL Parser 服务和类型
export { UrlParserService } from "../../../../common/content-processing";
export type {
  ParsedUrlType,
  ParseStatus,
  LinkPreview,
  ParsedUrl,
  DetectedUrl,
  ExtractedUrlContent as UrlExtractedContent,
} from "../../../../common/content-processing";

// 从 common 模块导入并重新导出 Web Content Extraction 服务和类型
// 注意：服务类名从 ContentExtractionService 改为 WebContentExtractionService
// 为保持向后兼容，这里创建别名
export { WebContentExtractionService as ContentExtractionService } from "../../../../common/content-processing";
export type {
  WebExtractedContent as JinaExtractedContent,
  DeepResearchResult,
} from "../../../../common/content-processing";
