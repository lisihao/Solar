import { ForbiddenException, HttpStatus } from "@nestjs/common";

export const BYOK_ERROR_CODES = {
  NO_AVAILABLE_KEY: "NO_AVAILABLE_KEY",
  NO_MODEL_CONFIGURED: "NO_MODEL_CONFIGURED",
  INVALID_API_KEY: "INVALID_API_KEY",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  KEY_EXPIRED: "KEY_EXPIRED",
  DUPLICATE_REQUEST: "DUPLICATE_REQUEST",
  ASSIGNMENT_EXISTS: "ASSIGNMENT_EXISTS",
  NO_SYSTEM_KEY: "NO_SYSTEM_KEY",
} as const;

export type BYOKErrorCode =
  (typeof BYOK_ERROR_CODES)[keyof typeof BYOK_ERROR_CODES];

export interface BYOKErrorMeta {
  provider?: string;
  source?: "PERSONAL" | "ASSIGNED" | "SYSTEM";
  canRequest?: boolean;
  requestUrl?: string;
  usedCents?: number;
  limitCents?: number;
  [k: string]: unknown;
}

export class BYOKError extends ForbiddenException {
  readonly code: BYOKErrorCode;
  readonly meta: BYOKErrorMeta;

  constructor(code: BYOKErrorCode, message: string, meta: BYOKErrorMeta = {}) {
    super({
      statusCode: HttpStatus.FORBIDDEN,
      message,
      code,
      meta,
    });
    this.code = code;
    this.meta = meta;
  }
}

export class NoAvailableKeyError extends BYOKError {
  constructor(provider: string, meta: Partial<BYOKErrorMeta> = {}) {
    const message = provider
      ? `No API Key available for provider "${provider}"`
      : "No API Key configured. Please add one in Settings → API Keys.";
    super(BYOK_ERROR_CODES.NO_AVAILABLE_KEY, message, {
      provider,
      canRequest: true,
      requestUrl: "/settings/api-keys/request",
      ...meta,
    });
  }
}

export class InvalidApiKeyError extends BYOKError {
  constructor(
    provider: string,
    source: BYOKErrorMeta["source"],
    meta: Partial<BYOKErrorMeta> = {},
  ) {
    super(
      BYOK_ERROR_CODES.INVALID_API_KEY,
      `API Key for provider "${provider}" is invalid or revoked`,
      { provider, source, ...meta },
    );
  }
}

export class QuotaExceededError extends BYOKError {
  constructor(
    provider: string,
    source: BYOKErrorMeta["source"],
    meta: Partial<BYOKErrorMeta> = {},
  ) {
    super(
      BYOK_ERROR_CODES.QUOTA_EXCEEDED,
      `Quota exceeded for provider "${provider}"`,
      { provider, source, ...meta },
    );
  }
}

export class NoModelConfiguredError extends BYOKError {
  constructor(modelType: string, meta: Partial<BYOKErrorMeta> = {}) {
    super(
      BYOK_ERROR_CODES.NO_MODEL_CONFIGURED,
      `No ${modelType} model configured for your account. 请前往「AI 配置」添加 ${modelType} 模型。`,
      {
        modelType,
        canRequest: true,
        requestUrl: "/me/ai?tab=models",
        ...meta,
      },
    );
  }
}

export class NoSystemKeyError extends BYOKError {
  constructor(provider: string) {
    super(
      BYOK_ERROR_CODES.NO_SYSTEM_KEY,
      `System API Key for provider "${provider}" is not configured. Ask the operator to add it in Secret Manager.`,
      { provider },
    );
  }
}
