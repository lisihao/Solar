/**
 * SecretKeysService（多 KEY 管理 P1）
 *
 * 职责：1 个 secret name 下 N 个 KEY 并存的 CRUD + 业务侧 fallback chain。
 * 与 SecretsService 边界：本服务只动 secret_keys 表 + 兼容字段读取；
 * 不动 Secret 元信息（name/displayName/category/provider/...）。
 *
 * dual-track：业务侧 getSecretKey 在 secret_keys 为空时降级到 Secret.encryptedValue
 *（保证 P3 业务层切换前不破坏）。
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import { EncryptionService } from "../encryption/encryption.service";
import { Secret, SecretKey } from "@prisma/client";
import { normalizeSecretName } from "./secret-name.catalog";
import { ProviderProbeService } from "../../governance/key-health/provider-probe.service";
import {
  cooldownMsForCode,
  isPermanentCooldown,
} from "../../governance/key-health/key-cooldown-policy";

interface AddSecretKeyDto {
  label: string;
  value: string;
  priority?: number;
  isActive?: boolean;
}

interface UpdateSecretKeyMetaDto {
  label?: string;
  priority?: number;
  isActive?: boolean;
}

interface ReplaceSecretKeyValueDto {
  value: string;
}

export interface SecretKeyListItem {
  id: string;
  secretId: string;
  label: string;
  keyHint: string | null;
  isActive: boolean;
  priority: number;
  testStatus: string | null;
  /** ★ 2026-05-12 (C方案): 真实"最后使用"时间(业务流量 + 手动 Test 都写).
   *   admin UI 唯一的"上次使用"字段, 取代旧 lastUsedAt (DB 列保留兼容但不暴露). */
  lastUsedAt: Date | null;
  /** ★ 2026-05-06: 归一化错误码（AUTH_FAILED / RATE_LIMIT_KEY / 等），UI 据此出语义 badge */
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  accessCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResolvedSecretKey {
  /// 解密后的明文（业务侧调用 provider 用）
  value: string;
  /// SecretKey.id（业务侧 markSuccess/markFailure 回写用）；
  /// 兼容降级到 Secret.encryptedValue 时为 null
  keyId: string | null;
  /// 命中 KEY 的 label（用于审计和日志，不含敏感数据）
  label: string;
}

export interface AuditContext {
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
}

// W1 (2026-05-29)：熔断时长改由共享策略 key-cooldown-policy.cooldownMsForCode 按错误码决定，
//   不再用固定 5min 常量（原 FAILED_CIRCUIT_BREAK_MS 已移除）。

@Injectable()
export class SecretKeysService {
  private readonly logger = new Logger(SecretKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly providerProbe: ProviderProbeService,
  ) {}

  // ========== Admin CRUD ==========

