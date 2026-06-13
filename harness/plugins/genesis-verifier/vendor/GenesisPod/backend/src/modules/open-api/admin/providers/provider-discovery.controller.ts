/**
 * Provider Discovery Controller —— 2026-05-11 P5 (BYOK 一键配置)
 *
 * admin 在 UI 输入 endpoint + apiKey + provider hint，后端：
 *   1. GET {endpoint}/models 拉取该 provider 的模型 ID 列表
 *   2. 按 name pattern 启发式推断每个 model 的 modelType
 *   3. 返回 candidate 列表供 admin 在 UI 勾选 → 批量创建 AIModel 行
 *
 * 不调 LLM 推断（成本零，admin 确认后再批量保存）。
 *
 * 启发式规则（覆盖主流 OpenAI-兼容 provider 的命名约定）：
 *   *embed* / *embedding* / text-embedding-*    → EMBEDDING
 *   *rerank*                                     → RERANK
 *   *vision* / *vl-* / *multimodal*              → MULTIMODAL
 *   dall-e* / imagen* / *image-gen*              → IMAGE_GENERATION
 *   *tts* / *speech*                             → TTS
 *   whisper* / *audio* / *stt*                   → AUDIO
 *   *coder* / *code* / qwen-coder*               → CODE
 *   *flash* / *mini* / *turbo* / *haiku*         → CHAT_FAST
 *   其余                                          → CHAT
 */
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsOptional, IsString, MaxLength, IsUrl, IsIn } from "class-validator";
import { JwtAuthGuard } from "../../../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../../../common/guards/admin.guard";

class DiscoverDto {
  @IsString()
  @IsUrl({ require_tld: false, require_protocol: true })
  @MaxLength(500)
  endpoint!: string;

  @IsString()
  @MaxLength(2000)
  apiKey!: string;

  /** 用于决定 auth header 风格（bearer / x-api-key / x-goog-api-key） */
  @IsOptional()
  @IsString()
  @IsIn(["openai", "anthropic", "google", "cohere"])
  apiFormat?: string;
}

interface DiscoveredModel {
  modelId: string;
  guessedModelType: string;
  category: string;
  raw?: unknown;
}

interface DiscoverResult {
  ok: boolean;
  count: number;
  models: DiscoveredModel[];
  warning?: string;
}

const MODEL_TYPE_PATTERNS: Array<{
  pattern: RegExp;
  modelType: string;
  category: string;
}> = [
  {
    pattern: /(^|[-_/])(embed|embedding)/i,
    modelType: "EMBEDDING",
    category: "embed",
  },
  { pattern: /^text-embedding-/i, modelType: "EMBEDDING", category: "embed" },
  { pattern: /rerank/i, modelType: "RERANK", category: "embed" },
  {
    pattern: /(vision|^vl-|multimodal|-vl$)/i,
    modelType: "MULTIMODAL",
    category: "text",
  },
  {
    pattern: /^dall-e|^imagen|image-gen/i,
    modelType: "IMAGE_GENERATION",
    category: "image",
  },
  { pattern: /tts|speech-/i, modelType: "TTS", category: "audio" },
  { pattern: /^whisper|stt|audio-/i, modelType: "AUDIO", category: "audio" },
  {
    pattern: /coder|-code-?|deepseek-coder|qwen-coder/i,
    modelType: "CODE",
    category: "text",
  },
  {
    pattern: /(flash|mini|turbo|haiku|fast|lite)/i,
    modelType: "CHAT_FAST",
    category: "text",
  },
];

const inferModelType = (
  modelId: string,
): { modelType: string; category: string } => {
  for (const rule of MODEL_TYPE_PATTERNS) {
    if (rule.pattern.test(modelId)) {
      return { modelType: rule.modelType, category: rule.category };
    }
  }
  return { modelType: "CHAT", category: "text" };
};

@UseGuards(JwtAuthGuard, AdminGuard)
@Controller("admin/ai-models")
export class ProviderDiscoveryController {
  @Post("discover")
  async discover(@Body() dto: DiscoverDto): Promise<DiscoverResult> {
    const endpoint = dto.endpoint.replace(/\/+$/, "");
    // OpenAI-兼容 + cohere 都用 /v1/models 或 /models；anthropic / google 不通用。
    // 简化处理：尝试 ${endpoint}/models（base 已含 /v1 时直接拼 /models）。
    const url =
      endpoint.endsWith("/v1") || /\/v\d+$/.test(endpoint)
        ? `${endpoint}/models`
        : `${endpoint}/v1/models`;

    const apiFormat = dto.apiFormat ?? "openai";
    const headers: Record<string, string> = {};
    if (apiFormat === "openai" || apiFormat === "cohere") {
      headers.Authorization = `Bearer ${dto.apiKey}`;
    } else if (apiFormat === "anthropic") {
      headers["x-api-key"] = dto.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (apiFormat === "google") {
      headers["x-goog-api-key"] = dto.apiKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      const message = (err as Error).message;
      throw new BadRequestException(`Discovery failed for ${url}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new BadRequestException(
        `Discovery failed (HTTP ${response.status}) for ${url}: ${body.slice(0, 300)}`,
      );
    }

    type DiscoveryRaw = {
      data?: Array<{ id?: string }>;
      models?: Array<{ name?: string; id?: string }>;
      result?: Array<{ id?: string }>;
    };
    const raw = (await response.json()) as DiscoveryRaw;
    const ids = new Set<string>();
    if (Array.isArray(raw.data)) {
      for (const m of raw.data) if (typeof m.id === "string") ids.add(m.id);
    }
    if (Array.isArray(raw.models)) {
      for (const m of raw.models) {
        const id = m.name || m.id;
        if (typeof id === "string") ids.add(id);
      }
    }
    if (Array.isArray(raw.result)) {
      for (const m of raw.result) if (typeof m.id === "string") ids.add(m.id);
    }

    if (ids.size === 0) {
      return {
        ok: false,
        count: 0,
        models: [],
        warning:
          `远端 ${url} 返回 200 但响应里没找到模型列表（data/models/result 三种 schema 都不匹配）。` +
          `请确认 endpoint 是否标准 OpenAI-兼容 /v1/models 接口，或手动添加。`,
      };
    }

    const models: DiscoveredModel[] = Array.from(ids).map((id) => {
      const inferred = inferModelType(id);
      return {
        modelId: id,
        guessedModelType: inferred.modelType,
        category: inferred.category,
      };
    });

    return { ok: true, count: models.length, models };
  }
}
