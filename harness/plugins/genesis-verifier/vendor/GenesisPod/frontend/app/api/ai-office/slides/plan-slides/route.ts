import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// 后端 API URL
const API_BASE_URL = config.getBackendUrl() + '/api/v1';

// Vercel Serverless Function 配置 - 增加超时时间（Pro plan 支持 60 秒）
export const maxDuration = 60;

/**
 * Slides 幻灯片规划 API 代理
 * POST /api/ai-office/slides/plan-slides
 *
 * 输入已确认的大纲，生成每页的详细设计规格：
 * - 布局类型 + 理由
 * - 背景决策（纯色/渐变/AI生成）
 * - 图像规格（prompt、位置、风格）
 * - 图表规格
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    logger.debug('[Slides Plan] Request:', JSON.stringify(body).slice(0, 200));

    const backendUrl = `${API_BASE_URL}/ai-office/slides/plan-slides`;

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
      logger.error('[Slides Plan] Backend error:', {
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
      '[Slides Plan] Success, specs count:',
      data.slideSpecs?.length || 0
    );

    return NextResponse.json(data);
  } catch (error) {
    logger.error('[Slides Plan] Error:', error);
    return NextResponse.json(
      {
        error: 'Failed to plan slides',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
