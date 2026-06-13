/**
 * 一人公司 OS · 跨路由共享状态（API-backed，Zustand 作缓存层）。
 *
 * /marketplace（招人/采购）与 /me 我的团队（组队/任命/下任务）通过本 store 联动。
 * loadCompany() 拉取后端快照；写 action 调对应 REST API，成功后更新本地缓存。
 */

import { create } from 'zustand';
import { apiClient } from '@/lib/api/client';
import { toast } from '@/stores/core/toastStore';
import type { Seniority } from '@/components/marketplace/marketplace.types';
import { AVATAR_GRADIENTS } from '@/lib/design/tokens';

/**
 * 平台共享可用的工具 id —— source ∈ platform/granted/user 且 usable=true。
 * 这些工具有可用的 key（平台兜底 / 被授权 / 用户自有），默认 seed 进团队工具池，
 * 让团队开箱即用；需用户自配 key（source=none）的不默认加入，避免塞一堆不能用的。
 */
async function fetchPlatformUsableToolIds(): Promise<string[]> {
  try {
    const res = await apiClient.get<{
      items: { toolId: string; usable: boolean; source: string }[];
    }>('/user/tools');
    return res.items
      .filter((t) => t.usable && t.source !== 'none')
      .map((t) => t.toolId);
  } catch {
    return [];
  }
}

export interface HiredAgent {
  /** 每次招聘生成的唯一实例 id（同一 listing 可招多个） */
  instanceId: string;
  listingId: string;
  name: string;
  role: string;
  seniority: Seniority;
  avatarGradient: string;
  /** 模型 fallback 链（有序，第一个为主模型，后续为备用） */
  models: string[];
  /** 自动 fallback：主模型失败时按链顺序自动切换 */
  autoFallback: boolean;
  /** 已装配技能（listing id），初始 = listing 自带 */
  skillIds: string[];
  /** 已装配工具（listing id），初始 = listing 自带 */
  toolIds: string[];
}

/**
 * 一人公司「Hero」—— 单能力官（如深度研究官），由市场 capability 驱动。
 * 0-config 可用：models 为空时引擎自动择优；autoFallback 控制主模型失败时按链切换。
 */
export interface Hero {
  id: string;
  capabilityId: string;
  name: string;
  /** cosmetic 头像预设 key（纯展示，不入 prompt） */
  avatar?: string;
  /** cosmetic 一句话人设（纯展示，不入 prompt） */
  tagline?: string;
  /** 模型 fallback 链（有序，第一个为主模型）；空数组 => 引擎自动择优 */
  models: string[];
  autoFallback: boolean;
}

export interface CompanyTeam {
  id: string;
  name: string;
  /** 成员 = HiredAgent.instanceId（含 leader） */
  memberIds: string[];
  leaderId: string | null;
  /** 套用的工作流 = TeamWorkflow.id */
  workflowId: string | null;
}

/** 工作流来源：market=从工作流市场获取（私有副本），custom=自建。 */
export type WorkflowOrigin = 'market' | 'custom';

/**
 * 团队工作流（私有）—— 市场获取的副本与自建的统一表示，名称/阶段/角色均可编辑。
 */
export interface TeamWorkflow {
  id: string;
  name: string;
  category: string;
  stages: string[];
  teamSize: number;
  roles: string[];
  origin: WorkflowOrigin;
  /** market 来源的市场 listing id（custom 则无） */
  sourceListingId?: string;
}

export type MissionStatus =
  | 'queued'
  | 'running'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled';

export interface CompanyMission {
  id: string;
  /** 团队任务为团队 ID；Hero 任务为 null（改走 heroId 派发）。 */
  teamId: string | null;
  /** Hero 任务的派发 hero；团队任务为 null。复跑兜底据此精确还原，避免降级到首个 hero。 */
  heroId: string | null;
  title: string;
  status: MissionStatus;
  /** 0–100 */
  progress: number;
  createdAt: number;
  /** 完成后的产物（深度研究报告 / 评审 / 维度等），由 mission runner 写入。 */
  result?: unknown;
}

