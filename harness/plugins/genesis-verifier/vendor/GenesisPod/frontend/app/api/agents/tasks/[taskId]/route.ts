import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// ★ 使用 cookies() 必须标记为动态
export const dynamic = 'force-dynamic';
const API_BASE_URL = config.getBackendUrl() + '/api/v1';

/**
 * GET /api/agents/tasks/[taskId]
 * Get task status and details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;

    const response = await fetch(`${API_BASE_URL}/ai-office/agents/tasks/${taskId}`, {
      headers: {
        ...(token && { Authorization: `Bearer ${token}` }),
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Agents Task] Backend error:', {
        status: response.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'Failed to fetch task', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('[Agents Task] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
