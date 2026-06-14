import {
  User,
  SlidersHorizontal,
  Key,
  Wand2,
  Users2,
  Workflow,
  Blocks,
  Bell,
  CreditCard,
  Wrench,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { UserApiKeysTab } from '@/components/me/api-keys/UserApiKeysTab';
import { UserModelsManagement } from '@/components/me/models/UserModelsManagement';
import { AgentTeamSection } from '@/components/me/team/AgentTeamSection';
import { TeamToolsSection } from '@/components/me/team/TeamToolsSection';
import { TeamSkillsSection } from '@/components/me/team/TeamSkillsSection';
import { TeamWorkflowsSection } from '@/components/me/team/TeamWorkflowsSection';
import { NotificationPreferencesView } from '@/components/me/notifications/NotificationPreferencesView';
import { AccountSection } from '@/components/me/sections/AccountSection';
import { GeneralSection } from '@/components/me/sections/GeneralSection';
import { BillingSection } from '@/components/me/sections/BillingSection';
import { IntegrationsSection } from '@/components/me/sections/IntegrationsSection';

export type SettingsGroup = 'profile' | 'ai' | 'team' | 'billing';

export interface SettingsSection {
  /** 路由 section 段，对应 /me/[id] */
  id: string;
  /** i18n key（禁硬编码文案） */
  labelKey: string;
  /** Lucide 图标（禁 emoji） */
  icon: LucideIcon;
  /** 左导航分组 */
  group: SettingsGroup;
  /** section 内容组件 */
  component: React.ComponentType;
}

const NotificationsSection = () => (
  <NotificationPreferencesView showHeader={false} />
);

/** 分组顺序 + 组标题 i18n key */
export const SETTINGS_GROUPS: { group: SettingsGroup; labelKey: string }[] = [
  { group: 'profile', labelKey: 'me.nav.groupProfile' },
  { group: 'ai', labelKey: 'me.nav.groupAi' },
  { group: 'team', labelKey: 'me.nav.groupTeam' },
  { group: 'billing', labelKey: 'me.nav.groupBilling' },
];

/** 全部 section（顺序即左导航内顺序） */
export const SETTINGS_SECTIONS: SettingsSection[] = [
  // 个人
  {
    id: 'account',
    labelKey: 'me.nav.account',
    icon: User,
    group: 'profile',
    component: AccountSection,
  },
  {
    id: 'general',
    labelKey: 'me.nav.general',
    icon: SlidersHorizontal,
    group: 'profile',
    component: GeneralSection,
  },
  // API 与模型（收纯：只剩密钥与模型）
  {
    id: 'api-keys',
    labelKey: 'me.nav.apiKeys',
    icon: Key,
    group: 'ai',
    component: UserApiKeysTab,
  },
  {
    id: 'models',
    labelKey: 'me.nav.models',
    icon: Wand2,
    group: 'ai',
    component: UserModelsManagement,
  },
  // 我的团队（一人公司私有后台）—— 工具/技能由「API 与模型」移入并改名；
  // agents 保留路由 id（/me/agents 不断链），内容换为一人公司 OS。
  {
    id: 'agents',
    labelKey: 'me.nav.agentTeam',
    icon: Users2,
    group: 'team',
    component: AgentTeamSection,
  },
  {
    id: 'tools',
    labelKey: 'me.nav.teamTools',
    icon: Wrench,
    group: 'team',
    component: TeamToolsSection,
  },
  {
    id: 'skills',
    labelKey: 'me.nav.teamSkills',
    icon: Sparkles,
    group: 'team',
    component: TeamSkillsSection,
  },
  {
    id: 'team-workflows',
    labelKey: 'me.nav.teamWorkflows',
    icon: Workflow,
    group: 'team',
    component: TeamWorkflowsSection,
  },
  // 资源与计费
  {
    id: 'integrations',
    labelKey: 'me.nav.integrations',
    icon: Blocks,
    group: 'billing',
    component: IntegrationsSection,
  },
  {
    id: 'notifications',
    labelKey: 'me.nav.notifications',
    icon: Bell,
    group: 'billing',
    component: NotificationsSection,
  },
  {
    id: 'billing',
    labelKey: 'me.nav.billing',
    icon: CreditCard,
    group: 'billing',
    component: BillingSection,
  },
];

export const SETTINGS_SECTION_IDS = SETTINGS_SECTIONS.map((s) => s.id);

export function getSettingsSection(id: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id);
}
