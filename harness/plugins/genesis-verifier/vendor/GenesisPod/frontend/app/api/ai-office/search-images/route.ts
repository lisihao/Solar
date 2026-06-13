import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
/**
 * 图片搜索API路由
 * POST /api/ai-office/search-images
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, text, count = 10 } = body;

    if (!query && !text) {
      return NextResponse.json(
        { error: 'Query or text is required' },
        { status: 400 }
      );
    }

    // 调用后端图片搜索服务
    const backendUrl =
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const response = await fetch(
      `${backendUrl}/api/v1/ai-office/search-images`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          text,
          count,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Backend API error: ${response.statusText}`);
    }

    const data = await response.json();

    return NextResponse.json({
      success: true,
      images: data.images || [],
      total: data.total || 0,
    });
  } catch (error) {
    logger.error('Image search API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        images: [],
        total: 0,
      },
      { status: 500 }
    );
  }
}
