import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// ★ 使用 cookies() 必须标记为动态
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const runtime = 'nodejs';

const API_BASE_URL = config.getBackendUrl() + '/api/v1';

/**
 * POST /api/agents/execute
 * Execute an AI Agent task
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;

    logger.debug('[Agents Execute] Request:', {
      agentType: body.agentType,
      hasPrompt: !!body.prompt,
    });

    const response = await fetch(`${API_BASE_URL}/ai-office/agents/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[Agents Execute] Backend error:', {
        status: response.status,
        error: errorText,
      });
      return NextResponse.json(
        { error: 'Failed to execute agent', details: errorText },
        { status: response.status }
      );
    }

    const data = await response.json();
    logger.debug('[Agents Execute] Success:', data);
    return NextResponse.json(data);
  } catch (error) {
    logger.error('[Agents Execute] Error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
