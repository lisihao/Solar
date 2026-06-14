/**
 * AI Provider 目录 —— system scope 内置供应商的【单一数据源】。
 *
 * 背景（2026-06-01）：此前 provider 目录散落且互相漂移——
 *   1. `prisma/migrations/20260505b_ai_provider_catalog/migration.sql`（11 个，一次性 INSERT）
 *   2. `prisma/migrations/20260510b_seed_extra_providers/migration.sql`（7 个国内，一次性 INSERT）
 *   3. `prisma/seed-catalog.sql`（fresh 冷启动 DO-if-empty）
 * 一次性 migration INSERT 只在该迁移首次 `migrate deploy` 时执行，导致「给现网加 provider
 * 只能再写一条迁移」。此文件把目录收敛为唯一来源，由 `AiProvidersSeeder` 在每次后端启动时
 * 经 `SeedSyncService` 幂等同步。
 *
 * 【create-only 语义】seeder 只在「该 slug 的 system 行不存在」时 create，绝不 update
 * 已存在行 —— 因此不会覆盖 admin 在后台（/admin/ai-providers）改过的 endpoint / 启停状态。
 * 新增供应商 = 往本数组加一项，重启自动补齐，无需再写 migration INSERT。
 *
 * 旧的 migration INSERT 与 seed-catalog.sql 保留（历史已执行、迁移链不可改），
 * 但【今后新增一律改本文件】。
 */

export interface AiProviderSeed {
  /** kebab-case 唯一标识（同 system scope 内唯一） */
  slug: string;
  /** 显示名 */
  name: string;
  /** base URL（不含 /chat/completions 等具体路径） */
  endpoint: string;
  /** 调用协议：openai / anthropic / google / cohere */
  apiFormat: string;
  /** 连接健康探测用的模型 id */
  testModel: string;
  /** 支持的 AIModelType（驱动「添加模型」时的类型筛选） */
  capabilities: string[];
  /** 下拉排序，越小越靠前；预留间隔便于插入 */
  displayOrder: number;
  docUrl?: string;
  freeTierNote?: string;
  description?: string;
}

