import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// 后端 API URL
const API_BASE_URL = config.getBackendUrl() + '/api/v1';

/**
 * 重新生成单页幻灯片
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; slideIndex: string } }
) {
  const { id, slideIndex } = params;

  try {
    const body = await request.json();

    const response = await fetch(
      `${API_BASE_URL}/ai-office/slides/${id}/slides/${slideIndex}/regenerate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('[Slides Regenerate] Error:', error);
    return NextResponse.json(
      { error: 'Failed to regenerate slide' },
      { status: 500 }
    );
  }
}
