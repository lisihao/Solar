/// <reference types="@testing-library/jest-dom" />

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  Loader2: (props: Record<string, unknown>) => (
    <svg data-testid="loader-icon" {...props} />
  ),
}));

// Mock cn utility
vi.mock('@/lib/utils/common', () => ({
  cn: (...classes: (string | undefined | false)[]) =>
    classes.filter(Boolean).join(' '),
}));

import { LoadingState, LoadingSkeleton, LoadingInline } from '../LoadingState';

describe('LoadingState', () => {
  it('renders the default loading text', () => {
    render(<LoadingState />);
    expect(screen.getByText('加载中...')).toBeInTheDocument();
  });

  it('renders custom text when provided', () => {
    render(<LoadingState text="Processing request..." />);
    expect(screen.getByText('Processing request...')).toBeInTheDocument();
  });

  it('does not render text when text prop is empty string', () => {
    render(<LoadingState text="" />);
    expect(screen.queryByRole('paragraph')).not.toBeInTheDocument();
  });

  it('renders the Loader2 spinner icon', () => {
    render(<LoadingState />);
    expect(screen.getByTestId('loader-icon')).toBeInTheDocument();
  });

  it('renders within min-height container (non-fullscreen default)', () => {
    const { container } = render(<LoadingState />);
    const minHeightWrapper = container.querySelector('[class*="min-h"]');
    expect(minHeightWrapper).toBeInTheDocument();
  });

  it('renders fullScreen wrapper with fixed inset when fullScreen=true', () => {
    const { container } = render(<LoadingState fullScreen />);
    const fixedWrapper = container.querySelector('[class*="fixed"]');
    expect(fixedWrapper).toBeInTheDocument();
  });

  it('does not render overlay classes by default even in fullScreen', () => {
    const { container } = render(<LoadingState fullScreen />);
    const overlayWrapper = container.querySelector('[class*="backdrop-blur"]');
    expect(overlayWrapper).not.toBeInTheDocument();
  });

  it('renders overlay classes when fullScreen and overlay are both true', () => {
    const { container } = render(<LoadingState fullScreen overlay />);
    const overlayWrapper = container.querySelector('[class*="backdrop-blur"]');
    expect(overlayWrapper).toBeInTheDocument();
  });
});

describe('LoadingSkeleton', () => {
  it('renders 3 skeleton lines by default', () => {
    const { container } = render(<LoadingSkeleton />);
    const lines = container.querySelectorAll('[class*="rounded"]');
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('renders custom number of lines', () => {
    const { container } = render(<LoadingSkeleton lines={5} />);
    const lines = container.querySelectorAll('[class*="h-4"]');
    expect(lines).toHaveLength(5);
  });

  it('renders with animate-pulse class', () => {
    const { container } = render(<LoadingSkeleton />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('animate-pulse');
  });
});

describe('LoadingInline', () => {
  it('renders default inline loading text', () => {
    render(<LoadingInline />);
    expect(screen.getByText('加载中')).toBeInTheDocument();
  });

  it('renders custom text when provided', () => {
    render(<LoadingInline text="Fetching data" />);
    expect(screen.getByText('Fetching data')).toBeInTheDocument();
  });

  it('renders as a span element', () => {
    render(<LoadingInline text="Loading" />);
    const span = screen.getByText('Loading').closest('span');
    expect(span).not.toBeNull();
  });
});
