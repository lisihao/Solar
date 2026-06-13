/** @type {import('next').NextConfig} */
const { execSync } = require('child_process');

// Get git commit hash at build time
function getGitCommitHash() {
  // First, try to get from Railway environment variable
  if (process.env.RAILWAY_GIT_COMMIT_SHA) {
    const fullHash = process.env.RAILWAY_GIT_COMMIT_SHA;
    const shortHash = fullHash.substring(0, 7);
    console.log('✓ Using git commit hash from Railway:', shortHash);
    return { short: shortHash, full: fullHash };
  }

  // Second, try to get from git command (local development)
  try {
    const hash = execSync('git rev-parse --short HEAD').toString().trim();
    const fullHash = execSync('git rev-parse HEAD').toString().trim();
    console.log('✓ Using git commit hash from git command:', hash);
    return { short: hash, full: fullHash };
  } catch (error) {
    console.warn('⚠ Git command failed, using fallback');
    return { short: 'dev', full: 'development' };
  }
}

const gitInfo = getGitCommitHash();
const packageJson = require('./package.json');

const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  // ★ 关键配置：跳过静态生成，使用纯动态渲染
  // 这是一个需要用户认证和客户端状态的应用，静态生成无意义
  experimental: {
    // 允许 CSR bailout 而不报错
    missingSuspenseWithCSRBailout: false,
    // ★ rewrite 代理超时：默认 30s 太短，AI 操作（MCP/Research 等）需要更长时间
    proxyTimeout: 300000, // 5 minutes
    // /admin/ai-app/[category] 在 server 端用 fs.readFile 读 bundled md,
    // standalone 模式默认 trace 不到这种动态字符串路径,显式 include.
    outputFileTracingIncludes: {
      '/admin/ai-app/[category]': ['./lib/generated/ai-app-docs/**/*.md'],
    },
  },
  env: {
    NEXT_PUBLIC_API_URL:
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
    NEXT_PUBLIC_GIT_COMMIT_HASH: gitInfo.short,
    NEXT_PUBLIC_GIT_COMMIT_HASH_FULL: gitInfo.full,
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    // Brand configuration (env var passthrough for build-time injection)
    NEXT_PUBLIC_BRAND_NAME: process.env.NEXT_PUBLIC_BRAND_NAME,
    NEXT_PUBLIC_BRAND_FULL_NAME: process.env.NEXT_PUBLIC_BRAND_FULL_NAME,
    NEXT_PUBLIC_BRAND_SUBTITLE: process.env.NEXT_PUBLIC_BRAND_SUBTITLE,
    NEXT_PUBLIC_BRAND_TAGLINE: process.env.NEXT_PUBLIC_BRAND_TAGLINE,
    NEXT_PUBLIC_BRAND_LOGO_PATH: process.env.NEXT_PUBLIC_BRAND_LOGO_PATH,
    NEXT_PUBLIC_RAILWAY_DOMAIN: process.env.NEXT_PUBLIC_RAILWAY_DOMAIN,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async redirects() {
    return [
      // Legacy admin routes -> new locations (server-side, no flash)
      {
        source: '/admin/dashboard',
        destination: '/admin/overview',
        permanent: false,
      },
      {
        source: '/admin/users',
        destination: '/admin/access/users',
        permanent: false,
      },
      {
        source: '/admin/whitelists',
        destination: '/admin/data/whitelists',
        permanent: false,
      },
      {
        source: '/admin/external-api',
        destination: '/admin/ai/tools',
        permanent: false,
      },
      {
        source: '/admin/ai-models',
        destination: '/admin/ai/models',
        permanent: false,
      },
      {
        source: '/admin/system/storage',
        destination: '/admin/storage',
        permanent: false,
      },
      {
        source: '/admin/collection',
        destination: '/admin/data/collection',
        permanent: false,
      },
      {
        source: '/admin/capabilities',
        destination: '/admin/ai/skills',
        permanent: false,
      },
      {
        source: '/admin/ai/capabilities',
        destination: '/admin/ai/skills',
        permanent: false,
      },
      {
        source: '/admin/ai-teams',
        destination: '/admin/ai/teams',
        permanent: false,
      },
      {
        source: '/admin/settings',
        destination: '/admin/system/site',
        permanent: false,
      },
      {
        source: '/admin/ai/external-services',
        destination: '/admin/ai/tools',
        permanent: false,
      },
      // Topic routes moved from /ai-research to /ai-insights
      {
        source: '/ai-research/topic/:topicId',
        destination: '/ai-insights/topic/:topicId',
        permanent: false,
      },
      {
        source: '/ai-research/topics/:topicId',
        destination: '/ai-insights/topic/:topicId',
        permanent: false,
      },
      {
        source: '/ai-research/topic-research',
        destination: '/ai-insights/topic-research',
        permanent: false,
      },
      // ★ 2026-05-12: bandaid 旧通知记录中 actionUrl 写的是 /teams/{topicId} /
      //  /topics/{topicId} / /research/{id}（前端从没有这些 page），点了必 404。
      //  后端 URL 构造已修，这层兜底保旧 DB 记录可点。
      {
        source: '/teams/:topicId',
        destination: '/ai-insights/topic/:topicId',
        permanent: false,
      },
      {
        source: '/topics/:topicId',
        destination: '/ai-insights/topic/:topicId',
        permanent: false,
      },
      {
        source: '/research/:id',
        destination: '/ai-insights/topic-research',
        permanent: false,
      },
      // ★ 2026-05-20: 统一遗留跳转到 config —— 删 app/report、app/notion 两个 client 端
      //   跳转壳页（'use client' + router.replace + spinner），改用服务端 redirect，
      //   与上方同类规则一套到底。旧链接 /report/:id、/notion/:id 照常工作。
      {
        source: '/report/:missionId',
        destination: '/ai-writing/report/:missionId',
        permanent: false,
      },
      {
        source: '/notion/:pageId',
        destination: '/library/notion/:pageId',
        permanent: false,
      },
      // ★ 2026-05-18 PR-V8: AI Social 意图驱动重设计 — 删 /create wizard + /edit 全屏页，
      //   30 天 301 redirect 防旧书签 404。期满（2026-06-17）后可删除这两条。
      //   旧路径 → 新主页（用户从主页 + 新建任务弹窗 进入新流程）
      {
        source: '/ai-social/create',
        destination: '/ai-social',
        permanent: false,
      },
      {
        source: '/ai-social/edit/:id',
        destination: '/ai-social',
        permanent: false,
      },
      // ★ 2026-05-20: 旧顶层路由收敛到 next.config 301（替代 app/ 下页面级
      //   redirect shim — 与 admin 路由一致的标准做法）。query string 自动转发。
      {
        source: '/knowledge-graph',
        destination: '/library/knowledge-graph',
        permanent: false,
      },
      {
        source: '/rag',
        destination: '/library/rag',
        permanent: false,
      },
      {
        source: '/ai-skills',
        destination: '/ai-store?tab=skills',
        permanent: false,
      },
      {
        source: '/custom-agents',
        destination: '/me/agents',
        permanent: false,
      },
      // ★ 2026-05-20: 个人中心整合 — 旧散落入口收敛到 /me/[section]（设计
      //   docs/architecture/frontend/personal-center.md §5）。query-tab 用 has
      //   匹配，须排在 bare 规则之前。bare /me/ai 必须保留，否则会落到
      //   app/me/[section] 动态路由（section='ai' 非法 → 404）。
      {
        source: '/profile',
        has: [{ type: 'query', key: 'tab', value: 'notifications' }],
        destination: '/me/notifications',
        permanent: false,
      },
      {
        source: '/profile',
        has: [{ type: 'query', key: 'tab', value: 'settings' }],
        destination: '/me/general',
        permanent: false,
      },
      {
        source: '/profile',
        has: [{ type: 'query', key: 'tab', value: 'stats' }],
        destination: '/me/billing',
        permanent: false,
      },
      {
        source: '/profile',
        has: [{ type: 'query', key: 'tab', value: 'integrations' }],
        destination: '/me/integrations',
        permanent: false,
      },
      {
        source: '/profile',
        destination: '/me/account',
        permanent: false,
      },
      {
        source: '/me/ai',
        has: [{ type: 'query', key: 'tab', value: 'keys' }],
        destination: '/me/api-keys',
        permanent: false,
      },
      {
        source: '/me/ai',
        has: [{ type: 'query', key: 'tab', value: 'models' }],
        destination: '/me/models',
        permanent: false,
      },
      {
        source: '/me/ai',
        has: [{ type: 'query', key: 'tab', value: 'agents' }],
        destination: '/me/agents',
        permanent: false,
      },
      {
        source: '/me/ai',
        destination: '/me/api-keys',
        permanent: false,
      },
      {
        source: '/settings/notifications',
        destination: '/me/notifications',
        permanent: false,
      },
      {
        source: '/credits',
        destination: '/me/billing',
        permanent: false,
      },
    ];
  },
  async rewrites() {
    // Ensure URLs have protocol prefix
    const ensureProtocol = (url) => {
      if (!url) return url;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
      }
      // Default to https for production URLs
      return `https://${url}`;
    };

    // 后端 URL 配置
    // 优先级：API_INTERNAL_URL（Railway 私有网络）> NEXT_PUBLIC_API_URL（公网）> 硬编码默认值
    // API_INTERNAL_URL 仅在服务端使用，避免暴露内部地址到客户端
    const apiUrl = ensureProtocol(
      process.env.API_INTERNAL_URL ||
        process.env.NEXT_PUBLIC_API_URL ||
        'https://api.gens.team'
    );
    const aiUrl = ensureProtocol(
      process.env.NEXT_PUBLIC_AI_URL || 'http://localhost:5000'
    );

    console.log('📡 Next.js rewrites configured:');
    console.log(`   - API URL: ${apiUrl}`);
    console.log(`   - AI URL: ${aiUrl}`);
    console.log(
      `   - RAILWAY_ENVIRONMENT: ${process.env.RAILWAY_ENVIRONMENT || 'not set'}`
    );

    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiUrl}/api/v1/:path*`,
      },
      // ★ 2026-06-02：删除 /api/ai-service/* → 独立 Python ai-service 的 rewrite。
      //   该 rewrite 把 Explore/首页的 AI（summary/insights/chat/quick-action）转发到
      //   一个未配 key 的旧 Python 服务（返回 503 "All AI services unavailable"），
      //   且盖住了 app/api/ai-service/ai/*/route.ts —— 那些 handler 才是正确代理到
      //   NestJS BYOK 后端（/api/v1/ai/*，含 chat→simple-chat 路径映射）。
      //   删掉 rewrite 后请求落到 route handler，AI 走用户 BYOK 模型。
      {
        source: '/api/ai-office/:path*',
        destination: `${apiUrl}/api/v1/ai-office/:path*`,
      },
    ];
  },
  // 添加安全头部配置以支持iframe预览
  async headers() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
    const aiUrl = process.env.NEXT_PUBLIC_AI_URL || 'http://localhost:5000';
    const staticCacheControl =
      process.env.NODE_ENV === 'development'
        ? 'no-store, max-age=0'
        : 'public, max-age=31536000, immutable';
    return [
      // ★ 顺序关键：Next.js headers 对同 key 取"后写覆盖"。catch-all 必须放在
      //   _next/static 规则之前，否则 catch-all 的 max-age=0/must-revalidate
      //   会冲掉 immutable，导致每个 chunk 都强制回源 304，prod 严重变慢。
      // ★ HTML 页面不缓存，确保用户总是获取最新版本
      {
        source: '/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=0, must-revalidate',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // 允许iframe加载来自API服务的内容
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self' blob: data:",
              // 允许所有脚本来源（因为iframe内容来自Blob URL，需要允许内联脚本）
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: https: http:",
              // 允许所有样式来源
              "style-src 'self' 'unsafe-inline' blob: data: https: http:",
              // 允许所有图片来源
              "img-src 'self' data: blob: https: http:",
              // 允许所有字体来源
              "font-src 'self' data: blob: https: http:",
              // 允许所有API连接
              `connect-src 'self' ${apiUrl} ${aiUrl} ws://localhost:* wss://localhost:* blob: data: https: http: wss: ws:`,
              // 允许所有iframe来源（内容通过Blob URL加载）
              `frame-src 'self' ${apiUrl} blob: data: https: http:`,
              // 允许所有worker来源
              "worker-src 'self' blob: data: https: http:",
              // 允许所有object来源（PDF）
              "object-src 'self' blob: data: https: http:",
              // 允许所有base-uri
              "base-uri 'self' https: http: blob: data:",
              // 允许所有form action
              "form-action 'self' https: http:",
              // 允许iframe被嵌入
              "frame-ancestors 'self'",
              // 允许媒体来源
              "media-src 'self' blob: data: https: http:",
              // 允许manifest来源
              "manifest-src 'self' blob: data: https: http:",
            ].join('; '),
          },
        ],
      },
      // ★ 静态资源（带 content hash）可以长期 immutable 缓存
      //   放在 catch-all 之后，让此规则的 Cache-Control 覆盖 catch-all 的值。
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: staticCacheControl,
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