/** 后端 CompanyMission 原始形状（Prisma 返回，createdAt 为 ISO 字符串） */
interface BackendMission {
  id: string;
  userId: string;
  teamId: string | null;
  heroId?: string | null;
  title: string;
  status: string;
  progress: number;
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

/** 后端原始形状（与前端 UI 形状不同，loadCompany/写操作经 adapt* 映射补齐 UI 字段） */
interface BackendHired {
  id: string;
  listingId: string;
  name: string;
  role: string;
  models: string[];
  autoFallback: boolean;
  skillIds: string[];
  toolIds: string[];
}
interface BackendTeam {
  id: string;
  name: string;
  leaderId: string | null;
  workflowId: string | null;
  members: { hiredAgentId: string }[];
}
/** 后端 CompanyHero 原始形状 */
interface BackendHero {
  id: string;
  capabilityId: string;
  name: string;
  avatar?: string | null;
  tagline?: string | null;
  models: string[];
  autoFallback: boolean;
  createdAt: string;
}
interface BackendWorkflow {
  id: string;
  name: string;
  category: string;
  stages: string[];
  teamSize: number;
  roles: string[];
  origin: string;
  sourceListingId: string | null;
}
interface BackendSnapshot {
  profile: { ceoHiredAgentId: string | null };
  hired: BackendHired[];
  teams: BackendTeam[];
  workflows: BackendWorkflow[];
}

/** 按 id 哈希取头像渐变（UI 字段，后端不存） */
function gradientForId(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return AVATAR_GRADIENTS[Math.abs(h) % AVATAR_GRADIENTS.length];
}
function adaptHired(a: BackendHired): HiredAgent {
  return {
    instanceId: a.id,
    listingId: a.listingId,
    name: a.name,
    role: a.role,
    seniority: 'mid',
    avatarGradient: gradientForId(a.listingId || a.id),
    models: a.models ?? [],
    autoFallback: a.autoFallback,
    skillIds: a.skillIds ?? [],
    toolIds: a.toolIds ?? [],
  };
}
function adaptTeam(t: BackendTeam): CompanyTeam {
  return {
    id: t.id,
    name: t.name,
    leaderId: t.leaderId,
    workflowId: t.workflowId,
    memberIds: (t.members ?? []).map((m) => m.hiredAgentId),
  };
}
function adaptWorkflow(w: BackendWorkflow): TeamWorkflow {
  return {
    id: w.id,
    name: w.name,
    category: w.category,
    stages: w.stages ?? [],
    teamSize: w.teamSize,
    roles: w.roles ?? [],
    origin: w.origin === 'custom' ? 'custom' : 'market',
    sourceListingId: w.sourceListingId ?? undefined,
  };
}

function adaptHero(h: BackendHero): Hero {
  return {
    id: h.id,
    capabilityId: h.capabilityId,
    name: h.name,
    avatar: h.avatar ?? undefined,
    tagline: h.tagline ?? undefined,
    models: h.models ?? [],
    autoFallback: h.autoFallback,
  };
}

function adaptMission(m: BackendMission): CompanyMission {
  const validStatuses: MissionStatus[] = [
    'queued',
    'running',
    'review',
    'done',
    'failed',
    'cancelled',
  ];
  const status: MissionStatus = validStatuses.includes(
    m.status as MissionStatus
  )
    ? (m.status as MissionStatus)
    : 'queued';
  return {
    id: m.id,
    teamId: m.teamId ?? null,
    heroId: m.heroId ?? null,
    title: m.title,
    status,
    progress: m.progress,
    createdAt: new Date(m.createdAt).getTime(),
    result: m.result,
  };
}

interface CompanyState {
  loading: boolean;
  ceoId: string | null;
  hired: HiredAgent[];
  acquiredSkillIds: string[];
  acquiredToolIds: string[];
  teamWorkflows: TeamWorkflow[];
  teams: CompanyTeam[];
  missions: CompanyMission[];
  heroes: Hero[];

  // ―― 快照加载 ――
  loadCompany: () => Promise<void>;

  // ―― 市场采购 ――
  hireAgent: (listingId: string) => Promise<string | null>;
  fireAgent: (instanceId: string) => Promise<void>;
  acquireSkill: (id: string) => void;
  acquireTool: (id: string) => void;
  acquireWorkflow: (sourceListingId: string) => Promise<void>;
  /** 一键成军：从团队模板（工作流 listing）实例化满编团队，返回 teamId。 */
  instantiateTeam: (
    workflowListingId: string,
    name?: string
  ) => Promise<string | null>;

