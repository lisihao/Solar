import { NextRequest, NextResponse } from 'next/server';
import { documentExportService } from '@/lib/utils/document-export.service';
import { getTemplateById } from '@/lib/features/ai-office/ppt-templates';

import { logger } from '@/lib/utils/logger';
/**
 * 文档导出API路由
 * 使用Node.js Runtime以支持docx和pptxgenjs库
 * POST /api/ai-office/export
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { format, content, title, templateId } = body;

    if (!format || !content || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: format, content, title' },
        { status: 400 }
      );
    }

    // 验证格式
    const validFormats = ['word', 'ppt', 'pdf', 'markdown', 'html', 'latex'];
    if (!validFormats.includes(format)) {
      return NextResponse.json(
        {
          error: `Invalid format. Supported formats: ${validFormats.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // 获取模板配置
    const template = templateId ? getTemplateById(templateId) : undefined;

    // 使用文档导出服务生成文件
    const buffer = await documentExportService.exportDocument({
      title,
      content,
      format: format as 'word' | 'ppt' | 'pdf' | 'markdown' | 'html' | 'latex',
      template,
    });

    // 设置正确的MIME类型和文件扩展名
    const mimeTypes = {
      word: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ppt: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      pdf: 'application/pdf',
      markdown: 'text/markdown',
      html: 'text/html',
      latex: 'application/x-latex',
    };

    const extensions = {
      word: 'docx',
      ppt: 'pptx',
      pdf: 'pdf',
      markdown: 'md',
      html: 'html',
      latex: 'tex',
    };

    const mimeType = mimeTypes[format as keyof typeof mimeTypes];
    const extension = extensions[format as keyof typeof extensions];
    const filename = `${title}.${extension}`;

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
        'Content-Length': buffer.length.toString(),
      },
    });
  } catch (error) {
    logger.error('Export API error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
