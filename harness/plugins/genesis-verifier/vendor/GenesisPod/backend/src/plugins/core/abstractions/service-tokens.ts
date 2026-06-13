/**
 * Plugin ServiceToken（v5.1 §11.3 DS1 + standards/19 §六）
 *
 * Token 是 unique symbol（不是 string，避免撞名），plugin 通过
 * IPluginContext.getService(token) 拿受 capability gate 控制的服务代理。
 *
 * 内置 token 全部在此文件定义；新增 token 必须经评审。
 *
 * 类型设计：ServiceToken<T> 形态上是 unique symbol，TS 编译期带类型信息，
 * 运行时是真实 symbol。
 */

/** ServiceToken 标记类型，T 表示 token 对应的服务实例类型 */
export type ServiceToken<T> = symbol & { readonly __serviceType?: T };

/**
 * 帮助函数：定义一个 ServiceToken
 *
 * @example
 * export const REDIS_SERVICE: ServiceToken<RedisClient> = defineServiceToken("plugin.service.redis");
 */
export function defineServiceToken<T>(name: string): ServiceToken<T> {
  return Symbol(name) as ServiceToken<T>;
}

// ── 内置 ServiceToken（按 capability 一一对应）──

/** redis client 受限代理（v5.1 MED-1：NamespacedRedisClient，屏蔽 KEYS/SCAN/FLUSHDB）*/
export const REDIS_SERVICE: ServiceToken<unknown> = defineServiceToken(
  "plugin.service.redis",
);

/** postgres client */
export const POSTGRES_SERVICE: ServiceToken<unknown> = defineServiceToken(
  "plugin.service.postgres",
);

/** http client（telemetry-otel / telemetry-datadog 等需要外发请求的 plugin 用）*/
export const HTTP_CLIENT_SERVICE: ServiceToken<unknown> = defineServiceToken(
  "plugin.service.http",
);

/** websocket client */
export const WEBSOCKET_SERVICE: ServiceToken<unknown> = defineServiceToken(
  "plugin.service.websocket",
);
