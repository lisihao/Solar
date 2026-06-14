/**
 * AI Social Process Source API Route
 *
 * Custom API route to handle AI content processing with extended timeout.
 * The default Next.js rewrite proxy has ~30s timeout which is too short
 * for AI operations that can take 60-90 seconds.
 */

import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

// Extend Next.js serverless function timeout (Vercel/Railway)
export const maxDuration = 120; // 2 minutes

const BACKEND_URL = config.getBackendUrl();

export async function POST(request: NextRequest) {
  try {
    // Get authorization header from the incoming request
    const authHeader = request.headers.get('authorization');

    if (!authHeader) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Missing authorization header' },
        { status: 401 }
      );
    }

    // Parse the request body
    const body = await request.json();

    // Create AbortController for timeout (90 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      // Forward the request to the backend
      const response = await fetch(
        `${BACKEND_URL}/api/v1/ai-social/ai/process-source`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authHeader,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        }
      );

      clearTimeout(timeoutId);

      // Get the response
      const data = await response.json();

      // Return the response with the same status code
      return NextResponse.json(data, { status: response.status });
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return NextResponse.json(
          {
            error: 'Timeout',
            message: 'AI processing timeout - please try again',
          },
          { status: 504 }
        );
      }

      throw error;
    }
  } catch (error) {
    logger.error('[process-source] Proxy error:', error);

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message:
          error instanceof Error ? error.message : 'Failed to process request',
      },
      { status: 500 }
    );
  }
}
