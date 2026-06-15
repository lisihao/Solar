/**
 * Secrets Service
 *
 * Centralized management for API keys and sensitive credentials.
 * All secrets are encrypted using AES-256-CBC with separate IV storage.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "@/common/prisma/prisma.service";
import {
  Secret,
  SecretCategory,
  SecretAccessLog,
  SecretAction,
} from "@prisma/client";
import {
  SYSTEM_SETTING_TO_SECRET_MAPPING,
  normalizeSecretName,
  getExpectedSecretsMetadata,
  classifySecret,
} from "./secret-name.catalog";
import { EncryptionService } from "../encryption/encryption.service";
import { SecretKeysService } from "./secret-keys.service";
import { AuditLogService } from "@/modules/platform/monitoring/audit/audit-log.service";

interface CreateSecretDto {
  name: string;
  displayName: string;
  value: string;
  category?: SecretCategory;
  description?: string;
  provider?: string;
  expiresAt?: string;
  isActive?: boolean;
}

interface UpdateSecretDto {
  displayName?: string;
  description?: string;
  category?: SecretCategory;
  provider?: string;
  expiresAt?: string;
  isActive?: boolean;
  value?: string;
  changeNote?: string;
}

export type SecretAggregateStatus = "ok" | "failed" | "unknown" | "disabled";

export interface SecretListItem {
  id: string;
  name: string;
  displayName: string;
  category: SecretCategory;
  description: string | null;
  provider: string | null;
  isActive: boolean;
  maskedValue: string;
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date | null;
  accessCount: number;
  expiresAt: Date | null;
  lastRotatedAt: Date | null;
  /** ★ 多 KEY 聚合状态（任一 active+success → ok；全 failed → failed；
   *  active 但无 test 结果 → unknown；secret/全 key inactive → disabled） */
  aggregateStatus: SecretAggregateStatus;
  /** 当前配置的 SecretKey 行数（active + inactive） */
  totalKeys: number;
  /** 其中 active 数量 */
  activeKeys: number;
}

export interface SecretVersionItem {
  id: string;
  version: number;
  checksum: string;
  createdBy: string | null;
  createdAt: Date;
  changeNote: string | null;
  isCurrent: boolean;
}

export interface SecretReference {
  type: "ai_model" | "external_api";
  id: string;
  name: string;
}

export interface AuditContext {
  userId?: string;
  userEmail?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private get currentKeyVersion(): number {
    return this.encryption.currentKeyVersion;
  }

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private secretKeys: SecretKeysService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(
    dto: CreateSecretDto,
    context?: AuditContext,
    ownerUserId?: string,
  ): Promise<SecretListItem> {
    // 2026-05-28 PR-3.1：新写一律信封 v2（dual-read：旧行经 decryptAny 仍可解）。
    // 2026-05-29 BYOK：ownerUserId 传入时落 user-scoped 行（admin 不传 → userId=null）。
    const env = await this.encryption.encryptEnvelope(dto.value);
    const valueHash = this.hashValue(dto.value);

    // ★ Dual-write 事务化：Secret + SecretKey 'primary' 同步落表，
    // 任一失败整个事务回滚（防 secret 已建但 secret_keys 缺行的不一致）。
    // SecretKey.encryptedValue 用独立 DEK，与 Secret.encryptedValue 是独立密文
    //（与 addKey 行为一致；保留 dual-track 期间各自独立旋转）。
    const secret = await this.prisma.$transaction(async (tx) => {
      const created = await tx.secret.create({
        data: {
          name: dto.name,
          userId: ownerUserId ?? null,
          displayName: dto.displayName,
          category: dto.category,
          description: dto.description,
          encryptedValue: env.encryptedValue,
          iv: env.iv,
          authTag: env.authTag,
          wrappedDek: env.wrappedDek,
          encVersion: env.encVersion,
          kekVersion: env.kekVersion,
          keyVersion: this.currentKeyVersion,
          // ★ 2026-05-29 评审修复：持久化脱敏指纹，避免列表渲染时为生成 mask 而解密明文
          //   （尤其 user-scoped secret 走 UserSecretsService.list 的 keyHint ?? 路径）。
          keyHint: this.makeHint(dto.value),
          provider: dto.provider,
          isActive: dto.isActive ?? true,
          expiresAt: dto.expiresAt,
          createdBy: context?.userEmail || context?.userId,
          updatedBy: context?.userEmail || context?.userId,
        },
      });

      const skEnc = await this.encryption.encryptEnvelope(dto.value);
      await tx.secretKey.create({
        data: {
          secretId: created.id,
          label: "primary",
          encryptedValue: skEnc.encryptedValue,
          iv: skEnc.iv,
          authTag: skEnc.authTag,
          wrappedDek: skEnc.wrappedDek,
          encVersion: skEnc.encVersion,
          kekVersion: skEnc.kekVersion,
          keyVersion: this.currentKeyVersion,
          keyHint: this.makeHint(dto.value),
          isActive: true,
          priority: 0,
          createdBy: context?.userEmail || context?.userId,
          updatedBy: context?.userEmail || context?.userId,
        },
      });

      return created;
    });

    await this.logAccess(secret.id, SecretAction.CREATE, context, {
      secretName: secret.name,
      newValueHash: valueHash,
    });

    this.logger.log(`Secret created: ${dto.name}`);
    return this.toListItem(secret);
  }

  private makeHint(value: string): string {
    if (!value || value.length < 8) return "••••••••";
    return `${value.slice(0, 3)}…${value.slice(-4)}`;
  }

