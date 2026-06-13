import { NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// 后端 API URL
const API_BASE_URL = config.getBackendUrl() + '/api/v1';

/**
 * 获取可用主题列表
 */
export async function GET() {
  try {
    const response = await fetch(
      `${API_BASE_URL}/ai-office/slides/themes/list`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
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
    logger.error('[Slides Themes] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch themes' },
      { status: 500 }
    );
  }
}
