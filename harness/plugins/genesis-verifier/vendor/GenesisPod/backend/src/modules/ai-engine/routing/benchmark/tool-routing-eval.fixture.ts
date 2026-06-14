/**
 * Tool-routing eval 种子集（真实工具 id）
 *
 * 用途：量化 ScoredRouter 在工具选择上的真实增量（Recall@k / token 节省），
 * 对照 LLMRouterBench 方法学的基线（all-tools / first-k / random-k）。
 *
 * 说明：
 *   - POOL 的 description 是为**离线 stub embedder**（BoW）准备的关键词化描述；
 *     真实 embedder 模式应改用 ToolRegistry 的线上描述（见 tool-routing-eval.ts 头注）。
 *   - 这是**种子集**（18 例），刻意小而干净，便于起步；扩充到数百例才能下生产结论。
 *   - id 全部是项目真实工具 id（grep 自 tools/categories/**）。
 */

export interface EvalPoolItem {
  readonly id: string;
  readonly description: string;
}

export interface EvalCase {
  readonly goal: string;
  /** 该 goal 下"正确"应被选中的工具 id（人工标注） */
  readonly expected: readonly string[];
}

/** 24 个真实工具，语义跨度大（academic/web/data/policy/gen/integration/memory/exec） */
export const EVAL_POOL: readonly EvalPoolItem[] = [
  {
    id: "arxiv-search",
    description: "search academic research papers preprints on arxiv",
  },
  {
    id: "pubmed",
    description: "search biomedical medical clinical academic papers pubmed",
  },
  {
    id: "semantic-scholar",
    description: "search academic scholarly papers citations",
  },
  {
    id: "openalex-search",
    description: "search open academic scholarly works metadata",
  },
  {
    id: "web-search",
    description: "general web search engine for current news information",
  },
  {
    id: "web-scraper",
    description: "scrape extract content text from a web page url",
  },
  { id: "data-fetch", description: "fetch raw data from a url http endpoint" },
  {
    id: "weather-api",
    description: "get weather forecast temperature for a location city",
  },
  {
    id: "finance-api",
    description: "get stock market financial price ticker data",
  },
  {
    id: "congress-gov",
    description: "search united states congress bills legislation laws",
  },
  {
    id: "federal-register",
    description: "search federal register regulations rules notices",
  },
  { id: "youtube-search", description: "search youtube videos clips channels" },
  {
    id: "github-search",
    description: "search github code repositories open source",
  },
  {
    id: "github-integration",
    description: "create issues pull requests on a github repository",
  },
  {
    id: "image-generation",
    description: "generate create images pictures from a text prompt",
  },
  {
    id: "video-generation",
    description: "generate create videos from a text prompt",
  },
  {
    id: "code-generation",
    description: "generate write source code programming",
  },
  { id: "text-generation", description: "generate write text content prose" },
  {
    id: "sql-executor",
    description: "run execute sql query against a database table",
  },
  {
    id: "ocr-recognition",
    description: "extract text from an image scan using ocr",
  },
  { id: "email-sender", description: "send an email message to recipients" },
  {
    id: "calendar-integration",
    description: "create read calendar events schedule meetings",
  },
  {
    id: "knowledge-base",
    description: "search the user personal knowledge base notes",
  },
  {
    id: "file-parser",
    description: "parse extract text from a document file pdf docx",
  },
];

export const EVAL_CASES: readonly EvalCase[] = [
  {
    goal: "find recent academic research papers on machine learning",
    expected: ["arxiv-search", "semantic-scholar", "openalex-search"],
  },
  { goal: "look up clinical biomedical medical studies", expected: ["pubmed"] },
  {
    goal: "what is the weather forecast in tokyo tomorrow",
    expected: ["weather-api"],
  },
  {
    goal: "get the current apple stock market price",
    expected: ["finance-api"],
  },
  {
    goal: "scrape the article content text from this web page url",
    expected: ["web-scraper"],
  },
  { goal: "search the web for the latest news", expected: ["web-search"] },
  {
    goal: "find united states legislation bills about privacy",
    expected: ["congress-gov"],
  },
  {
    goal: "generate an image picture of a cat",
    expected: ["image-generation"],
  },
  {
    goal: "create a short video from a prompt",
    expected: ["video-generation"],
  },
  {
    goal: "write python source code to sort a list",
    expected: ["code-generation"],
  },
  {
    goal: "run a sql query against the database to count users",
    expected: ["sql-executor"],
  },
  {
    goal: "extract text from this scanned image",
    expected: ["ocr-recognition"],
  },
  { goal: "send an email message to the team", expected: ["email-sender"] },
  {
    goal: "schedule a calendar meeting next monday",
    expected: ["calendar-integration"],
  },
  {
    goal: "search my personal knowledge base notes about the project",
    expected: ["knowledge-base"],
  },
  {
    goal: "find youtube videos about cooking pasta",
    expected: ["youtube-search"],
  },
  {
    goal: "open a pull request on the github repository",
    expected: ["github-integration"],
  },
  {
    goal: "parse the text from this pdf document file",
    expected: ["file-parser"],
  },
];
