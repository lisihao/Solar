/// <reference types="@testing-library/jest-dom" />

/**
 * CreateRadarTopicModal 单元测试
 *
 * 覆盖：
 *  - open=false 不渲染
 *  - primary 区双输入框（name + description + keywords）+ 必填校验
 *  - advanced 折叠默认状态（首次空白 = 关）
 *  - keywords 在 primary 区（R3 修复后）
 *  - 多种分隔符（空格 / 逗号 / 中文逗号）解析关键词
 *  - 提交成功后 onCreated + onClose 链路
 *  - createTopic 抛错时显示 error
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

const createTopicMock = vi.fn();
vi.mock('@/services/ai-radar/api', () => ({
  createTopic: (...args: unknown[]) => createTopicMock(...args),
}));

import { CreateRadarTopicModal } from '../CreateRadarTopicModal';

const baseProps = {
  open: true,
  onClose: vi.fn(),
  onCreated: vi.fn(),
};

describe('CreateRadarTopicModal', () => {
  beforeEach(() => {
    createTopicMock.mockReset();
    baseProps.onClose = vi.fn();
    baseProps.onCreated = vi.fn();
  });

  it('does not render when open=false', () => {
    render(<CreateRadarTopicModal {...baseProps} open={false} />);
    expect(screen.queryByText('新建 AI 雷达')).toBeNull();
  });

  it('renders title + subtitle when open', () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    expect(screen.getByText('新建 AI 雷达')).toBeInTheDocument();
    expect(
      screen.getByText(/持续监控多源数据.+AI 自动评分/)
    ).toBeInTheDocument();
  });

  it('primary 区包含 name + description + keywords（R3 修复）', () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    expect(
      screen.getByPlaceholderText(/例如：GPT-5 发布动态/)
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText(/聚焦 GPT-5 的能力评测/)
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('GPT-5, OpenAI, Sam Altman')
    ).toBeInTheDocument();
  });

  it('advanced 折叠默认关闭（首次打开 entityType=topic + cron=default）', () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    // 折叠区只剩对象类型 + 刷新频率（R3 修复后 keywords 已移到 primary）
    expect(
      screen.getByText('高级设置（对象类型 / 刷新频率）')
    ).toBeInTheDocument();
    // 折叠关时，对象类型按钮不可见
    expect(screen.queryByRole('button', { name: '话题' })).toBeNull();
  });

  it('点击高级设置展开后显示对象类型 + 刷新频率', () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    fireEvent.click(screen.getByText('高级设置（对象类型 / 刷新频率）'));
    expect(screen.getByRole('button', { name: '话题' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '每 6 小时' })
    ).toBeInTheDocument();
  });

  it('submit disabled until name typed', () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    const submit = screen.getByRole('button', { name: /创建雷达/ });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/例如：GPT-5 发布动态/), {
      target: { value: 'GPT-5 watch' },
    });
    expect(submit).not.toBeDisabled();
  });

  it('name < 2 chars → error message', async () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/例如：GPT-5 发布动态/), {
      target: { value: 'a' },
    });
    fireEvent.click(screen.getByRole('button', { name: /创建雷达/ }));
    await waitFor(() => {
      expect(screen.getByText(/至少 2 个字符/)).toBeInTheDocument();
    });
    expect(createTopicMock).not.toHaveBeenCalled();
  });

  it('keywords empty → error message（不再误导用户去打开高级设置）', async () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/例如：GPT-5 发布动态/), {
      target: { value: 'GPT-5 watch' },
    });
    fireEvent.click(screen.getByRole('button', { name: /创建雷达/ }));
    await waitFor(() => {
      expect(screen.getByText('请至少填 1 个关键词')).toBeInTheDocument();
    });
    expect(createTopicMock).not.toHaveBeenCalled();
  });

  it('successfully submits with name + keywords, calls onCreated + onClose', async () => {
    const fakeTopic = { id: 'new-id', name: 'x' };
    createTopicMock.mockResolvedValueOnce(fakeTopic);
    const onCreated = vi.fn();
    const onClose = vi.fn();
    render(
      <CreateRadarTopicModal open onClose={onClose} onCreated={onCreated} />
    );
    fireEvent.change(screen.getByPlaceholderText(/例如：GPT-5 发布动态/), {
      target: { value: 'GPT-5 watch' },
    });
    fireEvent.change(screen.getByPlaceholderText('GPT-5, OpenAI, Sam Altman'), {
      target: { value: 'gpt-5, openai sam-altman' },
    });
    fireEvent.click(screen.getByRole('button', { name: /创建雷达/ }));
    await waitFor(() => {
      expect(createTopicMock).toHaveBeenCalledTimes(1);
    });
    expect(createTopicMock.mock.calls[0]?.[0]).toMatchObject({
      name: 'GPT-5 watch',
      entityType: 'topic',
      keywords: ['gpt-5', 'openai', 'sam-altman'],
      refreshCron: '0 */6 * * *',
    });
    expect(onCreated).toHaveBeenCalledWith(fakeTopic);
    expect(onClose).toHaveBeenCalled();
  });

  it('parses keywords with chinese/english comma + spaces', async () => {
    createTopicMock.mockResolvedValueOnce({ id: 'x' });
    render(<CreateRadarTopicModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/例如：GPT-5 发布动态/), {
      target: { value: 'My topic' },
    });
    fireEvent.change(screen.getByPlaceholderText('GPT-5, OpenAI, Sam Altman'), {
      target: { value: 'a, b，c d' },
    });
    fireEvent.click(screen.getByRole('button', { name: /创建雷达/ }));
    await waitFor(() => {
      expect(createTopicMock).toHaveBeenCalled();
    });
    expect(createTopicMock.mock.calls[0]?.[0].keywords).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('displays error when createTopic rejects', async () => {
    createTopicMock.mockRejectedValueOnce(new Error('boom'));
    render(<CreateRadarTopicModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/例如：GPT-5 发布动态/), {
      target: { value: 'My topic' },
    });
    fireEvent.change(screen.getByPlaceholderText('GPT-5, OpenAI, Sam Altman'), {
      target: { value: 'a' },
    });
    fireEvent.click(screen.getByRole('button', { name: /创建雷达/ }));
    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  it('SAMPLE_NAMES chips render when name is empty and disappear after typing', () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    expect(
      screen.getByRole('button', { name: 'GPT-5 发布动态' })
    ).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/例如：GPT-5 发布动态/), {
      target: { value: 'x' },
    });
    expect(screen.queryByRole('button', { name: 'GPT-5 发布动态' })).toBeNull();
  });

  it('clicking a SAMPLE_NAMES chip fills the name input', () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI 公司动态' }));
    expect(screen.getByDisplayValue('OpenAI 公司动态')).toBeInTheDocument();
  });

  it('clicking cancel triggers onClose', () => {
    const onClose = vi.fn();
    render(
      <CreateRadarTopicModal open onClose={onClose} onCreated={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('cron preset selection updates internal state', () => {
    render(<CreateRadarTopicModal {...baseProps} />);
    fireEvent.click(screen.getByText('高级设置（对象类型 / 刷新频率）'));
    fireEvent.click(screen.getByRole('button', { name: '每 12 小时' }));
    // active 样式 = border-blue-500
    expect(
      screen.getByRole('button', { name: '每 12 小时' }).className
    ).toMatch(/border-blue-500/);
  });

  it('submit button shows "创建中…" while submitting', async () => {
    // 让 createTopic 长时间 pending，捕获中间态
    let resolve!: (v: unknown) => void;
    createTopicMock.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      })
    );
    render(<CreateRadarTopicModal {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText(/例如：GPT-5 发布动态/), {
      target: { value: 'GPT-5 watch' },
    });
    fireEvent.change(screen.getByPlaceholderText('GPT-5, OpenAI, Sam Altman'), {
      target: { value: 'a' },
    });
    fireEvent.click(screen.getByRole('button', { name: /创建雷达/ }));
    await waitFor(() => {
      expect(screen.getByText('创建中…')).toBeInTheDocument();
    });
    resolve({ id: 'x' });
  });

  it('changing entityType opens advanced by default next render（isAdvancedCustomized）', () => {
    // 一次 render：默认 topic，advanced 收起
    const { rerender } = render(<CreateRadarTopicModal {...baseProps} />);
    // 展开 advanced 切换 entityType
    fireEvent.click(screen.getByText('高级设置（对象类型 / 刷新频率）'));
    fireEvent.click(screen.getByRole('button', { name: '公司' }));
    // close 然后重开：MissionDialogShell 用 isOpen + defaultAdvancedOpen 控
    rerender(<CreateRadarTopicModal {...baseProps} open={false} />);
    rerender(<CreateRadarTopicModal {...baseProps} open={true} />);
    // 切了 entityType 后 isAdvancedCustomized=true → 默认展开
    expect(screen.getByRole('button', { name: '公司' })).toBeInTheDocument();
  });
});
