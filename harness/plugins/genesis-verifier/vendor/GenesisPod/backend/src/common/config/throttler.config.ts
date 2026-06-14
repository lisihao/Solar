/**
 * API限流配置
 *
 * 用途：
 * - 保护API免受滥用攻击
 * - 为不同端点提供差异化的限流策略
 * - 防止恶意爬虫和DDoS攻击
 */

export const ThrottlerConfig = {
  // 全局默认限制：60请求/分钟
  default: {
    ttl: 60000,
    limit: 60,
  },

  // 严格限制 - 认证相关端点
  strict: {
    ttl: 60000,
    limit: 5, // 5次/分钟 - 防止暴力破解
  },

  // 中等限制 - 数据创建/修改端点
  moderate: {
    ttl: 60000,
    limit: 30, // 30次/分钟
  },

  // 宽松限制 - 公开读取端点
  lenient: {
    ttl: 60000,
    limit: 100, // 100次/分钟
  },

  // 爬虫限制 - 内部爬虫任务
  crawler: {
    ttl: 60000,
    limit: 1000, // 1000次/分钟 - 允许高频爬取
  },

  // AI 限制 - AI 生成相关端点（成本敏感）
  // 默认 20/min；自部署 / 本机 dev 把 LiteLLM gateway 自带预算守护时，
  // 业务层 throttle 反而会干扰 UI 自动 fetch / 频繁切 BYOK 这类合法操作 ——
  // 通过 THROTTLE_AI_LIMIT 环境变量按部署放宽（缺省保持 20，prod 不受影响）。
  ai: {
    ttl: 60000,
    limit: Number(process.env.THROTTLE_AI_LIMIT) || 20,
  },

  // 导出限制 - 文件导出端点（资源敏感）
  export: {
    ttl: 300000, // 5分钟窗口
    limit: 10, // 10次/5分钟 - 防止大量导出
  },

  // Webhook 限制 - 外部 webhook 回调
  webhook: {
    ttl: 60000,
    limit: 200, // 200次/分钟 - 允许较高频率
  },
};

/**
 * 使用示例：
 *
 * @Controller('auth')
 * export class AuthController {
 *   @Throttle({ default: { limit: 5, ttl: 60000 } }) // 严格限制
 *   @Post('login')
 *   async login() { ... }
 *
 *   @SkipThrottle() // 跳过限流
 *   @Get('public')
 *   async publicEndpoint() { ... }
 * }
 */
