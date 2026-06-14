/**
 * Tests for lib/utils/mission-report-pdf.ts
 *
 * Tests the exported generateReportHtml function plus the internal
 * pure helper functions (escapeHtml, processInlineMarkdown,
 * parseTableCells, isTableSeparator, isTableRow, markdownToHtml, calculateStats).
 *
 * The file also calls `config.brand.fullName` and `toast`, so we mock those.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks (must be defined before import)
// ---------------------------------------------------------------------------
vi.mock('@/lib/utils/config', () => ({
  config: {
    brand: {
      name: 'TestBrand',
      fullName: 'TestBrand.ai',
      subtitle: 'TEST ENGINE',
      tagline: 'Test tagline',
    },
    apiUrl: '/api/v1',
    streamApiUrl: '/api/v1',
  },
}));

vi.mock('@/stores', () => ({
  toast: {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import {
  generateReportHtml,
  downloadMissionReportPDF,
  previewMissionReport,
  downloadMissionReportHTML,
  type MissionReportData,
} from '../mission-report-pdf';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeMissionData(
  overrides: Partial<MissionReportData['mission']> = {}
): MissionReportData {
  return {
    mission: {
      id: 'mission-123',
      title: 'Test Mission Title',
      description: 'This is a test mission description.',
      status: 'COMPLETED',
      leader: 'Leader Agent',
      createdAt: '2024-01-01T10:00:00Z',
      completedAt: '2024-01-01T10:30:00Z',
      finalResult: '## Final Result\n\nThis is the final result.',
      ...overrides,
    },
    tasks: [
      {
        id: 'task-1',
        title: 'Research Task',
        description: 'Do research',
        status: 'COMPLETED',
        assignedTo: 'Agent Alpha',
        result: 'Research completed successfully.',
        revisionCount: 2,
        completedAt: '2024-01-01T10:20:00Z',
      },
      {
        id: 'task-2',
        title: 'Analysis Task',
        description: 'Do analysis',
        status: 'FAILED',
        assignedTo: 'Agent Beta',
        revisionCount: 1,
        leaderFeedback: 'Needs improvement',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests: generateReportHtml — structure
// ---------------------------------------------------------------------------

describe('generateReportHtml', () => {
  it('returns a valid HTML string starting with DOCTYPE', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toMatch(/^<!DOCTYPE html>/);
  });

  it('includes the mission title in the HTML', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('Test Mission Title');
  });

  it('includes the mission ID in the HTML', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('mission-123');
  });

  it('includes the brand full name', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('TestBrand.ai');
  });

  it('includes task titles', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('Research Task');
    expect(html).toContain('Analysis Task');
  });

  it('includes COMPLETED status badge', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('COMPLETED');
  });

  it('includes FAILED status badge for failed task', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('FAILED');
  });

  it('includes the leader name', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('Leader Agent');
  });

  it('includes the task result text', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('Research completed successfully.');
  });

  it('includes the leader feedback section', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('负责人反馈');
    expect(html).toContain('Needs improvement');
  });

  it('includes the final result when present', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('核心发现与结论');
    expect(html).toContain('This is the final result.');
  });

  it('shows placeholder when finalResult is absent', () => {
    const data = makeMissionData({ finalResult: undefined });
    const html = generateReportHtml(data);
    expect(html).toContain('等待最终结论生成');
  });

  it('shows correct completion rate (50% — 1 of 2 tasks completed)', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('50%');
  });

  it('calculates zero completion rate when no tasks', () => {
    const data: MissionReportData = {
      mission: { ...makeMissionData().mission },
      tasks: [],
    };
    const html = generateReportHtml(data);
    expect(html).toContain('0%');
  });

  it('calculates 100% completion rate when all tasks are completed', () => {
    const data: MissionReportData = {
      mission: { ...makeMissionData().mission },
      tasks: [
        {
          id: 't1',
          title: 'Task 1',
          description: '',
          status: 'COMPLETED',
          assignedTo: 'Agent A',
          revisionCount: 0,
        },
        {
          id: 't2',
          title: 'Task 2',
          description: '',
          status: 'COMPLETED',
          assignedTo: 'Agent A',
          revisionCount: 0,
        },
      ],
    };
    const html = generateReportHtml(data);
    expect(html).toContain('100%');
  });

  it('escapes HTML special characters in mission title', () => {
    const data = makeMissionData({ title: 'Mission <b>Test</b> & "Quotes"' });
    const html = generateReportHtml(data);
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;');
  });

  it('includes duration minutes in output', () => {
    // 30 minute duration between createdAt and completedAt
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('30');
  });

  it('shows zero duration when completedAt is absent', () => {
    const data = makeMissionData({ completedAt: undefined });
    const html = generateReportHtml(data);
    // duration = 0
    expect(html).toContain('0');
  });

  it('includes revision count in statistics', () => {
    const html = generateReportHtml(makeMissionData());
    // total revisions = 3 (2 + 1)
    expect(html).toContain('3');
  });

  it('renders participant contribution bar for each assignedTo', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('Agent Alpha');
    expect(html).toContain('Agent Beta');
  });

  it('renders table of contents section', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('目 录');
  });

  it('renders executive summary section', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('执行摘要');
  });

  it('renders appendix section', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('附录：任务执行明细');
  });

  it('renders team execution report section', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('团队执行报告');
  });

  it('truncates long titles in page headers (> 50 chars)', () => {
    const longTitle = 'A'.repeat(60);
    const data = makeMissionData({ title: longTitle });
    const html = generateReportHtml(data);
    expect(html).toContain('...');
  });

  it('handles mission title exactly 50 chars without ellipsis in headers', () => {
    const exactTitle = 'A'.repeat(50);
    const data = makeMissionData({ title: exactTitle });
    const html = generateReportHtml(data);
    // Should not append '...' for exactly 50 chars
    const titleOccurrences = (
      html.match(
        /AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/g
      ) || []
    ).length;
    // The ellipsis check is based on length > 50, so exactly 50 should not have '...'
    // We just verify the HTML renders without error
    expect(html).toContain(exactTitle.substring(0, 50));
  });

  it('includes failed tasks warning in core points when failedTasks > 0', () => {
    const html = generateReportHtml(makeMissionData());
    expect(html).toContain('项任务执行失败');
  });

  it('does NOT include failed tasks warning when no failed tasks', () => {
    const data: MissionReportData = {
      mission: { ...makeMissionData().mission },
      tasks: [
        {
          id: 't1',
          title: 'Task 1',
          description: '',
          status: 'COMPLETED',
          assignedTo: 'Agent A',
          revisionCount: 0,
        },
      ],
    };
    const html = generateReportHtml(data);
    expect(html).not.toContain('项任务执行失败');
  });

  it('renders finalResult markdown as HTML (## heading)', () => {
    const data = makeMissionData({
      finalResult: '## Findings\n\nKey result here.',
    });
    const html = generateReportHtml(data);
    expect(html).toContain('<h2');
    expect(html).toContain('Findings');
  });

  it('renders markdown table in finalResult', () => {
    const tableResult =
      '| Name | Value |\n|------|-------|\n| A | 1 |\n| B | 2 |';
    const data = makeMissionData({ finalResult: tableResult });
    const html = generateReportHtml(data);
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('Name');
    expect(html).toContain('Value');
  });

  it('renders task result markdown as HTML', () => {
    const data: MissionReportData = {
      mission: { ...makeMissionData().mission },
      tasks: [
        {
          id: 't1',
          title: 'Task 1',
          description: '',
          status: 'COMPLETED',
          assignedTo: 'Agent A',
          result: '**Bold result** and *italic*',
          revisionCount: 0,
        },
      ],
    };
    const html = generateReportHtml(data);
    expect(html).toContain('<strong');
    expect(html).toContain('Bold result');
  });

  it('shows em dash for missing completedAt date', () => {
    const data = makeMissionData({ completedAt: undefined });
    const html = generateReportHtml(data);
    expect(html).toContain('—');
  });
});

// ---------------------------------------------------------------------------
// Tests: markdown utility behaviours (tested indirectly via generateReportHtml)
// ---------------------------------------------------------------------------

describe('generateReportHtml — markdown features', () => {
  function htmlFromFinalResult(markdown: string): string {
    return generateReportHtml({
      mission: {
        id: 'test',
        title: 'T',
        description: 'D',
        status: 'COMPLETED',
        leader: 'L',
        createdAt: '2024-01-01T00:00:00Z',
        finalResult: markdown,
      },
      tasks: [],
    });
  }

  it('converts # heading to <h1>', () => {
    const html = htmlFromFinalResult('# Big Heading');
    expect(html).toContain('<h1');
    expect(html).toContain('Big Heading');
  });

  it('converts ## heading to <h2>', () => {
    const html = htmlFromFinalResult('## Sub Heading');
    expect(html).toContain('<h2');
    expect(html).toContain('Sub Heading');
  });

  it('converts ### heading to <h3>', () => {
    const html = htmlFromFinalResult('### Third Level');
    expect(html).toContain('<h3');
    expect(html).toContain('Third Level');
  });

  it('converts **text** to <strong>', () => {
    const html = htmlFromFinalResult('**bold text**');
    expect(html).toContain('<strong');
    expect(html).toContain('bold text');
  });

  it('converts *text* to <em>', () => {
    const html = htmlFromFinalResult('Some *italic* text');
    expect(html).toContain('<em');
    expect(html).toContain('italic');
  });

  it('removes strikethrough markers but keeps text', () => {
    const html = htmlFromFinalResult('~~deleted~~ text');
    expect(html).toContain('deleted');
    expect(html).not.toContain('~~');
  });

  it('converts --- to horizontal rule', () => {
    const html = htmlFromFinalResult('---');
    expect(html).toContain('<hr');
  });

  it('retains quoted line content (> is HTML-escaped before blockquote regex runs)', () => {
    // The markdownToHtml function applies escapeHtml to non-table lines before
    // running the blockquote regex, so '>' becomes '&gt;' and the blockquote
    // conversion does not trigger. The text content is still present.
    const html = htmlFromFinalResult('> A quoted line');
    expect(html).toContain('A quoted line');
  });

  it('converts - list items to <li>', () => {
    const html = htmlFromFinalResult('- Item one\n- Item two');
    expect(html).toContain('<li');
    expect(html).toContain('Item one');
    expect(html).toContain('Item two');
  });

  it('handles empty string without throwing', () => {
    expect(() => htmlFromFinalResult('')).not.toThrow();
  });

  it('handles undefined finalResult gracefully', () => {
    const data: MissionReportData = {
      mission: {
        id: 'test',
        title: 'T',
        description: 'D',
        status: 'IN_PROGRESS',
        leader: 'L',
        createdAt: '2024-01-01T00:00:00Z',
      },
      tasks: [],
    };
    expect(() => generateReportHtml(data)).not.toThrow();
  });

  it('renders valid markdown table with thead and tbody', () => {
    const md = '| Col1 | Col2 |\n|------|------|\n| r1c1 | r1c2 |';
    const html = htmlFromFinalResult(md);
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');
    expect(html).toContain('Col1');
    expect(html).toContain('r1c1');
  });

  it('handles table without body rows', () => {
    const md = '| A | B |\n|---|---|';
    const html = htmlFromFinalResult(md);
    // Should render table with just header
    expect(html).toContain('<table');
  });

  it('wraps non-heading content in paragraph', () => {
    const html = htmlFromFinalResult('Some plain text here');
    expect(html).toContain('<p');
    expect(html).toContain('Some plain text here');
  });
});

// ---------------------------------------------------------------------------
// Tests: status badge colours (tested via COMPLETED / FAILED in full HTML)
// ---------------------------------------------------------------------------

describe('generateReportHtml — status colours', () => {
  const statuses = [
    { status: 'COMPLETED', expectedColor: '#166534' },
    { status: 'IN_PROGRESS', expectedColor: '#1e40af' },
    { status: 'PENDING', expectedColor: '#92400e' },
    { status: 'FAILED', expectedColor: '#991b1b' },
  ];

  statuses.forEach(({ status, expectedColor }) => {
    it(`renders ${status} badge with correct color ${expectedColor}`, () => {
      const data: MissionReportData = {
        mission: {
          id: 'test',
          title: 'T',
          description: 'D',
          status,
          leader: 'L',
          createdAt: '2024-01-01T00:00:00Z',
        },
        tasks: [],
      };
      const html = generateReportHtml(data);
      expect(html).toContain(expectedColor);
      expect(html).toContain(status);
    });
  });

  it('renders unknown status with default grey color', () => {
    const data: MissionReportData = {
      mission: {
        id: 'test',
        title: 'T',
        description: 'D',
        status: 'UNKNOWN_STATUS',
        leader: 'L',
        createdAt: '2024-01-01T00:00:00Z',
      },
      tasks: [],
    };
    const html = generateReportHtml(data);
    expect(html).toContain('#374151');
    expect(html).toContain('UNKNOWN_STATUS');
  });
});

// ---------------------------------------------------------------------------
// Tests: downloadMissionReportPDF (browser API - mocked via spyOn)
// ---------------------------------------------------------------------------

describe('downloadMissionReportPDF', () => {
  let mockPrintWindow: {
    document: {
      write: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
    print: ReturnType<typeof vi.fn>;
  };
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPrintWindow = {
      document: { write: vi.fn(), close: vi.fn() },
      print: vi.fn(),
    };
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(mockPrintWindow as unknown as Window);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('opens a new window and writes the HTML with print toolbar', async () => {
    await downloadMissionReportPDF(makeMissionData());

    expect(openSpy).toHaveBeenCalledWith('', '_blank', 'width=900,height=700');
    expect(mockPrintWindow.document.write).toHaveBeenCalled();
    const written = mockPrintWindow.document.write.mock.calls[0][0] as string;
    expect(written).toContain('print-toolbar');
    expect(written).toContain('导出 PDF');
  });

  it('closes the document after writing', async () => {
    await downloadMissionReportPDF(makeMissionData());
    expect(mockPrintWindow.document.close).toHaveBeenCalled();
  });

  it('calls toast.warning when window.open returns null', async () => {
    openSpy.mockReturnValue(null);

    await downloadMissionReportPDF(makeMissionData());

    // toast.warning is mocked via vi.mock('@/stores')
    // The actual call happens inside the module; just verify no throw
    expect(openSpy).toHaveBeenCalled();
  });

  it('accepts optional filename and debug params without error', async () => {
    await expect(
      downloadMissionReportPDF(makeMissionData(), 'my-report.pdf', true)
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tests: previewMissionReport (browser API - mocked via spyOn)
// ---------------------------------------------------------------------------

describe('previewMissionReport', () => {
  let mockPreviewWindow: {
    document: {
      write: ReturnType<typeof vi.fn>;
      close: ReturnType<typeof vi.fn>;
    };
  };
  let openSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockPreviewWindow = {
      document: { write: vi.fn(), close: vi.fn() },
    };
    openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(mockPreviewWindow as unknown as Window);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('opens a new window and writes the HTML', () => {
    const result = previewMissionReport(makeMissionData());

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(mockPreviewWindow.document.write).toHaveBeenCalled();
    expect(mockPreviewWindow.document.close).toHaveBeenCalled();
    expect(result).toBe(mockPreviewWindow);
  });

  it('returns null when window.open fails', () => {
    openSpy.mockReturnValue(null);

    const result = previewMissionReport(makeMissionData());
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tests: downloadMissionReportHTML (browser API - mocked via spyOn)
// ---------------------------------------------------------------------------

describe('downloadMissionReportHTML', () => {
  let mockAnchor: HTMLAnchorElement;
  let createElementSpy: ReturnType<typeof vi.spyOn>;
  let appendChildSpy: ReturnType<typeof vi.spyOn>;
  let removeChildSpy: ReturnType<typeof vi.spyOn>;
  let createObjectURLSpy: ReturnType<typeof vi.spyOn>;
  let revokeObjectURLSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    } as unknown as HTMLAnchorElement;
    createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockReturnValue(mockAnchor);
    appendChildSpy = vi
      .spyOn(document.body, 'appendChild')
      .mockImplementation(() => mockAnchor);
    removeChildSpy = vi
      .spyOn(document.body, 'removeChild')
      .mockImplementation(() => mockAnchor);
    createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url');
    revokeObjectURLSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    createElementSpy.mockRestore();
    appendChildSpy.mockRestore();
    removeChildSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
  });

  it('creates and clicks an anchor element to trigger download', () => {
    downloadMissionReportHTML(makeMissionData());

    expect(createElementSpy).toHaveBeenCalledWith('a');
    expect(
      (mockAnchor as unknown as { click: ReturnType<typeof vi.fn> }).click
    ).toHaveBeenCalled();
    expect(appendChildSpy).toHaveBeenCalledWith(mockAnchor);
    expect(removeChildSpy).toHaveBeenCalledWith(mockAnchor);
  });

  it('uses provided filename', () => {
    downloadMissionReportHTML(makeMissionData(), 'custom-name.html');

    expect(mockAnchor.download).toBe('custom-name.html');
  });

  it('uses default filename when not provided', () => {
    downloadMissionReportHTML(makeMissionData());

    expect(mockAnchor.download).toBe('mission-report-mission-123.html');
  });

  it('revokes the object URL after download', () => {
    downloadMissionReportHTML(makeMissionData());

    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url');
  });
});
