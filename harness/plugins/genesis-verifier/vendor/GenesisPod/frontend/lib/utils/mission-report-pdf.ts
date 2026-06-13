/**
 * AI Team Mission Report PDF Generator
 * 使用纯内联样式确保 PDF 渲染正确
 */

import { config } from './config';
import { toast } from '@/stores';

// Report data interfaces
export interface MissionReportData {
  mission: {
    id: string;
    title: string;
    description: string;
    status: string;
    leader: string;
    createdAt: string;
    completedAt?: string;
    finalResult?: string;
  };
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    status: string;
    assignedTo: string;
    result?: string;
    leaderFeedback?: string;
    revisionCount: number;
    startedAt?: string;
    completedAt?: string;
  }>;
}

interface ReportStats {
  totalTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
  failedTasks: number;
  totalRevisions: number;
  avgRevisions: number;
  durationMinutes: number;
  participantCount: number;
  participants: Map<string, number>;
}

function calculateStats(data: MissionReportData): ReportStats {
  const tasks = data.tasks || [];
  const participants = new Map<string, number>();

  tasks.forEach((task) => {
    const count = participants.get(task.assignedTo) || 0;
    participants.set(task.assignedTo, count + 1);
  });

  const completedTasks = tasks.filter((t) => t.status === 'COMPLETED').length;
  const inProgressTasks = tasks.filter(
    (t) => t.status === 'IN_PROGRESS'
  ).length;
  const pendingTasks = tasks.filter((t) => t.status === 'PENDING').length;
  const failedTasks = tasks.filter((t) => t.status === 'FAILED').length;
  const totalRevisions = tasks.reduce(
    (sum, t) => sum + (t.revisionCount || 0),
    0
  );

  let durationMinutes = 0;
  if (data.mission.createdAt && data.mission.completedAt) {
    const start = new Date(data.mission.createdAt);
    const end = new Date(data.mission.completedAt);
    durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  }

  return {
    totalTasks: tasks.length,
    completedTasks,
    inProgressTasks,
    pendingTasks,
    failedTasks,
    totalRevisions,
    avgRevisions: tasks.length > 0 ? totalRevisions / tasks.length : 0,
    durationMinutes,
    participantCount: participants.size,
    participants,
  };
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function getStatusBadge(status: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    COMPLETED: { bg: '#dcfce7', text: '#166534' },
    IN_PROGRESS: { bg: '#dbeafe', text: '#1e40af' },
    PENDING: { bg: '#fef3c7', text: '#92400e' },
    FAILED: { bg: '#fee2e2', text: '#991b1b' },
  };
  const c = colors[status] || { bg: '#f3f4f6', text: '#374151' };
  return `<span style="display: inline-block; padding: 4px 12px; border-radius: 12px; font-size: 11px; font-weight: 500; background: ${c.bg}; color: ${c.text};">${status}</span>`;
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Process inline markdown (bold, italic, etc.)
 */
function processInlineMarkdown(text: string): string {
  let result = text;
  // Bold
  result = result.replace(
    /\*\*(.+?)\*\*/g,
    '<strong style="font-weight: 600;">$1</strong>'
  );
  // Italic (but not if already processed as bold)
  result = result.replace(
    /(?<!\*)\*([^*]+?)\*(?!\*)/g,
    '<em style="font-style: italic;">$1</em>'
  );
  // Code
  result = result.replace(
    /`(.+?)`/g,
    '<code style="background: #f1f5f9; padding: 2px 4px; border-radius: 3px; font-family: monospace; font-size: 11px;">$1</code>'
  );
  return result;
}

/**
 * Parse table cells from a line
 */
function parseTableCells(line: string): string[] {
  // Remove leading and trailing pipes, then split
  const trimmed = line.replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
}

/**
 * Check if a line is a table separator (|---|---|)
 */
function isTableSeparator(line: string): boolean {
  return /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/.test(line.trim());
}

/**
 * Check if a line looks like a table row (contains |)
 */
function isTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && !isTableSeparator(trimmed);
}

/**
 * Convert a markdown table block to HTML
 */
function convertTableToHtml(tableLines: string[]): string {
  if (tableLines.length < 2) return tableLines.join('\n');

  // Find the separator line
  const separatorIndex = tableLines.findIndex(isTableSeparator);
  if (separatorIndex === -1 || separatorIndex === 0) {
    return tableLines.join('\n');
  }

  const headerLine = tableLines[separatorIndex - 1];
  const bodyLines = tableLines.slice(separatorIndex + 1).filter(isTableRow);

  const headerCells = parseTableCells(headerLine);

  const tableStyle =
    'width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12px;';
  const thStyle =
    'background: #f8fafc; padding: 10px 12px; text-align: left; border: 1px solid #e2e8f0; font-weight: 600; color: #374151;';
  const tdStyle =
    'padding: 8px 12px; border: 1px solid #e2e8f0; color: #475569;';

  let html = `<table style="${tableStyle}">`;

  // Header
  html += '<thead><tr>';
  headerCells.forEach((cell) => {
    const processedCell = processInlineMarkdown(escapeHtml(cell));
    html += `<th style="${thStyle}">${processedCell}</th>`;
  });
  html += '</tr></thead>';

  // Body
  if (bodyLines.length > 0) {
    html += '<tbody>';
    bodyLines.forEach((line) => {
      const cells = parseTableCells(line);
      html += '<tr>';
      // Match header cell count
      for (let i = 0; i < headerCells.length; i++) {
        const cell = cells[i] || '';
        const processedCell = processInlineMarkdown(escapeHtml(cell));
        html += `<td style="${tdStyle}">${processedCell}</td>`;
      }
      html += '</tr>';
    });
    html += '</tbody>';
  }

  html += '</table>';
  return html;
}

