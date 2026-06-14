/**
 * TokenEstimator — 精确 + 启发双层 token 计数
 *
 * v3 (PR-U)：按 model family 选 encoder
 *   - GPT-4o / o-series：o200k_base
 *   - GPT-4 / GPT-3.5 / Claude（近似）：cl100k_base
 *   - 未知 model：cl100k_base (默认)
 *   - encoder 加载失败：4 chars/token 启发兜底
 *
 * Anthropic 官方 tokenizer 暂未开源 JS 版；用 cl100k_base 估算误差 < 10%（够用）。
 */

import type {
  IContextEnvelope,
  IContextMessage,
} from "../../agents/abstractions";

const CHARS_PER_TOKEN_FALLBACK = 4;

type EncoderName = "cl100k_base" | "o200k_base";
type Encoder = { encode: (text: string) => number[] };

const encoderCache = new Map<EncoderName, Encoder | null>();
let baseModuleInitFailed = false;

/**
 * Lazy 加载特定 encoder。
 * gpt-tokenizer 默认导出是 cl100k_base；o200k_base 通过 sub-import 路径取。
 */
function getEncoder(name: EncoderName): Encoder | null {
  if (encoderCache.has(name)) return encoderCache.get(name) ?? null;
  if (baseModuleInitFailed) return null;
  try {
    let mod: Encoder;
    if (name === "o200k_base") {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("gpt-tokenizer/encoding/o200k_base") as Encoder;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require("gpt-tokenizer") as Encoder;
    }
    encoderCache.set(name, mod);
    return mod;
  } catch {
    encoderCache.set(name, null);
    if (name === "cl100k_base") baseModuleInitFailed = true;
    return null;
  }
}

/**
 * PR-U: 按 modelId 选合适的 encoder。
 * - gpt-4o / gpt-5 / o1 / o3 → o200k_base
 * - 其余（gpt-4 / claude / 未知）→ cl100k_base
 */
function pickEncoderName(modelId?: string): EncoderName {
  if (!modelId) return "cl100k_base";
  const m = modelId.toLowerCase();
  // o200k_base 适用于：gpt-4o / gpt-5+ / o-series（OpenAI 公开映射）。
  // o-series 用 /^o\d/ 覆盖未来型号 (o4/o5/o6...)，避免每次新模型改代码。
  // gpt 主版本号 >= 4 也算 o200k_base（gpt-4 老版用 cl100k 已罕见）。
  if (m.startsWith("gpt-4o") || /^gpt-[5-9]/.test(m) || /^o\d/.test(m)) {
    return "o200k_base";
  }
  return "cl100k_base";
}

function encodedLength(text: string, modelId?: string): number {
  if (!text) return 0;
  const enc = getEncoder(pickEncoderName(modelId));
  if (enc) {
    try {
      return enc.encode(text).length;
    } catch {
      // fall through
    }
  }
  return Math.ceil(text.length / CHARS_PER_TOKEN_FALLBACK);
}

/** 单条消息估算 */
export function estimateMessageTokens(message: IContextMessage): number {
  // role wrapper overhead ≈ 4 tokens (OpenAI ChatML standard)
  return encodedLength(message.content) + 4;
}

/**
 * PR-I 修复 #3: envelope token 估算 cache。
 *
 * 缓存键 = envelope.id + messages.length + reminders.length。
 * envelope 增量变化时（push 一条 message），messages.length 变化即 cache miss。
 * envelope.id 不变 + 长度不变 = 同一对象的多次询问 → cache hit，O(1)。
 *
 * 注意：本 cache 是 best-effort。compaction 后 messages.length 减少，cache key 变化，
 * 自动重算；不会返回过期值。
 */
const envelopeCache = new WeakMap<
  IContextEnvelope,
  { key: string; tokens: number }
>();

/** 整个 envelope 估算（system + reminders + messages + tools） */
export function estimateEnvelopeTokens(envelope: IContextEnvelope): number {
  const key = `${envelope.id}|${envelope.messages.length}|${envelope.reminders.length}`;
  const cached = envelopeCache.get(envelope);
  if (cached && cached.key === key) return cached.tokens;

  let total = 0;
  total += encodedLength(envelope.system);
  for (const r of envelope.reminders) {
    total += encodedLength(r.content) + 4;
  }
  for (const m of envelope.messages) {
    total += estimateMessageTokens(m);
  }
  // Tool descriptions ≈ 10 tokens each if only listed by id
  total += envelope.tools.length * 10;

  envelopeCache.set(envelope, { key, tokens: total });
  return total;
}

/**
 * 按 modelId 选合适 encoder 估算（PR-U）。
 *   - GPT-4o / GPT-5 / o-series → o200k_base
 *   - GPT-4 / Claude / 其它 → cl100k_base
 *   - encoder 加载失败 → 4 chars/token 启发
 */
export function estimateForModel(modelId: string, text: string): number {
  return encodedLength(text, modelId);
}
