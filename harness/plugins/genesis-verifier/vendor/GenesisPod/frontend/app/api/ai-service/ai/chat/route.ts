import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
// Use the main backend API URL (NestJS), not separate AI service
// Priority: BACKEND_INTERNAL_URL > NEXT_PUBLIC_API_URL > RAILWAY_SERVICE_BACKEND_URL > localhost
function ensureProtocol(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url;
  }
  return `https://${url}`;
}

function getBackendUrl() {
  if (process.env.BACKEND_INTERNAL_URL) {
    return ensureProtocol(process.env.BACKEND_INTERNAL_URL);
  }
  if (process.env.NEXT_PUBLIC_API_URL) {
    return ensureProtocol(process.env.NEXT_PUBLIC_API_URL);
  }
  // In Railway, try to construct from service name
  if (process.env.RAILWAY_SERVICE_BACKEND_URL) {
    return ensureProtocol(process.env.RAILWAY_SERVICE_BACKEND_URL);
  }
  return 'http://localhost:4000';
}

const API_URL = getBackendUrl();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, context, model = 'gemini', stream = true } = body;

    // 诊断日志
    logger.debug('[AI Chat API] Using backend URL:', API_URL);
    logger.debug('[AI Chat API] ENV check:', {
      BACKEND_INTERNAL_URL: process.env.BACKEND_INTERNAL_URL
        ? 'set'
        : 'not set',
      NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ? 'set' : 'not set',
      RAILWAY_SERVICE_BACKEND_URL: process.env.RAILWAY_SERVICE_BACKEND_URL
        ? 'set'
        : 'not set',
    });

    // Forward request to NestJS backend simple-chat endpoint
    // BYOK: Forward Authorization header so backend can use user's personal API key
    const authHeader = request.headers.get('authorization');
    const response = await fetch(`${API_URL}/api/v1/ai/simple-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        message,
        context,
        model,
        stream,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('AI service error:', {
        status: response.status,
        error: errorText,
      });
      throw new Error(`AI service responded with status: ${response.status}`);
    }

    // If streaming, pass through the stream
    if (stream && response.body) {
      return new NextResponse(response.body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      });
    }

    // Otherwise return JSON
    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('AI chat error:', error);
    return NextResponse.json(
      { error: 'Failed to communicate with AI service' },
      { status: 500 }
    );
  }
}
