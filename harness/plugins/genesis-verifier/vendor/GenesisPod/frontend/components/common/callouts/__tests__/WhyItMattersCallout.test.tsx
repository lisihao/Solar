import React from 'react';
import { render, screen } from '@testing-library/react';
import { WhyItMattersCallout } from '../WhyItMattersCallout';

describe('WhyItMattersCallout', () => {
  it('renders children', () => {
    render(
      <WhyItMattersCallout>
        <p>This is why it matters</p>
      </WhyItMattersCallout>
    );
    expect(screen.getByText('This is why it matters')).toBeInTheDocument();
  });

  it('applies violet accent bar class', () => {
    const { container } = render(
      <WhyItMattersCallout>content</WhyItMattersCallout>
    );
    expect(container.firstChild).toHaveClass('border-violet-500');
    expect(container.firstChild).toHaveClass('bg-violet-50');
  });

  it('does not render when children is null', () => {
    const { container } = render(
      <WhyItMattersCallout>{null}</WhyItMattersCallout>
    );
    expect(container.firstChild).toBeNull();
  });

  it('applies custom className', () => {
    const { container } = render(
      <WhyItMattersCallout className="mt-4">content</WhyItMattersCallout>
    );
    expect(container.firstChild).toHaveClass('mt-4');
  });
});
