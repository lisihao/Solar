import { SecretCategory } from "@prisma/client";

/**
 * 2026-05-27 BYOK：用户私有 Secret 的来源表。
 * - llm   → AI_MODEL 类，落 user_api_keys 表（复用 v1.0 KeyResolver / 捐赠池 / 多 key fallback）
 * - secret→ 工具/其他类，落 secrets 表（userId 非空 + per-user HKDF 加密）
 * 见方案 §18.1 落地铁律 1：写回按 category 分流。
 */
export type UserSecretSource = "llm" | "secret";

/** 统一列表项（UNION user_api_keys + secrets 后给前端的归一形状）。 */
export interface UserSecretListItem {
  source: UserSecretSource;
  id: string;
  name: string;
  displayName: string;
  category: SecretCategory;
  provider: string | null;
  maskedValue: string;
  isActive: boolean;
  usageCount: number;
  testStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
}
