/**
 * Version changelog configuration
 * 版本更新日志配置
 *
 * Data is auto-generated from CHANGELOG.md by scripts/generate-changelog.js
 *
 * 历史：原本通过 VersionUpdateBanner + localStorage `lastSeenVersion` 做版本提示，
 * 已迁移到后端通知中心推送（见 NotificationPresetsService.notifyVersionUpdate）。
 * `hasNewVersion` / `markVersionAsSeen` 已删除。
 */

import generatedChangelog from '@/lib/generated/changelog.json';

export interface ChangelogEntry {
  version: string;
  date: string;
  changes: {
    type: 'feature' | 'fix' | 'improvement' | 'breaking';
    description: string;
  }[];
}

export const CHANGELOG: ChangelogEntry[] =
  generatedChangelog as ChangelogEntry[];

export const CURRENT_VERSION = CHANGELOG[0]?.version ?? '0.0.0';

/**
 * Get the latest changelog entry
 */
export function getLatestChangelog(): ChangelogEntry {
  return CHANGELOG[0];
}

/**
 * Get change type display info
 */
export function getChangeTypeInfo(type: ChangelogEntry['changes'][0]['type']): {
  label: string;
  color: string;
} {
  switch (type) {
    case 'feature':
      return { label: 'New', color: 'bg-green-100 text-green-800' };
    case 'fix':
      return { label: 'Fix', color: 'bg-red-100 text-red-800' };
    case 'improvement':
      return { label: 'Improved', color: 'bg-blue-100 text-blue-800' };
    case 'breaking':
      return { label: 'Breaking', color: 'bg-orange-100 text-orange-800' };
  }
}
