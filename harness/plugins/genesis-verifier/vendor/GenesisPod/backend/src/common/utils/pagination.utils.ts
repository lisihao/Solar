/**
 * 分页工具
 *
 * 提供统一的分页参数处理和限制
 */

export interface PaginationOptions {
  skip?: number;
  take?: number;
  maxTake?: number;
}

export interface PaginationResult {
  skip: number;
  take: number;
}

/**
 * 分页限制常量
 */
export const PaginationLimits = {
  DEFAULT_TAKE: 20,
  MAX_TAKE: 100,
  MAX_TAKE_ADMIN: 500,
} as const;

/**
 * 解析并验证分页参数
 * @param skip 跳过的记录数（字符串）
 * @param take 获取的记录数（字符串）
 * @param maxTake 最大允许获取数量（默认100）
 */
export function parsePagination(
  skip?: string | number,
  take?: string | number,
  maxTake: number = PaginationLimits.MAX_TAKE,
): PaginationResult {
  const skipNum = typeof skip === "string" ? parseInt(skip, 10) : (skip ?? 0);
  const takeNum =
    typeof take === "string"
      ? parseInt(take, 10)
      : (take ?? PaginationLimits.DEFAULT_TAKE);

  return {
    skip: Math.max(0, isNaN(skipNum) ? 0 : skipNum),
    take: Math.min(
      Math.max(1, isNaN(takeNum) ? PaginationLimits.DEFAULT_TAKE : takeNum),
      maxTake,
    ),
  };
}

/**
 * 创建分页响应格式
 */
export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  pagination: PaginationResult,
) {
  return {
    data,
    pagination: {
      skip: pagination.skip,
      take: pagination.take,
      total,
      hasMore: pagination.skip + data.length < total,
    },
  };
}
