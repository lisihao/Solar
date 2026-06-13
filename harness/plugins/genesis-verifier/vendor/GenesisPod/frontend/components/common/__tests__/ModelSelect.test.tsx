/// <reference types="@testing-library/jest-dom" />

/**
 * ModelSelect 测试
 *
 * 2026-05-06 反馈："我的 Key / 系统 Key" 不能再是纯文本后缀，要专业图标。
 * 此组件用 Radix DropdownMenu 替代原生 <select>，让 6 处模型选择器全部走
 * KeyRound (emerald) / Server (slate) 图标识别。
 *
 * 测试要点：
 *   - 选中态显示模型 + provider + 来源图标
 *   - 打开下拉显示所有项 + 各自图标 + key 来源标签
 *   - onChange 用正确字段（默认 modelId，可切 id）
 *   - disabled / 空 models / valueKey 切换
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { I18nProvider } from '@/lib/i18n/i18n-context';

import { ModelSelect, type ModelSelectItem } from '../model-config/ModelSelect';

// Radix DropdownMenu 在 jsdom 下需要 PointerEvent / hasPointerCapture polyfill
beforeAll(() => {
  if (typeof window !== 'undefined') {
    if (!('PointerEvent' in window)) {
      // @ts-expect-error jsdom has no PointerEvent
      window.PointerEvent = window.MouseEvent;
    }
    Object.assign(window.HTMLElement.prototype, {
      hasPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
      scrollIntoView: vi.fn(),
    });
  }
});

function openMenu(trigger: HTMLElement) {
  // Radix Trigger 在 jsdom 用 Enter 键打开比 click 更稳定
  trigger.focus();
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' });
}

function wrap(ui: React.ReactElement) {
  return render(<I18nProvider>{ui}</I18nProvider>);
}

const models: ModelSelectItem[] = [
  {
    id: 'a',
    modelId: 'gpt-5',
    name: 'ChatGPT (GPT 5)',
    provider: 'OpenAI',
    isUserKey: false,
  },
  {
    id: 'b',
    modelId: 'grok-4',
    name: 'xAI (Grok 4-Reasoning)',
    provider: 'xAI',
    isUserKey: true,
  },
];

describe('ModelSelect', () => {
  it('renders selected model name + provider in trigger', () => {
    wrap(<ModelSelect value="gpt-5" onChange={() => {}} models={models} />);
    const trigger = screen.getByRole('button', { name: /Select AI model/i });
    expect(trigger.textContent).toContain('ChatGPT (GPT 5)');
    expect(trigger.textContent).toContain('OpenAI');
  });

  it('renders KeyRound icon for BYOK selected model', () => {
    const { container } = wrap(
      <ModelSelect value="grok-4" onChange={() => {}} models={models} />
    );
    // lucide KeyRound svg has class lucide-key-round in v0.2x; tolerant matcher
    const trigger = container.querySelector(
      'button[aria-label="Select AI model"]'
    );
    expect(trigger).toBeTruthy();
    // emerald color hint set on the icon for BYOK
    const emeraldIcon = trigger?.querySelector('.text-emerald-600');
    expect(emeraldIcon).toBeTruthy();
  });

  it('renders Server icon (slate) for system-key selected model', () => {
    const { container } = wrap(
      <ModelSelect value="gpt-5" onChange={() => {}} models={models} />
    );
    const trigger = container.querySelector(
      'button[aria-label="Select AI model"]'
    );
    const slateIcon = trigger?.querySelector('.text-slate-500');
    expect(slateIcon).toBeTruthy();
  });

  it('opens dropdown and lists all models on click', () => {
    wrap(<ModelSelect value="gpt-5" onChange={() => {}} models={models} />);
    openMenu(screen.getByRole('button', { name: /Select AI model/i }));
    expect(
      screen.getAllByText('ChatGPT (GPT 5)').length
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByText('xAI (Grok 4-Reasoning)').length
    ).toBeGreaterThanOrEqual(1);
  });

  it('calls onChange with modelId by default when item clicked', () => {
    const onChange = vi.fn();
    wrap(<ModelSelect value="gpt-5" onChange={onChange} models={models} />);
    openMenu(screen.getByRole('button', { name: /Select AI model/i }));
    const items = screen.getAllByRole('menuitem');
    fireEvent.click(items[1]);
    expect(onChange).toHaveBeenCalledWith('grok-4');
  });

  it('uses id as value when valueKey="id"', () => {
    const onChange = vi.fn();
    wrap(
      <ModelSelect
        value="a"
        onChange={onChange}
        models={models}
        valueKey="id"
      />
    );
    openMenu(screen.getByRole('button', { name: /Select AI model/i }));
    const items = screen.getAllByRole('menuitem');
    fireEvent.click(items[1]);
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('respects disabled flag', () => {
    wrap(
      <ModelSelect value="gpt-5" onChange={() => {}} models={models} disabled />
    );
    const trigger = screen.getByRole('button', { name: /Select AI model/i });
    expect(trigger).toBeDisabled();
  });

  it('disables trigger when models list is empty', () => {
    wrap(<ModelSelect value="" onChange={() => {}} models={[]} />);
    const trigger = screen.getByRole('button', { name: /Select AI model/i });
    expect(trigger).toBeDisabled();
  });

  it('renders placeholder when value matches no model', () => {
    wrap(
      <ModelSelect
        value="unknown-id"
        onChange={() => {}}
        models={models}
        placeholder="—"
      />
    );
    const trigger = screen.getByRole('button', { name: /Select AI model/i });
    expect(trigger.textContent).toContain('—');
  });

  it('shows BYOK key label in dropdown row for user-key model', () => {
    wrap(<ModelSelect value="gpt-5" onChange={() => {}} models={models} />);
    openMenu(screen.getByRole('button', { name: /Select AI model/i }));
    // I18nProvider 默认 locale='en'，所以走 en.json → 'My Key' / 'System Key'
    // BYOK 行带 "My Key" 文案，系统行带 "System Key" 文案
    expect(screen.getAllByText('My Key').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('System Key').length).toBeGreaterThanOrEqual(1);
  });
});
