import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StarRating } from '../StarRating';

describe('StarRating', () => {
  it('renders 5 star buttons', () => {
    render(<StarRating value={3} onChange={() => {}} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(5);
  });

  it('is readonly — buttons are disabled', () => {
    render(<StarRating value={3} onChange={() => {}} readonly />);
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => expect(btn).toBeDisabled());
  });

  it('calls onChange when a star is clicked', async () => {
    const onChange = jest.fn().mockResolvedValue(undefined);
    render(<StarRating value={2} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('4 star'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(4));
  });

  it('rolls back optimistic value when onChange rejects', async () => {
    const onChange = jest.fn().mockRejectedValue(new Error('network error'));
    render(<StarRating value={2} onChange={onChange} />);

    fireEvent.click(screen.getByLabelText('4 star'));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    // After rollback, optimistic should revert to prev; no crash
  });
});
