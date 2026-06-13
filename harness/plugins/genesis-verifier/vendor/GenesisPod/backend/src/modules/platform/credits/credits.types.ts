import { CreditTransactionType as PrismaCreditTransactionType } from "@prisma/client";

/**
 * 内部消耗积分参数
 */
export interface ConsumeCreditsParams {
  userId: string;
  moduleType: string;
  operationType: string;
  tokenCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  modelName?: string;
  referenceId?: string;
  description?: string;
  idempotencyKey?: string;
}

/**
 * 消耗结果
 */
export interface ConsumeCreditsResult {
  consumed: number;
  balanceAfter: number;
  transactionId: string;
}

/**
 * 发放结果
 */
export interface GrantCreditsResult {
  success: boolean;
  userId: string;
  amount: number;
  balanceAfter: number;
  transactionId: string;
}

/**
 * 交易记录响应
 */
export interface TransactionResponse {
  id: string;
  type: PrismaCreditTransactionType;
  amount: number;
  balanceAfter: number;
  description: string;
  moduleType?: string;
  operationType?: string;
  tokenCount?: number;
  modelName?: string;
  createdAt: Date;
}

/**
 * 分页交易记录响应
 */
export interface PaginatedTransactionsResponse {
  data: TransactionResponse[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