  // ―― 工作流（市场副本 + 自建，统一可编辑）――
  addCustomWorkflow: () => Promise<string | null>;
  renameWorkflow: (id: string, name: string) => Promise<void>;
  updateWorkflow: (id: string, patch: Partial<TeamWorkflow>) => Promise<void>;
  removeWorkflow: (id: string) => Promise<void>;

  // ―― 团队编排 ――
  appointCeo: (instanceId: string | null) => Promise<void>;
  createTeam: (name: string) => Promise<string | null>;
  renameTeam: (teamId: string, name: string) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;
  addMember: (teamId: string, instanceId: string) => Promise<void>;
  removeMember: (teamId: string, instanceId: string) => Promise<void>;
  setLeader: (teamId: string, instanceId: string) => Promise<void>;
  setWorkflow: (teamId: string, workflowId: string | null) => Promise<void>;

  // ―― 成员装配 ――
  toggleAgentSkill: (instanceId: string, skillId: string) => Promise<void>;
  toggleAgentTool: (instanceId: string, toolId: string) => Promise<void>;
  setAgentModels: (instanceId: string, models: string[]) => Promise<void>;
  setAgentAutoFallback: (instanceId: string, value: boolean) => Promise<void>;

  // ―― 任务 ――
  loadMissions: (teamId?: string) => Promise<void>;
  createMission: (teamId: string, title: string) => Promise<string | null>;
  deleteMission: (missionId: string) => Promise<void>;
  cancelMission: (missionId: string) => Promise<void>;
  rerunMission: (missionId: string) => Promise<string | null>;
  renameMission: (missionId: string, title: string) => Promise<void>;
  setMissionProgress: (
    missionId: string,
    progress: number,
    status?: MissionStatus
  ) => void;

