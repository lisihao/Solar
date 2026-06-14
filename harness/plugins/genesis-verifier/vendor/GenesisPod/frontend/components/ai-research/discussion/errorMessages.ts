/**
 * errorMessages - Map raw backend errors to user-friendly messages
 */

export interface FriendlyError {
  title: string;
  description: string;
  retryable: boolean;
}

const ERROR_PATTERNS: Array<{
  pattern: RegExp;
  toError: (match: RegExpMatchArray) => FriendlyError;
}> = [
  {
    pattern: /Insufficient credits/i,
    toError: () => ({
      title: '研究积分不足',
      description: '当前账户积分不够执行此操作，请充值或降低研究深度后重试。',
      retryable: false,
    }),
  },
  {
    pattern: /timeout.*?(\d+)/i,
    toError: () => ({
      title: '研究超时',
      description: '研究执行时间超出限制。请尝试更具体的问题或降低研究深度。',
      retryable: true,
    }),
  },
  {
    pattern: /network|fetch|connection|ECONNREFUSED/i,
    toError: () => ({
      title: '网络连接异常',
      description: '无法连接到服务器，请检查网络后重试。',
      retryable: true,
    }),
  },
  {
    pattern: /rate.?limit/i,
    toError: () => ({
      title: '请求过于频繁',
      description: '请稍等片刻后重试。',
      retryable: true,
    }),
  },
];

const DEFAULT_ERROR: FriendlyError = {
  title: '研究过程中出现问题',
  description: '请稍后重试，或尝试调整研究问题。',
  retryable: true,
};

export function getFriendlyError(rawError: string): FriendlyError {
  for (const { pattern, toError } of ERROR_PATTERNS) {
    const match = rawError.match(pattern);
    if (match) {
      return toError(match);
    }
  }
  return DEFAULT_ERROR;
}
