import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// 后端 API URL
const API_BASE_URL = config.getBackendUrl() + '/api/v1';

/**
 * 获取 Slides 文档
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    const response = await fetch(`${API_BASE_URL}/ai-office/slides/${id}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend error: ${response.status}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('[Slides GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch Slides document' },
      { status: 500 }
    );
  }
}

/**
 * 删除 Slides 文档
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;

  try {
    const response = await fetch(`${API_BASE_URL}/ai-office/slides/${id}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Backend error: ${response.status}` },
        { status: response.status }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[Slides DELETE] Error:', error);
    return NextResponse.json(
      { error: 'Failed to delete Slides document' },
      { status: 500 }
    );
  }
}
