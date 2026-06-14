/**
 * Constants for Explore component
 */

import type { TabType } from '@/components/layout/ResponsiveNav';

export const PAGE_SIZE = 20;

export const FILE_RESTRICTIONS: Record<
  string,
  { accept: string; maxSize: number; label: string }
> = {
  papers: {
    accept: '.pdf,application/pdf',
    maxSize: 50 * 1024 * 1024,
    label: 'PDF文件',
  },
  blogs: {
    accept: 'image/*',
    maxSize: 10 * 1024 * 1024,
    label: '图片',
  },
  reports: {
    accept:
      '.pdf,.doc,.docx,.xlsx,.pptx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation',
    maxSize: 100 * 1024 * 1024,
    label: '报告文件 (PDF/Word/Excel/PPT)',
  },
  youtube: {
    accept: '.srt,.vtt,text/plain',
    maxSize: 5 * 1024 * 1024,
    label: '字幕文件',
  },
  news: { accept: 'image/*', maxSize: 10 * 1024 * 1024, label: '图片' },
  policy: {
    accept:
      '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    maxSize: 50 * 1024 * 1024,
    label: '政策文件 (PDF/Word)',
  },
};

export const TYPE_MAP: Record<
  'papers' | 'blogs' | 'reports' | 'youtube' | 'news' | 'policy',
  string
> = {
  papers: 'PAPER',
  blogs: 'BLOG',
  reports: 'REPORT',
  youtube: 'YOUTUBE_VIDEO',
  news: 'NEWS',
  policy: 'POLICY',
};
