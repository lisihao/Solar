/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  AlertCircle: (props: Record<string, unknown>) => (
    <svg data-testid="alert-circle-icon" {...props} />
  ),
  RefreshCw: (props: Record<string, unknown>) => (
    <svg data-testid="refresh-icon" {...props} />
  ),
  ChevronDown: (props: Record<string, unknown>) => (
    <svg data-testid="chevron-down-icon" {...props} />
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

import { ErrorState, ErrorInline } from '../ErrorState';

describe('ErrorState', () => {
  it('renders default title when no title prop is provided', () => {
    render(<ErrorState error="Something went wrong" />);
    expect(screen.getByText('加载失败')).toBeInTheDocument();
  });

  it('renders custom title when provided', () => {
    render(
      <ErrorState error="Something went wrong" title="Custom Error Title" />
    );
    expect(screen.getByText('Custom Error Title')).toBeInTheDocument();
  });

  it('renders error message from string error', () => {
    render(<ErrorState error="Network connection failed" />);
    expect(screen.getByText('Network connection failed')).toBeInTheDocument();
  });

  it('renders error message from Error object', () => {
    const error = new Error('API request timeout');
    render(<ErrorState error={error} />);
    expect(screen.getByText('API request timeout')).toBeInTheDocument();
  });

  it('renders error message from object with message property', () => {
    render(
      <ErrorState error={{ message: 'Server unavailable', status: 503 }} />
    );
    expect(screen.getByText('Server unavailable')).toBeInTheDocument();
  });

  it('does not render error message when error is null', () => {
    render(<ErrorState error={null} />);
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(<ErrorState error="Error occurred" onRetry={onRetry} />);
    expect(screen.getByText('重试')).toBeInTheDocument();
  });

  it('does not render retry button when onRetry is not provided', () => {
    render(<ErrorState error="Error occurred" />);
    expect(screen.queryByText('重试')).not.toBeInTheDocument();
  });

  it('calls onRetry callback when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorState error="Error occurred" onRetry={onRetry} />);
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the AlertCircle icon', () => {
    render(<ErrorState error="Error" />);
    expect(screen.getByTestId('alert-circle-icon')).toBeInTheDocument();
  });

  it('does not render fullScreen wrapper by default', () => {
    const { container } = render(<ErrorState error="Error" />);
    const wrapper = container.querySelector('.min-h-\\[400px\\]');
    expect(wrapper).not.toBeInTheDocument();
  });

  it('renders fullScreen wrapper when fullScreen=true', () => {
    const { container } = render(<ErrorState error="Error" fullScreen />);
    const wrapper = container.querySelector('[class*="min-h"]');
    expect(wrapper).toBeInTheDocument();
  });
});

describe('ErrorInline', () => {
  it('renders error message', () => {
    render(<ErrorInline message="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders retry button when onRetry is provided', () => {
    const onRetry = vi.fn();
    render(<ErrorInline message="Error" onRetry={onRetry} />);
    const retryBtn = screen.getByRole('button');
    expect(retryBtn).toBeInTheDocument();
  });

  it('calls onRetry when retry button is clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorInline message="Error" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('does not render retry button when onRetry is absent', () => {
    render(<ErrorInline message="Error" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders AlertCircle icon', () => {
    render(<ErrorInline message="Error" />);
    expect(screen.getByTestId('alert-circle-icon')).toBeInTheDocument();
  });
});
