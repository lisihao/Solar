/**
 * Tests for lib/api/ai-organizer.ts
 *
 * Mocks apiClient from @/lib/api/client and getAuthHeader from @/lib/utils/auth.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock references
// ---------------------------------------------------------------------------
const { mockGet, mockPost, mockGetAuthHeader } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockGetAuthHeader: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: mockGet,
    post: mockPost,
  },
}));

vi.mock('../utils/auth', () => ({
  getAuthHeader: mockGetAuthHeader,
}));

// For the relative import path used in the module itself
vi.mock('@/lib/utils/auth', () => ({
  getAuthHeader: mockGetAuthHeader,
}));

// ---------------------------------------------------------------------------
// Import under test AFTER mocks
// ---------------------------------------------------------------------------
import {
  analyzeFiles,
  analyzeSingleFile,
  applySuggestion,
  getCategories,
  getTags,
  findRelatedFiles,
} from './api';
import type { FileInfo } from './api';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const sampleFile: FileInfo = {
  id: 'file-1',
  name: 'Research Paper.pdf',
  mimeType: 'application/pdf',
  source: 'google_drive',
  size: 1024 * 100,
};

const sampleSuggestion = {
  fileId: 'file-1',
  fileName: 'Research Paper.pdf',
  categories: [
    { category: 'Research', confidence: 0.9, reason: 'Academic paper' },
  ],
  tags: [{ tag: 'AI', confidence: 0.85, reason: 'Mentions AI' }],
  suggestedFolder: {
    folderPath: '/Research/AI',
    confidence: 0.8,
    reason: 'Best fit',
  },
  summary: 'An academic paper on AI research',
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.resetAllMocks();
  mockGetAuthHeader.mockReturnValue({ Authorization: 'Bearer test-token' });
});

// ---------------------------------------------------------------------------
// analyzeFiles
// ---------------------------------------------------------------------------
describe('analyzeFiles', () => {
  it('POSTs to /ai-organizer/analyze with files array', async () => {
    const result = {
      success: true,
      suggestions: [sampleSuggestion],
      totalFiles: 1,
      processedFiles: 1,
      errors: [],
    };
    mockPost.mockResolvedValue(result);

    const response = await analyzeFiles([sampleFile]);

    expect(mockPost).toHaveBeenCalledWith(
      '/ai-organizer/analyze',
      { files: [sampleFile] },
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(response.success).toBe(true);
    expect(response.suggestions).toHaveLength(1);
    expect(response.totalFiles).toBe(1);
  });

  it('handles multiple files', async () => {
    const files: FileInfo[] = [
      { ...sampleFile, id: 'f1' },
      { ...sampleFile, id: 'f2', source: 'notion' },
    ];
    mockPost.mockResolvedValue({
      success: true,
      suggestions: [],
      totalFiles: 2,
      processedFiles: 2,
      errors: [],
    });

    await analyzeFiles(files);

    const body = mockPost.mock.calls[0][1] as { files: FileInfo[] };
    expect(body.files).toHaveLength(2);
  });

  it('returns errors array when some files fail', async () => {
    mockPost.mockResolvedValue({
      success: false,
      suggestions: [],
      totalFiles: 2,
      processedFiles: 1,
      errors: [{ fileId: 'f2', error: 'Processing failed' }],
    });

    const result = await analyzeFiles([
      sampleFile,
      { ...sampleFile, id: 'f2' },
    ]);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].fileId).toBe('f2');
  });
});

// ---------------------------------------------------------------------------
// analyzeSingleFile
// ---------------------------------------------------------------------------
describe('analyzeSingleFile', () => {
  it('POSTs to /ai-organizer/analyze-single with file data', async () => {
    const response = { success: true, suggestion: sampleSuggestion };
    mockPost.mockResolvedValue(response);

    const result = await analyzeSingleFile(sampleFile);

    expect(mockPost).toHaveBeenCalledWith(
      '/ai-organizer/analyze-single',
      sampleFile,
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.success).toBe(true);
    expect(result.suggestion.fileId).toBe('file-1');
  });

  it('passes all file properties including optional fields', async () => {
    const file: FileInfo = {
      ...sampleFile,
      content: 'Some text content',
      description: 'Research paper about AI',
      createdAt: '2024-01-01',
      modifiedAt: '2024-06-01',
    };
    mockPost.mockResolvedValue({ success: true, suggestion: sampleSuggestion });

    await analyzeSingleFile(file);

    expect(mockPost.mock.calls[0][1]).toEqual(file);
  });
});

// ---------------------------------------------------------------------------
// applySuggestion
// ---------------------------------------------------------------------------
describe('applySuggestion', () => {
  it('POSTs to /ai-organizer/apply with params', async () => {
    mockPost.mockResolvedValue({
      success: true,
      message: 'Applied successfully',
    });

    const result = await applySuggestion({
      resourceId: 'res-1',
      suggestion: { categories: sampleSuggestion.categories },
    });

    expect(mockPost).toHaveBeenCalledWith(
      '/ai-organizer/apply',
      {
        resourceId: 'res-1',
        suggestion: { categories: sampleSuggestion.categories },
      },
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.success).toBe(true);
    expect(result.message).toBe('Applied successfully');
  });

  it('handles empty suggestion object', async () => {
    mockPost.mockResolvedValue({ success: true, message: 'Nothing to apply' });

    await applySuggestion({ resourceId: 'res-1', suggestion: {} });

    expect(mockPost.mock.calls[0][1]).toEqual({
      resourceId: 'res-1',
      suggestion: {},
    });
  });
});

// ---------------------------------------------------------------------------
// getCategories
// ---------------------------------------------------------------------------
describe('getCategories', () => {
  it('GETs /ai-organizer/categories', async () => {
    mockGet.mockResolvedValue({
      categories: ['Research', 'Engineering', 'Design'],
    });

    const result = await getCategories();

    expect(mockGet).toHaveBeenCalledWith(
      '/ai-organizer/categories',
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.categories).toEqual(['Research', 'Engineering', 'Design']);
  });

  it('returns empty categories when none exist', async () => {
    mockGet.mockResolvedValue({ categories: [] });

    const result = await getCategories();

    expect(result.categories).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getTags
// ---------------------------------------------------------------------------
describe('getTags', () => {
  it('GETs /ai-organizer/tags', async () => {
    mockGet.mockResolvedValue({ tags: ['AI', 'machine-learning', 'nlp'] });

    const result = await getTags();

    expect(mockGet).toHaveBeenCalledWith(
      '/ai-organizer/tags',
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.tags).toEqual(['AI', 'machine-learning', 'nlp']);
  });

  it('returns empty tags when none exist', async () => {
    mockGet.mockResolvedValue({ tags: [] });

    const result = await getTags();

    expect(result.tags).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findRelatedFiles
// ---------------------------------------------------------------------------
describe('findRelatedFiles', () => {
  it('GETs /ai-organizer/related/:fileId with auth header', async () => {
    const relatedFiles = [
      { id: 'f2', title: 'Related Paper 1', similarity: 0.9 },
      { id: 'f3', title: 'Related Paper 2', similarity: 0.75 },
    ];
    mockGet.mockResolvedValue({ relatedFiles });

    const result = await findRelatedFiles('file-1', sampleFile);

    expect(mockGet).toHaveBeenCalledWith(
      '/ai-organizer/related/file-1',
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result.relatedFiles).toHaveLength(2);
    expect(result.relatedFiles[0].similarity).toBe(0.9);
  });

  it('returns empty relatedFiles when no similar files found', async () => {
    mockGet.mockResolvedValue({ relatedFiles: [] });

    const result = await findRelatedFiles('file-orphan', sampleFile);

    expect(result.relatedFiles).toEqual([]);
  });
});
