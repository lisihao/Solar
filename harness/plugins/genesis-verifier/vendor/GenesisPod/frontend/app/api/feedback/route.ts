import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/utils/logger';
import { config } from '@/lib/utils/config';

const GITHUB_ISSUES_URL = config.brand.githubIssuesUrl;

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    const backendUrl = config.getBackendUrl();

    // Handle multipart form data (with file uploads)
    // ★ 2026-06-11：直接流式转发原始 body，不再 await request.formData() 重建——
    //   重建会把截图文件整个读进 Next 进程内存（违背去内存化），且重新编码 multipart
    //   易破坏 boundary 导致后端解析失败。字段校验交后端 DTO（错误会透传回前端）。
    if (contentType.includes('multipart/form-data')) {
      try {
        // 透传 Authorization：登录用户的反馈归属 userId（后端 OptionalJwtAuthGuard 读取）。
        const authHeader = request.headers.get('authorization');
        const response = await fetch(`${backendUrl}/api/v1/feedback`, {
          method: 'POST',
          headers: {
            'content-type': contentType,
            ...(authHeader ? { authorization: authHeader } : {}),
          },
          body: request.body,
          // Node fetch 流式 body 必须显式 duplex（透传原始上传流，不缓冲进内存）
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });

        const data = (await response.json().catch(() => ({}))) as {
          feedbackId?: string;
          attachmentsCount?: number;
          message?: string | string[];
          error?: string;
        };
        if (response.ok) {
          return NextResponse.json({
            success: true,
            message: 'Feedback submitted successfully',
            feedbackId: data.feedbackId,
            attachmentsCount: data.attachmentsCount || 0,
          });
        }
        // ★ 不再吞错 fall-through：透传后端真实状态码 + 错误（含 DTO 校验 message 数组），
        //   让用户/诊断看到真因而非"Failed to submit"通用文案。
        logger.error('Backend feedback error:', data);
        const backendMsg = Array.isArray(data.message)
          ? data.message.join('; ')
          : data.message;
        return NextResponse.json(
          {
            success: false,
            error:
              backendMsg || data.error || `提交失败（后端 ${response.status}）`,
            githubIssuesUrl: GITHUB_ISSUES_URL,
          },
          { status: response.status }
        );
      } catch (backendError) {
        logger.error('Backend feedback service error:', backendError);
        return NextResponse.json(
          {
            success: false,
            error: `无法连接反馈服务：${
              backendError instanceof Error ? backendError.message : '未知错误'
            }`,
            githubIssuesUrl: GITHUB_ISSUES_URL,
          },
          { status: 502 }
        );
      }
    } else {
      // Handle JSON (no file uploads)
      const body = await request.json();

      // Validate required fields
      if (!body.title || !body.description || !body.type) {
        return NextResponse.json(
          { success: false, error: 'Missing required fields' },
          { status: 400 }
        );
      }

      // Send to backend feedback API
      try {
        const authHeader = request.headers.get('authorization');
        const response = await fetch(`${backendUrl}/api/v1/feedback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authHeader ? { authorization: authHeader } : {}),
          },
          body: JSON.stringify({
            type: body.type,
            title: body.title,
            description: body.description,
            userEmail: body.email,
            userAgent: body.userAgent,
            url: body.url,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          return NextResponse.json({
            success: true,
            message: 'Feedback submitted successfully',
            feedbackId: data.feedbackId,
          });
        } else {
          const errorData = await response.json().catch(() => ({}));
          logger.error('Backend feedback error:', errorData);
        }
      } catch (backendError) {
        logger.error('Backend feedback service error:', backendError);
      }
    }

    // Fallback: Return error and suggest GitHub Issues
    return NextResponse.json(
      {
        success: false,
        error:
          'Failed to submit feedback. Please try again or open a GitHub issue.',
        githubIssuesUrl: GITHUB_ISSUES_URL,
      },
      { status: 500 }
    );
  } catch (error) {
    logger.error('Feedback submission error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to submit feedback',
        githubIssuesUrl: GITHUB_ISSUES_URL,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    githubIssuesUrl: GITHUB_ISSUES_URL,
    types: ['bug', 'feature', 'improvement', 'other'],
  });
}
