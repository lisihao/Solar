/**
 * Export API Route - 绕过 Next.js rewrite proxy
 *
 * WYSIWYG 导出的 POST body 包含完整 HTML/CSS 内容，体积可能很大。
 * 通过 Next.js rewrite 代理传输时连接会被中断（ECONNRESET / request aborted）。
 * 此 API route 优先于 rewrite 规则，手动转发请求到后端，避免代理层限制。
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const getBackendUrl = () => {
  // 优先使用服务端专用变量（可配置为 Railway 内部地址），否则用公开地址
  return (
    process.env.BACKEND_INTERNAL_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    'https://api.gens.team'
  );
};

export async function POST(request: NextRequest) {
  const backendUrl = getBackendUrl();
  const targetUrl = `${backendUrl}/api/v1/export`;

  try {
    // 转发 headers
    const headers: Record<string, string> = {
      'Content-Type': request.headers.get('Content-Type') || 'application/json',
    };
    const auth = request.headers.get('Authorization');
    if (auth) headers['Authorization'] = auth;

    // 读取完整 body 后转发（避免流式代理的兼容性问题）
    const body = await request.arrayBuffer();

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(60000),
    });

    const data = await response.text();
    return new NextResponse(data, {
      status: response.status,
      headers: {
        'Content-Type':
          response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Export Route] Proxy error:', message);
    return NextResponse.json(
      { success: false, error: `Export request failed: ${message}` },
      { status: 502 }
    );
  }
}
