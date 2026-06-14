/**
 * AI Engine Tools Provider
 * 工具统一提供者 - 注册所有内置工具
 */

import { Provider, Type } from "@nestjs/common";
import { ITool } from "./abstractions/tool.interface";

// ============================================================================
// Information Tools (信息获取)
// ============================================================================
import {
  WebSearchTool,
  WebScraperTool,
  DataFetchTool,
  RAGSearchTool,
  DatabaseQueryTool,
  KnowledgeGraphTool,
  WikiPageReadTool,
  WikiSearchTool,
  HackerNewsSearchTool,
  ArxivSearchTool,
  GithubSearchTool,
  SemanticScholarSearchTool,
  PubMedSearchTool,
  OpenAlexSearchTool,
  FinanceApiTool,
  WeatherApiTool,
  SecEdgarTool,
  StartupHubTool,
  // Policy Tools
  FederalRegisterTool,
  CongressGovTool,
  WhiteHouseNewsTool,
  // Image Search Tools
  BingImageSearchTool,
  GoogleImageSearchTool,
  SerpAPIImageSearchTool,
  ImageSearchAggregatorTool,
  // Industry Report Tools
  IndustryReportSearchTool,
  // Social Tools
  SocialXSearchTool,
  // Job Tools
  JobSearchTool,
  // Video Tools
  YouTubeSearchTool,
} from "./categories/information";

// ============================================================================
// Generation Tools (内容生成)
// ============================================================================
import {
  TextGenerationTool,
  ImageGenerationTool,
  CodeGenerationTool,
  AudioGenerationTool,
  VideoGenerationTool,
  StructuredOutputTool,
} from "./categories/generation";

// ============================================================================
// Processing Tools (数据处理)
// ============================================================================
import {
  DataAnalysisTool,
  DataValidationTool,
  DataCleaningTool,
  FileParserTool,
  FileConversionTool,
  DocumentDiffTool,
  TemplateRenderTool,
} from "./categories/processing";

// ============================================================================
// Execution Tools (代码执行)
// ============================================================================
// ⚠️ SECURITY: Dangerous execution tools disabled for security reasons
// See: https://owasp.org/www-community/attacks/Command_Injection
// These tools can execute arbitrary code and pose significant RCE risks
// If you need code execution, use ContainerExecutorTool with proper isolation
import {
  // PythonExecutorTool,      // DISABLED: RCE risk - arbitrary Python execution
  // JavaScriptExecutorTool,  // DISABLED: RCE risk - arbitrary JS execution
  SQLExecutorTool,
  // ShellExecutorTool,       // DISABLED: RCE risk - arbitrary shell commands
  ContainerExecutorTool,
  OCRRecognitionTool,
} from "./categories/execution";

// ============================================================================
// Integration Tools (外部集成)
// ============================================================================
import {
  MessagePushTool,
  CloudStorageTool,
  GitHubIntegrationTool,
  EmailSenderTool,
  CalendarIntegrationTool,
  WebhookTriggerTool,
  WechatMpPublishTool,
  XhsPublishTool,
  SocialPublishStatusTool,
} from "./categories/integration";

// ============================================================================
// Memory Tools (记忆管理)
// ShortTermMemoryTool / LongTermMemoryTool 已迁到 ai-harness/memory/tools/
// 它们由 RuntimeMemoryModule (@Global) 在 onModuleInit 时通过 ToolRegistry.register
// 注册到全局工具表（harness 可以 import ai-engine，反向被 ESLint 拦截）。
// ============================================================================
import {
  EntityMemoryTool,
  KnowledgeBaseTool,
  UserPreferencesTool,
} from "./categories/memory";

// ============================================================================
// Export Tools (导出)
// ============================================================================
import {
  ExportPPTXTool,
  ExportDOCXTool,
  ExportPDFTool,
  ExportImageTool,
} from "./categories/export";

