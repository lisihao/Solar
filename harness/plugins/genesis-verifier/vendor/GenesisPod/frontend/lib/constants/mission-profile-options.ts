/**
 * Shared mission profile option lists — consumed by both PlaygroundMissionDialog
 * and MissionRunView (company). Single source of truth; no duplication.
 */

import type {
  StyleProfile,
  LengthProfile,
  AudienceProfile,
  AuditLayers,
} from '@/services/agent-playground/api';

export const STYLE_PROFILE_OPTIONS: Array<{
  value: StyleProfile;
  label: string;
}> = [
  { value: 'executive', label: '管理层简报' },
  { value: 'academic', label: '学术论证' },
  { value: 'journalistic', label: '新闻型' },
  { value: 'technical', label: '技术型' },
];

export const LENGTH_PROFILE_OPTIONS: Array<{
  value: LengthProfile;
  label: string;
}> = [
  { value: 'brief', label: '简洁' },
  { value: 'standard', label: '标准（推荐）' },
  { value: 'deep', label: '详细' },
  { value: 'extended', label: '详尽' },
  { value: 'epic', label: '超长' },
  { value: 'mega', label: '极长' },
];

export const AUDIENCE_PROFILE_OPTIONS: Array<{
  value: AudienceProfile;
  label: string;
}> = [
  { value: 'domain-expert', label: '领域专家' },
  { value: 'executive', label: '管理层' },
  { value: 'general-public', label: '大众' },
];

export const AUDIT_LAYERS_OPTIONS: Array<{
  value: AuditLayers;
  label: string;
}> = [
  { value: 'minimal', label: '最简' },
  { value: 'default', label: '标准' },
  { value: 'thorough', label: '完整' },
  { value: 'thorough+', label: '全审' },
];