  async findAll(category?: SecretCategory): Promise<SecretListItem[]> {
    const secrets = await this.prisma.secret.findMany({
      where: {
        deletedAt: null,
        userId: null,
        ...(category ? { category } : {}),
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: {
        keys: {
          select: { isActive: true, testStatus: true },
        },
      },
    });
    return secrets.map((secret) => {
      const keyAgg = aggregateKeyStatus(secret.isActive, secret.keys ?? []);
      return this.toListItem(secret, keyAgg);
    });
  }

  async findByName(name: string): Promise<SecretListItem | null> {
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: null },
    });
    if (!secret || secret.deletedAt) return null;
    return this.toListItem(secret);
  }

  // ───────── BYOK user-scoped 读（2026-05-29，与 admin findAll/findByName 同构）─────────

  /** 列当前用户的 BYOK secrets（多 KEY 聚合状态，与 admin findAll 一致的呈现）。 */
  async listByUser(
    userId: string,
    category?: SecretCategory,
  ): Promise<SecretListItem[]> {
    const secrets = await this.prisma.secret.findMany({
      where: {
        deletedAt: null,
        userId,
        ...(category ? { category } : {}),
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      include: { keys: { select: { isActive: true, testStatus: true } } },
    });
    return secrets.map((secret) => {
      const keyAgg = aggregateKeyStatus(secret.isActive, secret.keys ?? []);
      return this.toListItem(secret, keyAgg);
    });
  }

  /** 按 id + owner 取一个用户 secret（controller 用它做归属校验 + 拿 name 调 update/delete）。 */
  async getByIdForUser(
    id: string,
    userId: string,
  ): Promise<SecretListItem | null> {
    const secret = await this.prisma.secret.findFirst({
      where: { id, userId },
    });
    if (!secret || secret.deletedAt) return null;
    return this.toListItem(secret);
  }

  async getValue(name: string, context?: AuditContext): Promise<string | null> {
    // ★ 多 KEY 路径优先（与 getValueInternal 对齐）：
    // SecretKeysService.getSecretKey 已含 fallback chain + 5min 熔断 + dual-track 兜底。
    // 找不到 / 不可用则降级到 legacy 单 KEY 路径，保持 logAccess / logAccessDenied 审计语义。
    if (this.secretKeys) {
      const resolved = await this.secretKeys.getSecretKey(name);
      if (resolved) {
        const sec = await this.prisma.secret.findFirst({
          where: { name, userId: null },
          select: { id: true, name: true },
        });
        if (sec) {
          await this.prisma.secret
            .update({
              where: { id: sec.id },
              data: {
                lastAccessedAt: new Date(),
                accessCount: { increment: 1 },
              },
            })
            .catch(() => undefined);
          // ★ 多 KEY 路径也记审计（不丢 SecretAction.VIEW）
          await this.logAccess(sec.id, SecretAction.VIEW, context, {
            secretName: sec.name,
          });
        }
        // 高敏操作审计：secret 访问 append-only 留痕（与内部 access log 互补）
        await this.auditLog.record({
          actorUserId: context?.userId ?? null,
          action: "secret.access",
          resourceType: "secret",
          resourceId: sec?.id,
          result: "success",
          ip: context?.ipAddress,
          metadata: { secretName: name, path: "multi-key" },
        });
        return resolved.value;
      }
    }

    // Legacy 路径（secretKeys 未注入或 multi-key resolver 返 null）
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: null },
    });

    if (!secret || secret.deletedAt) {
      if (context)
        await this.logAccessDenied(name, context, "Secret not found");
      return null;
    }

    if (!secret.isActive) {
      if (context)
        await this.logAccessDenied(name, context, "Secret is disabled");
      return null;
    }

    if (secret.expiresAt && secret.expiresAt < new Date()) {
      if (context) await this.logAccessDenied(name, context, "Secret expired");
      return null;
    }

    await this.prisma.secret.update({
      where: { id: secret.id },
      data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
    });

    await this.logAccess(secret.id, SecretAction.VIEW, context, {
      secretName: secret.name,
    });
    // 高敏操作审计：secret 访问 append-only 留痕（legacy 单 KEY 路径）
    await this.auditLog.record({
      actorUserId: context?.userId ?? null,
      action: "secret.access",
      resourceType: "secret",
      resourceId: secret.id,
      result: "success",
      ip: context?.ipAddress,
      metadata: { secretName: secret.name, path: "legacy" },
    });
    return this.encryption.decryptAny(secret);
  }

  /**
   * 按 provider 模糊匹配查找一个 AI_MODEL 分类的 Secret。
   * 容忍历史命名不规范（claude-api-key / gemini-api / xai-grok-api-key 等）。
   *
   * 匹配规则：
   * 1. provider 字段不区分大小写等于输入
   * 2. 或 name 字段以 provider 为前缀（大小写不敏感）
   *
   * 返回找到的第一个 active secret（按 name 排序保证稳定）。不解密。
   */
  async findByProviderAlias(
    provider: string,
  ): Promise<{ id: string; name: string } | null> {
    const normalized = provider.toLowerCase();
    const secrets = await this.prisma.secret.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        userId: null,
        category: "AI_MODEL",
        OR: [
          { provider: { equals: normalized, mode: "insensitive" } },
          { name: { startsWith: normalized, mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, provider: true },
      orderBy: { name: "asc" },
    });
    // Prefer exact-provider match over name prefix match when both exist
    const exact = secrets.find((s) => s.provider?.toLowerCase() === normalized);
    const chosen = exact ?? secrets[0] ?? null;
    return chosen ? { id: chosen.id, name: chosen.name } : null;
  }

  /**
   * 返回系统 Secret 中已配置、且处于活跃状态的全部 provider（用于管理员的
   * availableProviders 过滤）。不解密任何值。
   */
  async listAvailableProviders(): Promise<string[]> {
    const rows = await this.prisma.secret.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        userId: null,
        category: "AI_MODEL",
        provider: { not: null },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      select: { provider: true },
    });
    // distinct 在 Prisma 层是大小写敏感的（"Claude" 和 "claude" 会各占一席），
    // 所以在内存层归一化后去重，保证和 KeyResolver 的 normalized provider 对齐。
    const set = new Set<string>();
    for (const r of rows) {
      if (r.provider) set.add(r.provider.toLowerCase());
    }
    return [...set];
  }

  async getValueInternal(name: string): Promise<string | null> {
    // ★ 规范化 Secret 名称，支持旧格式（SCREAMING_SNAKE_CASE）自动转换
    const normalizedName = normalizeSecretName(name);

    // ★ 多 KEY 路径：委托 SecretKeysService（fallback chain + 5min 失败熔断）。
    // SecretKey 表为空时它会降级读 Secret.encryptedValue（dual-track），
    // 确保所有既有 caller 不需改一行代码。
    if (this.secretKeys) {
      const resolved = await this.secretKeys.getSecretKey(normalizedName);
      if (resolved) {
        const sec = await this.prisma.secret.findFirst({
          where: { name: normalizedName, userId: null },
          select: { id: true, name: true },
        });
        if (sec) {
          await this.prisma.secret
            .update({
              where: { id: sec.id },
              data: {
                lastAccessedAt: new Date(),
                accessCount: { increment: 1 },
              },
            })
            .catch(() => undefined);
          // ★ 多 KEY 路径补审计（与 legacy 路径对齐）
          await this.logAccess(sec.id, SecretAction.VIEW, undefined, {
            secretName: sec.name,
          });
        }
        // ★ 2026-05-07: 给当前物理 KEY 累加命中数。这是唯一自动累加路径，
        // 业务侧不需要逐 caller 加 markSuccess 装饰。语义 = "secrets-service
        // 把这个物理 KEY value 交给 caller 用了一次"。**不动 testStatus**——
        // testStatus 只能由 markSuccess/markFailure 写（"上游真的成功/失败"），
        // 否则 retrieval 之后即使 upstream 401，badge 也会先闪绿再翻红。
        // dual-track legacy 路径 keyId=null（直接读 Secret.encryptedValue），跳过。
        //
        // ★ 2026-05-12 (C方案): 同步写 lastUsedAt = now. UI 显示的"上次使用时间"
        // 改读这个字段, 不再用 lastUsedAt (lastUsedAt 留作手动 Test 历史).
        if (resolved.keyId) {
          await this.prisma.secretKey
            .update({
              where: { id: resolved.keyId },
              data: {
                accessCount: { increment: 1 },
                lastUsedAt: new Date(),
              },
            })
            .catch(() => undefined);
        }
        return resolved.value;
      }
    }

    const secret = await this.prisma.secret.findFirst({
      where: { name: normalizedName, userId: null },
    });
    if (!secret || !secret.isActive || secret.deletedAt) {
      // 很多 caller（如 key-resolver `{provider}-api-endpoint`）做的是 optional
      // lookup —— secret 没配是合理情况，不是错误。debug 级别记录即可。
      // expired / deactivated 是需要告警的异常情况，但两者混在一个 warn 里
      // 会让告警噪音淹没真信号，分开。
      if (!secret) {
        this.logger.debug(
          `[getValueInternal] Secret "${normalizedName}" not found (optional lookup ok)`,
        );
      } else {
        this.logger.warn(
          `[getValueInternal] Secret "${normalizedName}" inactive: isActive=${secret.isActive}, deletedAt=${secret.deletedAt}`,
        );
      }
      return null;
    }
    if (secret.expiresAt && secret.expiresAt < new Date()) {
      this.logger.warn(
        `[getValueInternal] Secret "${normalizedName}" expired at ${secret.expiresAt}`,
      );
      return null;
    }

    // Increment access count for internal calls too
    await this.prisma.secret.update({
      where: { id: secret.id },
      data: {
        lastAccessedAt: new Date(),
        accessCount: { increment: 1 },
      },
    });

    const decrypted = await this.encryption.decryptAny(secret);
    this.logger.debug(
      `[getValueInternal] Secret "${normalizedName}" decrypt: success=${!!decrypted}, length=${decrypted?.length ?? 0}`,
    );
    return decrypted;
  }

  async update(
    name: string,
    dto: UpdateSecretDto,
    context?: AuditContext,
    ownerUserId?: string,
  ): Promise<SecretListItem> {
    // 2026-05-29 BYOK：ownerUserId 传入时按 user 作用域查（admin 不传 → userId=null）。
    const existing = await this.prisma.secret.findFirst({
      where: { name, userId: ownerUserId ?? null },
    });
    if (!existing || existing.deletedAt) {
      throw new NotFoundException(`Secret '${name}' not found`);
    }

    const updateData: Record<string, unknown> = {
      updatedBy: context?.userEmail || context?.userId,
    };

    let oldValueHash: string | undefined;
    let newValueHash: string | undefined;

    if (dto.displayName !== undefined) updateData.displayName = dto.displayName;
    if (dto.category !== undefined) updateData.category = dto.category;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.provider !== undefined) updateData.provider = dto.provider;
    if (dto.isActive !== undefined) updateData.isActive = dto.isActive;
    if (dto.expiresAt !== undefined) updateData.expiresAt = dto.expiresAt;

    let valueRotated = false;
    if (dto.value !== undefined && dto.value !== "") {
      const oldValue = await this.encryption.decryptAny(existing);
      oldValueHash = oldValue ? this.hashValue(oldValue) : undefined;
      const env = await this.encryption.encryptEnvelope(dto.value);
      updateData.encryptedValue = env.encryptedValue;
      updateData.iv = env.iv;
      updateData.authTag = env.authTag;
      updateData.wrappedDek = env.wrappedDek;
      updateData.encVersion = env.encVersion;
      updateData.kekVersion = env.kekVersion;
      updateData.keyVersion = this.currentKeyVersion;
      updateData.lastRotatedAt = new Date();
      newValueHash = this.hashValue(dto.value);

      // Create new version (snapshot)
      const newVersion = (existing.currentVersion || 1) + 1;
      updateData.currentVersion = newVersion;
      valueRotated = true;
    }

    // ★ 事务化：Secret 更新 + SecretVersion 历史 + secret_keys 'primary' 同步
    // 任一失败回滚（防 secret 改了但 secret_keys 还是老 value 的不一致）
    const secret = await this.prisma.$transaction(async (tx) => {
      // ★ 2026-05-29 评审修复：SecretVersion 历史/回滚 API 仅 admin 作用域（查 userId=null），
      //   用户 BYOK secret 写版本行会成孤儿数据 → user 作用域跳过版本快照（值仍同步到 primary key）。
      if (valueRotated && ownerUserId == null) {
        const newVersion = updateData.currentVersion as number;
        await tx.secretVersion.create({
          data: {
            secretId: existing.id,
            version: newVersion,
            encryptedValue: updateData.encryptedValue as string,
            iv: updateData.iv as string,
            authTag: updateData.authTag as string,
            wrappedDek: updateData.wrappedDek as string,
            encVersion: updateData.encVersion as number,
            kekVersion: updateData.kekVersion as number,
            keyVersion: this.currentKeyVersion,
            checksum: this.calculateChecksum(dto.value!),
            createdBy: context?.userEmail || context?.userId,
            changeNote: dto.changeNote || null,
          },
        });
      }

      const updated = await tx.secret.update({
        where: { id: existing.id },
        data: updateData,
      });

      // Mirror new value to secret_keys.primary（dual-write 同事务）
      if (valueRotated) {
        const primary = await tx.secretKey.findUnique({
          where: { secretId_label: { secretId: updated.id, label: "primary" } },
          select: { id: true },
        });
        const skEnc = await this.encryption.encryptEnvelope(dto.value!);
        if (primary) {
          await tx.secretKey.update({
            where: { id: primary.id },
            data: {
              encryptedValue: skEnc.encryptedValue,
              iv: skEnc.iv,
              authTag: skEnc.authTag,
              wrappedDek: skEnc.wrappedDek,
              encVersion: skEnc.encVersion,
              kekVersion: skEnc.kekVersion,
              keyVersion: this.currentKeyVersion,
              keyHint: this.makeHint(dto.value!),
              testStatus: null,
              lastUsedAt: null,
              lastErrorMessage: null,
              updatedBy: context?.userEmail || context?.userId,
            },
          });
        } else {
          await tx.secretKey.create({
            data: {
              secretId: updated.id,
              label: "primary",
              encryptedValue: skEnc.encryptedValue,
              iv: skEnc.iv,
              keyVersion: this.currentKeyVersion,
              keyHint: this.makeHint(dto.value!),
              isActive: true,
              priority: 0,
              createdBy: context?.userEmail || context?.userId,
              updatedBy: context?.userEmail || context?.userId,
            },
          });
        }
      }

      return updated;
    });

    await this.logAccess(secret.id, SecretAction.UPDATE, context, {
      secretName: secret.name,
      oldValueHash,
      newValueHash,
    });
    this.logger.log(`Secret updated: ${name}`);
    return this.toListItem(secret);
  }

  async delete(
    name: string,
    context?: AuditContext,
    ownerUserId?: string,
  ): Promise<void> {
    // 2026-05-29 BYOK：ownerUserId 传入时按 user 作用域查（admin 不传 → userId=null）。
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: ownerUserId ?? null },
    });
    if (!secret || secret.deletedAt) {
      throw new NotFoundException(`Secret '${name}' not found`);
    }

    // 系统引用检查仅对 admin secret 有意义（用户 BYOK secret 不被系统 config 引用）。
    // == null 同时覆盖 undefined 与 null，与 where 的 `ownerUserId ?? null` 语义对称。
    if (ownerUserId == null) {
      const references = await this.getReferences(name);
      if (references.length > 0) {
        throw new ConflictException(
          `Cannot delete secret '${name}': still referenced by ${references.length} configuration(s)`,
        );
      }
    }

    await this.logAccess(secret.id, SecretAction.DELETE, context, {
      secretName: secret.name,
    });

    // ★ 软删 Secret 同时禁用所有 SecretKey 行（CASCADE 仅 hard delete 触发）
    // 防 multi-key resolver 在 Secret.deletedAt 之外仍命中 active SecretKey
    // 实际 getSecretKey 会先 check secret.deletedAt 早返回 null（双保险）
    await this.prisma.$transaction(async (tx) => {
      await tx.secret.update({
        where: { id: secret.id },
        data: {
          deletedAt: new Date(),
          deletedBy: context?.userEmail || context?.userId,
          isActive: false,
        },
      });
      await tx.secretKey.updateMany({
        where: { secretId: secret.id },
        data: {
          isActive: false,
          updatedBy: context?.userEmail || context?.userId,
        },
      });
    });
    this.logger.log(`Secret soft deleted: ${name}`);
  }

  async getAccessLogs(
    name: string,
    limit: number = 50,
  ): Promise<SecretAccessLog[]> {
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: null },
    });
    return this.prisma.secretAccessLog.findMany({
      where: { OR: [{ secretId: secret?.id }, { secretName: name }] },
      orderBy: { timestamp: "desc" },
      take: limit,
    });
  }

  async getReferences(name: string): Promise<SecretReference[]> {
    const references: SecretReference[] = [];

    // 2026-05-12 PR-5: 引用扫描扩充到全部消费方
    //   - AIModel.secretKey (新方式) + apiKey contains (legacy fuzzy)
    //   - ToolConfig.secretKey
    //   - MCPServerConfig.secretKey
    // 删除前 block：避免删 Secret 后 admin 看不到 broken 引用导致工具静默 fail。
    const aiModels = await this.prisma.aIModel.findMany({
      where: {
        OR: [{ secretKey: name }, { apiKey: { contains: name } }],
      },
      select: { id: true, displayName: true },
    });
    for (const model of aiModels) {
      references.push({
        type: "ai_model",
        id: model.id,
        name: model.displayName,
      });
    }

    const toolConfigs = await this.prisma.toolConfig.findMany({
      where: { secretKey: name },
      select: { id: true, toolId: true, displayName: true },
    });
    for (const tool of toolConfigs) {
      references.push({
        type: "external_api",
        id: tool.id,
        name: tool.displayName || tool.toolId,
      });
    }

    const mcpServers = await this.prisma.mCPServerConfig.findMany({
      where: { secretKey: name },
      select: { id: true, name: true },
    });
    for (const mcp of mcpServers) {
      references.push({
        type: "external_api",
        id: mcp.id,
        name: mcp.name,
      });
    }

    return references;
  }

  async exists(name: string): Promise<boolean> {
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: null },
      select: { isActive: true, deletedAt: true, expiresAt: true },
    });
    if (!secret || secret.deletedAt) return false;
    if (secret.expiresAt && secret.expiresAt < new Date()) return false;
    return secret.isActive;
  }

  async getSecretNames(category?: SecretCategory): Promise<string[]> {
    const secrets = await this.prisma.secret.findMany({
      where: {
        isActive: true,
        deletedAt: null,
        userId: null,
        ...(category ? { category } : {}),
      },
      select: { name: true },
      orderBy: { name: "asc" },
    });
    return secrets.map((s) => s.name);
  }

  /**
   * H3 Fix: Migration wrapped in transaction for atomicity
   */
  async migrateExistingKeys(
    context?: AuditContext,
  ): Promise<{ imported: number; skipped: number; errors: string[] }> {
    // H3 Fix: Wrap in transaction, but allow partial success with error tracking
    // Note: We don't use strict transaction here because we want to report partial progress
    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    const aiModels = await this.prisma.aIModel.findMany({
      where: { apiKey: { not: null } },
      select: {
        id: true,
        name: true,
        displayName: true,
        provider: true,
        apiKey: true,
      },
    });

    for (const model of aiModels) {
      if (!model.apiKey) continue;
      const secretName =
        `${model.provider.toLowerCase()}-${model.name.toLowerCase()}-api-key`.replace(
          /[^a-z0-9-]/g,
          "-",
        );
      try {
        const exists = await this.prisma.secret.findFirst({
          where: { name: secretName, userId: null },
        });
        if (exists) {
          skipped.push(`${secretName} (already exists)`);
          continue;
        }

        const decryptedValue = this.decryptLegacy(model.apiKey);
        if (!decryptedValue) {
          errors.push(`${secretName}: Failed to decrypt legacy value`);
          continue;
        }

        const env = await this.encryption.encryptEnvelope(decryptedValue);
        await this.prisma.secret.create({
          data: {
            name: secretName,
            displayName: `${model.displayName} API Key`,
            category: "AI_MODEL",
            description: `API key for ${model.displayName} (${model.provider})`,
            encryptedValue: env.encryptedValue,
            iv: env.iv,
            authTag: env.authTag,
            wrappedDek: env.wrappedDek,
            encVersion: env.encVersion,
            kekVersion: env.kekVersion,
            keyVersion: this.currentKeyVersion,
            provider: model.provider,
            isActive: true,
            createdBy: context?.userEmail || "migration",
            updatedBy: context?.userEmail || "migration",
          },
        });
        imported.push(secretName);
        this.logger.log(`Imported secret: ${secretName}`);
      } catch (error) {
        errors.push(`${secretName}: ${(error as Error).message}`);
      }
    }

    // ★ 使用统一的 SYSTEM_SETTING_TO_SECRET_MAPPING
    // 不允许在此硬编码映射关系
    const settingKeys = SYSTEM_SETTING_TO_SECRET_MAPPING;

    for (const setting of settingKeys) {
      try {
        const dbSetting = await this.prisma.systemSetting.findUnique({
          where: { key: setting.key },
        });
        if (!dbSetting?.value) continue;

        const exists = await this.prisma.secret.findFirst({
          where: { name: setting.name, userId: null },
        });
        if (exists) {
          skipped.push(`${setting.name} (already exists)`);
          continue;
        }

        const decryptedValue = dbSetting.encrypted
          ? this.decryptLegacy(dbSetting.value)
          : dbSetting.value;
        if (!decryptedValue) {
          errors.push(`${setting.name}: Failed to decrypt`);
          continue;
        }

        const env = await this.encryption.encryptEnvelope(decryptedValue);
        await this.prisma.secret.create({
          data: {
            name: setting.name,
            displayName: setting.displayName,
            category: setting.category as SecretCategory,
            description: `Migrated from SystemSetting: ${setting.key}`,
            encryptedValue: env.encryptedValue,
            iv: env.iv,
            authTag: env.authTag,
            wrappedDek: env.wrappedDek,
            encVersion: env.encVersion,
            kekVersion: env.kekVersion,
            keyVersion: this.currentKeyVersion,
            provider: setting.provider,
            isActive: true,
            createdBy: context?.userEmail || "migration",
            updatedBy: context?.userEmail || "migration",
          },
        });
        imported.push(setting.name);
      } catch (error) {
        errors.push(`${setting.name}: ${(error as Error).message}`);
      }
    }

    this.logger.log(
      `Migration completed: ${imported.length} imported, ${skipped.length} skipped, ${errors.length} errors`,
    );
    return { imported: imported.length, skipped: skipped.length, errors };
  }

  /**
   * 获取"预期应配置的 secret"4 区块清单
   *
   * - presetTools (A类): 平台预置工具 key，标记 configured / missing
   * - llmProviders (B类): LLM provider key，命中 LLM_PROVIDER_NAME_PATTERNS
   * - customSecrets (C类): 用户自定义 key，无警告
   * - orphans (D类): 真孤儿保留位，本期永远空数组
   */
  async getExpectedSecrets(): Promise<{
    presetTools: {
      items: Array<{
        name: string;
        displayName: string;
        category: string;
        provider: string;
        description?: string;
        setupGuideUrl?: string;
        freeTierAvailable: boolean;
        status: "configured" | "missing";
        secretId?: string;
        relatedToolIds: string[];
      }>;
      summary: { total: number; configured: number; missing: number };
    };
    llmProviders: Array<{
      secretId: string;
      name: string;
      displayName: string;
      category: string;
      provider: string;
    }>;
    customSecrets: Array<{
      secretId: string;
      name: string;
      displayName: string;
      category: string;
      provider: string | null;
    }>;
    orphans: Array<{
      secretId: string;
      name: string;
      displayName: string;
    }>;
    // Legacy flat fields kept for backward compat with existing callers
    items: Array<{
      name: string;
      displayName: string;
      category: string;
      provider: string;
      description?: string;
      setupGuideUrl?: string;
      freeTierAvailable: boolean;
      status: "configured" | "missing";
      secretId?: string;
      relatedToolIds: string[];
    }>;
    summary: { total: number; configured: number; missing: number };
  }> {
    // 1. 拉所有 active secret
    const dbSecrets = await this.prisma.secret.findMany({
      where: { isActive: true, deletedAt: null, userId: null },
      select: {
        id: true,
        name: true,
        displayName: true,
        category: true,
        provider: true,
      },
    });

    // 2. A 类：preset tools（现有逻辑）
    const expectedMetadata = getExpectedSecretsMetadata();
    const dbByName = new Map(dbSecrets.map((s) => [s.name, s]));
    const presetItems = expectedMetadata.map((meta) => {
      const dbRow = dbByName.get(meta.name);
      return {
        ...meta,
        status: (dbRow ? "configured" : "missing") as "configured" | "missing",
        secretId: dbRow?.id,
      };
    });
    const presetNames = new Set(expectedMetadata.map((m) => m.name));

    // 3. 分类剩余 secret 进 B / C / D 类
    const llmProviders: Array<{
      secretId: string;
      name: string;
      displayName: string;
      category: string;
      provider: string;
    }> = [];
    const customSecrets: Array<{
      secretId: string;
      name: string;
      displayName: string;
      category: string;
      provider: string | null;
    }> = [];
    const orphans: Array<{
      secretId: string;
      name: string;
      displayName: string;
    }> = [];

    for (const s of dbSecrets) {
      if (presetNames.has(s.name)) continue; // 已进 A 类

      const cls = classifySecret(s.name);
      if (cls === "llm-provider") {
        llmProviders.push({
          secretId: s.id,
          name: s.name,
          displayName: s.displayName,
          category: s.category as string,
          provider: s.provider ?? "Unknown",
        });
      } else if (cls === "orphan") {
        orphans.push({
          secretId: s.id,
          name: s.name,
          displayName: s.displayName,
        });
      } else {
        // "custom" (default)
        customSecrets.push({
          secretId: s.id,
          name: s.name,
          displayName: s.displayName,
          category: s.category as string,
          provider: s.provider,
        });
      }
    }

    const presetSummary = {
      total: presetItems.length,
      configured: presetItems.filter((i) => i.status === "configured").length,
      missing: presetItems.filter((i) => i.status === "missing").length,
    };

    return {
      presetTools: {
        items: presetItems,
        summary: presetSummary,
      },
      llmProviders,
      customSecrets,
      orphans,
      // Legacy flat shape — kept so existing API consumers don't break
      items: presetItems,
      summary: presetSummary,
    };
  }

  /**
   * H2 Fix: Convert secret to list item without full decryption
   * Uses encrypted value prefix/suffix for masking to avoid exposing all secrets in memory
   *
   * keyAgg 由 caller (findAll) 提供；缺省时降级为 isActive 两态。
   */
  private toListItem(
    secret: Secret,
    keyAgg?: {
      aggregateStatus: SecretAggregateStatus;
      totalKeys: number;
      activeKeys: number;
    },
  ): SecretListItem {
    return {
      id: secret.id,
      name: secret.name,
      displayName: secret.displayName,
      category: secret.category,
      description: secret.description,
      provider: secret.provider,
      isActive: secret.isActive,
      // H2 Fix: Generate masked value from encrypted data, not decrypted
      maskedValue: this.generateMaskedHint(secret.encryptedValue),
      createdAt: secret.createdAt,
      updatedAt: secret.updatedAt,
      lastAccessedAt: secret.lastAccessedAt,
      accessCount: secret.accessCount,
      expiresAt: secret.expiresAt,
      lastRotatedAt: secret.lastRotatedAt,
      aggregateStatus:
        keyAgg?.aggregateStatus ?? (secret.isActive ? "unknown" : "disabled"),
      totalKeys: keyAgg?.totalKeys ?? 0,
      activeKeys: keyAgg?.activeKeys ?? 0,
    };
  }

  /**
   * H2 Fix: Generate a masked hint from encrypted value
   * This avoids decrypting secrets just to show a masked preview
   */
  private generateMaskedHint(encryptedValue: string): string {
    if (!encryptedValue || encryptedValue.length < 8) {
      return "••••••••";
    }
    // Use a hash of the encrypted value to generate consistent but non-revealing hint
    const hint = this.encryption.hashValue(encryptedValue).substring(0, 4);
    return `••••${hint}••••`;
  }

  private hashValue(value: string): string {
    return this.encryption.hashValue(value);
  }

  private calculateChecksum(value: string): string {
    return this.encryption.hashValue(value);
  }

  private async logAccess(
    secretId: string,
    action: SecretAction,
    context?: AuditContext,
    extra?: {
      secretName?: string;
      oldValueHash?: string;
      newValueHash?: string;
    },
  ): Promise<void> {
    try {
      await this.prisma.secretAccessLog.create({
        data: {
          secretId,
          action,
          actionStatus: "success",
          secretName: extra?.secretName,
          oldValueHash: extra?.oldValueHash,
          newValueHash: extra?.newValueHash,
          userId: context?.userId,
          userEmail: context?.userEmail,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to log secret access: ${(error as Error).message}`,
      );
    }
  }

  private async logAccessDenied(
    secretName: string,
    context: AuditContext,
    reason: string,
  ): Promise<void> {
    try {
      await this.prisma.secretAccessLog.create({
        data: {
          secretId: null,
          action: SecretAction.ACCESS_DENIED,
          actionStatus: "denied",
          secretName,
          errorMessage: reason,
          userId: context.userId,
          userEmail: context.userEmail,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to log access denied: ${(error as Error).message}`,
      );
    }
  }

  private decryptLegacy(encryptedText: string | null): string | null {
    return this.encryption.decryptLegacy(encryptedText);
  }

  // ========== Version Management ==========

  /**
   * Get all versions of a secret
   */
  async getVersions(name: string): Promise<SecretVersionItem[]> {
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: null },
    });
    if (!secret || secret.deletedAt) {
      throw new NotFoundException(`Secret '${name}' not found`);
    }

    const versions = await this.prisma.secretVersion.findMany({
      where: { secretId: secret.id },
      orderBy: { version: "desc" },
    });

    return versions.map((v) => ({
      id: v.id,
      version: v.version,
      checksum: v.checksum,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      changeNote: v.changeNote,
      isCurrent: v.version === (secret.currentVersion || 1),
    }));
  }

  /**
   * Get decrypted value of a specific version
   */
  async getVersionValue(
    name: string,
    version: number,
    context?: AuditContext,
  ): Promise<string | null> {
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: null },
    });
    if (!secret || secret.deletedAt) {
      throw new NotFoundException(`Secret '${name}' not found`);
    }

    // If requesting current version, use the secret's current value
    if (version === (secret.currentVersion || 1)) {
      await this.logAccess(secret.id, SecretAction.VIEW, context, {
        secretName: name,
      });
      return this.encryption.decryptAny(secret);
    }

    // Otherwise, get from version history
    const secretVersion = await this.prisma.secretVersion.findUnique({
      where: {
        secretId_version: {
          secretId: secret.id,
          version,
        },
      },
    });

    if (!secretVersion) {
      throw new NotFoundException(
        `Version ${version} not found for secret '${name}'`,
      );
    }

    await this.logAccess(secret.id, SecretAction.VIEW, context, {
      secretName: name,
    });

    return this.encryption.decryptAny(secretVersion);
  }

  /**
   * Rollback to a previous version
   */
  async rollback(
    name: string,
    version: number,
    context?: AuditContext,
  ): Promise<SecretListItem> {
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: null },
    });
    if (!secret || secret.deletedAt) {
      throw new NotFoundException(`Secret '${name}' not found`);
    }

    const currentVersion = secret.currentVersion || 1;
    if (version === currentVersion) {
      throw new BadRequestException("Cannot rollback to current version");
    }

    const targetVersion = await this.prisma.secretVersion.findUnique({
      where: {
        secretId_version: {
          secretId: secret.id,
          version,
        },
      },
    });

    if (!targetVersion) {
      throw new NotFoundException(
        `Version ${version} not found for secret '${name}'`,
      );
    }

    // Decrypt the target version's value
    const decryptedValue = await this.encryption.decryptAny(targetVersion);
    if (!decryptedValue) {
      throw new InternalServerErrorException(
        `Failed to decrypt version ${version}`,
      );
    }

    // Create a new version with the rolled-back value
    const newVersion = currentVersion + 1;
    const env = await this.encryption.encryptEnvelope(decryptedValue);

    await this.prisma.secretVersion.create({
      data: {
        secretId: secret.id,
        version: newVersion,
        encryptedValue: env.encryptedValue,
        iv: env.iv,
        authTag: env.authTag,
        wrappedDek: env.wrappedDek,
        encVersion: env.encVersion,
        kekVersion: env.kekVersion,
        keyVersion: this.currentKeyVersion,
        checksum: this.calculateChecksum(decryptedValue),
        createdBy: context?.userEmail || context?.userId,
        changeNote: `Rollback from version ${version}`,
      },
    });

    const updated = await this.prisma.secret.update({
      where: { id: secret.id },
      data: {
        encryptedValue: env.encryptedValue,
        iv: env.iv,
        authTag: env.authTag,
        wrappedDek: env.wrappedDek,
        encVersion: env.encVersion,
        kekVersion: env.kekVersion,
        keyVersion: this.currentKeyVersion,
        currentVersion: newVersion,
        lastRotatedAt: new Date(),
        updatedBy: context?.userEmail || context?.userId,
      },
    });

    await this.logAccess(secret.id, SecretAction.UPDATE, context, {
      secretName: name,
    });

    this.logger.log(
      `Secret '${name}' rolled back to version ${version} (now version ${newVersion})`,
    );
    return this.toListItem(updated);
  }

  /**
   * Create initial version for existing secrets (migration helper)
   */
  async createInitialVersion(name: string): Promise<void> {
    const secret = await this.prisma.secret.findFirst({
      where: { name, userId: null },
    });
    if (!secret || secret.deletedAt) {
      throw new NotFoundException(`Secret '${name}' not found`);
    }

    // Check if version 1 already exists
    const existingVersion = await this.prisma.secretVersion.findUnique({
      where: {
        secretId_version: {
          secretId: secret.id,
          version: 1,
        },
      },
    });

    if (existingVersion) {
      this.logger.debug(`Secret '${name}' already has version 1`);
      return;
    }

    const decryptedValue = await this.encryption.decryptAny(secret);
    if (!decryptedValue) {
      this.logger.warn(
        `Cannot create initial version for '${name}': decryption failed`,
      );
      return;
    }

    await this.prisma.secretVersion.create({
      data: {
        secretId: secret.id,
        version: 1,
        encryptedValue: secret.encryptedValue,
        iv: secret.iv,
        keyVersion: secret.keyVersion,
        checksum: this.calculateChecksum(decryptedValue),
        createdBy: secret.createdBy,
        createdAt: secret.createdAt,
        changeNote: "Initial version",
      },
    });

    // Ensure currentVersion is set to 1
    if (!secret.currentVersion || secret.currentVersion < 1) {
      await this.prisma.secret.update({
        where: { id: secret.id },
        data: { currentVersion: 1 },
      });
    }

    this.logger.log(`Created initial version for secret '${name}'`);
  }

  /**
   * Initialize versions for all existing secrets
   */
  async initializeAllVersions(): Promise<{
    processed: number;
    skipped: number;
  }> {
    const secrets = await this.prisma.secret.findMany({
      where: { deletedAt: null, userId: null },
    });

    let processed = 0;
    let skipped = 0;

    for (const secret of secrets) {
      try {
        await this.createInitialVersion(secret.name);
        processed++;
      } catch (error) {
        this.logger.warn(
          `Skipped version init for '${secret.name}': ${(error as Error).message}`,
        );
        skipped++;
      }
    }

    return { processed, skipped };
  }

  /**
   * 业务调用方在 provider call 成功后调，feed 健康反馈给 fallback chain。
   *
   * **优先传 keyId**：从 getValueInternalWithKeyId 拿到的 keyId 直接传，
   * 避免再次走 fallback chain（熔断窗口可能已变化导致错标 next key 而非命中 key）。
   * keyId 不传时回退到 lookup（兼容 legacy caller）。
   */
  /**
   * 业务侧 multi-key resolver — 返回某 secret 下所有活跃 KEY 的明文 + keyId 数组。
   *
   * 适用场景：caller 需要自己做 round-robin / 并发分散（如 SearchService 的多 KEY
   * 滚动重试），但同时要把 mark*Failure / mark*Success 反馈到 DB 让 admin UI 看到
   * 真实状态。
   *
   * 模式自适应：
   *   1. SecretKey 表有行（新模式）→ 返回每个 active 行的解密 value + 真 keyId
   *   2. 表为空但 Secret.encryptedValue 有值（legacy comma-separated）→ 兜底返回
   *      单条记录 keyId=null（caller 无法 mark*，但仍能拿到 value 跑业务）
   *
   * 与 getSecretKey / getValueInternalWithKeyId 的区别：那俩按 priority + 熔断挑
   * **一个**最佳 KEY；本方法返回**全部** active KEY 让 caller 自己挑（round-robin
   * 分散并发 / 自定义健康策略）。
   */
  async getValueInternalAllKeys(
    name: string,
  ): Promise<Array<{ value: string; keyId: string | null; label: string }>> {
    const normalizedName = normalizeSecretName(name);
    const secret = await this.prisma.secret.findFirst({
      where: { name: normalizedName, userId: null },
    });
    if (!secret || !secret.isActive || secret.deletedAt) return [];
    if (secret.expiresAt && secret.expiresAt < new Date()) return [];

    // 新模式：SecretKey 表 active 行（不过滤熔断 — caller 自己决定）
    const rows = await this.prisma.secretKey.findMany({
      where: { secretId: secret.id, isActive: true },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    if (rows.length > 0) {
      const out: Array<{
        value: string;
        keyId: string | null;
        label: string;
      }> = [];
      for (const row of rows) {
        const decrypted = await this.encryption.decryptAny(row);
        if (decrypted) {
          out.push({ value: decrypted, keyId: row.id, label: row.label });
        }
      }
      return out;
    }

    // legacy dual-track：读 Secret.encryptedValue（可能 comma-separated 多 KEY，
    // 但都属于同一行，没有独立 keyId 可标失败状态）
    const legacy = await this.encryption.decryptAny(secret);
    if (!legacy) return [];
    return [{ value: legacy, keyId: null, label: "(legacy)" }];
  }

  async markSecretSuccess(name: string, keyId?: string): Promise<void> {
    if (!this.secretKeys) return;
    if (keyId) {
      await this.secretKeys.markSuccess(keyId);
      return;
    }
    const resolved = await this.secretKeys.getSecretKey(
      normalizeSecretName(name),
    );
    if (resolved?.keyId) await this.secretKeys.markSuccess(resolved.keyId);
  }

  /**
   * 业务调用方在 provider call 失败时调，触发 5min 熔断 + 切到下一个 KEY。
   * **优先传 keyId**（理由同 markSecretSuccess）。
   */
  async markSecretFailure(
    name: string,
    errorMessage: string,
    keyId?: string,
    /** ★ 2026-05-06: 归一化错误码（AUTH_FAILED / RATE_LIMIT_KEY / 等）。
     *   不传时默认 'UNKNOWN'，UI 会出"失败（未分类）"灰章；caller 应优先调
     *   KeyErrorClassifier.classify(err) 拿 reason 后传入。*/
    errorCode?: string,
  ): Promise<void> {
    if (!this.secretKeys) return;
    const code = errorCode ?? "UNKNOWN";
    if (keyId) {
      await this.secretKeys.markFailure(keyId, code, errorMessage);
      return;
    }
    const resolved = await this.secretKeys.getSecretKey(
      normalizeSecretName(name),
    );
    if (resolved?.keyId)
      await this.secretKeys.markFailure(resolved.keyId, code, errorMessage);
  }

  /**
   * 业务侧 resolver — 同 getValueInternal 但同时返回 keyId，让 caller 调
   * markSecretSuccess/Failure 时直传 keyId（避免二次 lookup race）。
   *
   * keyId 为 null 时表示走 dual-track legacy 兜底（无 SecretKey 行可标）。
   */
  async getValueInternalWithKeyId(
    name: string,
  ): Promise<{ value: string; keyId: string | null } | null> {
    const normalizedName = normalizeSecretName(name);
    if (this.secretKeys) {
      const resolved = await this.secretKeys.getSecretKey(normalizedName);
      if (resolved) {
        const sec = await this.prisma.secret.findFirst({
          where: { name: normalizedName, userId: null },
          select: { id: true, name: true },
        });
        if (sec) {
          await this.prisma.secret
            .update({
              where: { id: sec.id },
              data: {
                lastAccessedAt: new Date(),
                accessCount: { increment: 1 },
              },
            })
            .catch(() => undefined);
          await this.logAccess(sec.id, SecretAction.VIEW, undefined, {
            secretName: sec.name,
          });
        }
        // ★ 2026-05-12 (C方案): 同步 SecretKey 行级 accessCount + lastUsedAt.
        // 与 getValueInternal 路径对齐, 避免该 API 漏写命中视图字段.
        if (resolved.keyId) {
          await this.prisma.secretKey
            .update({
              where: { id: resolved.keyId },
              data: {
                accessCount: { increment: 1 },
                lastUsedAt: new Date(),
              },
            })
            .catch(() => undefined);
        }
        return { value: resolved.value, keyId: resolved.keyId };
      }
    }
    // 没有多 KEY 路径或 resolver 返 null → fall back to legacy single-key
    const value = await this.getValueInternal(name);
    return value === null ? null : { value, keyId: null };
  }
}

/**
 * 把 secret + 全部 SecretKey 行聚合成 4 态状态徽章。
 *
 * 规则：
 * - secret !isActive → disabled（无视 keys）
 * - 任一 key isActive=true 且 testStatus='success' → ok
 * - 全部 active key testStatus='failed' → failed
 * - 其他（active 但 testStatus null / 0 active key）→ unknown
 */
export function aggregateKeyStatus(
  secretIsActive: boolean,
  keys: { isActive: boolean; testStatus: string | null }[],
): {
  aggregateStatus: SecretAggregateStatus;
  totalKeys: number;
  activeKeys: number;
} {
  const totalKeys = keys.length;
  const activeRows = keys.filter((k) => k.isActive);
  const activeKeys = activeRows.length;

  if (!secretIsActive) {
    return { aggregateStatus: "disabled", totalKeys, activeKeys };
  }
  if (activeRows.some((k) => k.testStatus === "success")) {
    return { aggregateStatus: "ok", totalKeys, activeKeys };
  }
  if (
    activeRows.length > 0 &&
    activeRows.every((k) => k.testStatus === "failed")
  ) {
    return { aggregateStatus: "failed", totalKeys, activeKeys };
  }
  return { aggregateStatus: "unknown", totalKeys, activeKeys };
}