/**
 * Convert Markdown to HTML for PDF rendering
 * Processes tables by detecting consecutive lines with | character
 */
function markdownToHtml(text: string): string {
  if (!text) return '';

  const lines = text.split('\n');
  const result: string[] = [];
  let tableBuffer: string[] = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // Check if this line could be part of a table
    const couldBeTableLine =
      trimmedLine.includes('|') || isTableSeparator(trimmedLine);

    if (couldBeTableLine) {
      // Start or continue table
      if (!inTable) {
        inTable = true;
        tableBuffer = [];
      }
      tableBuffer.push(line);
    } else {
      // End of table
      if (inTable && tableBuffer.length >= 2) {
        // Check if we have a valid table (has separator)
        if (tableBuffer.some(isTableSeparator)) {
          result.push(convertTableToHtml(tableBuffer));
        } else {
          // Not a valid table, add lines back
          result.push(...tableBuffer.map(escapeHtml));
        }
        tableBuffer = [];
        inTable = false;
      } else if (inTable) {
        // Table was too short, not valid
        result.push(...tableBuffer.map(escapeHtml));
        tableBuffer = [];
        inTable = false;
      }

      // Add current non-table line
      result.push(escapeHtml(line));
    }
  }

  // Handle any remaining table at end of text
  if (
    inTable &&
    tableBuffer.length >= 2 &&
    tableBuffer.some(isTableSeparator)
  ) {
    result.push(convertTableToHtml(tableBuffer));
  } else if (tableBuffer.length > 0) {
    result.push(...tableBuffer.map(escapeHtml));
  }

  let html = result.join('\n');

  // Headers
  html = html.replace(
    /^### (.+)$/gm,
    '<h3 style="font-size: 14px; font-weight: bold; color: #1e293b; margin: 16px 0 8px 0;">$1</h3>'
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h2 style="font-size: 16px; font-weight: bold; color: #1e293b; margin: 20px 0 10px 0;">$1</h2>'
  );
  html = html.replace(
    /^# (.+)$/gm,
    '<h1 style="font-size: 18px; font-weight: bold; color: #1e293b; margin: 24px 0 12px 0;">$1</h1>'
  );

  // Bold
  html = html.replace(
    /\*\*(.+?)\*\*/g,
    '<strong style="font-weight: 600;">$1</strong>'
  );

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em style="font-style: italic;">$1</em>');

  // Remove strikethrough markers (删除线文本在正式报告中应该移除，只保留文字)
  html = html.replace(/~~(.+?)~~/g, '$1');

  // Horizontal rule
  html = html.replace(
    /^---$/gm,
    '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 16px 0;">'
  );

  // Unordered lists
  html = html.replace(
    /^- (.+)$/gm,
    '<li style="margin: 4px 0; padding-left: 8px;">$1</li>'
  );
  html = html.replace(
    /(<li[^>]*>.*<\/li>\n?)+/g,
    '<ul style="margin: 8px 0; padding-left: 20px; list-style-type: disc;">$&</ul>'
  );

  // Ordered lists (simple)
  html = html.replace(
    /^\d+\. (.+)$/gm,
    '<li style="margin: 4px 0; padding-left: 8px;">$1</li>'
  );

  // Blockquotes
  html = html.replace(
    /^> (.+)$/gm,
    '<blockquote style="border-left: 3px solid #7c3aed; padding-left: 12px; margin: 8px 0; color: #64748b;">$1</blockquote>'
  );

  // Line breaks - convert double newlines to paragraphs (but not inside tables)
  html = html.replace(
    /\n\n(?![^<]*<\/table>)/g,
    '</p><p style="margin: 8px 0;">'
  );

  // Single line breaks (but not inside tables)
  html = html.replace(/\n(?![^<]*<\/table>)/g, '<br>');

  // Wrap in paragraph if not already wrapped
  if (
    !html.startsWith('<h') &&
    !html.startsWith('<ul') &&
    !html.startsWith('<ol') &&
    !html.startsWith('<blockquote') &&
    !html.startsWith('<table')
  ) {
    html = '<p style="margin: 8px 0;">' + html + '</p>';
  }

  return html;
}

/**
 * Generate page header HTML
 */
function generatePageHeader(
  title: string,
  taskId: string,
  currentPage: number,
  totalPages: number
): string {
  return `
    <div style="position: fixed; top: 0; left: 0; right: 0; height: 40px; background: white; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; padding: 0 40px; font-size: 10px; color: #64748b;">
      <span style="max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(title)}</span>
      <span style="font-family: monospace; font-size: 9px;">${escapeHtml(taskId.substring(0, 8))}</span>
    </div>
  `;
}

/**
 * Generate page footer HTML
 */
function generatePageFooter(
  currentPage: number,
  totalPages: number,
  generatedAt: string
): string {
  return `
    <div style="position: fixed; bottom: 0; left: 0; right: 0; height: 30px; background: white; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; padding: 0 40px; font-size: 10px; color: #94a3b8;">
      <span>${generatedAt}</span>
      <span>第 ${currentPage} 页 / 共 ${totalPages} 页</span>
    </div>
  `;
}

/**
 * Generate Table of Contents
 */
