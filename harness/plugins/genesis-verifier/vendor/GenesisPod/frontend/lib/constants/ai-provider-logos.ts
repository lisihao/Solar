/**
 * AI Provider Logo Utility
 * Maps AI provider names to their official logo paths and brand colors
 */

export interface ProviderBrand {
  name: string;
  logo: string;
  color: string;
  gradient: string;
}

const PROVIDER_BRANDS: Record<string, ProviderBrand> = {
  openai: {
    name: 'OpenAI',
    logo: '/icons/ai/openai.svg',
    color: '#10a37f',
    gradient: 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)',
  },
  gpt: {
    name: 'OpenAI',
    logo: '/icons/ai/openai.svg',
    color: '#10a37f',
    gradient: 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)',
  },
  chatgpt: {
    name: 'OpenAI',
    logo: '/icons/ai/openai.svg',
    color: '#10a37f',
    gradient: 'linear-gradient(135deg, #10a37f 0%, #0d8a6a 100%)',
  },
  google: {
    name: 'Google',
    logo: '/icons/ai/gemini.svg',
    color: '#4285f4',
    gradient: 'linear-gradient(135deg, #4285f4 0%, #9b72cb 50%, #d96570 100%)',
  },
  gemini: {
    name: 'Google Gemini',
    logo: '/icons/ai/gemini.svg',
    color: '#4285f4',
    gradient: 'linear-gradient(135deg, #4285f4 0%, #9b72cb 50%, #d96570 100%)',
  },
  anthropic: {
    name: 'Anthropic',
    logo: '/icons/ai/claude.svg',
    color: '#d97706',
    gradient: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
  },
  claude: {
    name: 'Claude',
    logo: '/icons/ai/claude.svg',
    color: '#d97706',
    gradient: 'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
  },
  xai: {
    name: 'xAI',
    logo: '/icons/ai/grok.svg',
    color: '#000000',
    gradient: 'linear-gradient(135deg, #1d1d1f 0%, #000000 100%)',
  },
  grok: {
    name: 'Grok',
    logo: '/icons/ai/grok.svg',
    color: '#000000',
    gradient: 'linear-gradient(135deg, #1d1d1f 0%, #000000 100%)',
  },
  meta: {
    name: 'Meta',
    logo: '/icons/ai/meta.svg',
    color: '#0668e1',
    gradient: 'linear-gradient(135deg, #0668e1 0%, #0553b8 100%)',
  },
  llama: {
    name: 'Meta Llama',
    logo: '/icons/ai/meta.svg',
    color: '#0668e1',
    gradient: 'linear-gradient(135deg, #0668e1 0%, #0553b8 100%)',
  },
  openrouter: {
    name: 'OpenRouter',
    logo: '/icons/ai/openrouter.svg',
    color: '#6366f1',
    gradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
  },
  minimax: {
    name: 'MiniMax',
    logo: '/icons/ai/minimax.svg',
    color: '#1a1a2e',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
  },
  groq: {
    name: 'Groq',
    logo: '/icons/ai/groq.svg',
    color: '#f55036',
    gradient: 'linear-gradient(135deg, #f55036 0%, #c4402b 100%)',
  },
  deepseek: {
    name: 'DeepSeek',
    logo: '/icons/ai/deepseek.svg',
    color: '#4d6bfe',
    gradient: 'linear-gradient(135deg, #4d6bfe 0%, #3b5bdb 100%)',
  },
  qwen: {
    name: 'Qwen',
    logo: '/icons/ai/qwen.svg',
    color: '#6236ff',
    gradient: 'linear-gradient(135deg, #6236ff 0%, #4a1fd6 100%)',
  },
  alibaba: {
    name: 'Alibaba',
    logo: '/icons/ai/qwen.svg',
    color: '#6236ff',
    gradient: 'linear-gradient(135deg, #6236ff 0%, #4a1fd6 100%)',
  },
  doubao: {
    name: 'Doubao',
    logo: '/icons/ai/doubao.svg',
    color: '#325aff',
    gradient: 'linear-gradient(135deg, #325aff 0%, #2040cc 100%)',
  },
  bytedance: {
    name: 'ByteDance',
    logo: '/icons/ai/doubao.svg',
    color: '#325aff',
    gradient: 'linear-gradient(135deg, #325aff 0%, #2040cc 100%)',
  },
  zhipu: {
    name: 'Zhipu',
    logo: '/icons/ai/zhipu.svg',
    color: '#3d5afe',
    gradient: 'linear-gradient(135deg, #3d5afe 0%, #2a3eb1 100%)',
  },
  glm: {
    name: 'GLM',
    logo: '/icons/ai/zhipu.svg',
    color: '#3d5afe',
    gradient: 'linear-gradient(135deg, #3d5afe 0%, #2a3eb1 100%)',
  },
  kimi: {
    name: 'Kimi',
    logo: '/icons/ai/kimi.svg',
    color: '#000000',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #000000 100%)',
  },
  moonshot: {
    name: 'Moonshot',
    logo: '/icons/ai/kimi.svg',
    color: '#000000',
    gradient: 'linear-gradient(135deg, #1a1a2e 0%, #000000 100%)',
  },
  mistral: {
    name: 'Mistral',
    logo: '/icons/ai/mistral.svg',
    color: '#f7d046',
    gradient: 'linear-gradient(135deg, #f7d046 0%, #eb5829 100%)',
  },
};

// Default fallback for unknown providers
const DEFAULT_BRAND: ProviderBrand = {
  name: 'AI',
  logo: '',
  color: '#6b7280',
  gradient: 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)',
};

/**
 * Get provider brand information from a model name or display name
 * @param name - The model name, display name, or provider name
 * @returns ProviderBrand object with logo, color, and gradient
 */
export function getProviderBrand(name: string): ProviderBrand {
  const lowerName = name.toLowerCase();

  // Check each provider pattern
  for (const [key, brand] of Object.entries(PROVIDER_BRANDS)) {
    if (lowerName.includes(key)) {
      return brand;
    }
  }

  // ★ 火山引擎接入点 ID（ep-xxx）映射到 Doubao
  if (lowerName.startsWith('ep-')) {
    return PROVIDER_BRANDS.doubao;
  }

  // 未收录的 provider（自定义 slug / 新厂商如 agnes / tokenmix）：
  // 回退用真实 slug 名（首字母大写）而不是死板的 "AI"，否则一列全显示 "AI"。
  return { ...DEFAULT_BRAND, name: titleCaseSlug(name) || DEFAULT_BRAND.name };
}

/** "agnes" → "Agnes"；"my-proxy" → "My Proxy"；"sapiens-ai/agnes" → "Agnes"（取末段）。 */
function titleCaseSlug(raw: string): string {
  const base = (raw || '').split('/').pop() ?? '';
  return base
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Get just the logo path for a provider
 * @param name - The model name or provider name
 * @returns Logo path or empty string
 */
export function getProviderLogo(name: string): string {
  return getProviderBrand(name).logo;
}

/**
 * Get provider brand color
 * @param name - The model name or provider name
 * @returns CSS color value
 */
export function getProviderColor(name: string): string {
  return getProviderBrand(name).color;
}

/**
 * Get provider gradient for backgrounds
 * @param name - The model name or provider name
 * @returns CSS gradient value
 */
export function getProviderGradient(name: string): string {
  return getProviderBrand(name).gradient;
}