// ============================================================================
// Collaboration Tools (Agent 协作)
// ============================================================================
import {
  AgentHandoffTool,
  HumanApprovalTool,
  AgentCommunicationTool,
  TaskDelegationTool,
  ConsensusMechanismTool,
  WorkflowOrchestrationTool,
} from "./categories/collaboration";

// ============================================================================
// Automation Tools (浏览器自动化等)
// ============================================================================
import { BrowserContextTool } from "./categories/automation";

/**
 * 所有内置工具类列表
 */
export const ALL_TOOL_CLASSES: Type<ITool>[] = [
  // Information Tools
  WebSearchTool,
  WebScraperTool,
  DataFetchTool,
  RAGSearchTool,
  DatabaseQueryTool,
  KnowledgeGraphTool,
  WikiPageReadTool,
  WikiSearchTool,
  HackerNewsSearchTool,
  ArxivSearchTool,
  GithubSearchTool,
  SemanticScholarSearchTool,
  PubMedSearchTool,
  OpenAlexSearchTool,
  FinanceApiTool,
  WeatherApiTool,
  SecEdgarTool,
  StartupHubTool,
  FederalRegisterTool,
  CongressGovTool,
  WhiteHouseNewsTool,
  BingImageSearchTool,
  GoogleImageSearchTool,
  SerpAPIImageSearchTool,
  ImageSearchAggregatorTool,
  IndustryReportSearchTool,
  SocialXSearchTool,
  JobSearchTool,
  YouTubeSearchTool,

  // Generation Tools
  TextGenerationTool,
  ImageGenerationTool,
  CodeGenerationTool,
  AudioGenerationTool,
  VideoGenerationTool,
  StructuredOutputTool,

  // Processing Tools
  DataAnalysisTool,
  DataValidationTool,
  DataCleaningTool,
  FileParserTool,
  FileConversionTool,
  DocumentDiffTool,
  TemplateRenderTool,

  // Execution Tools
  // ⚠️ SECURITY: PythonExecutorTool, JavaScriptExecutorTool, ShellExecutorTool DISABLED
  // These tools pose significant RCE (Remote Code Execution) risks
  // PythonExecutorTool,      // DISABLED
  // JavaScriptExecutorTool,  // DISABLED
  SQLExecutorTool,
  // ShellExecutorTool,       // DISABLED
  ContainerExecutorTool,
  OCRRecognitionTool,

  // Integration Tools
  MessagePushTool,
  CloudStorageTool,
  GitHubIntegrationTool,
  EmailSenderTool,
  CalendarIntegrationTool,
  WebhookTriggerTool,
  WechatMpPublishTool,
  XhsPublishTool,
  SocialPublishStatusTool,

  // Memory Tools (Short/LongTerm 由 RuntimeMemoryModule 单独注册，见 ai-harness/memory/tools/)
  EntityMemoryTool,
  KnowledgeBaseTool,
  UserPreferencesTool,

  // Export Tools
  ExportPPTXTool,
  ExportDOCXTool,
  ExportPDFTool,
  ExportImageTool,

  // Collaboration Tools
  AgentHandoffTool,
  HumanApprovalTool,
  AgentCommunicationTool,
  TaskDelegationTool,
  ConsensusMechanismTool,
  WorkflowOrchestrationTool,

  // Automation Tools
  BrowserContextTool,
];

/**
 * 所有工具 Providers（用于 NestJS Module）
 */
export const ALL_TOOL_PROVIDERS: Provider[] = ALL_TOOL_CLASSES;

/**
 * 工具注册 Token（用于批量注入）
 */
export const ALL_TOOLS_TOKEN = "ALL_TOOLS";

/**
 * 批量注入所有工具的 Provider
 */
export const allToolsProvider: Provider = {
  provide: ALL_TOOLS_TOKEN,
  useFactory: (...tools: ITool[]) => tools,
  inject: ALL_TOOL_CLASSES,
};

/**
 * 工具 ID 到类的映射
 */