function generateTableOfContents(hasFinalResult: boolean): string {
  const sections = [
    { title: '执行摘要', page: 2 },
    { title: '目录', page: 3 },
    ...(hasFinalResult
      ? [
          { title: '研究背景与方法', page: 4 },
          { title: '核心发现与结论', page: 5 },
        ]
      : []),
    { title: '团队执行报告', page: hasFinalResult ? 6 : 4 },
    { title: '附录：任务执行明细', page: hasFinalResult ? 7 : 5 },
  ];

  return `
    <div style="width: 100%; padding: 40px; box-sizing: border-box; page-break-before: always;">
      <div style="font-size: 24px; font-weight: bold; color: #1f2937; margin-bottom: 30px; text-align: center;">
        目 录
      </div>
      <div style="max-width: 500px; margin: 0 auto;">
        ${sections
          .map(
            (s, i) => `
          <div style="display: flex; justify-content: space-between; align-items: baseline; padding: 12px 0; border-bottom: 1px dotted #e2e8f0;">
            <span style="font-size: 14px; color: #374151;">${i + 1}. ${s.title}</span>
            <span style="font-size: 14px; color: #7c3aed; font-weight: 500;">${s.page}</span>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `;
}

/**
 * Generate HTML with pure inline styles
 *
 * Report Structure (Improved):
 * 1. Cover Page (enhanced with key stats preview)
 * 2. Executive Summary (moved to page 2)
 * 3. Table of Contents
 * 4. Research Background & Methodology (split from "最终结论")
 * 5. Key Findings & Conclusions (split from "最终结论")
 * 6. Team Execution Report
 * 7. Appendix: Full Task Details (no truncation)
 */
export function generateReportHtml(data: MissionReportData): string {
  const stats = calculateStats(data);
  const completionRate =
    stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0;

  const sortedParticipants = Array.from(stats.participants.entries()).sort(
    (a, b) => b[1] - a[1]
  );
  const maxTasks = sortedParticipants[0]?.[1] || 1;

  const baseFont =
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;";

  const generatedAt = new Date().toLocaleString('zh-CN');
  const hasFinalResult = !!data.mission.finalResult;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Mission Report - ${escapeHtml(data.mission.title)}</title>
  <style>
    @page {
      margin: 50px 0;
    }
    @media print {
      .page-header { display: block !important; }
      .page-footer { display: block !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; ${baseFont} font-size: 12px; line-height: 1.6; color: #1f2937; background: #fff;">

  <!-- Cover Page -->
  <div style="width: 100%; min-height: 900px; box-sizing: border-box; position: relative;">
    <!-- Header Banner -->
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 60px 40px; text-align: center;">
      <div style="font-size: 36px; font-weight: bold; margin-bottom: 12px; letter-spacing: 2px;">AI Team Mission Report</div>
      <div style="font-size: 16px; color: #e9d5ff;">Powered by ${config.brand.fullName}</div>
    </div>

    <!-- Mission Title Box -->
    <div style="padding: 40px; text-align: center;">
      <div style="font-size: 24px; font-weight: bold; color: #1f2937; margin-bottom: 20px; line-height: 1.5;">${escapeHtml(data.mission.title)}</div>

      <!-- Key Stats Preview (NEW) -->
      <div style="display: flex; justify-content: center; gap: 20px; margin-bottom: 30px;">
        <div style="background: #dcfce7; border-radius: 12px; padding: 16px 24px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #166534;">${stats.completedTasks}/${stats.totalTasks}</div>
          <div style="font-size: 11px; color: #166534;">任务完成</div>
        </div>
        <div style="background: #dbeafe; border-radius: 12px; padding: 16px 24px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #1e40af;">${completionRate}%</div>
          <div style="font-size: 11px; color: #1e40af;">完成率</div>
        </div>
        <div style="background: #faf5ff; border-radius: 12px; padding: 16px 24px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #7c3aed;">${stats.durationMinutes}<span style="font-size: 14px;">分</span></div>
          <div style="font-size: 11px; color: #7c3aed;">执行时长</div>
        </div>
      </div>

      <!-- Info Card -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 30px; max-width: 500px; margin: 0 auto; text-align: left;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; color: #64748b; width: 100px; font-weight: 500;">任务ID</td>
            <td style="padding: 12px 0; color: #1e293b; font-family: monospace; font-size: 11px;">${escapeHtml(data.mission.id)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-weight: 500;">状态</td>
            <td style="padding: 12px 0;">${getStatusBadge(data.mission.status)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-weight: 500;">负责人</td>
            <td style="padding: 12px 0; color: #1e293b; font-weight: 600;">${escapeHtml(data.mission.leader)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-weight: 500;">创建时间</td>
            <td style="padding: 12px 0; color: #1e293b;">${formatDate(data.mission.createdAt)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-weight: 500;">完成时间</td>
            <td style="padding: 12px 0; color: #1e293b;">${data.mission.completedAt ? formatDate(data.mission.completedAt) : '—'}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Cover Footer -->
    <div style="position: absolute; bottom: 40px; left: 0; right: 0; text-align: center; color: #94a3b8; font-size: 11px;">
      报告生成时间: ${generatedAt}
    </div>
  </div>

  <!-- Page 2: Executive Summary (MOVED TO PAGE 2) -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; page-break-before: always;">
    <!-- Page Header -->
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>${escapeHtml(data.mission.title.substring(0, 50))}${data.mission.title.length > 50 ? '...' : ''}</span>
      <span>第 2 页</span>
    </div>

    <div style="font-size: 24px; font-weight: bold; color: #7c3aed; border-bottom: 4px solid #7c3aed; padding-bottom: 12px; margin-bottom: 30px;">
      执行摘要
    </div>

    <!-- Core Findings Highlight (NEW - 3-5 key points) -->
    <div style="background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); border-radius: 16px; padding: 24px; margin-bottom: 30px; border-left: 4px solid #7c3aed;">
      <div style="font-size: 14px; font-weight: bold; color: #7c3aed; margin-bottom: 12px;">核心要点</div>
      <ul style="margin: 0; padding-left: 20px; color: #374151; line-height: 2;">
        <li>共执行 <strong>${stats.totalTasks}</strong> 项子任务，完成率 <strong>${completionRate}%</strong></li>
        <li>AI团队 <strong>${stats.participantCount}</strong> 名成员协作，总耗时 <strong>${stats.durationMinutes}</strong> 分钟</li>
        <li>任务修订 <strong>${stats.totalRevisions}</strong> 次，平均每任务 <strong>${stats.avgRevisions.toFixed(1)}</strong> 次</li>
        ${stats.failedTasks > 0 ? `<li style="color: #dc2626;">有 <strong>${stats.failedTasks}</strong> 项任务执行失败，需关注</li>` : ''}
      </ul>
    </div>

    <!-- KPI Cards -->
    <table style="width: 100%; border-collapse: separate; border-spacing: 12px;">
      <tr>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center; width: 33%;">
          <div style="font-size: 32px; font-weight: bold; color: #7c3aed;">${stats.totalTasks}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">总任务数</div>
        </td>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center; width: 33%;">
          <div style="font-size: 32px; font-weight: bold; color: #22c55e;">${stats.completedTasks}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">已完成</div>
        </td>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center; width: 33%;">
          <div style="font-size: 32px; font-weight: bold; color: #6366f1;">${completionRate}%</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">完成率</div>
        </td>
      </tr>
      <tr>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center;">
          <div style="font-size: 32px; font-weight: bold; color: #7c3aed;">${stats.participantCount}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">AI成员</div>
        </td>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #6b7280;">${stats.durationMinutes}<span style="font-size: 14px;">分钟</span></div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">执行时长</div>
        </td>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center;">
          <div style="font-size: 32px; font-weight: bold; color: #f59e0b;">${stats.totalRevisions}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">修订次数</div>
        </td>
      </tr>
    </table>

    <!-- Task Description -->
    <div style="margin-top: 30px;">
      <div style="font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 12px;">任务描述</div>
      <div style="background: #f8fafc; border-radius: 8px; padding: 16px; color: #374151; line-height: 1.8;">
        ${escapeHtml(data.mission.description)}
      </div>
    </div>

    <!-- Page Footer -->
    <div style="margin-top: 40px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>报告生成: ${generatedAt}</span>
      <span>${config.brand.fullName}</span>
    </div>
  </div>

  <!-- Page 3: Table of Contents (NEW) -->
  ${generateTableOfContents(hasFinalResult)}

  ${
    hasFinalResult
      ? `
  <!-- Page 4: Research Background & Methodology (RENAMED from "最终结论") -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; page-break-before: always;">
    <!-- Page Header -->
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>${escapeHtml(data.mission.title.substring(0, 50))}${data.mission.title.length > 50 ? '...' : ''}</span>
      <span>第 4 页</span>
    </div>

    <div style="font-size: 24px; font-weight: bold; color: #1f2937; border-bottom: 4px solid #7c3aed; padding-bottom: 12px; margin-bottom: 30px;">
      研究背景与方法
    </div>

    <div style="background: #f8fafc; border-radius: 16px; padding: 30px; margin-bottom: 20px;">
      <div style="font-size: 16px; font-weight: bold; color: #374151; margin-bottom: 16px;">研究范围与数据来源</div>
      <div style="font-size: 13px; color: #64748b; line-height: 1.8;">
        本报告基于AI团队协作研究生成。研究数据来源于各子任务执行过程中收集的信息。
        任务执行周期为 ${formatDate(data.mission.createdAt)} 至 ${data.mission.completedAt ? formatDate(data.mission.completedAt) : '进行中'}。
      </div>
    </div>

    <div style="background: #f8fafc; border-radius: 16px; padding: 30px;">
      <div style="font-size: 16px; font-weight: bold; color: #374151; margin-bottom: 16px;">研究方法论</div>
      <div style="font-size: 13px; color: #64748b; line-height: 1.8;">
        采用AI团队分布式协作模式，由 ${escapeHtml(data.mission.leader)} 作为任务负责人统筹协调，
        ${stats.participantCount} 名AI成员分工执行 ${stats.totalTasks} 项子任务。
        任务执行过程中进行了 ${stats.totalRevisions} 次修订优化。
      </div>
    </div>

    <!-- Page Footer -->
    <div style="margin-top: 40px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>报告生成: ${generatedAt}</span>
      <span>${config.brand.fullName}</span>
    </div>
  </div>

  <!-- Page 5: Key Findings & Conclusions (SPLIT from "最终结论") -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; page-break-before: always;">
    <!-- Page Header -->
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>${escapeHtml(data.mission.title.substring(0, 50))}${data.mission.title.length > 50 ? '...' : ''}</span>
      <span>第 5 页</span>
    </div>

    <div style="font-size: 24px; font-weight: bold; color: #7c3aed; border-bottom: 4px solid #7c3aed; padding-bottom: 12px; margin-bottom: 30px;">
      核心发现与结论
    </div>

    <div style="background: #faf5ff; border: 2px solid #7c3aed; border-radius: 16px; padding: 30px;">
      <div style="font-size: 14px; color: #374151; line-height: 1.9;">
        ${markdownToHtml(data.mission.finalResult || '')}
      </div>
    </div>

    <!-- Page Footer -->
    <div style="margin-top: 40px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>报告生成: ${generatedAt}</span>
      <span>${config.brand.fullName}</span>
    </div>
  </div>
  `
      : `
  <!-- No Final Result - Show placeholder -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; page-break-before: always;">
    <!-- Page Header -->
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>${escapeHtml(data.mission.title.substring(0, 50))}${data.mission.title.length > 50 ? '...' : ''}</span>
      <span>第 4 页</span>
    </div>

    <div style="font-size: 24px; font-weight: bold; color: #1f2937; border-bottom: 4px solid #7c3aed; padding-bottom: 12px; margin-bottom: 30px;">
      核心发现与结论
    </div>

    <div style="background: #f8fafc; border-radius: 16px; padding: 40px; text-align: center;">
      <div style="font-size: 48px; margin-bottom: 16px;">📋</div>
      <div style="font-size: 16px; color: #64748b;">任务${data.mission.status === 'COMPLETED' ? '已完成' : '进行中'}，等待最终结论生成</div>
      <div style="font-size: 13px; color: #94a3b8; margin-top: 8px;">请查看下方任务详情了解当前进度</div>
    </div>

    <!-- Page Footer -->
    <div style="margin-top: 40px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>报告生成: ${generatedAt}</span>
      <span>${config.brand.fullName}</span>
    </div>
  </div>
  `
  }

  <!-- Team Execution Report -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; page-break-before: always;">
    <!-- Page Header -->
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>${escapeHtml(data.mission.title.substring(0, 50))}${data.mission.title.length > 50 ? '...' : ''}</span>
      <span>团队执行报告</span>
    </div>

    <div style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 3px solid #7c3aed; padding-bottom: 10px; margin-bottom: 30px;">
      团队执行报告
    </div>

    <!-- Status Distribution -->
    <div style="margin-bottom: 30px;">
      <div style="font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 12px;">任务状态分布</div>
      <table style="width: 100%; background: #f8fafc; border-radius: 8px; padding: 20px;">
        <tr>
          <td style="text-align: center; padding: 10px;">
            <div style="display: inline-block; width: 50px; height: ${Math.max(20, (stats.completedTasks / Math.max(stats.totalTasks, 1)) * 80)}px; background: #22c55e; border-radius: 4px 4px 0 0;"></div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px;">${stats.completedTasks}</div>
            <div style="font-size: 11px; color: #6b7280;">已完成</div>
          </td>
          <td style="text-align: center; padding: 10px;">
            <div style="display: inline-block; width: 50px; height: ${Math.max(20, (stats.inProgressTasks / Math.max(stats.totalTasks, 1)) * 80)}px; background: #3b82f6; border-radius: 4px 4px 0 0;"></div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px;">${stats.inProgressTasks}</div>
            <div style="font-size: 11px; color: #6b7280;">进行中</div>
          </td>
          <td style="text-align: center; padding: 10px;">
            <div style="display: inline-block; width: 50px; height: ${Math.max(20, (stats.pendingTasks / Math.max(stats.totalTasks, 1)) * 80)}px; background: #f59e0b; border-radius: 4px 4px 0 0;"></div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px;">${stats.pendingTasks}</div>
            <div style="font-size: 11px; color: #6b7280;">待处理</div>
          </td>
          <td style="text-align: center; padding: 10px;">
            <div style="display: inline-block; width: 50px; height: ${Math.max(20, (stats.failedTasks / Math.max(stats.totalTasks, 1)) * 80)}px; background: #ef4444; border-radius: 4px 4px 0 0;"></div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px;">${stats.failedTasks}</div>
            <div style="font-size: 11px; color: #6b7280;">失败</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Participants -->
    <div style="margin-top: 30px;">
      <div style="font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 16px;">AI成员贡献统计</div>
      <div style="background: #f8fafc; border-radius: 12px; padding: 20px;">
      ${sortedParticipants
        .map(
          ([name, count]) => `
        <div style="margin: 12px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-size: 12px; color: #374151; font-weight: 500;">${escapeHtml(name)}</span>
            <span style="font-size: 12px; color: #7c3aed; font-weight: 600;">${count} 个任务 (${Math.round((count / stats.totalTasks) * 100)}%)</span>
          </div>
          <div style="height: 8px; background: #e2e8f0; border-radius: 4px;">
            <div style="width: ${(count / maxTasks) * 100}%; height: 100%; background: linear-gradient(90deg, #7c3aed, #a78bfa); border-radius: 4px;"></div>
          </div>
        </div>
      `
        )
        .join('')}
      </div>
    </div>

    <!-- Page Footer -->
    <div style="margin-top: 40px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>报告生成: ${generatedAt}</span>
      <span>${config.brand.fullName}</span>
    </div>
  </div>

  <!-- Appendix: Task Execution Details (FULL CONTENT - NO TRUNCATION) -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; page-break-before: always;">
    <!-- Page Header -->
    <div style="border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-bottom: 20px; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>${escapeHtml(data.mission.title.substring(0, 50))}${data.mission.title.length > 50 ? '...' : ''}</span>
      <span>附录</span>
    </div>

    <div style="font-size: 18px; font-weight: bold; color: #64748b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px;">
      附录：任务执行明细
    </div>
    <div style="font-size: 12px; color: #94a3b8; margin-bottom: 20px;">以下为各子任务的完整执行记录</div>

    ${data.tasks
      .map(
        (task, index) => `
      <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #fafafa; page-break-inside: avoid;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="width: 70%; vertical-align: top;">
              <div style="font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 4px;">${index + 1}. ${escapeHtml(task.title)}</div>
              <div style="font-size: 11px; color: #6b7280;">执行: ${escapeHtml(task.assignedTo)} | 修订: ${task.revisionCount}次${task.completedAt ? ` | 完成: ${formatDate(task.completedAt)}` : ''}</div>
            </td>
            <td style="width: 30%; text-align: right; vertical-align: top;">
              ${getStatusBadge(task.status)}
            </td>
          </tr>
        </table>
        ${
          task.result
            ? `
          <div style="background: white; border-radius: 6px; padding: 12px; margin-top: 10px; font-size: 11px; color: #475569; line-height: 1.6; border: 1px solid #e2e8f0;">
            ${markdownToHtml(task.result)}
          </div>
        `
            : ''
        }
        ${
          task.leaderFeedback
            ? `
          <div style="background: #fef3c7; border-radius: 6px; padding: 10px; margin-top: 8px; font-size: 10px; color: #92400e; border-left: 3px solid #f59e0b;">
            <strong>负责人反馈:</strong> ${escapeHtml(task.leaderFeedback)}
          </div>
        `
            : ''
        }
      </div>
    `
      )
      .join('')}

    <!-- Page Footer -->
    <div style="margin-top: 40px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8;">
      <span>报告生成: ${generatedAt}</span>
      <span>${config.brand.fullName}</span>
    </div>
  </div>

  <!-- Final Footer -->
  <div style="text-align: center; padding: 30px; color: #9ca3af; font-size: 11px; border-top: 1px solid #e2e8f0;">
    <div style="margin-bottom: 8px;">— 报告结束 —</div>
    © ${new Date().getFullYear()} ${config.brand.fullName} - AI Team Mission Report
  </div>

</body>
</html>`;
}

