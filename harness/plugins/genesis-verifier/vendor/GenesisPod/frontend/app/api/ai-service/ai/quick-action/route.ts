import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
// Use the main backend API URL (NestJS)
function ensureProtocol(url: string): string {
  if (!url) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `https://${url}`;
}
function getBackendUrl() {
  return ensureProtocol(
    process.env.BACKEND_INTERNAL_URL ||
      process.env.NEXT_PUBLIC_API_URL ||
      process.env.RAILWAY_SERVICE_BACKEND_URL ||
      'http://localhost:4000'
  );
}
const API_URL = getBackendUrl();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, action, model = 'gemini' } = body;

    // BYOK: Forward Authorization header so backend can use user's personal API key
    const authHeader = request.headers.get('authorization');

    // Forward request to NestJS backend
    const response = await fetch(`${API_URL}/api/v1/ai/quick-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        content,
        action,
        model,
      }),
    });

    if (!response.ok) {
      throw new Error(`AI service responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('AI quick action error:', error);
    return NextResponse.json(
      { error: 'Failed to communicate with AI service' },
      { status: 500 }
    );
  }
}