  // ―― Hero（一人公司·单能力官）――
  loadHeroes: () => Promise<void>;
  adoptHero: (capabilityId: string) => Promise<string | null>;
  configHero: (
    id: string,
    patch: Partial<
      Pick<Hero, 'name' | 'models' | 'autoFallback' | 'avatar' | 'tagline'>
    >
  ) => Promise<void>;
  removeHero: (id: string) => Promise<void>;
  createHeroMission: (
    heroId: string,
    title: string,
    opts?: {
      description?: string;
      depth?: 'quick' | 'standard' | 'deep';
      language?: 'zh-CN' | 'en-US';
      withFigures?: boolean;
      knowledgeBaseIds?: string[];
      searchTimeRange?: '30d' | '90d' | '180d' | '365d' | '730d' | 'all';
      styleProfile?: 'executive' | 'academic' | 'journalistic' | 'technical';
      lengthProfile?:
        | 'brief'
        | 'standard'
        | 'deep'
        | 'extended'
        | 'epic'
        | 'mega';
      audienceProfile?: 'executive' | 'domain-expert' | 'general-public';
      auditLayers?: 'minimal' | 'default' | 'thorough' | 'thorough+';
    }
  ) => Promise<string | null>;
}

export const useCompanyStore = create<CompanyState>((set, get) => ({
  loading: false,
  ceoId: null,
  hired: [],
  acquiredSkillIds: [],
  acquiredToolIds: [],
  teamWorkflows: [],
  teams: [],
  missions: [],
  heroes: [],

  // ―― 快照加载 ――
  loadCompany: async () => {
    set({ loading: true });
    try {
      const snap = await apiClient.get<BackendSnapshot>('/company');
      const hired = snap.hired.map(adaptHired);
      const allSkillIds = Array.from(new Set(hired.flatMap((a) => a.skillIds)));
      const hiredToolIds = hired.flatMap((a) => a.toolIds);
      // 默认入队：平台共享可用的工具（有平台/授权/自有 key 且 usable）默认进团队工具池，
      // 开箱即用，无需手动加购；与已雇 Agent 自带工具并集。
      const platformToolIds = await fetchPlatformUsableToolIds();
      set({
        ceoId: snap.profile.ceoHiredAgentId ?? null,
        hired,
        teams: snap.teams.map(adaptTeam),
        teamWorkflows: snap.workflows.map(adaptWorkflow),
        acquiredSkillIds: allSkillIds,
        acquiredToolIds: Array.from(
          new Set([...hiredToolIds, ...platformToolIds])
        ),
        loading: false,
      });
    } catch {
      set({ loading: false });
      toast.error('加载公司数据失败，请稍后重试');
    }
  },

  // ―― 市场采购 ――
  hireAgent: async (listingId) => {
    try {
      const agent = adaptHired(
        await apiClient.post<BackendHired>('/company/hire', { listingId })
      );
      set((s) => ({
        hired: [...s.hired, agent],
        acquiredSkillIds: Array.from(
          new Set([...s.acquiredSkillIds, ...agent.skillIds])
        ),
        acquiredToolIds: Array.from(
          new Set([...s.acquiredToolIds, ...agent.toolIds])
        ),
      }));
      return agent.instanceId;
    } catch {
      toast.error('招募 Agent 失败，请稍后重试');
      return null;
    }
  },

  fireAgent: async (instanceId) => {
    const prev = get().hired;
    const prevCeo = get().ceoId;
    const prevTeams = get().teams;
    // 乐观更新
    set((s) => ({
      hired: s.hired.filter((a) => a.instanceId !== instanceId),
      ceoId: s.ceoId === instanceId ? null : s.ceoId,
      teams: s.teams.map((t) => ({
        ...t,
        memberIds: t.memberIds.filter((m) => m !== instanceId),
        leaderId: t.leaderId === instanceId ? null : t.leaderId,
      })),
    }));
    try {
      await apiClient.delete(`/company/hired/${instanceId}`);
    } catch {
      set({ hired: prev, ceoId: prevCeo, teams: prevTeams });
      toast.error('解雇 Agent 失败，请稍后重试');
    }
  },

  acquireSkill: (id) =>
    set((s) => ({
      acquiredSkillIds: Array.from(new Set([...s.acquiredSkillIds, id])),
    })),

  acquireTool: (id) =>
    set((s) => ({
      acquiredToolIds: Array.from(new Set([...s.acquiredToolIds, id])),
    })),

  acquireWorkflow: async (sourceListingId) => {
    if (
      get().teamWorkflows.some((w) => w.sourceListingId === sourceListingId)
    ) {
      return;
    }
    try {
      const wf = adaptWorkflow(
        await apiClient.post<BackendWorkflow>('/company/workflows/acquire', {
          sourceListingId,
        })
      );
      set((s) => ({ teamWorkflows: [...s.teamWorkflows, wf] }));
    } catch {
      toast.error('获取工作流失败，请稍后重试');
    }
  },

  instantiateTeam: async (workflowListingId, name) => {
    try {
      const team = await apiClient.post<BackendTeam>(
        '/company/teams/from-workflow',
        { workflowListingId, ...(name ? { name } : {}) }
      );
      // 雇了人 + 建了队 + 配了工作流/工具，整体重载快照保证一致
      await get().loadCompany();
      return team.id;
    } catch {
      toast.error('组建团队失败，请稍后重试');
      return null;
    }
  },

  // ―― 工作流 ――
  addCustomWorkflow: async () => {
    try {
      const wf = adaptWorkflow(
        await apiClient.post<BackendWorkflow>('/company/workflows/custom')
      );
      set((s) => ({ teamWorkflows: [...s.teamWorkflows, wf] }));
      return wf.id;
    } catch {
      toast.error('创建工作流失败，请稍后重试');
      return null;
    }
  },

  renameWorkflow: async (id, name) => {
    const prev = get().teamWorkflows;
    set((s) => ({
      teamWorkflows: s.teamWorkflows.map((w) =>
        w.id === id ? { ...w, name } : w
      ),
    }));
    try {
      await apiClient.patch(`/company/workflows/${id}`, { name });
    } catch {
      set({ teamWorkflows: prev });
      toast.error('重命名工作流失败，请稍后重试');
    }
  },

  updateWorkflow: async (id, patch) => {
    const prev = get().teamWorkflows;
    set((s) => ({
      teamWorkflows: s.teamWorkflows.map((w) =>
        w.id === id ? { ...w, ...patch } : w
      ),
    }));
    try {
      await apiClient.patch(`/company/workflows/${id}`, patch);
    } catch {
      set({ teamWorkflows: prev });
      toast.error('更新工作流失败，请稍后重试');
    }
  },

  removeWorkflow: async (id) => {
    const prev = get().teamWorkflows;
    const prevTeams = get().teams;
    set((s) => ({
      teamWorkflows: s.teamWorkflows.filter((w) => w.id !== id),
      teams: s.teams.map((t) =>
        t.workflowId === id ? { ...t, workflowId: null } : t
      ),
    }));
    try {
      await apiClient.delete(`/company/workflows/${id}`);
    } catch {
      set({ teamWorkflows: prev, teams: prevTeams });
      toast.error('删除工作流失败，请稍后重试');
    }
  },

  // ―― 团队编排 ――
  appointCeo: async (instanceId) => {
    const prev = get().ceoId;
    set({ ceoId: instanceId });
    try {
      await apiClient.post('/company/ceo', { hiredAgentId: instanceId });
    } catch {
      set({ ceoId: prev });
      toast.error('任命 CEO 失败，请稍后重试');
    }
  },

  createTeam: async (name) => {
    try {
      const team = adaptTeam(
        await apiClient.post<BackendTeam>('/company/teams', { name })
      );
      set((s) => ({ teams: [...s.teams, team] }));
      return team.id;
    } catch {
      toast.error('创建团队失败，请稍后重试');
      return null;
    }
  },

  renameTeam: async (teamId, name) => {
    const prev = get().teams;
    set((s) => ({
      teams: s.teams.map((t) => (t.id === teamId ? { ...t, name } : t)),
    }));
    try {
      await apiClient.patch(`/company/teams/${teamId}`, { name });
    } catch {
      set({ teams: prev });
      toast.error('重命名团队失败，请稍后重试');
    }
  },

  deleteTeam: async (teamId) => {
    const prev = get().teams;
    const prevMissions = get().missions;
    set((s) => ({
      teams: s.teams.filter((t) => t.id !== teamId),
      missions: s.missions.filter((m) => m.teamId !== teamId),
    }));
    try {
      await apiClient.delete(`/company/teams/${teamId}`);
    } catch {
      set({ teams: prev, missions: prevMissions });
      toast.error('删除团队失败，请稍后重试');
    }
  },

  addMember: async (teamId, instanceId) => {
    const prev = get().teams;
    set((s) => ({
      teams: s.teams.map((t) =>
        t.id === teamId && !t.memberIds.includes(instanceId)
          ? { ...t, memberIds: [...t.memberIds, instanceId] }
          : t
      ),
    }));
    try {
      await apiClient.post(`/company/teams/${teamId}/members`, {
        hiredAgentId: instanceId,
      });
    } catch {
      set({ teams: prev });
      toast.error('添加成员失败，请稍后重试');
    }
  },

  removeMember: async (teamId, instanceId) => {
    const prev = get().teams;
    set((s) => ({
      teams: s.teams.map((t) =>
        t.id === teamId
          ? {
              ...t,
              memberIds: t.memberIds.filter((m) => m !== instanceId),
              leaderId: t.leaderId === instanceId ? null : t.leaderId,
            }
          : t
      ),
    }));
    try {
      await apiClient.delete(`/company/teams/${teamId}/members/${instanceId}`);
    } catch {
      set({ teams: prev });
      toast.error('移除成员失败，请稍后重试');
    }
  },

  setLeader: async (teamId, instanceId) => {
    const prev = get().teams;
    set((s) => ({
      teams: s.teams.map((t) =>
        t.id === teamId
          ? {
              ...t,
              leaderId: instanceId,
              memberIds: t.memberIds.includes(instanceId)
                ? t.memberIds
                : [...t.memberIds, instanceId],
            }
          : t
      ),
    }));
    try {
      await apiClient.post(`/company/teams/${teamId}/leader`, {
        hiredAgentId: instanceId,
      });
    } catch {
      set({ teams: prev });
      toast.error('设置 Leader 失败，请稍后重试');
    }
  },

  setWorkflow: async (teamId, workflowId) => {
    const prev = get().teams;
    set((s) => ({
      teams: s.teams.map((t) => (t.id === teamId ? { ...t, workflowId } : t)),
    }));
    try {
      await apiClient.post(`/company/teams/${teamId}/workflow`, { workflowId });
    } catch {
      set({ teams: prev });
      toast.error('设置工作流失败，请稍后重试');
    }
  },

  // ―― 成员装配 ――
  toggleAgentSkill: async (instanceId, skillId) => {
    const prev = get().hired;
    set((s) => ({
      hired: s.hired.map((a) =>
        a.instanceId === instanceId
          ? {
              ...a,
              skillIds: a.skillIds.includes(skillId)
                ? a.skillIds.filter((x) => x !== skillId)
                : [...a.skillIds, skillId],
            }
          : a
      ),
    }));
    const agent = get().hired.find((a) => a.instanceId === instanceId);
    if (!agent) return;
    try {
      await apiClient.patch(`/company/hired/${instanceId}`, {
        skillIds: agent.skillIds,
      });
    } catch {
      set({ hired: prev });
      toast.error('更新技能失败，请稍后重试');
    }
  },

  toggleAgentTool: async (instanceId, toolId) => {
    const prev = get().hired;
    set((s) => ({
      hired: s.hired.map((a) =>
        a.instanceId === instanceId
          ? {
              ...a,
              toolIds: a.toolIds.includes(toolId)
                ? a.toolIds.filter((x) => x !== toolId)
                : [...a.toolIds, toolId],
            }
          : a
      ),
    }));
    const agent = get().hired.find((a) => a.instanceId === instanceId);
    if (!agent) return;
    try {
      await apiClient.patch(`/company/hired/${instanceId}`, {
        toolIds: agent.toolIds,
      });
    } catch {
      set({ hired: prev });
      toast.error('更新工具失败，请稍后重试');
    }
  },

  setAgentModels: async (instanceId, models) => {
    const prev = get().hired;
    set((s) => ({
      hired: s.hired.map((a) =>
        a.instanceId === instanceId ? { ...a, models } : a
      ),
    }));
    try {
      await apiClient.patch(`/company/hired/${instanceId}`, { models });
    } catch {
      set({ hired: prev });
      toast.error('更新模型配置失败，请稍后重试');
    }
  },

  setAgentAutoFallback: async (instanceId, value) => {
    const prev = get().hired;
    set((s) => ({
      hired: s.hired.map((a) =>
        a.instanceId === instanceId ? { ...a, autoFallback: value } : a
      ),
    }));
    try {
      await apiClient.patch(`/company/hired/${instanceId}`, {
        autoFallback: value,
      });
    } catch {
      set({ hired: prev });
      toast.error('更新 fallback 配置失败，请稍后重试');
    }
  },

  // ―― 任务 ――
  loadMissions: async (teamId?: string) => {
    try {
      const path = teamId
        ? `/company/missions?teamId=${encodeURIComponent(teamId)}`
        : '/company/missions';
      const raw = await apiClient.get<
        BackendMission[] | { items?: BackendMission[] }
      >(path);
      // apiClient 已自动解包 { success, data } envelope；
      // 后端直接返回数组（ResponseTransformInterceptor 包裹后 data = array）
      const arr: BackendMission[] = Array.isArray(raw)
        ? raw
        : ((raw as { items?: BackendMission[] }).items ?? []);
      set({ missions: arr.map(adaptMission) });
    } catch {
      toast.error('加载任务列表失败，请稍后重试');
    }
  },

  createMission: async (teamId, title) => {
    try {
      const raw = await apiClient.post<BackendMission>(
        `/company/teams/${encodeURIComponent(teamId)}/missions`,
        { title }
      );
      const mission = adaptMission(raw);
      set((s) => ({ missions: [mission, ...s.missions] }));
      return mission.id;
    } catch {
      toast.error('创建任务失败，请稍后重试');
      return null;
    }
  },

  deleteMission: async (missionId) => {
    // 乐观删除：先从本地移除，失败再回滚
    const prev = get().missions;
    set({ missions: prev.filter((m) => m.id !== missionId) });
    try {
      await apiClient.delete(
        `/company/missions/${encodeURIComponent(missionId)}`
      );
    } catch {
      set({ missions: prev });
      toast.error('删除任务失败，请稍后重试');
    }
  },

  cancelMission: async (missionId) => {
    // 乐观置 cancelled：立即翻状态，失败再回滚
    const prev = get().missions;
    set({
      missions: prev.map((m) =>
        m.id === missionId ? { ...m, status: 'cancelled' as MissionStatus } : m
      ),
    });
    try {
      await apiClient.post(
        `/company/missions/${encodeURIComponent(missionId)}/cancel`,
        {}
      );
    } catch {
      set({ missions: prev });
      toast.error('取消任务失败，请稍后重试');
    }
  },

  rerunMission: async (missionId) => {
    try {
      // 后端用原派发参数（depth/语言/知识库/图文）创建全新任务重跑，返回完整 mission 行。
      const raw = await apiClient.post<BackendMission>(
        `/company/missions/${encodeURIComponent(missionId)}/rerun`,
        {}
      );
      const mission = adaptMission(raw);
      set((s) => ({ missions: [mission, ...s.missions] }));
      toast.success('已复跑，新任务已创建');
      return mission.id;
    } catch {
      toast.error('复跑失败，请稍后重试');
      return null;
    }
  },

  renameMission: async (missionId, title) => {
    const prev = get().missions;
    set({
      missions: prev.map((m) => (m.id === missionId ? { ...m, title } : m)),
    });
    try {
      await apiClient.patch(
        `/company/missions/${encodeURIComponent(missionId)}`,
        { title }
      );
    } catch {
      set({ missions: prev });
      toast.error('重命名失败，请稍后重试');
    }
  },

  setMissionProgress: (missionId, progress, status) =>
    set((s) => ({
      missions: s.missions.map((m) =>
        m.id === missionId
          ? {
              ...m,
              progress,
              status: status ?? (progress >= 100 ? 'done' : m.status),
            }
          : m
      ),
    })),

  // ―― Hero（一人公司·单能力官）――
  loadHeroes: async () => {
    try {
      const raw = await apiClient.get<
        BackendHero[] | { items?: BackendHero[] }
      >('/company/heroes');
      // apiClient 已解包 envelope；后端零 hero 时自动配发 1 个默认 hero 并返回
      const arr: BackendHero[] = Array.isArray(raw)
        ? raw
        : ((raw as { items?: BackendHero[] }).items ?? []);
      set({ heroes: arr.map(adaptHero) });
    } catch {
      toast.error('加载 Hero 列表失败，请稍后重试');
    }
  },

  adoptHero: async (capabilityId) => {
    try {
      const hero = adaptHero(
        await apiClient.post<BackendHero>('/company/heroes', { capabilityId })
      );
      set((s) => ({ heroes: [hero, ...s.heroes] }));
      return hero.id;
    } catch {
      toast.error('采用 Hero 失败，请稍后重试');
      return null;
    }
  },

  configHero: async (id, patch) => {
    const prev = get().heroes;
    set((s) => ({
      heroes: s.heroes.map((h) => (h.id === id ? { ...h, ...patch } : h)),
    }));
    try {
      await apiClient.patch(`/company/heroes/${encodeURIComponent(id)}`, patch);
    } catch {
      set({ heroes: prev });
      toast.error('更新 Hero 配置失败，请稍后重试');
    }
  },

  removeHero: async (id) => {
    const prev = get().heroes;
    set((s) => ({ heroes: s.heroes.filter((h) => h.id !== id) }));
    try {
      await apiClient.delete(`/company/heroes/${encodeURIComponent(id)}`);
    } catch {
      set({ heroes: prev });
      toast.error('移除 Hero 失败，请稍后重试');
    }
  },

  createHeroMission: async (heroId, title, opts) => {
    try {
      const raw = await apiClient.post<BackendMission>(
        `/company/heroes/${encodeURIComponent(heroId)}/missions`,
        {
          title,
          description: opts?.description,
          depth: opts?.depth,
          language: opts?.language,
          withFigures: opts?.withFigures,
          knowledgeBaseIds: opts?.knowledgeBaseIds,
          searchTimeRange: opts?.searchTimeRange,
          styleProfile: opts?.styleProfile,
          lengthProfile: opts?.lengthProfile,
          audienceProfile: opts?.audienceProfile,
          auditLayers: opts?.auditLayers,
        }
      );
      const mission = adaptMission(raw);
      set((s) => ({ missions: [mission, ...s.missions] }));
      return mission.id;
    } catch {
      toast.error('下达任务失败，请稍后重试');
      return null;
    }
  },
}));