/**
 * Generate body-only HTML content for PDF rendering
 */
function generateReportBodyHtml(data: MissionReportData): string {
  const stats = calculateStats(data);
  const completionRate =
    stats.totalTasks > 0
      ? Math.round((stats.completedTasks / stats.totalTasks) * 100)
      : 0;

  const sortedParticipants = Array.from(stats.participants.entries()).sort(
    (a, b) => b[1] - a[1]
  );
  const maxTasks = sortedParticipants[0]?.[1] || 1;

  const generatedAt = new Date().toLocaleString('zh-CN');
  const hasFinalResult = !!data.mission.finalResult;

  return `
  <!-- Cover Page -->
  <div style="width: 100%; min-height: 1100px; box-sizing: border-box; position: relative; background: white; page-break-after: always;">
    <!-- Header Banner -->
    <div style="background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: white; padding: 60px 40px; text-align: center;">
      <div style="font-size: 36px; font-weight: bold; margin-bottom: 12px; letter-spacing: 2px;">AI Team Mission Report</div>
      <div style="font-size: 16px; color: #e9d5ff;">Powered by ${config.brand.fullName}</div>
    </div>

    <!-- Mission Title Box -->
    <div style="padding: 40px; text-align: center;">
      <div style="font-size: 24px; font-weight: bold; color: #1f2937; margin-bottom: 20px; line-height: 1.5;">${escapeHtml(data.mission.title)}</div>

      <!-- Key Stats Preview -->
      <div style="display: flex; justify-content: center; gap: 20px; margin-bottom: 30px;">
        <div style="background: #dcfce7; border-radius: 12px; padding: 16px 24px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #166534;">${stats.completedTasks}/${stats.totalTasks}</div>
          <div style="font-size: 11px; color: #166534;">任务完成</div>
        </div>
        <div style="background: #dbeafe; border-radius: 12px; padding: 16px 24px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #1e40af;">${completionRate}%</div>
          <div style="font-size: 11px; color: #1e40af;">完成率</div>
        </div>
        <div style="background: #faf5ff; border-radius: 12px; padding: 16px 24px; text-align: center;">
          <div style="font-size: 28px; font-weight: bold; color: #7c3aed;">${stats.durationMinutes}<span style="font-size: 14px;">分</span></div>
          <div style="font-size: 11px; color: #7c3aed;">执行时长</div>
        </div>
      </div>

      <!-- Info Card -->
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 30px; max-width: 500px; margin: 0 auto; text-align: left;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 12px 0; color: #64748b; width: 100px; font-weight: 500;">任务ID</td>
            <td style="padding: 12px 0; color: #1e293b; font-family: monospace; font-size: 11px;">${escapeHtml(data.mission.id)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-weight: 500;">状态</td>
            <td style="padding: 12px 0;">${getStatusBadge(data.mission.status)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-weight: 500;">负责人</td>
            <td style="padding: 12px 0; color: #1e293b; font-weight: 600;">${escapeHtml(data.mission.leader)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-weight: 500;">创建时间</td>
            <td style="padding: 12px 0; color: #1e293b;">${formatDate(data.mission.createdAt)}</td>
          </tr>
          <tr>
            <td style="padding: 12px 0; color: #64748b; font-weight: 500;">完成时间</td>
            <td style="padding: 12px 0; color: #1e293b;">${data.mission.completedAt ? formatDate(data.mission.completedAt) : '—'}</td>
          </tr>
        </table>
      </div>
    </div>

    <!-- Cover Footer -->
    <div style="position: absolute; bottom: 40px; left: 0; right: 0; text-align: center; color: #94a3b8; font-size: 11px;">
      报告生成时间: ${generatedAt}
    </div>
  </div>

  <!-- Page 2: Executive Summary -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; background: white; page-break-after: always;">
    <div style="font-size: 24px; font-weight: bold; color: #7c3aed; border-bottom: 4px solid #7c3aed; padding-bottom: 12px; margin-bottom: 30px;">
      执行摘要
    </div>

    <!-- Core Findings Highlight -->
    <div style="background: linear-gradient(135deg, #faf5ff 0%, #f3e8ff 100%); border-radius: 16px; padding: 24px; margin-bottom: 30px; border-left: 4px solid #7c3aed;">
      <div style="font-size: 14px; font-weight: bold; color: #7c3aed; margin-bottom: 12px;">核心要点</div>
      <ul style="margin: 0; padding-left: 20px; color: #374151; line-height: 2;">
        <li>共执行 <strong>${stats.totalTasks}</strong> 项子任务，完成率 <strong>${completionRate}%</strong></li>
        <li>AI团队 <strong>${stats.participantCount}</strong> 名成员协作，总耗时 <strong>${stats.durationMinutes}</strong> 分钟</li>
        <li>任务修订 <strong>${stats.totalRevisions}</strong> 次，平均每任务 <strong>${stats.avgRevisions.toFixed(1)}</strong> 次</li>
        ${stats.failedTasks > 0 ? `<li style="color: #dc2626;">有 <strong>${stats.failedTasks}</strong> 项任务执行失败，需关注</li>` : ''}
      </ul>
    </div>

    <!-- KPI Cards -->
    <table style="width: 100%; border-collapse: separate; border-spacing: 12px;">
      <tr>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center; width: 33%;">
          <div style="font-size: 32px; font-weight: bold; color: #7c3aed;">${stats.totalTasks}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">总任务数</div>
        </td>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center; width: 33%;">
          <div style="font-size: 32px; font-weight: bold; color: #22c55e;">${stats.completedTasks}</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">已完成</div>
        </td>
        <td style="background: #f8fafc; border-radius: 10px; padding: 20px; text-align: center; width: 33%;">
          <div style="font-size: 32px; font-weight: bold; color: #6366f1;">${completionRate}%</div>
          <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">完成率</div>
        </td>
      </tr>
    </table>

    <!-- Task Description -->
    <div style="margin-top: 30px;">
      <div style="font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 12px;">任务描述</div>
      <div style="background: #f8fafc; border-radius: 8px; padding: 16px; color: #374151; line-height: 1.8;">
        ${escapeHtml(data.mission.description)}
      </div>
    </div>
  </div>

  ${
    hasFinalResult
      ? `
  <!-- Key Findings & Conclusions -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; background: white; page-break-after: always;">
    <div style="font-size: 24px; font-weight: bold; color: #7c3aed; border-bottom: 4px solid #7c3aed; padding-bottom: 12px; margin-bottom: 30px;">
      核心发现与结论
    </div>

    <div style="background: #faf5ff; border: 2px solid #7c3aed; border-radius: 16px; padding: 30px;">
      <div style="font-size: 14px; color: #374151; line-height: 1.9;">
        ${markdownToHtml(data.mission.finalResult || '')}
      </div>
    </div>
  </div>
  `
      : ''
  }

  <!-- Team Execution Report -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; background: white; page-break-after: always;">
    <div style="font-size: 20px; font-weight: bold; color: #1f2937; border-bottom: 3px solid #7c3aed; padding-bottom: 10px; margin-bottom: 30px;">
      团队执行报告
    </div>

    <!-- Status Distribution -->
    <div style="margin-bottom: 30px;">
      <div style="font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 12px;">任务状态分布</div>
      <table style="width: 100%; background: #f8fafc; border-radius: 8px; padding: 20px;">
        <tr>
          <td style="text-align: center; padding: 10px;">
            <div style="display: inline-block; width: 50px; height: ${Math.max(20, (stats.completedTasks / Math.max(stats.totalTasks, 1)) * 80)}px; background: #22c55e; border-radius: 4px 4px 0 0;"></div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px;">${stats.completedTasks}</div>
            <div style="font-size: 11px; color: #6b7280;">已完成</div>
          </td>
          <td style="text-align: center; padding: 10px;">
            <div style="display: inline-block; width: 50px; height: ${Math.max(20, (stats.inProgressTasks / Math.max(stats.totalTasks, 1)) * 80)}px; background: #3b82f6; border-radius: 4px 4px 0 0;"></div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px;">${stats.inProgressTasks}</div>
            <div style="font-size: 11px; color: #6b7280;">进行中</div>
          </td>
          <td style="text-align: center; padding: 10px;">
            <div style="display: inline-block; width: 50px; height: ${Math.max(20, (stats.pendingTasks / Math.max(stats.totalTasks, 1)) * 80)}px; background: #f59e0b; border-radius: 4px 4px 0 0;"></div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px;">${stats.pendingTasks}</div>
            <div style="font-size: 11px; color: #6b7280;">待处理</div>
          </td>
          <td style="text-align: center; padding: 10px;">
            <div style="display: inline-block; width: 50px; height: ${Math.max(20, (stats.failedTasks / Math.max(stats.totalTasks, 1)) * 80)}px; background: #ef4444; border-radius: 4px 4px 0 0;"></div>
            <div style="font-size: 14px; font-weight: bold; margin-top: 8px;">${stats.failedTasks}</div>
            <div style="font-size: 11px; color: #6b7280;">失败</div>
          </td>
        </tr>
      </table>
    </div>

    <!-- Participants -->
    <div style="margin-top: 30px;">
      <div style="font-size: 16px; font-weight: bold; color: #1f2937; margin-bottom: 16px;">AI成员贡献统计</div>
      <div style="background: #f8fafc; border-radius: 12px; padding: 20px;">
      ${sortedParticipants
        .map(
          ([name, count]) => `
        <div style="margin: 12px 0;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
            <span style="font-size: 12px; color: #374151; font-weight: 500;">${escapeHtml(name)}</span>
            <span style="font-size: 12px; color: #7c3aed; font-weight: 600;">${count} 个任务 (${Math.round((count / stats.totalTasks) * 100)}%)</span>
          </div>
          <div style="height: 8px; background: #e2e8f0; border-radius: 4px;">
            <div style="width: ${(count / maxTasks) * 100}%; height: 100%; background: linear-gradient(90deg, #7c3aed, #a78bfa); border-radius: 4px;"></div>
          </div>
        </div>
      `
        )
        .join('')}
      </div>
    </div>
  </div>

  <!-- Appendix: Task Execution Details -->
  <div style="width: 100%; padding: 40px; box-sizing: border-box; background: white;">
    <div style="font-size: 18px; font-weight: bold; color: #64748b; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; margin-bottom: 20px;">
      附录：任务执行明细
    </div>
    <div style="font-size: 12px; color: #94a3b8; margin-bottom: 20px;">以下为各子任务的完整执行记录</div>

    ${data.tasks
      .map(
        (task, index) => `
      <div style="border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; background: #fafafa; page-break-inside: avoid;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="width: 70%; vertical-align: top;">
              <div style="font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 4px;">${index + 1}. ${escapeHtml(task.title)}</div>
              <div style="font-size: 11px; color: #6b7280;">执行: ${escapeHtml(task.assignedTo)} | 修订: ${task.revisionCount}次${task.completedAt ? ` | 完成: ${formatDate(task.completedAt)}` : ''}</div>
            </td>
            <td style="width: 30%; text-align: right; vertical-align: top;">
              ${getStatusBadge(task.status)}
            </td>
          </tr>
        </table>
        ${
          task.result
            ? `
          <div style="background: white; border-radius: 6px; padding: 12px; margin-top: 10px; font-size: 11px; color: #475569; line-height: 1.6; border: 1px solid #e2e8f0;">
            ${markdownToHtml(task.result)}
          </div>
        `
            : ''
        }
        ${
          task.leaderFeedback
            ? `
          <div style="background: #fef3c7; border-radius: 6px; padding: 10px; margin-top: 8px; font-size: 10px; color: #92400e; border-left: 3px solid #f59e0b;">
            <strong>负责人反馈:</strong> ${escapeHtml(task.leaderFeedback)}
          </div>
        `
            : ''
        }
      </div>
    `
      )
      .join('')}

    <!-- Final Footer -->
    <div style="text-align: center; padding: 30px; color: #9ca3af; font-size: 11px; border-top: 1px solid #e2e8f0; margin-top: 40px;">
      <div style="margin-bottom: 8px;">— 报告结束 —</div>
      © ${new Date().getFullYear()} ${config.brand.fullName} - AI Team Mission Report
    </div>
  </div>
`;
}

