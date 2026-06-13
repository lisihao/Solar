import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SideDrawer } from '../SideDrawer';

describe('SideDrawer', () => {
  it('does not render when open is false', () => {
    const { container } = render(
      <SideDrawer open={false} onClose={() => {}}>
        <p>content</p>
      </SideDrawer>
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders children when open is true', () => {
    render(
      <SideDrawer open={true} onClose={() => {}}>
        <p>hello drawer</p>
      </SideDrawer>
    );
    expect(screen.getByText('hello drawer')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <SideDrawer open={true} onClose={() => {}} title="My Drawer">
        <p>body</p>
      </SideDrawer>
    );
    expect(screen.getByText('My Drawer')).toBeInTheDocument();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = jest.fn();
    render(
      <SideDrawer open={true} onClose={onClose}>
        <p>body</p>
      </SideDrawer>
    );
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when ESC is pressed', () => {
    const onClose = jest.fn();
    render(
      <SideDrawer open={true} onClose={onClose}>
        <p>body</p>
      </SideDrawer>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = jest.fn();
    render(
      <SideDrawer open={true} onClose={onClose}>
        <p>body</p>
      </SideDrawer>
    );
    fireEvent.click(screen.getByLabelText('close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
