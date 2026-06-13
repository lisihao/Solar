import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// ★ 使用 cookies() 必须标记为动态
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const runtime = 'nodejs';

const API_BASE_URL = config.getBackendUrl() + '/api/v1';

/**
 * GET /api/agents/tasks/[taskId]/stream
 * SSE stream for task progress updates
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskId: string }> }
) {
  try {
    const { taskId } = await params;
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;

    logger.debug('[Agents Stream] Connecting to task:', taskId);

    const response = await fetch(
      `${API_BASE_URL}/ai-office/agents/tasks/${taskId}/stream`,
      {
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      }
    );

    if (!response.ok) {
      logger.error('[Agents Stream] Backend error:', {
        status: response.status,
        statusText: response.statusText,
      });
      return new Response(
        JSON.stringify({
          error: `Backend error: ${response.status}`,
        }),
        {
          status: response.status,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // Proxy the SSE stream
    if (response.body) {
      return new Response(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    return new Response(JSON.stringify({ error: 'No response body' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('[Agents Stream] Error:', error);
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
