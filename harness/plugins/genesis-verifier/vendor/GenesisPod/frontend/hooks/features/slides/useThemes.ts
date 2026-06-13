'use client';

import { useState, useEffect } from 'react';
import { config } from '@/lib/utils/config';

export interface SlideThemePreview {
  id: string;
  name: string;
  description: string;
  preview: string; // CSS gradient 字符串
  colors: {
    primary: string; // 背景主色
    accent: string; // 强调色
    text: string; // 文字色
  };
}

const FALLBACK_THEMES: SlideThemePreview[] = [
  {
    id: 'genspark-dark',
    name: '深邃蓝',
    description: '专业深色主题',
    preview: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
    colors: { primary: '#0F172A', accent: '#F97316', text: '#F8FAFC' },
  },
  {
    id: 'tech-purple',
    name: '科技紫',
    description: '科技感主题',
    preview: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 100%)',
    colors: { primary: '#1E1B4B', accent: '#A78BFA', text: '#F8FAFC' },
  },
  {
    id: 'executive-white',
    name: '商务白',
    description: '简洁商务主题',
    preview: 'linear-gradient(135deg, #FFFFFF 0%, #F1F5F9 100%)',
    colors: { primary: '#FFFFFF', accent: '#0EA5E9', text: '#1E293B' },
  },
  {
    id: 'nature-green',
    name: '自然绿',
    description: '清新自然主题',
    preview: 'linear-gradient(135deg, #064E3B 0%, #065F46 100%)',
    colors: { primary: '#064E3B', accent: '#34D399', text: '#F8FAFC' },
  },
  {
    id: 'warm-sunset',
    name: '暖阳橙',
    description: '温暖活力主题',
    preview: 'linear-gradient(135deg, #7C2D12 0%, #9A3412 100%)',
    colors: { primary: '#7C2D12', accent: '#FB923C', text: '#F8FAFC' },
  },
];

const API_BASE = config.apiUrl || '';

export function useThemes() {
  const [themes, setThemes] = useState<SlideThemePreview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/ai-office/slides/themes/list`)
      .then((r) => r.json())
      .then((data) => {
        const list: SlideThemePreview[] =
          data?.data?.themes ?? data?.themes ?? [];
        setThemes(list.length > 0 ? list : FALLBACK_THEMES);
      })
      .catch(() => setThemes(FALLBACK_THEMES))
      .finally(() => setLoading(false));
  }, []);

  return { themes, loading };
}
