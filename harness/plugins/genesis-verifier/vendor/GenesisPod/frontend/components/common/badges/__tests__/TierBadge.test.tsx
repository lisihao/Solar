import React from 'react';
import { render, screen } from '@testing-library/react';
import { TierBadge } from '../TierBadge';

describe('TierBadge', () => {
  it('renders tier 3 with three stars and violet color', () => {
    const { container } = render(<TierBadge tier={3} />);
    expect(container.firstChild).toHaveClass('text-violet-600');
    expect(screen.getByLabelText('Tier 3')).toBeInTheDocument();
  });

  it('renders tier 2 with two stars and blue color', () => {
    const { container } = render(<TierBadge tier={2} />);
    expect(container.firstChild).toHaveClass('text-blue-500');
    expect(screen.getByLabelText('Tier 2')).toBeInTheDocument();
  });

  it('renders tier 1 with one star and slate color', () => {
    const { container } = render(<TierBadge tier={1} />);
    expect(container.firstChild).toHaveClass('text-slate-500');
    expect(screen.getByLabelText('Tier 1')).toBeInTheDocument();
  });

  it('returns null when tier is null', () => {
    const { container } = render(<TierBadge tier={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('applies sm size class', () => {
    const { container } = render(<TierBadge tier={1} size="sm" />);
    expect(container.firstChild).toHaveClass('text-xs');
  });

  it('applies md size class (default)', () => {
    const { container } = render(<TierBadge tier={1} />);
    expect(container.firstChild).toHaveClass('text-sm');
  });

  it('applies lg size class', () => {
    const { container } = render(<TierBadge tier={1} size="lg" />);
    expect(container.firstChild).toHaveClass('text-base');
  });
});
