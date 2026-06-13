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
    const { content, max_length = 200, language = 'zh' } = body;

    // Forward request to NestJS backend
    // BYOK: Forward Authorization header so backend can use user's personal API key
    const authHeader = request.headers.get('authorization');
    const response = await fetch(`${API_URL}/api/v1/ai/summary`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        content,
        max_length,
        language,
      }),
    });

    if (!response.ok) {
      let errorDetail = `AI service responded with status: ${response.status}`;
      try {
        const errorData = await response.json();
        errorDetail =
          errorData.detail ||
          errorData.error ||
          errorData.message ||
          errorDetail;
      } catch {
        errorDetail = response.statusText || errorDetail;
      }
      logger.error('AI summary error:', errorDetail);
      return NextResponse.json(
        { error: errorDetail },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('AI summary error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: `无法连接到AI服务: ${errorMessage}` },
      { status: 500 }
    );
  }
}
