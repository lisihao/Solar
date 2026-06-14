/// <reference types="@testing-library/jest-dom" />

/**
 * RadarSourceList 单元测试
 *
 * 覆盖（R2 5 路评审产出清单 — task #34）：
 *  - AddSourceForm 只渲染 RSS / YOUTUBE / CUSTOM 三个按钮，X 永不出现
 *  - 选 CUSTOM 时显 amber warning（需配 listSelector）
 *  - 选 YOUTUBE / RSS / CUSTOM 时 identifier label 切换正确
 *  - 老 type=X 源仍能渲染（label 显示 "X (Twitter)"），不崩
 *  - hasLegacyX 时显示顶部黄条"X 已停止新推荐"提示
 *  - 没有 type=X 源时不显示黄条（避免误导）
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';

vi.mock('@/services/ai-radar/api', () => ({
  acceptRecommendedSources: vi.fn(),
  createSource: vi.fn(),
  deleteSource: vi.fn(),
  recommendSources: vi.fn(),
  updateSource: vi.fn(),
}));

import { RadarSourceList } from '../RadarSourceList';
import type { RadarSource } from '@/services/ai-radar/types';

function makeSource(overrides: Partial<RadarSource> = {}): RadarSource {
  return {
    id: 'src-1',
    topicId: 'tid-1',
    type: 'RSS',
    identifier: 'https://openai.com/blog/rss.xml',
    label: 'OpenAI Blog',
    config: null,
    enabled: true,
    isAiRecommended: false,
    health: 'HEALTHY',
    consecutiveFailures: 0,
    cooldownUntil: null,
    lastFetchAt: '2026-05-15T10:00:00Z',
    lastError: null,
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-15T10:00:00Z',
    ...overrides,
  };
}

describe('RadarSourceList', () => {
  describe('legacy X notice banner', () => {
    it('显示顶部黄条 when sources contain type=X', () => {
      const sources = [
        makeSource({ id: 's1', type: 'RSS' }),
        makeSource({ id: 's2', type: 'X', identifier: '@elonmusk' }),
      ];
      render(
        <RadarSourceList
          topicId="tid-1"
          sources={sources}
          onReload={() => {}}
        />
      );
      const status = screen.getByRole('status');
      expect(status.textContent).toMatch(/X \(Twitter\) 已停止新推荐/);
      expect(status.textContent).toMatch(/Nitter/);
    });

    it('不显示黄条 when sources 不含 type=X', () => {
      const sources = [
        makeSource({ id: 's1', type: 'RSS' }),
        makeSource({ id: 's2', type: 'YOUTUBE', identifier: 'UC-abc' }),
      ];
      render(
        <RadarSourceList
          topicId="tid-1"
          sources={sources}
          onReload={() => {}}
        />
      );
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('老 type=X 源仍正常渲染 label "X (Twitter)" 不崩', () => {
      const sources = [
        makeSource({ id: 'x1', type: 'X', identifier: '@cnbc', label: 'CNBC' }),
      ];
      render(
        <RadarSourceList
          topicId="tid-1"
          sources={sources}
          onReload={() => {}}
        />
      );
      expect(screen.getByText('X (Twitter)')).toBeInTheDocument();
      expect(screen.getByText('CNBC')).toBeInTheDocument();
    });
  });

  describe('AddSourceForm 类型按钮', () => {
    function openAddForm() {
      render(
        <RadarSourceList topicId="tid-1" sources={[]} onReload={() => {}} />
      );
      fireEvent.click(screen.getByRole('button', { name: /添加/ }));
      return screen.getByRole('dialog');
    }

    it('只渲染 RSS / YouTube / 自定义 三个按钮，X 永不出现', () => {
      const dialog = openAddForm();
      const scoped = within(dialog);
      expect(scoped.getByRole('button', { name: 'RSS' })).toBeInTheDocument();
      expect(
        scoped.getByRole('button', { name: 'YouTube' })
      ).toBeInTheDocument();
      expect(
        scoped.getByRole('button', { name: '自定义' })
      ).toBeInTheDocument();
      expect(
        scoped.queryByRole('button', { name: /X \(Twitter\)/ })
      ).not.toBeInTheDocument();
    });

    it('默认选 RSS，identifier label 显示 RSS 提示', () => {
      const dialog = openAddForm();
      expect(
        within(dialog).getByText(/RSS feed URL.+不要 paywall/)
      ).toBeInTheDocument();
    });

    it('选 YouTube 切换 identifier label 到 channelId 提示', () => {
      const dialog = openAddForm();
      fireEvent.click(within(dialog).getByRole('button', { name: 'YouTube' }));
      expect(
        within(dialog).getByText(/channelId \(UC\.\.\.\) 或 youtube\.com URL/)
      ).toBeInTheDocument();
    });

    it('选 自定义 显 amber warning 提示需配 listSelector', () => {
      const dialog = openAddForm();
      fireEvent.click(within(dialog).getByRole('button', { name: '自定义' }));
      expect(
        within(dialog).getByText(/config\.listSelector 提供 CSS 选择器/)
      ).toBeInTheDocument();
    });

    it('选 RSS 不显 amber warning（RSS 无需额外 config）', () => {
      const dialog = openAddForm();
      expect(
        within(dialog).queryByText(/listSelector/)
      ).not.toBeInTheDocument();
    });
  });
});
