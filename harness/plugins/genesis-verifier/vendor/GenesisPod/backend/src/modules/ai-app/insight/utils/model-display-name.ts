import type { PrismaService } from "@/common/prisma/prisma.service";

/**
 * 模型 displayName 缓存
 * 模型配置变更频率极低，缓存 60 秒避免高频轮询场景下的重复 DB 查询
 */
const CACHE_TTL_MS = 60_000;
let cachedMap = new Map<string, string>();
let cacheTimestamp = 0;
let cacheLoading: Promise<void> | null = null;

async function refreshCache(prisma: PrismaService): Promise<void> {
  const models = await prisma.aIModel.findMany({
    where: { isEnabled: true },
    select: { modelId: true, displayName: true },
  });

  const newMap = new Map<string, string>();
  for (const m of models) {
    newMap.set(m.modelId, m.displayName);
  }
  cachedMap = newMap;
  cacheTimestamp = Date.now();
}

/**
 * 批量查询 modelId → displayName 映射
 * 带 60 秒内存缓存，避免高频轮询场景下的重复 DB 查询
 */
export async function getModelDisplayNameMap(
  prisma: PrismaService,
  modelIds: string[],
): Promise<Map<string, string>> {
  if (modelIds.length === 0) return new Map();

  // 缓存过期或未初始化时刷新
  if (Date.now() - cacheTimestamp > CACHE_TTL_MS) {
    // 防止并发刷新
    if (!cacheLoading) {
      cacheLoading = refreshCache(prisma).finally(() => {
        cacheLoading = null;
      });
    }
    await cacheLoading;
  }

  // 从缓存中提取请求的 modelIds
  const result = new Map<string, string>();
  for (const id of modelIds) {
    const name = cachedMap.get(id);
    if (name) {
      result.set(id, name);
    }
  }
  return result;
}
