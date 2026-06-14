import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DateSwitcher } from '../DateSwitcher';

const OPTIONS = [
  { date: '2026-05-18', label: '今日', subtitle: 'Sunday' },
  { date: '2026-05-17', label: '昨日', subtitle: 'Saturday' },
];

describe('DateSwitcher', () => {
  it('shows skeleton when loading', () => {
    const { container } = render(
      <DateSwitcher value="" options={[]} onChange={() => {}} loading={true} />
    );
    expect(
      container.querySelector('[aria-label="loading date"]')
    ).toBeInTheDocument();
  });

  it('shows empty message when options is empty', () => {
    render(<DateSwitcher value="" options={[]} onChange={() => {}} />);
    expect(screen.getByText('无历史记录')).toBeInTheDocument();
  });

  it('calls onChange when native select changes (sm)', () => {
    const onChange = jest.fn();
    render(
      <DateSwitcher value="2026-05-18" options={OPTIONS} onChange={onChange} />
    );
    // sm native select is rendered (both are in DOM, jsdom has no media queries)
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: '2026-05-17' } });
    expect(onChange).toHaveBeenCalledWith('2026-05-17');
  });
});
