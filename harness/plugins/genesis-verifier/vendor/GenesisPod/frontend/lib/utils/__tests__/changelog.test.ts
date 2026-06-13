import { describe, it, expect } from 'vitest';

// Mock the generated changelog JSON
import { vi } from 'vitest';
vi.mock('@/lib/generated/changelog.json', () => ({
  default: [
    {
      version: '2.1.0',
      date: '2026-02-01',
      changes: [
        { type: 'feature', description: 'New AI research module' },
        { type: 'fix', description: 'Fixed auth token refresh bug' },
      ],
    },
    {
      version: '2.0.0',
      date: '2026-01-01',
      changes: [
        { type: 'breaking', description: 'Removed legacy API endpoints' },
        { type: 'improvement', description: 'Performance improvements' },
      ],
    },
  ],
}));

import {
  CHANGELOG,
  CURRENT_VERSION,
  getLatestChangelog,
  getChangeTypeInfo,
} from '@/lib/utils/changelog';

// hasNewVersion / markVersionAsSeen 已删除（版本提示迁移到后端通知中心推送）。

describe('changelog utils', () => {
  // ============================================================
  // CHANGELOG / CURRENT_VERSION
  // ============================================================

  it('CHANGELOG is an array with 2 entries', () => {
    expect(Array.isArray(CHANGELOG)).toBe(true);
    expect(CHANGELOG).toHaveLength(2);
  });

  it('CURRENT_VERSION equals the first entry version', () => {
    expect(CURRENT_VERSION).toBe('2.1.0');
  });

  // ============================================================
  // getLatestChangelog
  // ============================================================

  it('getLatestChangelog returns the first changelog entry', () => {
    const latest = getLatestChangelog();
    expect(latest.version).toBe('2.1.0');
    expect(latest.date).toBe('2026-02-01');
  });

  it('getLatestChangelog has correct changes array', () => {
    const latest = getLatestChangelog();
    expect(latest.changes).toHaveLength(2);
    expect(latest.changes[0].type).toBe('feature');
    expect(latest.changes[1].type).toBe('fix');
  });

  // ============================================================
  // getChangeTypeInfo
  // ============================================================

  it('returns correct label and color for "feature" type', () => {
    const info = getChangeTypeInfo('feature');
    expect(info.label).toBe('New');
    expect(info.color).toContain('green');
  });

  it('returns correct label and color for "fix" type', () => {
    const info = getChangeTypeInfo('fix');
    expect(info.label).toBe('Fix');
    expect(info.color).toContain('red');
  });

  it('returns correct label and color for "improvement" type', () => {
    const info = getChangeTypeInfo('improvement');
    expect(info.label).toBe('Improved');
    expect(info.color).toContain('blue');
  });

  it('returns correct label and color for "breaking" type', () => {
    const info = getChangeTypeInfo('breaking');
    expect(info.label).toBe('Breaking');
    expect(info.color).toContain('orange');
  });
});
