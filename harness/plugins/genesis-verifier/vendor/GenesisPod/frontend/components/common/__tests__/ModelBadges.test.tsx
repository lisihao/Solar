/// <reference types="@testing-library/jest-dom" />

/**
 * ModelBadges + modelLabelSuffix 测试
 *
 * W4-byok 2026-05-05: 这两个工具被 8+ 处使用，必须覆盖完整组合：
 *   - 纯 BYOK / 纯系统 / Multi / 都有 / 都没
 *   - undefined / null fields
 *   - 渲染顺序 (Multi 在前 My Key 在后)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { ModelBadges, modelLabelSuffix } from '../badges/ModelBadges';

describe('ModelBadges', () => {
  it('renders My Key chip when isUserKey=true', () => {
    render(<ModelBadges model={{ isUserKey: true }} />);
    expect(screen.getByText('My Key')).toBeInTheDocument();
    expect(screen.queryByText('Multi')).not.toBeInTheDocument();
  });

  it('renders Multi chip when isMixture=true', () => {
    render(<ModelBadges model={{ isMixture: true }} />);
    expect(screen.getByText('Multi')).toBeInTheDocument();
    expect(screen.queryByText('My Key')).not.toBeInTheDocument();
  });

  it('renders both chips when both flags=true', () => {
    render(<ModelBadges model={{ isMixture: true, isUserKey: true }} />);
    expect(screen.getByText('Multi')).toBeInTheDocument();
    expect(screen.getByText('My Key')).toBeInTheDocument();
  });

  it('renders nothing when both flags absent', () => {
    const { container } = render(<ModelBadges model={{}} />);
    expect(container.textContent).toBe('');
  });

  it('renders nothing for undefined isUserKey/isMixture', () => {
    const { container } = render(
      <ModelBadges model={{ isUserKey: undefined, isMixture: undefined }} />
    );
    expect(container.textContent).toBe('');
  });

  it('My Key chip uses emerald gradient (BYOK 视觉识别)', () => {
    const { container } = render(<ModelBadges model={{ isUserKey: true }} />);
    const chip = container.querySelector('span');
    expect(chip?.className).toMatch(/from-emerald-500/);
    expect(chip?.className).toMatch(/to-teal-500/);
  });

  it('Multi chip renders before My Key chip (顺序稳定)', () => {
    const { container } = render(
      <ModelBadges model={{ isMixture: true, isUserKey: true }} />
    );
    const chips = container.querySelectorAll('span');
    expect(chips[0]?.textContent).toBe('Multi');
    expect(chips[1]?.textContent).toBe('My Key');
  });
});

describe('modelLabelSuffix', () => {
  it('returns "· 我的 Key" when isUserKey=true', () => {
    expect(modelLabelSuffix({ isUserKey: true })).toBe(' · 我的 Key');
  });

  it('returns "· 系统 Key" when isUserKey=false', () => {
    expect(modelLabelSuffix({ isUserKey: false })).toBe(' · 系统 Key');
  });

  it('returns "· 系统 Key" when isUserKey is undefined', () => {
    expect(modelLabelSuffix({})).toBe(' · 系统 Key');
  });

  it('always returns string starting with leading space (option text concat)', () => {
    expect(modelLabelSuffix({ isUserKey: true }).startsWith(' ')).toBe(true);
    expect(modelLabelSuffix({}).startsWith(' ')).toBe(true);
  });

  // ─── i18n-aware path（W4-byok 2026-05-05 i18n 支持）────────────

  it('uses translator when t function is provided', () => {
    const t = (key: string) => {
      if (key === 'common.modelKeyLabel.myKey') return 'My Key';
      if (key === 'common.modelKeyLabel.systemKey') return 'System Key';
      return key;
    };
    expect(modelLabelSuffix({ isUserKey: true }, t)).toBe(' · My Key');
    expect(modelLabelSuffix({ isUserKey: false }, t)).toBe(' · System Key');
  });

  it('falls back to chinese when t returns key as-is (key not registered)', () => {
    // 项目 t 在 key 缺失时返回 key 字符串本身 → modelLabelSuffix 应识别并退回中文
    const tNoOp = (key: string) => key;
    expect(modelLabelSuffix({ isUserKey: true }, tNoOp)).toBe(' · 我的 Key');
    expect(modelLabelSuffix({ isUserKey: false }, tNoOp)).toBe(' · 系统 Key');
  });

  it('Translator signature compatible with project useI18n().t (params arg)', () => {
    // 仿真项目实际签名：(key, params?: Record<string, string | number>) => string
    const t = (
      key: string,
      _params?: Record<string, string | number>
    ): string => {
      if (key === 'common.modelKeyLabel.myKey') return '我的密钥';
      return key;
    };
    expect(modelLabelSuffix({ isUserKey: true }, t)).toBe(' · 我的密钥');
  });
});
