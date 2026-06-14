import { NextRequest, NextResponse } from 'next/server';

/**
 * Runtime API proxy — read API_INTERNAL_URL at request time
 *
 * 历史背景: 早先 next.config.js rewrites() 把 API_INTERNAL_URL 在 *build* 阶段烤进
 * routes-manifest.json (Next.js standalone 不再 read runtime env)。结果:
 *  - Railway prod build 时 env=https://api.gens.team → 客户离线部署后端 URL 不可改
 *  - 客户拿镜像跑本地 docker compose → /api/v1/* 仍打 Railway, 登录拿 500
 *
 * 彻底解决: 改用 middleware 在每个 request 时 `process.env.API_INTERNAL_URL` 实时读,
 * NextResponse.rewrite 到目标。Next.js middleware 在 standalone 也保留 runtime env
 * 访问 (经 next-runtime/edge), 这是 framework 唯一干净的 "运行时改 rewrite 目标" 方案。
 *
 * 优先级:
 *   API_INTERNAL_URL (服务端私有, e.g. http://backend:4000)
 *   > NEXT_PUBLIC_API_URL (build-time 注入, e.g. https://api.gens.team)
 *   > 'https://api.gens.team' (兜底 - 与历史 next.config.js 默认行为一致)
 *
 * 同时保留 next.config.js 的 rewrites 配置作 *fallback* (开发模式 / 没走 middleware
 * 的边缘场景), 但目标 URL 仍是 https://api.gens.team — 生产路径恒走本 middleware。
 */

function ensureProtocol(url: string): string {
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const apiBase = ensureProtocol(
    process.env.API_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      'https://api.gens.team'
  );
  // /api/v1/* → ${API}/api/v1/*
  if (pathname.startsWith('/api/v1/')) {
    const url = new URL(`${apiBase}${pathname}${search}`);
    return NextResponse.rewrite(url);
  }
  // ★ 2026-06-02：/api/ai-service/* 不再 rewrite 到独立 Python ai-service（已弃用，
  //   未配 key 时返回 503 "All AI services unavailable"）。改为放行，让
  //   app/api/ai-service/ai/*/route.ts 处理 —— 它们代理到 NestJS BYOK 后端
  //   (/api/v1/ai/*，含 chat→simple-chat 映射)，AI 走用户自己的 BYOK 模型。
  // /api/ai-office/* → ${API}/api/v1/ai-office/*
  if (pathname.startsWith('/api/ai-office/')) {
    const rel = pathname.replace('/api/ai-office/', '/api/v1/ai-office/');
    const url = new URL(`${apiBase}${rel}${search}`);
    return NextResponse.rewrite(url);
  }
}

export const config = {
  matcher: ['/api/v1/:path*', '/api/ai-office/:path*'],
};
