import { NextRequest } from 'next/server';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

/**
 * Slides Team 生成 API 代理
 *
 * 将前端 POST 请求代理到后端的 SSE 流式生成接口
 * 路由: POST /api/ai-office/slides/team/generate
 */

// 后端 API URL
const API_BASE_URL = config.getBackendUrl() + '/api/v1';

// 设置更长的超时时间以支持长时间的 Slides 生成
// Railway Pro plan 支持最多 300 秒
export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // 构建后端 URL - no longer need userId in query params
  const backendUrl = `${API_BASE_URL}/ai-office/slides/team/generate`;

  logger.debug('[Slides Team Generate] Proxying to:', backendUrl);

  // Forward Authorization header from the request
  const authHeader = request.headers.get('Authorization');

  try {
    // 获取请求体
    const body = await request.json();
    logger.debug('[Slides Team Generate] Request body:', {
      title: body.title,
      sourceTextLength: body.sourceText?.length || 0,
      targetPages: body.targetPages,
      themeId: body.themeId,
    });

    // 代理到后端 with auth header
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(authHeader && { Authorization: authHeader }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Slides Team Generate] Backend error:', {
        status: response.status,
        error: errorText,
      });
      return new Response(
        JSON.stringify({
          error: `Backend error: ${response.status}`,
          details: errorText,
        }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 转发 SSE 流
    if (response.body) {
      logger.debug('[Slides Team Generate] Starting SSE stream');
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response(JSON.stringify({ error: 'No response body' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('[Slides Team Generate] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to connect to backend service',
        details: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
