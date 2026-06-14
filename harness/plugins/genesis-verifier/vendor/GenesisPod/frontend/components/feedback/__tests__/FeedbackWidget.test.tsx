/// <reference types="@testing-library/jest-dom" />

/**
 * FeedbackWidget unit tests
 *
 * Covers:
 *  - clicking floating button triggers html2canvas (mocked) → modal opens with screenshot preview
 *  - submit builds FormData with url = current page (captured before screenshot) + screenshot file
 *  - html2canvas throwing → modal still opens (degrades to manual upload) + does not crash,
 *    shows screenshotFailed message
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// ── html2canvas mock (dynamic import target) ──────────────────────────────────
const mockHtml2canvas = vi.fn();
vi.mock('html2canvas', () => ({
  default: (...a: unknown[]) => mockHtml2canvas(...a),
}));

import { FeedbackWidget } from '../FeedbackWidget';

const PROBLEM_PATH = '/the-broken-page';
let problemUrl = '';

function makeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // jsdom canvas.toBlob is not implemented → stub it
  (canvas as unknown as { toBlob: HTMLCanvasElement['toBlob'] }).toBlob = (
    cb: BlobCallback
  ) => cb(new Blob(['png'], { type: 'image/png' }));
  return canvas;
}

beforeEach(() => {
  mockHtml2canvas.mockReset();
  // stable object URL + current page url
  global.URL.createObjectURL = vi.fn(() => 'blob:preview');
  global.URL.revokeObjectURL = vi.fn();
  // jsdom 不允许重定义 window.location（non-configurable），改用 history API 切到出问题的页面
  window.history.replaceState(null, '', PROBLEM_PATH);
  problemUrl = window.location.href;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FeedbackWidget', () => {
  it('captures screenshot and opens modal with preview on button click', async () => {
    mockHtml2canvas.mockResolvedValue(makeCanvas());
    render(<FeedbackWidget />);

    fireEvent.click(screen.getByLabelText('反馈与截图'));

    await waitFor(() => {
      expect(mockHtml2canvas).toHaveBeenCalledWith(
        document.body,
        expect.any(Object)
      );
    });
    // modal open with preview image
    await screen.findByRole('dialog');
    const img = await screen.findByAltText('当前页面截图');
    expect(img).toHaveAttribute('src', 'blob:preview');
  });

  it('submits FormData with url=current page + screenshot file', async () => {
    mockHtml2canvas.mockResolvedValue(makeCanvas());

    let captured: FormData | undefined;
    global.fetch = vi.fn(async (_u, init) => {
      captured = init?.body as FormData;
      return {
        ok: true,
        json: async () => ({ success: true, data: { feedbackId: 'fb-9' } }),
      } as Response;
    }) as unknown as typeof fetch;

    render(<FeedbackWidget />);
    fireEvent.click(screen.getByLabelText('反馈与截图'));
    await screen.findByRole('dialog');

    fireEvent.change(screen.getByLabelText('标题'), {
      target: { value: 'Broken button' },
    });
    fireEvent.change(screen.getByLabelText('描述'), {
      target: { value: 'It does nothing' },
    });

    fireEvent.click(screen.getByText('提交反馈'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(captured?.get('url')).toBe(problemUrl);
    expect(captured?.get('title')).toBe('Broken button');
    // screenshot file present
    const files = captured?.getAll('files') as File[];
    expect(files).toHaveLength(1);
    expect(files[0].type).toBe('image/png');
  });

  it('degrades gracefully when html2canvas throws: modal opens, no crash', async () => {
    mockHtml2canvas.mockRejectedValue(new Error('tainted canvas / CSP'));
    render(<FeedbackWidget />);

    fireEvent.click(screen.getByLabelText('反馈与截图'));

    // modal still opens despite capture failure
    await screen.findByRole('dialog');
    // failure message shown, manual upload still possible
    expect(
      screen.getByText('截图失败，您可以手动上传附件。')
    ).toBeInTheDocument();
    expect(screen.getByText('追加附件')).toBeInTheDocument();
  });
});
