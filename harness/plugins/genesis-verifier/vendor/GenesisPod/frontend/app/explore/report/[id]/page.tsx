'use client';

import { useState, useEffect } from 'react';
import { Table, Th, Td } from '@/components/ui/table';
import { useParams, useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { config } from '@/lib/utils/config';
import ClientDate from '@/components/common/ClientDate';
import { CitationListItem } from '@/components/common/citations';
import { formatDateSafe } from '@/lib/utils/date';
import { toast, confirm } from '@/stores';

interface ReportSection {
  title: string;
  content: string;
}

interface Resource {
  id: string;
  type: string;
  title: string;
  abstract?: string;
  authors?: unknown;
  publishedAt?: string;
  thumbnailUrl?: string;
  sourceUrl?: string;
  pdfUrl?: string;
  tags?: unknown;
}

interface Report {
  id: string;
  title: string;
  template: string;
  templateName: string;
  templateIcon: string;
  summary: string;
  sections: ReportSection[];
  resourceIds: string[];
  resourceCount: number;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
  resources?: Resource[];
}

export default function ReportPage() {
  const params = useParams();
  const router = useRouter();
  const reportId = params?.id as string;

  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadReport();
  }, [reportId]);

  const loadReport = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/reports/${reportId}`
      );

      if (!response.ok) {
        throw new Error('Failed to load report');
      }

      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report');
    } finally {
      setLoading(false);
    }
  };

  const handleExportMarkdown = () => {
    if (!report) return;

    let markdown = `# ${report.title}\n\n`;
    markdown += `**${report.templateIcon} ${report.templateName}** | `;
    markdown += `📄 ${report.resourceCount} 篇素材 | `;
    markdown += `🕐 ${formatDateSafe(report.createdAt, 'datetime')}\n\n`;
    markdown += `## 📝 核心摘要\n\n${report.summary}\n\n`;

    report.sections.forEach((section) => {
      markdown += `## ${section.title}\n\n${section.content}\n\n`;
    });

    markdown += `## 📚 参考素材\n\n`;
    report.resources?.forEach((resource, idx) => {
      markdown += `${idx + 1}. **${resource.title}**\n`;
      if (resource.sourceUrl) {
        markdown += `   - 链接: ${resource.sourceUrl}\n`;
      }
    });

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.title}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRegenerate = async () => {
    if (
      !(await confirm({
        title: '确定要重新生成报告吗？',
        description: '这将花费一些时间。',
        type: 'warning',
      }))
    )
      return;

    toast.info('Regeneration feature is not yet available');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-red-600"></div>
          <p className="text-gray-600">加载报告中...</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-6xl">😕</div>
          <h2 className="mb-2 text-2xl font-bold text-gray-900">
            报告加载失败
          </h2>
          <p className="mb-4 text-gray-600">{error || '未找到报告'}</p>
          <button
            onClick={() => router.back()}
            className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
          >
            返回
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="mx-auto max-w-5xl px-6">
        {/* Header */}
        <header className="mb-8 rounded-lg bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-start justify-between">
            <div className="flex-1">
              {/* Metadata */}
              <div className="mb-3 flex items-center gap-3 text-sm text-gray-600">
                <span>
                  {report.templateIcon} {report.templateName}
                </span>
                <span>•</span>
                <span>📄 {report.resourceCount} 篇素材</span>
                <span>•</span>
                <span>
                  🕐 <ClientDate date={report.createdAt} format="date" />
                </span>
              </div>

              {/* Title */}
              <h1 className="text-3xl font-bold text-gray-900">
                {report.title}
              </h1>
            </div>

            {/* Actions */}
            <div className="ml-4 flex gap-2">
              <button
                onClick={handleExportMarkdown}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                📄 导出 MD
              </button>
              <button
                onClick={handleRegenerate}
                className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                🔄 重新生成
              </button>
            </div>
          </div>

          {/* Summary */}
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-5">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold text-gray-900">
              <span>📝</span>
              <span>核心摘要</span>
            </h2>
            <p className="whitespace-pre-wrap leading-relaxed text-gray-700">
              {report.summary}
            </p>
          </div>
        </header>

        {/* Sections */}
        <div className="mb-12 space-y-6">
          {report.sections.map((section, idx) => (
            <section key={idx} className="rounded-lg bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-2xl font-semibold text-gray-900">
                {section.title}
              </h2>
              <div className="prose prose-sm prose-headings:text-gray-900 prose-p:text-gray-700 prose-a:text-red-600 prose-strong:text-gray-900 prose-code:text-red-600 prose-code:bg-red-50 prose-pre:bg-gray-50 max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    table: ({ node, ...props }) => (
                      <div className="overflow-x-auto">
                        <Table
                          className="min-w-full divide-y divide-gray-300 border"
                          {...props}
                        />
                      </div>
                    ),
                    th: ({ node, ...props }) => (
                      <Th
                        className="border bg-gray-50 px-4 py-2 text-left text-sm font-semibold"
                        {...props}
                      />
                    ),
                    td: ({ node, ...props }) => (
                      <Td className="border px-4 py-2 text-sm" {...props} />
                    ),
                  }}
                >
                  {section.content}
                </ReactMarkdown>
              </div>
            </section>
          ))}
        </div>

        {/* Referenced Resources */}
        {report.resources && report.resources.length > 0 && (
          <div className="rounded-lg bg-white p-6 shadow-sm">
            <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold text-gray-900">
              <span>📚</span>
              <span>参考素材 ({report.resources.length})</span>
            </h2>
            <div className="grid gap-4">
              {report.resources.map((resource) => (
                <CitationListItem
                  key={resource.id}
                  title={resource.title}
                  description={resource.abstract}
                  thumbnailUrl={
                    resource.thumbnailUrl
                      ? `${config.apiBaseUrl}${resource.thumbnailUrl}`
                      : undefined
                  }
                  accentClass="hover:border-red-300"
                  meta={
                    <>
                      <span className="font-medium uppercase">
                        {resource.type}
                      </span>
                      {resource.publishedAt && (
                        <>
                          <span>•</span>
                          <span>
                            <ClientDate
                              date={resource.publishedAt}
                              format="date"
                            />
                          </span>
                        </>
                      )}
                    </>
                  }
                  actions={
                    <>
                      {resource.pdfUrl && (
                        <a
                          href={resource.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-red-50 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                        >
                          PDF
                        </a>
                      )}
                      {resource.sourceUrl && (
                        <a
                          href={resource.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-200"
                        >
                          查看
                        </a>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center">
          <button
            onClick={() => router.back()}
            className="rounded-lg border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            ← 返回
          </button>
        </div>
      </div>
    </div>
  );
}
