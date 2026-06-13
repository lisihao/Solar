/**
 * RadarTopicConfigDrawer — unit tests
 *
 * Covers: open/close, tab switching, dirty detection, save callback, sources tab delegation.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RadarTopicConfigDrawer } from '../RadarTopicConfigDrawer';
import type { RadarTopicConfigDrawerTopic } from '../RadarTopicConfigDrawer';

// Minimal mock so SideDrawer renders children without portal issues
vi.mock('@/components/common/drawers/SideDrawer', () => ({
  SideDrawer: ({
    open,
    children,
    title,
  }: {
    open: boolean;
    children: React.ReactNode;
    title?: string;
  }) =>
    open ? (
      <div data-testid="side-drawer">
        {title && <h2>{title}</h2>}
        {children}
      </div>
    ) : null,
}));

// RadarSourceList renders just a stub to avoid full API mocking
vi.mock('../RadarSourceList', () => ({
  RadarSourceList: () => <div data-testid="radar-source-list" />,
}));

const BASE_TOPIC: RadarTopicConfigDrawerTopic = {
  id: 'topic-1',
  name: 'AI 动态',
  description: null,
  keywords: ['AI', '机器学习'],
  matchMode: 'semantic',
  briefingTime: '08:00',
  signalsTarget: 3,
  signalTypes: ['turning_point', 'trend_acceleration'],
  weekendSkip: false,
  outputLanguage: 'zh-CN',
  pushConfig: null,
  refreshCron: '0 */6 * * *',
  entityType: null,
};

function renderDrawer(
  props: Partial<React.ComponentProps<typeof RadarTopicConfigDrawer>> = {}
) {
  const onClose = jest.fn();
  const onUpdate = jest.fn().mockResolvedValue(undefined);
  const onSourceReload = jest.fn();

  render(
    <RadarTopicConfigDrawer
      open={true}
      onClose={onClose}
      topic={BASE_TOPIC}
      sources={[]}
      onSourceReload={onSourceReload}
      onUpdate={onUpdate}
      {...props}
    />
  );
  return { onClose, onUpdate, onSourceReload };
}

describe('RadarTopicConfigDrawer', () => {
  it('renders nothing when closed', () => {
    renderDrawer({ open: false });
    expect(screen.queryByTestId('side-drawer')).not.toBeInTheDocument();
  });

  it('renders drawer when open', () => {
    renderDrawer();
    expect(screen.getByTestId('side-drawer')).toBeInTheDocument();
    expect(screen.getByText(/AI 动态/)).toBeInTheDocument();
  });

  it('shows 4 tabs', () => {
    renderDrawer();
    expect(screen.getByText('精选偏好')).toBeInTheDocument();
    expect(screen.getByText('推送方式')).toBeInTheDocument();
    expect(screen.getByText('数据源')).toBeInTheDocument();
    expect(screen.getByText('高级')).toBeInTheDocument();
  });

  it('defaults to briefing tab and shows briefingTime input', () => {
    renderDrawer();
    const timeInput = screen.getByDisplayValue('08:00');
    expect(timeInput).toBeInTheDocument();
  });

  it('switching to sources tab shows RadarSourceList', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('数据源'));
    expect(screen.getByTestId('radar-source-list')).toBeInTheDocument();
    // footer buttons hidden on sources tab
    expect(screen.queryByText('保存')).not.toBeInTheDocument();
  });

  it('switching to advanced tab shows cron input', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('高级'));
    expect(screen.getByDisplayValue('0 */6 * * *')).toBeInTheDocument();
  });

  it('save button disabled when no changes', () => {
    renderDrawer();
    const saveBtn = screen.getByText('保存');
    expect(saveBtn).toBeDisabled();
  });

  it('save button enabled after draft change', () => {
    renderDrawer();
    const timeInput = screen.getByDisplayValue('08:00');
    fireEvent.change(timeInput, { target: { value: '09:00' } });
    expect(screen.getByText('保存')).not.toBeDisabled();
  });

  it('calls onUpdate with draft on save', async () => {
    const { onUpdate } = renderDrawer();
    const timeInput = screen.getByDisplayValue('08:00');
    fireEvent.change(timeInput, { target: { value: '09:00' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ briefingTime: '09:00' })
      );
    });
  });

  it('shows saved ok feedback after successful save', async () => {
    renderDrawer();
    const timeInput = screen.getByDisplayValue('08:00');
    fireEvent.change(timeInput, { target: { value: '10:00' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(screen.getByText('已保存')).toBeInTheDocument();
    });
  });

  it('shows error message on save failure', async () => {
    const onUpdate = jest.fn().mockRejectedValue(new Error('网络错误'));
    renderDrawer({ onUpdate });
    const timeInput = screen.getByDisplayValue('08:00');
    fireEvent.change(timeInput, { target: { value: '11:00' } });
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(screen.getByText('网络错误')).toBeInTheDocument();
    });
  });

  it('push tab: override mode shows channel checkboxes', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('推送方式'));
    fireEvent.click(screen.getByText('单独配置'));
    expect(screen.getByText('邮件')).toBeInTheDocument();
    expect(screen.getByText('公众号')).toBeInTheDocument();
    expect(screen.getByText('站内')).toBeInTheDocument();
  });

  it('signalTypes checkbox toggles off removes value', () => {
    renderDrawer();
    // '转折点' corresponds to 'turning_point' which is in default signalTypes
    const checkbox = screen.getByLabelText<HTMLInputElement>('转折点');
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    // Now dirty
    expect(screen.getByText('保存')).not.toBeDisabled();
  });

  // ── 关键词 Tab ─────────────────────────────────────────

  it('keywords tab: renders existing keywords as removable chips', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('关键词'));
    expect(screen.getByText('AI')).toBeInTheDocument();
    expect(screen.getByText('机器学习')).toBeInTheDocument();
    expect(screen.getByLabelText('删除关键词 AI')).toBeInTheDocument();
  });

  it('keywords tab: adding a keyword via Enter shows new chip + dirties form', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('关键词'));
    const input = screen.getByPlaceholderText('输入关键词，回车添加…');
    fireEvent.change(input, { target: { value: 'NLP' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('NLP')).toBeInTheDocument();
    expect(screen.getByText('保存')).not.toBeDisabled();
  });

  it('keywords tab: removing a keyword dirties form', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('关键词'));
    fireEvent.click(screen.getByLabelText('删除关键词 AI'));
    expect(screen.queryByLabelText('删除关键词 AI')).not.toBeInTheDocument();
    expect(screen.getByText('保存')).not.toBeDisabled();
  });

  it('keywords tab: emptying all keywords blocks save with a warning', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('关键词'));
    fireEvent.click(screen.getByLabelText('删除关键词 AI'));
    fireEvent.click(screen.getByLabelText('删除关键词 机器学习'));
    expect(screen.getByText('至少保留 1 个关键词才能保存')).toBeInTheDocument();
    expect(screen.getByText('保存')).toBeDisabled();
  });

  it('keywords tab: switching matchMode to literal saves with matchMode', async () => {
    const { onUpdate } = renderDrawer();
    fireEvent.click(screen.getByText('关键词'));
    // radios order: semantic(0) / literal(1) / hybrid(2)
    const radios = screen.getAllByRole<HTMLInputElement>('radio');
    expect(radios).toHaveLength(3);
    fireEvent.click(radios[1]);
    expect(screen.getByText('保存')).not.toBeDisabled();
    fireEvent.click(screen.getByText('保存'));
    await waitFor(() => {
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ matchMode: 'literal' })
      );
    });
  });
});