/**
 * Generate and download mission report PDF
 * Uses browser's native print dialog for high-quality PDF output
 */
export async function downloadMissionReportPDF(
  data: MissionReportData,
  filename?: string,
  debug?: boolean
): Promise<void> {
  // Browser print is the most reliable method for high-quality PDF
  const printWindow = window.open('', '_blank', 'width=900,height=700');
  if (!printWindow) {
    toast.warning('请允许弹出窗口以导出PDF');
    return;
  }

  // Add print instructions and button to the HTML
  const fullHtml = generateReportHtml(data);
  const htmlWithPrintButton = fullHtml.replace(
    '</body>',
    `
    <div id="print-toolbar" style="position: fixed; top: 0; left: 0; right: 0; background: linear-gradient(135deg, #7c3aed, #5b21b6); color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; z-index: 99999; box-shadow: 0 2px 10px rgba(0,0,0,0.2);">
      <span style="font-size: 14px;">报告预览已加载完成，点击右侧按钮导出PDF</span>
      <button onclick="document.getElementById('print-toolbar').style.display='none'; window.print();" style="background: white; color: #7c3aed; border: none; padding: 8px 20px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 14px;">
        导出 PDF
      </button>
    </div>
    <div style="height: 50px;"></div>
    <style>
      @media print {
        #print-toolbar { display: none !important; }
        body { padding-top: 0 !important; }
      }
    </style>
    </body>`
  );

  printWindow.document.write(htmlWithPrintButton);
  printWindow.document.close();

  // Don't auto-trigger print - let user click the button when ready
}

/**
 * Preview mission report in a new window
 */
export function previewMissionReport(data: MissionReportData): Window | null {
  const html = generateReportHtml(data);
  const previewWindow = window.open('', '_blank');
  if (previewWindow) {
    previewWindow.document.write(html);
    previewWindow.document.close();
  }
  return previewWindow;
}

/**
 * Download report as HTML file (fallback when PDF fails)
 */
export function downloadMissionReportHTML(
  data: MissionReportData,
  filename?: string
): void {
  const html = generateReportHtml(data);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `mission-report-${data.mission.id}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
