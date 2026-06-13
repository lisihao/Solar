import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// 后端 API URL
const API_BASE_URL = config.getBackendUrl() + '/api/v1';

// Vercel Serverless Function 配置
// Pro plan 支持最多 300 秒，设置为 180 秒以支持长时间 AI 生成
export const maxDuration = 180;

// 强制使用 Node.js 运行时（支持更长超时）
export const runtime = 'nodejs';

/**
 * Slides 大纲生成 API 代理
 * POST /api/ai-office/slides/outline
 */
export async function POST(request: NextRequest) {
  logger.debug('[Slides Outline] API route called');

  try {
    const body = await request.json();

    logger.debug(
      '[Slides Outline] Request body:',
      JSON.stringify(body).slice(0, 500)
    );
    logger.debug('[Slides Outline] prompt:', body.prompt?.slice(0, 100));
    logger.debug('[Slides Outline] slideCount:', body.slideCount);

    const backendUrl = `${API_BASE_URL}/ai-office/slides/outline`;

    // 创建 AbortController 用于超时控制（2 分钟）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Slides Outline] Backend error:', {
        status: response.status,
        error: errorText,
      });
      return NextResponse.json(
        {
          error: `Backend error: ${response.status}`,
          details: errorText,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    logger.debug(
      '[Slides Outline] Success, slides count:',
      data.outline?.slides?.length || 0
    );

    return NextResponse.json(data);
  } catch (error) {
    logger.error('[Slides Outline] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to generate outline',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
