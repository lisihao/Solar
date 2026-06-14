import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
const AI_SERVICE_URL =
  process.env.NEXT_PUBLIC_AI_URL || 'http://localhost:5000';

/**
 * Grok AI API Proxy
 * Proxies requests to backend Grok service
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Extract message from messages array if not provided
    let message = body.message;
    if (!message && body.messages?.length > 0) {
      const userMessages = body.messages.filter(
        (m: { role: string }) => m.role === 'user'
      );
      message =
        userMessages.length > 0
          ? userMessages[userMessages.length - 1].content
          : body.messages[body.messages.length - 1].content;
    }

    // Forward to backend AI service
    // BYOK: Forward Authorization header so backend can use user's personal API key
    const authHeader = request.headers.get('authorization');
    const response = await fetch(`${AI_SERVICE_URL}/api/v1/ai/simple-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        ...body,
        message: message || 'Process this request',
        model: body.model || 'grok-2',
        stream: body.stream ?? false,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Grok API error:', errorText);
      throw new Error(`Grok API responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('Grok proxy error:', error);
    return NextResponse.json(
      {
        error: 'Failed to communicate with Grok API',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
