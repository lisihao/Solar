import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
// Use the main backend API URL (NestJS)
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, targetLanguage = 'zh-CN' } = body;

    // Forward request to NestJS backend
    // BYOK: Forward Authorization header so backend can use user's personal API key
    const authHeader = request.headers.get('authorization');
    const response = await fetch(`${API_URL}/api/v1/ai/translate-single`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        text,
        targetLang: targetLanguage,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`AI service error: ${response.status} - ${errorText}`);
      throw new Error(`AI service responded with status: ${response.status}`);
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    logger.error('Translation error:', (error as Error)?.message || error);
    return NextResponse.json(
      { error: (error as Error)?.message || 'Failed to translate text' },
      { status: 500 }
    );
  }
}