  async listKeys(
    secretId: string,
    ownerUserId?: string,
  ): Promise<SecretKeyListItem[]> {
    await this.requireSecret(secretId, ownerUserId);
    const rows = await this.prisma.secretKey.findMany({
      where: { secretId },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    return rows.map((row) => this.toListItem(row));
  }

  async addKey(
    secretId: string,
    dto: AddSecretKeyDto,
    context?: AuditContext,
    ownerUserId?: string,
  ): Promise<SecretKeyListItem> {
    await this.requireSecret(secretId, ownerUserId);

    const dup = await this.prisma.secretKey.findUnique({
      where: { secretId_label: { secretId, label: dto.label } },
      select: { id: true },
    });
    if (dup) {
      throw new ConflictException(
        `Key with label '${dto.label}' already exists for this secret`,
      );
    }

    // 2026-05-28 PR-3.1：新写一律信封 v2（dual-read：旧行经 decryptAny 仍可解）。
    const env = await this.encryption.encryptEnvelope(dto.value);
    const created = await this.prisma.secretKey.create({
      data: {
        secretId,
        label: dto.label,
        encryptedValue: env.encryptedValue,
        iv: env.iv,
        authTag: env.authTag,
        wrappedDek: env.wrappedDek,
        encVersion: env.encVersion,
        kekVersion: env.kekVersion,
        keyVersion: this.encryption.currentKeyVersion,
        keyHint: this.makeHint(dto.value),
        isActive: dto.isActive ?? true,
        priority: dto.priority ?? 0,
        createdBy: context?.userEmail || context?.userId,
        updatedBy: context?.userEmail || context?.userId,
      },
    });
    this.logger.log(`SecretKey added: secretId=${secretId} label=${dto.label}`);
    return this.toListItem(created);
  }

  async updateKeyMeta(
    keyId: string,
    dto: UpdateSecretKeyMetaDto,
    context?: AuditContext,
    ownerUserId?: string,
  ): Promise<SecretKeyListItem> {
    const existing = await this.requireKey(keyId, ownerUserId);

    if (dto.label && dto.label !== existing.label) {
      const dup = await this.prisma.secretKey.findUnique({
        where: {
          secretId_label: { secretId: existing.secretId, label: dto.label },
        },
        select: { id: true },
      });
      if (dup) {
        throw new ConflictException(
          `Key with label '${dto.label}' already exists for this secret`,
        );
      }
    }

    const updated = await this.prisma.secretKey.update({
      where: { id: keyId },
      data: {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: context?.userEmail || context?.userId,
      },
    });
    return this.toListItem(updated);
  }

  async replaceKeyValue(
    keyId: string,
    dto: ReplaceSecretKeyValueDto,
    context?: AuditContext,
    ownerUserId?: string,
  ): Promise<SecretKeyListItem> {
    await this.requireKey(keyId, ownerUserId);
    const env = await this.encryption.encryptEnvelope(dto.value);
    const updated = await this.prisma.secretKey.update({
      where: { id: keyId },
      data: {
        encryptedValue: env.encryptedValue,
        iv: env.iv,
        authTag: env.authTag,
        wrappedDek: env.wrappedDek,
        encVersion: env.encVersion,
        kekVersion: env.kekVersion,
        keyVersion: this.encryption.currentKeyVersion,
        keyHint: this.makeHint(dto.value),
        // 替换 value 后健康状态置回 unknown，等下次 test/调用回写
        // ★ 2026-05-06: lastErrorCode 也要清，否则旧错误码残留 → UI 误判失败
        testStatus: null,
        lastUsedAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        // ★ 2026-05-07: accessCount 是"当前物理 KEY 值的命中数"。Replace 后是
        // 全新物理 value，旧 hits 不属于它 → 重置为 0（与 testStatus reset 同语义）。
        accessCount: 0,
        updatedBy: context?.userEmail || context?.userId,
      },
    });
    return this.toListItem(updated);
  }

  async deleteKey(
    keyId: string,
    context?: AuditContext,
    ownerUserId?: string,
  ): Promise<void> {
    const existing = await this.requireKey(keyId, ownerUserId);
    const secret = await this.prisma.secret.findUnique({
      where: { id: existing.secretId },
      select: { name: true },
    });

    // ★ 事务：删 KEY + 写审计日志（单 KEY 删除可追溯）
    await this.prisma.$transaction(async (tx) => {
      await tx.secretKey.delete({ where: { id: keyId } });
      await tx.secretAccessLog
        .create({
          data: {
            secretId: existing.secretId,
            action: "DELETE",
            actionStatus: "success",
            secretName: secret
              ? `${secret.name}#${existing.label}`
              : `?#${existing.label}`,
            userId: context?.userId,
            userEmail: context?.userEmail,
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent,
          },
        })
        .catch(() => undefined); // 审计失败不阻塞主流程（与既有 logAccess 一致）
    });

    this.logger.log(
      `SecretKey deleted: secretId=${existing.secretId} label=${existing.label} by=${context?.userEmail ?? "?"}`,
    );
  }

  /**
   * ★ 2026-05-06 重写：手动 Test 按钮做真上游探测（不再只看 AES 解密）。
   *
   * 流程：
   *   1. 解密 KEY；失败 → markFailure('DECRYPTION_FAILED')
   *   2. 拿 Secret.provider 调 ProviderProbeService.probeByProvider 真发 HTTP
   *   3. 结果走 markSuccess / markFailure 同一写库路径；UI 看到的 testStatus /
   *      lastUsedAt / lastErrorCode / lastErrorMessage 永远是"最近一次真实活动"
   *
   * 业务流量也调 markSuccess / markFailure，所以"OK / Failed 的时间"自动是
   * 上一次实际命中的时间，不会被手动按钮的伪绿章覆盖。
   *
   * 单写库原则：所有分支只调用一次 prisma.secretKey.update（直接写或经
   * markSuccess/markFailure），避免双写覆盖混乱 + 减少 race。
   */
  async testKey(
    keyId: string,
    context?: AuditContext,
    ownerUserId?: string,
  ): Promise<{ ok: boolean; errorCode?: string; errorMessage?: string }> {
    const existing = await this.requireKey(keyId, ownerUserId);
    const updatedBy = context?.userEmail || context?.userId;
    const now = new Date();
    const decrypted = await this.encryption.decryptAny(existing);

    if (!decrypted || decrypted.length === 0) {
      await this.prisma.secretKey.update({
        where: { id: keyId },
        data: {
          testStatus: "failed",
          lastUsedAt: now,
          lastErrorCode: "DECRYPTION_FAILED",
          lastErrorMessage:
            "decryption failed (encryptedValue or iv corrupted)",
          updatedBy,
        },
      });
      return {
        ok: false,
        errorCode: "DECRYPTION_FAILED",
        errorMessage: "decryption failed",
      };
    }

    // 拉 Secret.provider 找 endpoint / apiFormat
    const secret = await this.prisma.secret.findUnique({
      where: { id: existing.secretId },
      select: { provider: true, name: true },
    });
    const providerSlug = secret?.provider ?? null;

    if (!providerSlug) {
      // Secret 没绑定 provider（SkillsMP / Tools 类）→ 暂无上游可调，
      // 退化为"解密 OK"。仍标 success 是因为 KEY 本身可用；errorMessage 提示
      // 真上游探测被跳过，让运维知道这条路径是降级状态。
      await this.prisma.secretKey.update({
        where: { id: keyId },
        data: {
          testStatus: "success",
          lastUsedAt: now,
          lastErrorCode: null,
          lastErrorMessage: "decrypted (no provider bound, real probe skipped)",
          updatedBy,
        },
      });
      return { ok: true };
    }

    const probeResult = await this.providerProbe.probeByProvider({
      provider: providerSlug,
      apiKey: decrypted,
    });

    // 注意：手动 probe 不算业务调用次数，markSuccess 走 incrementAccessCount=false
    if (probeResult.ok) {
      await this.prisma.secretKey.update({
        where: { id: keyId },
        data: {
          testStatus: "success",
          lastUsedAt: now,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedBy,
        },
      });
    } else {
      await this.prisma.secretKey.update({
        where: { id: keyId },
        data: {
          testStatus: "failed",
          lastUsedAt: now,
          lastErrorCode: (probeResult.errorCode ?? "UNKNOWN").slice(0, 40),
          lastErrorMessage: (probeResult.errorMessage ?? "probe failed").slice(
            0,
            500,
          ),
          updatedBy,
        },
      });
    }
    return {
      ok: probeResult.ok,
      errorCode: probeResult.errorCode,
      errorMessage: probeResult.errorMessage,
    };
  }

  // ========== Business-side fallback chain ==========

  /**
   * 业务侧 resolver 入口。按 priority asc + 健康熔断挑一个 KEY 解密返回。
   * 找不到 SecretKey 行（dual-track 还没回填）时降级读 Secret.encryptedValue。
   */
  async getSecretKey(
    secretName: string,
    ownerUserId?: string | null,
    _context?: AuditContext,
  ): Promise<ResolvedSecretKey | null> {
    // 2026-05-29 BYOK：ownerUserId 传入时按 user 作用域查 user secret（不做 catalog 归一，
    //   用户 secret 名为自定义）；admin 不传 → userId=null + 沿用 catalog 归一。
    const lookupName = ownerUserId
      ? secretName
      : normalizeSecretName(secretName);

    const secret = await this.prisma.secret.findFirst({
      where: { name: lookupName, userId: ownerUserId ?? null },
    });
    if (!secret || !secret.isActive || secret.deletedAt) return null;
    if (secret.expiresAt && secret.expiresAt < new Date()) return null;

    const candidate = await this.pickActiveKey(secret.id);
    if (candidate) {
      const decrypted = await this.encryption.decryptAny(candidate);
      if (!decrypted) {
        this.logger.warn(
          `getSecretKey: decrypt failed for secretKey id=${candidate.id} label=${candidate.label}`,
        );
        return null;
      }
      return {
        value: decrypted,
        keyId: candidate.id,
        label: candidate.label,
      };
    }

    // dual-track 降级：SecretKey 表为空 → 读 Secret.encryptedValue
    const decrypted = await this.encryption.decryptAny(secret);
    if (!decrypted) return null;
    return { value: decrypted, keyId: null, label: "(legacy)" };
  }

  /**
   * ★ 2026-05-06: 业务流量成功调用上游 + 手动 probe 通过都走它。
   * 写入：testStatus='success'、lastUsedAt=now、lastUsedAt=now、清错误码/消息、可选 accessCount++。
   * incrementAccessCount=true 仅在真实业务流量成功时；手动 probe 不算"业务调用次数"
   * (但仍写 lastUsedAt — Test 也算 Used, 见 2026-05-12 用户指示).
   */
  async markSuccess(
    keyId: string,
    options: { incrementAccessCount?: boolean } = {
      incrementAccessCount: true,
    },
  ): Promise<void> {
    const now = new Date();
    await this.prisma.secretKey.update({
      where: { id: keyId },
      data: {
        testStatus: "success",
        lastUsedAt: now,
        lastErrorCode: null,
        lastErrorMessage: null,
        ...(options.incrementAccessCount !== false
          ? { accessCount: { increment: 1 } }
          : {}),
      },
    });
  }

  /**
   * ★ 2026-05-06: 业务流量失败 + 手动 probe 失败统一入口。
   * errorCode 用 ProbeErrorCode 同款命名（AUTH_FAILED / RATE_LIMIT_KEY / 等），
   * UI 据此出语义化 badge（"未授权" / "限流" / 等）。
   * ★ 2026-05-12: lastUsedAt 失败也写 (用户角度 "Test 是 Used").
   */
  async markFailure(
    keyId: string,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const trimmedMessage = errorMessage.slice(0, 500);
    const trimmedCode = errorCode.slice(0, 40);
    const now = new Date();
    await this.prisma.secretKey.update({
      where: { id: keyId },
      data: {
        testStatus: "failed",
        lastUsedAt: now,
        lastErrorCode: trimmedCode,
        lastErrorMessage: trimmedMessage,
      },
    });
  }

  // ========== Internals ==========

  private async pickActiveKey(secretId: string): Promise<SecretKey | null> {
    const candidates = await this.prisma.secretKey.findMany({
      where: { secretId, isActive: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });
    if (candidates.length === 0) return null;

    // W1 (2026-05-29)：从固定 5min 升级为按 lastErrorCode 动态熔断（复用共享 cooldown 策略）。
    //   AUTH_FAILED / 配额耗尽 / 解密失败 → 永久熔断（等替换）；限流 60s；超时 30s；未分类 5min。
    const now = Date.now();
    let fallback: SecretKey | null = null; // 全熔断时兜底：优先非永久熔断的那把
    const eligible: SecretKey[] = []; // 可用 key（active + 不在熔断窗口）
    for (const k of candidates) {
      if (k.testStatus === "failed" && k.lastUsedAt) {
        const cooldownMs = cooldownMsForCode(k.lastErrorCode);
        const since = now - k.lastUsedAt.getTime();
        if (since < cooldownMs) {
          // 仍在熔断窗口：跳过（不进轮询）。非永久熔断的留作全熔断时兜底。
          if (fallback === null && !isPermanentCooldown(cooldownMs))
            fallback = k;
          continue;
        }
      }
      eligible.push(k);
    }
    // 全部在熔断窗口内 → 兜底返回一个非永久熔断的（避免硬返回已 DEAD 的坏 key）；
    // 若全是永久熔断（全坏/全配额耗尽），仍返回第一个让上层拿到明确失败。
    if (eligible.length === 0) return fallback ?? candidates[0];

    // ★ 2026-06-12 round-robin：在「可用」key 间按 LRU 轮询（选最久未用的一把），
    //   把负载/限流分散到所有可用 key，不再永远只用优先级第 0 把。
    //   解析后 caller 会 stamp lastUsedAt=now（getValueInternal 等），下次自然轮到别把；
    //   DB 为准、多进程安全。只轮询可用 key —— 熔断中 / 永久坏 / 已禁用的上面已滤除。
    //   并列 tiebreak：命中少的优先，再按 priority 小的（保留优先级作为最终次序）。
    eligible.sort((a, b) => {
      const ta = a.lastUsedAt ? a.lastUsedAt.getTime() : 0;
      const tb = b.lastUsedAt ? b.lastUsedAt.getTime() : 0;
      if (ta !== tb) return ta - tb;
      if (a.accessCount !== b.accessCount) return a.accessCount - b.accessCount;
      return a.priority - b.priority;
    });
    return eligible[0];
  }

  /**
   * @param ownerUserId BYOK owner 隔离（2026-05-29）：传入时强制 secret.userId === ownerUserId。
   *   admin 调用不传（undefined）→ 不做 owner 校验（AdminGuard 管控）。
   *   不匹配按 NotFound 处理（不泄露他人 secret 存在性，防 IDOR 探测）。
   */
  private async requireSecret(
    secretId: string,
    ownerUserId?: string,
  ): Promise<Secret> {
    const secret = await this.prisma.secret.findUnique({
      where: { id: secretId },
    });
    if (!secret || secret.deletedAt) {
      throw new NotFoundException(`Secret '${secretId}' not found`);
    }
    if (ownerUserId !== undefined && secret.userId !== ownerUserId) {
      throw new NotFoundException(`Secret '${secretId}' not found`);
    }
    return secret;
  }

  /** @param ownerUserId 传入时校验该 key 的父 secret 归属（见 requireSecret）。 */
  private async requireKey(
    keyId: string,
    ownerUserId?: string,
  ): Promise<SecretKey> {
    const key = await this.prisma.secretKey.findUnique({
      where: { id: keyId },
    });
    if (!key) {
      throw new NotFoundException(`SecretKey '${keyId}' not found`);
    }
    if (ownerUserId !== undefined) {
      await this.requireSecret(key.secretId, ownerUserId);
    }
    return key;
  }

  private makeHint(value: string): string {
    if (!value || value.length < 8) return "••••••••";
    const head = value.slice(0, 3);
    const tail = value.slice(-4);
    return `${head}…${tail}`;
  }

  private toListItem(row: SecretKey): SecretKeyListItem {
    return {
      id: row.id,
      secretId: row.secretId,
      label: row.label,
      keyHint: row.keyHint,
      isActive: row.isActive,
      priority: row.priority,
      testStatus: row.testStatus,
      lastUsedAt: row.lastUsedAt,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      accessCount: row.accessCount,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
