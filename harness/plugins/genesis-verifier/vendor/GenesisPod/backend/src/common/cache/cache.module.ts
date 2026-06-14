import { Module, Global, Logger } from "@nestjs/common";
import { CacheModule as NestCacheModule } from "@nestjs/cache-manager";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { redisStore } from "cache-manager-ioredis-yet";
import { CacheService } from "./cache.service";

/**
 * 全局缓存模块
 *
 * 支持两种模式：
 * 1. Redis 模式（生产环境）：使用 Railway Redis 服务
 * 2. 内存模式（开发环境）：使用内存缓存
 *
 * 通过 REDIS_URL 环境变量自动切换模式
 *
 * 重要：cache-manager-ioredis-yet 的 redisStore() 直接把 options 传给
 * new Redis(options)，而 ioredis 不识别 options.url — 只有第一个字符串
 * 参数才会被解析为 URL。因此必须手动解析 URL，传 host/port/password。
 * 降级链：REDIS_URL（内网优先）→ REDIS_PUBLIC_URL（TCP Proxy）→ 内存缓存
 */

function parseRedisUrl(redisUrl: string) {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port) || 6379,
    password: parsed.password || undefined,
    username:
      parsed.username && parsed.username !== "default"
        ? parsed.username
        : undefined,
    db: parsed.pathname ? parseInt(parsed.pathname.slice(1)) || 0 : 0,
  };
}

@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const logger = new Logger("CacheModule");
        const redisUrl = configService.get<string>("REDIS_URL");
        const redisPublicUrl = configService.get<string>("REDIS_PUBLIC_URL");

        if (!redisUrl && !redisPublicUrl) {
          logger.log("REDIS_URL not set, using in-memory cache");
          const maxItems = parseInt(process.env.CACHE_MAX_ITEMS || "5000", 10);
          return { ttl: 300 * 1000, max: maxItems };
        }

        // 内网优先，公网降级
        const urlCandidates = [
          ...(redisUrl ? [{ url: redisUrl, label: "internal" }] : []),
          ...(redisPublicUrl && redisPublicUrl !== redisUrl
            ? [{ url: redisPublicUrl, label: "public" }]
            : []),
        ];

        for (const { url, label } of urlCandidates) {
          const maskedUrl = url.replace(/\/\/.*@/, "//***@");
          logger.log(`Trying Redis (${label}): ${maskedUrl}`);

          try {
            const { host, port, password, username, db } = parseRedisUrl(url);

            const store = await redisStore({
              host,
              port,
              password,
              username,
              db,
              ttl: 300 * 1000,
              maxRetriesPerRequest: 3,
              enableOfflineQueue: false,
              connectTimeout: 5000,
              retryStrategy(times: number) {
                if (times > 5) {
                  logger.warn(
                    `Redis retry limit reached (${times}). Stopping.`,
                  );
                  return null;
                }
                const delay = Math.min(times * 500, 3000);
                logger.warn(
                  `Redis reconnecting in ${delay}ms (attempt ${times})...`,
                );
                return delay;
              },
            });

            // 绑定 error 事件处理器，防止 "Unhandled error event" 刷屏
            const client = (store as unknown as Record<string, unknown>)
              .client as
              | {
                  on?: (
                    event: string,
                    handler: (err: Error & { code?: string }) => void,
                  ) => void;
                }
              | undefined;
            if (client?.on) {
              client.on("error", (err: Error & { code?: string }) => {
                const detail = err.message || err.code || "unknown";
                logger.warn(`Redis error (${label}): ${detail}`);
              });
            }

            logger.log(
              `Redis cache connected successfully (${label}) → ${host}:${port}`,
            );
            return { store, ttl: 300 * 1000 };
          } catch (error) {
            logger.error(
              `Failed to create Redis store (${label}): ${error instanceof Error ? error.message : error}`,
            );
          }
        }

        logger.warn(
          "All Redis connections failed. Falling back to memory cache.",
        );
        const maxItems = parseInt(process.env.CACHE_MAX_ITEMS || "5000", 10);
        return { ttl: 300 * 1000, max: maxItems };
      },
    }),
  ],
  providers: [CacheService],
  exports: [NestCacheModule, CacheService],
})
export class CacheModule {}
