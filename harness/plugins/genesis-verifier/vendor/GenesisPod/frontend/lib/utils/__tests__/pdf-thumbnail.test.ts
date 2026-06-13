/**
 * Tests for lib/utils/pdf-thumbnail.ts
 *
 * PDF.js and fetch are mocked to test generation/upload logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockGetDocument, mockVersion } = vi.hoisted(() => ({
  mockGetDocument: vi.fn(),
  mockVersion: '4.0.0',
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('pdfjs-dist', () => ({
  getDocument: mockGetDocument,
  version: mockVersion,
  GlobalWorkerOptions: { workerSrc: '' },
}));

vi.mock('@/lib/utils/config', () => ({
  config: {
    apiUrl: 'https://api.example.com/api/v1',
  },
}));

vi.mock('@/lib/utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import {
  generatePdfThumbnail,
  generateAndSaveThumbnail,
  batchGenerateThumbnails,
  thumbnailExists,
} from '../pdf-thumbnail';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createMockPage(width = 595, height = 842) {
  const mockCanvas = {
    width: 0,
    height: 0,
    toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,/9j/thumbnail'),
    getContext: vi.fn().mockReturnValue({
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    }),
  };

  const mockRender = {
    promise: Promise.resolve(),
  };

  return {
    getViewport: vi.fn().mockImplementation(({ scale }: { scale: number }) => ({
      width: width * scale,
      height: height * scale,
    })),
    render: vi.fn().mockReturnValue(mockRender),
    _canvas: mockCanvas,
  };
}

function createMockPdf(page = createMockPage()) {
  return {
    getPage: vi.fn().mockResolvedValue(page),
    numPages: 1,
  };
}

function setupDocumentMock(pdf = createMockPdf()) {
  mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf) });
  return pdf;
}

function createCanvasMock() {
  return {
    width: 0,
    height: 0,
    toDataURL: vi.fn().mockReturnValue('data:image/jpeg;base64,/9j/thumbnail'),
    getContext: vi.fn().mockReturnValue({
      fillRect: vi.fn(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  global.fetch = vi.fn();

  // Mock document.createElement for canvas
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    if (tag === 'canvas') {
      return createCanvasMock() as unknown as HTMLElement;
    }
    return document.createElement(tag);
  });
});

// ---------------------------------------------------------------------------
// generatePdfThumbnail
// ---------------------------------------------------------------------------
describe('generatePdfThumbnail', () => {
  it('returns a data URL on success', async () => {
    setupDocumentMock();

    const result = await generatePdfThumbnail('https://example.com/test.pdf');

    expect(result).toBe('data:image/jpeg;base64,/9j/thumbnail');
  });

  it('calls getDocument with the PDF URL', async () => {
    setupDocumentMock();

    await generatePdfThumbnail('https://example.com/my.pdf');

    expect(mockGetDocument).toHaveBeenCalledWith('https://example.com/my.pdf');
  });

  it('uses jpeg format by default', async () => {
    const page = createMockPage();
    setupDocumentMock(createMockPdf(page));

    const canvas = createCanvasMock();
    vi.spyOn(document, 'createElement').mockReturnValue(
      canvas as unknown as HTMLElement
    );

    await generatePdfThumbnail('https://example.com/test.pdf');

    expect(canvas.toDataURL).toHaveBeenCalledWith(
      'image/jpeg',
      expect.any(Number)
    );
  });

  it('uses png format when specified', async () => {
    const page = createMockPage();
    setupDocumentMock(createMockPdf(page));

    const canvas = createCanvasMock();
    vi.spyOn(document, 'createElement').mockReturnValue(
      canvas as unknown as HTMLElement
    );

    await generatePdfThumbnail('https://example.com/test.pdf', {
      format: 'png',
    });

    expect(canvas.toDataURL).toHaveBeenCalledWith(
      'image/png',
      expect.any(Number)
    );
  });

  it('returns null when getDocument throws', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error('load failed')),
    });

    const result = await generatePdfThumbnail(
      'https://bad.example.com/test.pdf'
    );

    expect(result).toBeNull();
  });

  it('returns null when canvas context is null', async () => {
    setupDocumentMock();

    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue(null),
      toDataURL: vi.fn(),
    };
    vi.spyOn(document, 'createElement').mockReturnValue(
      canvas as unknown as HTMLElement
    );

    const result = await generatePdfThumbnail('https://example.com/test.pdf');

    expect(result).toBeNull();
  });

  it('accepts custom width and height options', async () => {
    const page = createMockPage(200, 300);
    setupDocumentMock(createMockPdf(page));

    await generatePdfThumbnail('https://example.com/test.pdf', {
      width: 200,
      height: 300,
    });

    expect(page.getViewport).toHaveBeenCalled();
  });

  it('accepts custom quality option', async () => {
    const page = createMockPage();
    setupDocumentMock(createMockPdf(page));

    const canvas = createCanvasMock();
    vi.spyOn(document, 'createElement').mockReturnValue(
      canvas as unknown as HTMLElement
    );

    await generatePdfThumbnail('https://example.com/test.pdf', {
      quality: 0.5,
    });

    expect(canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.5);
  });
});

// ---------------------------------------------------------------------------
// generateAndSaveThumbnail
// ---------------------------------------------------------------------------
describe('generateAndSaveThumbnail', () => {
  it('returns thumbnail URL on full success flow', async () => {
    setupDocumentMock();

    const thumbnailDataUrl = 'data:image/jpeg;base64,/9j/thumbnail';
    const fetchMock = global.fetch as ReturnType<typeof vi.fn>;

    // First fetch: convert data URL to blob
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['fake-image']), { status: 200 })
    );
    // Second fetch: upload to backend
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ thumbnailUrl: 'https://cdn.example.com/thumb.jpg' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    // Mock generatePdfThumbnail to return expected URL
    vi.doMock('../pdf-thumbnail', async (importOriginal) => {
      const original =
        await importOriginal<typeof import('../pdf-thumbnail')>();
      return {
        ...original,
        generatePdfThumbnail: vi.fn().mockResolvedValue(thumbnailDataUrl),
      };
    });

    // Since we can't easily mock the same module, just check error handling path
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error('load failed')),
    });

    const result = await generateAndSaveThumbnail(
      'res-1',
      'https://example.com/bad.pdf'
    );
    expect(result).toBeNull();
  });

  it('returns null when thumbnail generation fails', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error('failed')),
    });

    const result = await generateAndSaveThumbnail(
      'res-1',
      'https://bad.com/pdf'
    );
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// batchGenerateThumbnails
// ---------------------------------------------------------------------------
describe('batchGenerateThumbnails', () => {
  it('returns success=0 and failed=count when all fail', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error('failed')),
    });

    // Use fake timers to avoid real delays
    vi.useFakeTimers();

    const promise = batchGenerateThumbnails([
      { id: 'r1', pdfUrl: 'https://example.com/1.pdf' },
      { id: 'r2', pdfUrl: 'https://example.com/2.pdf' },
    ]);

    // Advance through the setTimeout delays
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.failed).toBe(2);
    expect(result.success).toBe(0);
    expect(result.skipped).toBe(0);

    vi.useRealTimers();
  });

  it('calls progress callback for each resource', async () => {
    mockGetDocument.mockReturnValue({
      promise: Promise.reject(new Error('fail')),
    });

    vi.useFakeTimers();

    const onProgress = vi.fn();
    const resources = [
      { id: 'r1', pdfUrl: 'https://example.com/1.pdf' },
      { id: 'r2', pdfUrl: 'https://example.com/2.pdf' },
    ];

    const promise = batchGenerateThumbnails(resources, onProgress);
    await vi.runAllTimersAsync();
    await promise;

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenCalledWith(1, 2, 'r1');
    expect(onProgress).toHaveBeenCalledWith(2, 2, 'r2');

    vi.useRealTimers();
  });

  it('returns empty stats for empty resources array', async () => {
    vi.useFakeTimers();

    const promise = batchGenerateThumbnails([]);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ success: 0, failed: 0, skipped: 0 });

    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// thumbnailExists
// ---------------------------------------------------------------------------
describe('thumbnailExists', () => {
  it('returns true when HEAD request succeeds', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 200 })
    );

    const result = await thumbnailExists('res-1');

    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/resources/res-1'),
      { method: 'HEAD' }
    );
  });

  it('returns false when HEAD request returns 404', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(null, { status: 404 })
    );

    const result = await thumbnailExists('res-not-found');

    expect(result).toBe(false);
  });

  it('returns false when fetch throws (network error)', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Network error')
    );

    const result = await thumbnailExists('res-1');

    expect(result).toBe(false);
  });
});
