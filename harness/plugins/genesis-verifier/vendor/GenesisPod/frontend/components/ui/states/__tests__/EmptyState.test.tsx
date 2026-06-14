/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Inbox: (props: Record<string, unknown>) => (
    <svg data-testid="inbox-icon" {...props} />
  ),
  Search: (props: Record<string, unknown>) => (
    <svg data-testid="search-icon" {...props} />
  ),
  FileX: (props: Record<string, unknown>) => (
    <svg data-testid="file-x-icon" {...props} />
  ),
  Plus: (props: Record<string, unknown>) => (
    <svg data-testid="plus-icon" {...props} />
  ),
}));

// Mock cn utility
vi.mock('@/lib/utils/common', () => ({
  cn: (...classes: (string | undefined)[]) => classes.filter(Boolean).join(' '),
}));

// Mock Button primitive
vi.mock('../primitives/button', () => ({
  Button: ({
    onClick,
    children,
    ...props
  }: {
    onClick?: () => void;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
  it('renders default title and description when no props provided', () => {
    render(<EmptyState />);
    expect(screen.getByText('暂无内容')).toBeInTheDocument();
    expect(screen.getByText('这里还没有任何内容')).toBeInTheDocument();
  });

  it('renders the default Inbox icon for default type', () => {
    render(<EmptyState />);
    expect(screen.getByTestId('inbox-icon')).toBeInTheDocument();
  });

  it('renders Search icon and text for search type', () => {
    render(<EmptyState type="search" />);
    expect(screen.getByTestId('search-icon')).toBeInTheDocument();
    expect(screen.getByText('未找到结果')).toBeInTheDocument();
    expect(screen.getByText('尝试调整搜索条件或筛选器')).toBeInTheDocument();
  });

  it('renders FileX icon for noData type', () => {
    render(<EmptyState type="noData" />);
    expect(screen.getByTestId('file-x-icon')).toBeInTheDocument();
    expect(screen.getByText('暂无数据')).toBeInTheDocument();
  });

  it('renders error type with correct text', () => {
    render(<EmptyState type="error" />);
    expect(screen.getByText('加载失败')).toBeInTheDocument();
    expect(screen.getByText('请稍后重试')).toBeInTheDocument();
  });

  it('renders custom title overriding the type default', () => {
    render(<EmptyState type="search" title="No search results found" />);
    expect(screen.getByText('No search results found')).toBeInTheDocument();
    expect(screen.queryByText('未找到结果')).not.toBeInTheDocument();
  });

  it('renders custom description overriding the type default', () => {
    render(<EmptyState type="search" description="Try a different keyword" />);
    expect(screen.getByText('Try a different keyword')).toBeInTheDocument();
    expect(
      screen.queryByText('尝试调整搜索条件或筛选器')
    ).not.toBeInTheDocument();
  });

  it('renders action button when action prop is provided', () => {
    const action = { label: 'Create New Item', onClick: vi.fn() };
    render(<EmptyState action={action} />);
    expect(screen.getByText('Create New Item')).toBeInTheDocument();
  });

  it('calls action.onClick when action button is clicked', () => {
    const onClick = vi.fn();
    render(<EmptyState action={{ label: 'Add', onClick }} />);
    fireEvent.click(screen.getByText('Add'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not render action button when action prop is absent', () => {
    render(<EmptyState />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders custom icon when icon prop is provided', () => {
    const CustomIcon = () => <svg data-testid="custom-icon" />;
    render(<EmptyState icon={<CustomIcon />} />);
    expect(screen.getByTestId('custom-icon')).toBeInTheDocument();
    expect(screen.queryByTestId('inbox-icon')).not.toBeInTheDocument();
  });

  it('renders Plus icon inside action button', () => {
    render(<EmptyState action={{ label: 'Add', onClick: vi.fn() }} />);
    expect(screen.getByTestId('plus-icon')).toBeInTheDocument();
  });
});
