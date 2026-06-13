/**
 * KEK (Key-Encryption-Key) provider 抽象（2026-05-28 BYOK 加固 PR-1 / G2）。
 *
 * 信封加密：每条凭据有独立随机 DEK（data-encryption-key）加密明文，DEK 本身用 KEK
 * 包裹（wrap）。KEK 由 provider 托管 —— on-prem 用客户自管的 env/文件 KEK，cloud 用
 * KMS。轮换 KEK 只需 re-wrap DEK，不碰明文/密文。
 *
 * ★ 严格保持：上层只看到 wrap/unwrap + 版本，不关心 KEK 实际来源。
 */
export interface IKekProvider {
  /** 用当前版本 KEK 包裹一个 DEK，返回可持久化的 wrapped 串 + 所用 KEK 版本。 */
  wrap(dek: Buffer): Promise<{ wrapped: string; kekVersion: number }>;

  /** 用指定版本 KEK 解开 wrapped DEK。版本不存在 / 校验失败抛错。 */
  unwrap(wrapped: string, kekVersion: number): Promise<Buffer>;

  /** 当前用于 wrap 的 KEK 版本（轮换时递增）。 */
  readonly currentVersion: number;
}

/** DI token —— EncryptionModule 按 edition 绑定具体实现（env / kms）。 */
export const KEK_PROVIDER = Symbol("KekProvider");
