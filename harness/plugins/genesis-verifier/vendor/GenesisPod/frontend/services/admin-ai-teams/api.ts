/**
 * Admin AI Teams API Client
 *
 * API functions for managing AI team templates in the admin panel
 */

import { apiClient } from '@/lib/api/client';

// ==================== Types ====================

export type AITeamTemplateStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED';

export type AICapability =
  | 'TEXT_GENERATION'
  | 'CODE_GENERATION'
  | 'CODE_REVIEW'
  | 'IMAGE_GENERATION'
  | 'IMAGE_ANALYSIS'
  | 'WEB_SEARCH'
  | 'URL_FETCH'
  | 'DOCUMENT_ANALYSIS'
  | 'REASONING'
  | 'MATH'
  | 'TRANSLATION'
  | 'SUMMARIZATION';

export type AgentWorkStyle =
  | 'AUTONOMOUS'
  | 'COLLABORATIVE'
  | 'SUPPORTIVE'
  | 'ANALYTICAL'
  | 'CREATIVE';

export interface MCPToolConfig {
  id: string;
  name: string;
  description?: string;
  serverUrl?: string;
  isEnabled: boolean;
  parameters?: Record<string, unknown>;
}

export interface AITeamMemberTemplate {
  id: string;
  teamId: string;
  name: string;
  displayName: string;
  avatar?: string;
  roleDescription?: string;
  personality?: string;
  roleId: string;
  isLeader: boolean;
  defaultModel?: string;
  capabilities: AICapability[];
  workStyle?: AgentWorkStyle;
  expertiseAreas: string[];
  mcpTools?: MCPToolConfig[];
  systemPrompt?: string;
  sortOrder: number;
  minCount: number;
  maxCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AITeamTemplate {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  status: AITeamTemplateStatus;
  isSystem: boolean;
  sortOrder: number;
  workflowConfig?: Record<string, unknown>;
  constraintProfile?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  members?: AITeamMemberTemplate[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeamDto {
  name: string;
  displayName: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  status?: AITeamTemplateStatus;
  isSystem?: boolean;
  sortOrder?: number;
  workflowConfig?: Record<string, unknown>;
  constraintProfile?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  members?: CreateTeamMemberDto[];
}

export interface UpdateTeamDto {
  name?: string;
  displayName?: string;
  description?: string;
  icon?: string;
  color?: string;
  category?: string;
  status?: AITeamTemplateStatus;
  sortOrder?: number;
  workflowConfig?: Record<string, unknown>;
  constraintProfile?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface CreateTeamMemberDto {
  name: string;
  displayName: string;
  avatar?: string;
  roleDescription?: string;
  personality?: string;
  roleId: string;
  isLeader?: boolean;
  defaultModel?: string;
  capabilities?: AICapability[];
  workStyle?: AgentWorkStyle;
  expertiseAreas?: string[];
  mcpTools?: MCPToolConfig[];
  systemPrompt?: string;
  sortOrder?: number;
  minCount?: number;
  maxCount?: number;
}

export interface UpdateTeamMemberDto {
  name?: string;
  displayName?: string;
  avatar?: string;
  roleDescription?: string;
  personality?: string;
  roleId?: string;
  isLeader?: boolean;
  defaultModel?: string;
  capabilities?: AICapability[];
  workStyle?: AgentWorkStyle;
  expertiseAreas?: string[];
  mcpTools?: MCPToolConfig[];
  systemPrompt?: string;
  sortOrder?: number;
  minCount?: number;
  maxCount?: number;
}

export interface ToolInfo {
  id: string;
  name: string;
  description: string;
}

export interface SkillInfo {
  id: string;
  name: string;
}

export interface RoleInfo {
  id: string;
  name: string;
  description: string;
}

export interface WorkStyleInfo {
  id: string;
  name: string;
  description: string;
}

// ==================== Admin API ====================

/**
 * Create a new AI team template
 */
export async function createTeam(dto: CreateTeamDto): Promise<AITeamTemplate> {
  return apiClient.post('/admin/ai-teams', dto);
}

/**
 * Get all AI team templates
 */
export async function getTeams(options?: {
  status?: AITeamTemplateStatus;
  category?: string;
  includeMembers?: boolean;
}): Promise<{ items: AITeamTemplate[]; total: number }> {
  const params = new URLSearchParams();
  if (options?.status) params.set('status', options.status);
  if (options?.category) params.set('category', options.category);
  if (options?.includeMembers !== undefined) {
    params.set('includeMembers', String(options.includeMembers));
  }
  const query = params.toString();
  return apiClient.get(`/admin/ai-teams${query ? `?${query}` : ''}`);
}

/**
 * Get a single AI team template by ID
 */
export async function getTeam(id: string): Promise<AITeamTemplate> {
  return apiClient.get(`/admin/ai-teams/${id}`);
}

/**
 * Update an AI team template
 */
export async function updateTeam(
  id: string,
  dto: UpdateTeamDto
): Promise<AITeamTemplate> {
  return apiClient.patch(`/admin/ai-teams/${id}`, dto);
}

/**
 * Delete an AI team template
 */
export async function deleteTeam(
  id: string
): Promise<{ success: boolean; message: string }> {
  return apiClient.delete(`/admin/ai-teams/${id}`);
}

// ==================== Member API ====================

/**
 * Add a member to a team
 */
export async function addMember(
  teamId: string,
  dto: CreateTeamMemberDto
): Promise<AITeamMemberTemplate> {
  return apiClient.post(`/admin/ai-teams/${teamId}/members`, dto);
}

/**
 * Update a team member
 */
export async function updateMember(
  memberId: string,
  dto: UpdateTeamMemberDto
): Promise<AITeamMemberTemplate> {
  return apiClient.patch(`/admin/ai-teams/members/${memberId}`, dto);
}

/**
 * Delete a team member
 */
export async function deleteMember(
  memberId: string
): Promise<{ success: boolean; message: string }> {
  return apiClient.delete(`/admin/ai-teams/members/${memberId}`);
}

/**
 * Reorder team members
 */
export async function reorderMembers(
  teamId: string,
  memberIds: string[]
): Promise<AITeamTemplate> {
  return apiClient.post(`/admin/ai-teams/${teamId}/reorder`, {
    memberIds,
  });
}

// ==================== Utility API ====================

/**
 * Get available built-in tools
 */
export async function getAvailableTools(): Promise<{ builtIn: ToolInfo[] }> {
  return apiClient.get('/admin/ai-teams/tools');
}

/**
 * Get available skills
 */
export async function getAvailableSkills(): Promise<
  Record<string, SkillInfo[]>
> {
  return apiClient.get('/admin/ai-teams/skills');
}

/**
 * Get built-in roles
 */
export async function getBuiltInRoles(): Promise<{
  leaders: RoleInfo[];
  members: RoleInfo[];
}> {
  return apiClient.get('/admin/ai-teams/roles');
}

/**
 * Get available work styles
 */
export async function getWorkStyles(): Promise<WorkStyleInfo[]> {
  return apiClient.get('/admin/ai-teams/work-styles');
}

// ==================== AI Configuration ====================

export interface GeneratedMemberConfig {
  name: string;
  displayName: string;
  avatar?: string;
  roleId: string;
  isLeader: boolean;
  roleDescription?: string;
  personality?: string;
  workStyle?: AgentWorkStyle;
  capabilities?: AICapability[];
  expertiseAreas?: string[];
  systemPrompt?: string;
}

export interface GeneratedTeamConfig {
  members: GeneratedMemberConfig[];
}

/**
 * Use AI to generate team member configuration
 */
export async function generateTeamConfig(params: {
  teamName: string;
  teamDescription?: string;
  category?: string;
}): Promise<GeneratedTeamConfig> {
  return apiClient.post('/admin/ai-teams/generate-config', params);
}

// ==================== Public API (for apps) ====================

/**
 * Get active team templates (for use by apps)
 */
export async function getActiveTemplates(
  category?: string
): Promise<AITeamTemplate[]> {
  const params = category ? `?category=${category}` : '';
  return apiClient.get(`/ai-teams/templates${params}`);
}

/**
 * Get a team template by ID (public)
 */
export async function getTemplateById(id: string): Promise<AITeamTemplate> {
  return apiClient.get(`/ai-teams/templates/${id}`);
}