export const AI_PROVIDER_CATALOG: AiProviderSeed[] = [
  // ───────────────── 国际前沿（直连）─────────────────
  {
    slug: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    apiFormat: "openai",
    testModel: "gpt-4o-mini",
    capabilities: [
      "CHAT",
      "CHAT_FAST",
      "CODE",
      "EMBEDDING",
      "IMAGE_GENERATION",
      "IMAGE_EDITING",
    ],
    displayOrder: 10,
    docUrl: "https://platform.openai.com/docs",
  },
  {
    slug: "anthropic",
    name: "Anthropic",
    endpoint: "https://api.anthropic.com/v1",
    apiFormat: "anthropic",
    testModel: "claude-3-haiku-20240307",
    capabilities: ["CHAT", "CHAT_FAST", "CODE", "MULTIMODAL"],
    displayOrder: 20,
    docUrl: "https://docs.anthropic.com",
  },
  {
    slug: "google",
    name: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
    apiFormat: "google",
    testModel: "gemini-2.0-flash-lite",
    capabilities: [
      "CHAT",
      "CHAT_FAST",
      "MULTIMODAL",
      "EMBEDDING",
      "IMAGE_GENERATION",
    ],
    displayOrder: 30,
    freeTierNote: "免费层每分钟 1500 req",
    docUrl: "https://ai.google.dev/docs",
  },
  {
    slug: "xai",
    name: "xAI (Grok)",
    endpoint: "https://api.x.ai/v1",
    apiFormat: "openai",
    testModel: "grok-3-mini-fast",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 40,
    docUrl: "https://docs.x.ai",
  },
  {
    slug: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1",
    apiFormat: "openai",
    testModel: "deepseek-chat",
    capabilities: ["CHAT", "CODE"],
    displayOrder: 50,
    docUrl: "https://api-docs.deepseek.com",
  },
  {
    slug: "cohere",
    name: "Cohere",
    endpoint: "https://api.cohere.com/v2",
    apiFormat: "cohere",
    testModel: "command-r",
    capabilities: ["CHAT", "CHAT_FAST", "EMBEDDING", "RERANK"],
    displayOrder: 70,
    freeTierNote: "免费 trial 100 calls/min",
    docUrl: "https://docs.cohere.com",
  },
  {
    slug: "mistral",
    name: "Mistral AI",
    endpoint: "https://api.mistral.ai/v1",
    apiFormat: "openai",
    testModel: "mistral-small-latest",
    capabilities: ["CHAT", "CHAT_FAST", "CODE", "EMBEDDING"],
    displayOrder: 80,
    docUrl: "https://docs.mistral.ai",
  },
  {
    slug: "perplexity",
    name: "Perplexity",
    endpoint: "https://api.perplexity.ai",
    apiFormat: "openai",
    testModel: "sonar",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 90,
    docUrl: "https://docs.perplexity.ai",
  },

  // ───────────────── 国产模型厂商 ─────────────────
  {
    slug: "qwen",
    name: "通义千问 (Qwen)",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiFormat: "openai",
    testModel: "qwen-turbo",
    capabilities: ["CHAT", "CHAT_FAST", "EMBEDDING"],
    displayOrder: 200,
    docUrl: "https://help.aliyun.com/zh/dashscope",
  },
  {
    slug: "zhipu",
    name: "智谱 AI (GLM)",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    apiFormat: "openai",
    testModel: "glm-4-flash",
    capabilities: ["CHAT", "CHAT_FAST", "EMBEDDING"],
    displayOrder: 210,
    docUrl: "https://open.bigmodel.cn/dev/api",
  },
  {
    slug: "glm",
    name: "智谱 GLM (alias)",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    apiFormat: "openai",
    testModel: "glm-4-flash",
    capabilities: ["CHAT", "CHAT_FAST", "EMBEDDING"],
    displayOrder: 215,
    docUrl: "https://open.bigmodel.cn/dev/api",
  },
  {
    slug: "moonshot",
    name: "月之暗面 (Kimi)",
    endpoint: "https://api.moonshot.cn/v1",
    apiFormat: "openai",
    testModel: "moonshot-v1-8k",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 220,
    docUrl: "https://platform.moonshot.cn/docs",
  },
  {
    slug: "kimi",
    name: "Kimi (Moonshot)",
    endpoint: "https://api.moonshot.cn/v1",
    apiFormat: "openai",
    testModel: "moonshot-v1-8k",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 225,
    docUrl: "https://platform.moonshot.cn/docs",
  },
  {
    slug: "doubao",
    name: "豆包 (火山引擎)",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    apiFormat: "openai",
    testModel: "doubao-seed-1-6-flash",
    capabilities: ["CHAT", "CHAT_FAST", "MULTIMODAL"],
    displayOrder: 230,
    docUrl: "https://www.volcengine.com/docs/82379",
  },
  {
    slug: "bytedance",
    name: "ByteDance Ark",
    endpoint: "https://ark.cn-beijing.volces.com/api/v3",
    apiFormat: "openai",
    testModel: "doubao-seed-1-6-flash",
    capabilities: ["CHAT", "CHAT_FAST", "MULTIMODAL"],
    displayOrder: 235,
    docUrl: "https://www.volcengine.com/docs/82379",
  },
  {
    slug: "hunyuan",
    name: "腾讯混元",
    endpoint: "https://api.hunyuan.cloud.tencent.com/v1",
    apiFormat: "openai",
    testModel: "hunyuan-lite",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 240,
    docUrl: "https://cloud.tencent.com/document/product/1729",
  },
  {
    slug: "spark",
    name: "讯飞星火",
    endpoint: "https://spark-api-open.xf-yun.com/v1",
    apiFormat: "openai",
    testModel: "lite",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 250,
    docUrl: "https://www.xfyun.cn/doc/spark/Web.html",
  },
  {
    slug: "minimax",
    name: "MiniMax",
    endpoint: "https://api.minimax.chat/v1",
    apiFormat: "openai",
    testModel: "MiniMax-Text-01",
    capabilities: ["CHAT"],
    displayOrder: 260,
    docUrl: "https://platform.minimaxi.com/document/notice",
  },
  {
    slug: "01ai",
    name: "零一万物 (Yi)",
    endpoint: "https://api.lingyiwanwu.com/v1",
    apiFormat: "openai",
    testModel: "yi-lightning",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 270,
    docUrl: "https://platform.lingyiwanwu.com/docs",
  },
  {
    slug: "stepfun",
    name: "阶跃星辰 (StepFun)",
    endpoint: "https://api.stepfun.com/v1",
    apiFormat: "openai",
    testModel: "step-3.5-flash",
    capabilities: ["CHAT", "CHAT_FAST", "MULTIMODAL"],
    displayOrder: 280,
    docUrl: "https://platform.stepfun.com/docs",
  },
  {
    slug: "siliconflow",
    name: "硅基流动 (SiliconFlow)",
    endpoint: "https://api.siliconflow.cn/v1",
    apiFormat: "openai",
    testModel: "Qwen/Qwen2.5-7B-Instruct",
    capabilities: ["CHAT", "CHAT_FAST", "EMBEDDING", "RERANK"],
    displayOrder: 290,
    docUrl: "https://docs.siliconflow.cn",
  },
  {
    // 新加坡 Sapiens AI 一方多模态模型。base 以官方文档为准（agnes-ai.com/doc §2）：
    // https://apihub.agnes-ai.com/v1 —— OpenAI 兼容网关（new-api 架构），
    // 拼出 .../v1/chat/completions、.../v1/models。鉴权 `Authorization: Bearer <key>`。
    // ⚠️ 两个易踩的错 host：① 根域 agnes-ai.com 是营销站(Next.js)，chat 返 404 HTML；
    //   ② api.agnes-ai.com 是另一网关，key 不被它认（返 000501 invalid token）。均非文档端点。
    slug: "agnes",
    name: "Agnes AI (Sapiens)",
    endpoint: "https://apihub.agnes-ai.com/v1",
    apiFormat: "openai",
    testModel: "sapiens-ai/agnes-1.5-lite",
    capabilities: ["CHAT", "CHAT_FAST", "IMAGE_GENERATION"],
    displayOrder: 300,
    freeTierNote: "Agnes 2.0 免费 API（新加坡 Sapiens AI；需注册取 key）",
    docUrl: "https://agnes-ai.com/doc",
  },

  // ───────────────── 聚合网关 / 多模型路由 ─────────────────
  {
    slug: "openrouter",
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1",
    apiFormat: "openai",
    testModel: "openrouter/auto",
    capabilities: ["CHAT", "CHAT_FAST", "CODE", "MULTIMODAL"],
    displayOrder: 400,
    docUrl: "https://openrouter.ai/docs",
  },
  {
    slug: "together",
    name: "Together AI",
    endpoint: "https://api.together.xyz/v1",
    apiFormat: "openai",
    testModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    capabilities: ["CHAT", "CHAT_FAST", "CODE"],
    displayOrder: 410,
    docUrl: "https://docs.together.ai",
  },
  {
    slug: "fireworks",
    name: "Fireworks AI",
    endpoint: "https://api.fireworks.ai/inference/v1",
    apiFormat: "openai",
    testModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    capabilities: ["CHAT", "CHAT_FAST", "CODE"],
    displayOrder: 420,
    docUrl: "https://docs.fireworks.ai",
  },
  {
    slug: "deepinfra",
    name: "DeepInfra",
    endpoint: "https://api.deepinfra.com/v1/openai",
    apiFormat: "openai",
    testModel: "meta-llama/Llama-3.3-70B-Instruct",
    capabilities: ["CHAT", "CHAT_FAST", "EMBEDDING"],
    displayOrder: 430,
    docUrl: "https://deepinfra.com/docs",
  },
  {
    slug: "novita",
    name: "Novita AI",
    endpoint: "https://api.novita.ai/v3/openai",
    apiFormat: "openai",
    testModel: "meta-llama/llama-3.3-70b-instruct",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 440,
    docUrl: "https://novita.ai/docs",
  },

  // ───────────────── 极速推理平台 ─────────────────
  {
    slug: "groq",
    name: "Groq",
    endpoint: "https://api.groq.com/openai/v1",
    apiFormat: "openai",
    testModel: "llama-3.3-70b-versatile",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 500,
    freeTierNote: "免费层有节流",
    docUrl: "https://console.groq.com/docs",
  },
  {
    slug: "cerebras",
    name: "Cerebras",
    endpoint: "https://api.cerebras.ai/v1",
    apiFormat: "openai",
    testModel: "llama-3.3-70b",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 510,
    docUrl: "https://inference-docs.cerebras.ai",
  },
  {
    slug: "sambanova",
    name: "SambaNova",
    endpoint: "https://api.sambanova.ai/v1",
    apiFormat: "openai",
    testModel: "Meta-Llama-3.3-70B-Instruct",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 520,
    docUrl: "https://docs.sambanova.ai",
  },
  {
    slug: "nvidia",
    name: "NVIDIA NIM",
    endpoint: "https://integrate.api.nvidia.com/v1",
    apiFormat: "openai",
    testModel: "meta/llama-3.3-70b-instruct",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 530,
    docUrl: "https://docs.nvidia.com/nim",
  },

  // ───────────────── 向量 / 重排专用 ─────────────────
  {
    slug: "voyage",
    name: "Voyage AI",
    endpoint: "https://api.voyageai.com/v1",
    apiFormat: "openai",
    testModel: "voyage-3-lite",
    capabilities: ["EMBEDDING", "RERANK"],
    displayOrder: 600,
    freeTierNote: "200M tokens/月免费",
    docUrl: "https://docs.voyageai.com",
  },
  {
    slug: "jina",
    name: "Jina AI",
    endpoint: "https://api.jina.ai/v1",
    apiFormat: "openai",
    testModel: "jina-embeddings-v3",
    capabilities: ["EMBEDDING", "RERANK"],
    displayOrder: 610,
    docUrl: "https://jina.ai/embeddings",
  },

  // ───────────────── 本地 / 自托管运行时（endpoint 为 localhost 默认值，用户按需改）─────────────────
  {
    slug: "ollama",
    name: "Ollama (本地)",
    endpoint: "http://localhost:11434/v1",
    apiFormat: "openai",
    testModel: "llama3.2",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 700,
    description: "本地运行时；testModel 请改为你已 pull 的模型",
    docUrl: "https://ollama.com",
  },
  {
    slug: "vllm",
    name: "vLLM (本地)",
    endpoint: "http://localhost:8000/v1",
    apiFormat: "openai",
    testModel: "Qwen/Qwen2.5-7B-Instruct",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 710,
    description: "本地运行时；testModel 请改为你实际 serve 的模型",
    docUrl: "https://docs.vllm.ai",
  },
  {
    slug: "lmstudio",
    name: "LM Studio (本地)",
    endpoint: "http://localhost:1234/v1",
    apiFormat: "openai",
    testModel: "local-model",
    capabilities: ["CHAT", "CHAT_FAST"],
    displayOrder: 720,
    description: "本地运行时；testModel 请改为你在 LM Studio 加载的模型",
    docUrl: "https://lmstudio.ai",
  },
];
