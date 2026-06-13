/// <reference types="@testing-library/jest-dom" />

/**
 * PageHeaderHero 单元测试
 *
 * 公共组件 —— AI 雷达 / AI 洞察 / Playground 三处共用，必须覆盖完整：
 *   - 必填 title 单独 / 加 subtitle
 *   - icon 渐变 + 阴影 class 拼接
 *   - actions slot 渲染
 *   - children slot（search bar）渲染
 *   - 默认值（iconGradient / iconShadowClass）
 *   - 无 icon 时不渲染 icon 容器
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { PageHeaderHero } from '../PageHeaderHero';

describe('PageHeaderHero', () => {
  it('renders title only when subtitle/icon/actions/children absent', () => {
    render(<PageHeaderHero title="Solo Title" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Solo Title'
    );
  });

  it('renders subtitle when provided', () => {
    render(<PageHeaderHero title="T" subtitle="Sub line" />);
    expect(screen.getByText('Sub line')).toBeInTheDocument();
  });

  it('omits subtitle paragraph when not provided', () => {
    const { container } = render(<PageHeaderHero title="T" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders icon node when provided', () => {
    render(<PageHeaderHero title="T" icon={<svg data-testid="my-icon" />} />);
    expect(screen.getByTestId('my-icon')).toBeInTheDocument();
  });

  it('omits icon block when icon not provided', () => {
    const { container } = render(<PageHeaderHero title="T" />);
    // icon 方块容器的标志类是 h-14 w-14 + bg-gradient-to-br
    expect(container.querySelector('.h-14.w-14.bg-gradient-to-br')).toBeNull();
  });

  it('applies default iconGradient (violet→purple) when not specified', () => {
    const { container } = render(<PageHeaderHero title="T" icon={<svg />} />);
    const block = container.querySelector('.h-14.w-14');
    expect(block?.className).toMatch(/from-violet-500/);
    expect(block?.className).toMatch(/to-purple-600/);
  });

  it('applies custom iconGradient when provided', () => {
    const { container } = render(
      <PageHeaderHero
        title="T"
        icon={<svg />}
        iconGradient="from-cyan-500 to-sky-600"
      />
    );
    const block = container.querySelector('.h-14.w-14');
    expect(block?.className).toMatch(/from-cyan-500/);
    expect(block?.className).toMatch(/to-sky-600/);
  });

  it('applies default iconShadowClass (violet/25) when not specified', () => {
    const { container } = render(<PageHeaderHero title="T" icon={<svg />} />);
    const block = container.querySelector('.h-14.w-14');
    expect(block?.className).toMatch(/shadow-violet-500\/25/);
  });

  it('applies custom iconShadowClass when provided (custom-agents rose case)', () => {
    const { container } = render(
      <PageHeaderHero
        title="T"
        icon={<svg />}
        iconGradient="from-rose-500 to-pink-600"
        iconShadowClass="shadow-rose-500/25"
      />
    );
    const block = container.querySelector('.h-14.w-14');
    expect(block?.className).toMatch(/shadow-rose-500\/25/);
    expect(block?.className).not.toMatch(/shadow-violet-500/);
  });

  it('renders actions slot', () => {
    render(
      <PageHeaderHero
        title="T"
        actions={<button type="button">Create</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('omits actions container when not provided', () => {
    const { container } = render(<PageHeaderHero title="T" />);
    // actions container 的标志是 flex-shrink-0 flex gap-2
    expect(container.querySelector('.flex.flex-shrink-0')).toBeNull();
  });

  it('renders children below header (search bar slot)', () => {
    render(
      <PageHeaderHero title="T">
        <input data-testid="search" placeholder="search" />
      </PageHeaderHero>
    );
    expect(screen.getByTestId('search')).toBeInTheDocument();
  });

  it('applies custom className to root container', () => {
    const { container } = render(
      <PageHeaderHero title="T" className="custom-cls" />
    );
    expect(container.firstChild).toHaveClass('custom-cls');
  });

  it('uses default px-8 py-6 padding when no custom className', () => {
    const { container } = render(<PageHeaderHero title="T" />);
    expect(container.firstChild).toHaveClass('px-8');
    expect(container.firstChild).toHaveClass('py-6');
  });

  it('title h1 has bold + 2xl + gray-900 typography', () => {
    render(<PageHeaderHero title="X" />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveClass('text-2xl');
    expect(h1).toHaveClass('font-bold');
    expect(h1).toHaveClass('text-gray-900');
  });

  it('subtitle p has sm text-gray-500 typography', () => {
    render(<PageHeaderHero title="X" subtitle="S" />);
    const p = screen.getByText('S');
    expect(p).toHaveClass('text-sm');
    expect(p).toHaveClass('text-gray-500');
  });
});
