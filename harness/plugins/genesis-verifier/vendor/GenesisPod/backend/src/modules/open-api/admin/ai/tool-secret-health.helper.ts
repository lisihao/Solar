/**
 * Tool Secret Health Aggregation Helper (2026-05-12)
 *
 * 拆自 ai-admin.service.ts.getToolConfigs（god-class size guard 3124→<2500）。
 *
 * 职责：根据 tool 列表 secretKey 字段，JOIN Secret + SecretKey 表，
 *      聚合每个 secret name 下所有活跃 KEY 的健康字段（accessCount /
 *      lastUsedAt / testStatus / lastErrorCode），返回 enriched 列表。
 *
 * 与 /admin/access/secrets 同款 testStatus 优先级（success > unknown > failed）
 * 让 admin 跨页面看到相同 badge 含义。
 */
import { PrismaService } from "@/common/prisma/prisma.service";

export interface ToolWithSecretRef {
  secretKey: string | null;
  [k: string]: unknown;
}

export interface ToolWithSecretHealth extends ToolWithSecretRef {
  accessCount: number | null;
  lastUsedAt: string | null;
  testStatus: string | null;
  lastErrorCode: string | null;
}

type SecretHealth = {
  accessCount: number;
  lastUsedAt: Date | null;
  testStatus: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

const STATUS_RANK: Record<string, number> = {
  success: 3,
  unknown: 2,
  failed: 1,
};

/**
 * 聚合多 KEY 到 secret name 维度：
 *  - accessCount 求和
 *  - lastUsedAt 取 max
 *  - testStatus 按 RANK 取优先级最高（任一 success 整体 healthy）
 *  - lastErrorCode/Message 跟随最高优先 status
 */
async function loadSecretHealthByName(
  prisma: PrismaService,
  secretNames: string[],
): Promise<Map<string, SecretHealth>> {
  const out = new Map<string, SecretHealth>();
  if (secretNames.length === 0) return out;

  const secrets = await prisma.secret.findMany({
    where: { name: { in: secretNames }, deletedAt: null, isActive: true },
    select: { id: true, name: true },
  });
  if (secrets.length === 0) return out;

  const secretIdToName = new Map(secrets.map((s) => [s.id, s.name]));
  const keys = await prisma.secretKey.findMany({
    where: { secretId: { in: secrets.map((s) => s.id) }, isActive: true },
    select: {
      secretId: true,
      accessCount: true,
      lastUsedAt: true,
      testStatus: true,
      lastErrorCode: true,
      lastErrorMessage: true,
    },
  });

  for (const k of keys) {
    const name = secretIdToName.get(k.secretId);
    if (!name) continue;
    const cur =
      out.get(name) ??
      ({
        accessCount: 0,
        lastUsedAt: null,
        testStatus: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      } as SecretHealth);

    cur.accessCount += k.accessCount ?? 0;
    if (k.lastUsedAt && (!cur.lastUsedAt || k.lastUsedAt > cur.lastUsedAt)) {
      cur.lastUsedAt = k.lastUsedAt;
    }
    const curRank = cur.testStatus ? (STATUS_RANK[cur.testStatus] ?? 0) : 0;
    const newRank = k.testStatus ? (STATUS_RANK[k.testStatus] ?? 0) : 0;
    if (newRank > curRank) {
      cur.testStatus = k.testStatus;
      cur.lastErrorCode = k.lastErrorCode;
      cur.lastErrorMessage = k.lastErrorMessage;
    }
    out.set(name, cur);
  }
  return out;
}

/**
 * 给一组 tool（带 secretKey 字段）富化 SecretKey 聚合健康字段。
 * 工具未配 secretKey → 全 null（前端显示 '—'）。
 */
export async function enrichToolsWithSecretHealth<T extends ToolWithSecretRef>(
  prisma: PrismaService,
  tools: T[],
): Promise<
  Array<
    T &
      Pick<
        ToolWithSecretHealth,
        "accessCount" | "lastUsedAt" | "testStatus" | "lastErrorCode"
      >
  >
> {
  const secretNames = Array.from(
    new Set(tools.map((t) => t.secretKey).filter(Boolean) as string[]),
  );
  const healthByName = await loadSecretHealthByName(prisma, secretNames);

  return tools.map((t) => {
    const health = t.secretKey ? (healthByName.get(t.secretKey) ?? null) : null;
    return {
      ...t,
      accessCount: health?.accessCount ?? null,
      lastUsedAt: health?.lastUsedAt?.toISOString() ?? null,
      testStatus: health?.testStatus ?? null,
      lastErrorCode: health?.lastErrorCode ?? null,
    };
  });
}
