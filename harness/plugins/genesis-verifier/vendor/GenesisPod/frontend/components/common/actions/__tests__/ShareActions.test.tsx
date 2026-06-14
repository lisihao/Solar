import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShareActions } from '../ShareActions';

const defaultProps = {
  title: 'Test Title',
  summary: 'Test summary',
  detailUrl: 'https://example.com/detail',
};

describe('ShareActions', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'open', {
      writable: true,
      value: jest.fn(),
    });
    Object.assign(navigator, {
      clipboard: { writeText: jest.fn().mockResolvedValue(undefined) },
    });
  });

  it('calls window.open with mailto when email button clicked (md+ row)', () => {
    render(<ShareActions {...defaultProps} />);
    // Both md+ and sm buttons exist in DOM; target aria-label="email share"
    const emailBtns = screen.getAllByLabelText('email share');
    fireEvent.click(emailBtns[0]);
    expect(window.open).toHaveBeenCalledWith(
      expect.stringContaining('mailto:?subject=')
    );
  });

  it('calls clipboard.writeText when copy link is clicked', async () => {
    render(<ShareActions {...defaultProps} />);
    const copyBtns = screen.getAllByLabelText('复制链接');
    fireEvent.click(copyBtns[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(defaultProps.title)
    );
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining(defaultProps.detailUrl)
    );
  });

  it('calls onFavorite when favorite button clicked', () => {
    const onFavorite = jest.fn().mockResolvedValue(undefined);
    render(<ShareActions {...defaultProps} onFavorite={onFavorite} />);
    const favBtns = screen.getAllByLabelText('favorite');
    fireEvent.click(favBtns[0]);
    expect(onFavorite).toHaveBeenCalledTimes(1);
  });

  it('calls onCopySuccess after copy', async () => {
    const onCopySuccess = jest.fn();
    render(<ShareActions {...defaultProps} onCopySuccess={onCopySuccess} />);
    const copyBtns = screen.getAllByLabelText('复制链接');
    fireEvent.click(copyBtns[0]);
    // wait microtask
    await Promise.resolve();
    expect(onCopySuccess).toHaveBeenCalled();
  });
});