export const TOOL_ID_CLASS_MAP: Record<string, Type<ITool>> = {
  // Information
  "web-search": WebSearchTool,
  "web-scraper": WebScraperTool,
  "data-fetch": DataFetchTool,
  "rag-search": RAGSearchTool,
  "database-query": DatabaseQueryTool,
  "knowledge-graph": KnowledgeGraphTool,
  "wiki-page-read": WikiPageReadTool,
  "wiki-search": WikiSearchTool,
  "hackernews-search": HackerNewsSearchTool,
  "arxiv-search": ArxivSearchTool,
  "github-search": GithubSearchTool,
  "semantic-scholar": SemanticScholarSearchTool,
  pubmed: PubMedSearchTool,
  "openalex-search": OpenAlexSearchTool,
  "finance-api": FinanceApiTool,
  "weather-api": WeatherApiTool,
  "sec-edgar-search": SecEdgarTool,
  "startuphub-startup": StartupHubTool,
  "federal-register": FederalRegisterTool,
  "congress-gov": CongressGovTool,
  "whitehouse-news": WhiteHouseNewsTool,
  "image-search": ImageSearchAggregatorTool,
  "bing-image-search": BingImageSearchTool,
  "google-image-search": GoogleImageSearchTool,
  "serpapi-image-search": SerpAPIImageSearchTool,
  "industry-report-search": IndustryReportSearchTool,
  "social-x-search": SocialXSearchTool,
  "job-search": JobSearchTool,
  "youtube-search": YouTubeSearchTool,

  // Generation
  "text-generation": TextGenerationTool,
  "image-generation": ImageGenerationTool,
  "code-generation": CodeGenerationTool,
  "audio-generation": AudioGenerationTool,
  "video-generation": VideoGenerationTool,
  "structured-output": StructuredOutputTool,

  // Processing
  "data-analysis": DataAnalysisTool,
  "data-validation": DataValidationTool,
  "data-cleaning": DataCleaningTool,
  "file-parser": FileParserTool,
  "file-conversion": FileConversionTool,
  "document-diff": DocumentDiffTool,
  "template-render": TemplateRenderTool,

  // Execution
  // ⚠️ SECURITY: Dangerous execution tools disabled
  // "python-executor": PythonExecutorTool,      // DISABLED: RCE risk
  // "javascript-executor": JavaScriptExecutorTool, // DISABLED: RCE risk
  "sql-executor": SQLExecutorTool,
  // "shell-executor": ShellExecutorTool,        // DISABLED: RCE risk
  "container-executor": ContainerExecutorTool,
  "ocr-recognition": OCRRecognitionTool,

  // Integration
  "message-push": MessagePushTool,
  "cloud-storage": CloudStorageTool,
  "github-integration": GitHubIntegrationTool,
  "email-sender": EmailSenderTool,
  "calendar-integration": CalendarIntegrationTool,
  "webhook-trigger": WebhookTriggerTool,
  "wechat-mp-publish": WechatMpPublishTool,
  "xhs-publish": XhsPublishTool,
  "social-publish-status": SocialPublishStatusTool,

  // Memory (Short/LongTerm 由 ai-harness/memory/tools/ 注册到 ToolRegistry)
  "entity-memory": EntityMemoryTool,
  "knowledge-base": KnowledgeBaseTool,
  "user-preferences": UserPreferencesTool,

  // Export
  "export-pptx": ExportPPTXTool,
  "export-docx": ExportDOCXTool,
  "export-pdf": ExportPDFTool,
  "export-image": ExportImageTool,

  // Collaboration
  "agent-handoff": AgentHandoffTool,
  "human-approval": HumanApprovalTool,
  "agent-communication": AgentCommunicationTool,
  "task-delegation": TaskDelegationTool,
  "consensus-mechanism": ConsensusMechanismTool,
  "workflow-orchestration": WorkflowOrchestrationTool,

  // Automation
  "browser-context": BrowserContextTool,
};

/**
 * 获取工具总数
 */
export const TOTAL_TOOL_COUNT = ALL_TOOL_CLASSES.length;
