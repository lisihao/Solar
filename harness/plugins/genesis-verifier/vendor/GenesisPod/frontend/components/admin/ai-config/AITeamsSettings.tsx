'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Crown,
  Loader2,
  AlertCircle,
  UserPlus,
  Sparkles,
  X,
  ArrowLeft,
  Settings,
} from 'lucide-react';
import * as api from '@/services/admin-ai-teams/api';
import type {
  AITeamTemplate,
  AITeamMemberTemplate,
  CreateTeamDto,
  UpdateTeamDto,
} from '@/services/admin-ai-teams/api';
import AITeamMemberEditor from './AITeamMemberEditor';
import { toast, confirm } from '@/stores';

// ==================== Team Form Modal ====================

interface TeamFormModalProps {
  team?: AITeamTemplate | null;
  onClose: () => void;
  onSave: (dto: CreateTeamDto | UpdateTeamDto) => Promise<void>;
}

function TeamFormModal({ team, onClose, onSave }: TeamFormModalProps) {
  const [name, setName] = useState(team?.name || '');
  const [displayName, setDisplayName] = useState(team?.displayName || '');
  const [description, setDescription] = useState(team?.description || '');
  const [icon, setIcon] = useState(team?.icon || '');
  const [color, setColor] = useState(team?.color || '#3B82F6');
  const [category, setCategory] = useState(team?.category || 'writing');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name,
        displayName,
        description: description || undefined,
        icon: icon || undefined,
        color: color || undefined,
        category: category || undefined,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">
            {team ? 'Edit Team' : 'Create Team'}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <form
          onSubmit={handleSubmit}
          className="flex-1 space-y-4 overflow-y-auto px-6 py-4"
        >
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Internal ID *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="writing-team"
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Display Name *
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Writing Team"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              rows={3}
              placeholder="Team description..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Icon
              </label>
              <input
                type="text"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="emoji"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Color
              </label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-[42px] w-full rounded-lg border border-gray-300"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="writing">Writing</option>
                <option value="research">Research</option>
                <option value="design">Design</option>
              </select>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={(e) => {
              e.preventDefault();
              const form = document.querySelector('form');
              if (form) form.requestSubmit();
            }}
            disabled={saving || !name || !displayName}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {team ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== Team Detail Panel ====================

interface TeamDetailPanelProps {
  team: AITeamTemplate;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMemberSave: (
    data: api.CreateTeamMemberDto | api.UpdateTeamMemberDto
  ) => Promise<void>;
  onMemberDelete: (member: AITeamMemberTemplate) => Promise<void>;
  onGenerateConfig: () => Promise<void>;
  generatingConfig: boolean;
}

function TeamDetailPanel({
  team,
  onBack,
  onEdit,
  onDelete,
  onMemberSave,
  onMemberDelete,
  onGenerateConfig,
  generatingConfig,
}: TeamDetailPanelProps) {
  const [showMemberEditor, setShowMemberEditor] = useState(false);
  const [editingMember, setEditingMember] =
    useState<AITeamMemberTemplate | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Teams
        </button>
        <div className="flex gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Pencil className="h-4 w-4" />
            Edit
          </button>
          {!team.isSystem && (
            <button
              onClick={onDelete}
              className="flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Team Info Card */}
      <div className="rounded-xl border-2 border-gray-200 bg-white p-6">
        <div className="flex items-start gap-4">
          <div
            className="flex h-16 w-16 items-center justify-center rounded-xl text-3xl"
            style={{ backgroundColor: team.color || '#E5E7EB' }}
          >
            {team.icon || '👥'}
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold text-gray-900">
              {team.displayName}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {team.description || 'No description'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                {team.category || 'Uncategorized'}
              </span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  team.status === 'ACTIVE'
                    ? 'bg-green-100 text-green-700'
                    : team.status === 'DRAFT'
                      ? 'bg-yellow-100 text-yellow-700'
                      : 'bg-gray-100 text-gray-600'
                }`}
              >
                {team.status === 'ACTIVE'
                  ? 'Active'
                  : team.status === 'DRAFT'
                    ? 'Draft'
                    : 'Archived'}
              </span>
              {team.isSystem && (
                <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                  System
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Team Members */}
      <div className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-500" />
            <h3 className="font-semibold text-gray-900">Team Members</h3>
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              {team.members?.length || 0}
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onGenerateConfig}
              disabled={generatingConfig}
              className="flex items-center gap-1.5 rounded-lg border border-purple-300 bg-purple-50 px-3 py-1.5 text-sm font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
            >
              {generatingConfig ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              AI Generate
            </button>
            <button
              onClick={() => {
                setEditingMember(null);
                setShowMemberEditor(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              <UserPlus className="h-4 w-4" />
              Add Member
            </button>
          </div>
        </div>

        {/* Members List */}
        <div className="divide-y divide-gray-100">
          {team.members?.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50"
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-xl">
                {member.avatar || member.displayName[0]}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">
                    {member.displayName}
                  </span>
                  {member.isLeader && (
                    <Crown className="h-4 w-4 text-yellow-500" />
                  )}
                </div>
                <div className="text-sm text-gray-500">
                  {member.roleDescription || member.roleId}
                </div>
              </div>
              <div className="flex items-center gap-3 text-sm text-gray-500">
                {member.workStyle && (
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
                    {member.workStyle}
                  </span>
                )}
                <span>{member.capabilities?.length || 0} tools</span>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    setEditingMember(member);
                    setShowMemberEditor(true);
                  }}
                  className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onMemberDelete(member)}
                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          {(!team.members || team.members.length === 0) && (
            <div className="py-12 text-center text-sm text-gray-500">
              No members yet. Click "Add Member" or "AI Generate" to add team
              members.
            </div>
          )}
        </div>
      </div>

      {/* Member Editor Modal */}
      {showMemberEditor && (
        <AITeamMemberEditor
          member={editingMember}
          onClose={() => {
            setShowMemberEditor(false);
            setEditingMember(null);
          }}
          onSave={async (data) => {
            await onMemberSave(data);
            setShowMemberEditor(false);
            setEditingMember(null);
          }}
        />
      )}
    </div>
  );
}

// ==================== Main Component ====================

interface AITeamsSettingsProps {
  showCreateModal?: boolean;
  setShowCreateModal?: (show: boolean) => void;
  searchQuery?: string;
}

export default function AITeamsSettings({
  showCreateModal,
  setShowCreateModal,
  searchQuery = '',
}: AITeamsSettingsProps) {
  const [teams, setTeams] = useState<AITeamTemplate[]>([]);
  const [selectedTeam, setSelectedTeam] = useState<AITeamTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [internalShowTeamForm, setInternalShowTeamForm] = useState(false);
  const showTeamForm = showCreateModal ?? internalShowTeamForm;
  const setShowTeamForm = setShowCreateModal ?? setInternalShowTeamForm;
  const [editingTeam, setEditingTeam] = useState<AITeamTemplate | null>(null);
  const [generatingConfig, setGeneratingConfig] = useState(false);

  // Load teams
  const loadTeams = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result = await api.getTeams({ includeMembers: true });
      setTeams(result.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // Team CRUD
  const handleCreateTeam = async (dto: CreateTeamDto | UpdateTeamDto) => {
    const team = await api.createTeam(dto as CreateTeamDto);
    setTeams((prev) => [...prev, team]);
    setSelectedTeam(team);
  };

  const handleUpdateTeam = async (dto: CreateTeamDto | UpdateTeamDto) => {
    if (!editingTeam) return;
    const updated = await api.updateTeam(editingTeam.id, dto as UpdateTeamDto);
    setTeams((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    if (selectedTeam?.id === updated.id) {
      setSelectedTeam(updated);
    }
  };

  const handleDeleteTeam = async (team: AITeamTemplate) => {
    if (team.isSystem) {
      toast.warning('System teams cannot be deleted');
      return;
    }
    if (
      !(await confirm({
        title: `Delete team "${team.displayName}"?`,
        type: 'danger',
      }))
    )
      return;

    await api.deleteTeam(team.id);
    setTeams((prev) => prev.filter((t) => t.id !== team.id));
    setSelectedTeam(null);
  };

  // Member CRUD
  const handleSaveMember = async (
    memberData: api.CreateTeamMemberDto | api.UpdateTeamMemberDto,
    editingMember: AITeamMemberTemplate | null
  ) => {
    if (!selectedTeam) return;

    if (editingMember) {
      const updated = await api.updateMember(
        editingMember.id,
        memberData as api.UpdateTeamMemberDto
      );
      const newTeam = {
        ...selectedTeam,
        members: selectedTeam.members?.map((m) =>
          m.id === updated.id ? updated : m
        ),
      };
      setSelectedTeam(newTeam);
      setTeams((prev) => prev.map((t) => (t.id === newTeam.id ? newTeam : t)));
    } else {
      const newMember = await api.addMember(
        selectedTeam.id,
        memberData as api.CreateTeamMemberDto
      );
      const newTeam = {
        ...selectedTeam,
        members: [...(selectedTeam.members || []), newMember],
      };
      setSelectedTeam(newTeam);
      setTeams((prev) => prev.map((t) => (t.id === newTeam.id ? newTeam : t)));
    }
  };

  const handleDeleteMember = async (member: AITeamMemberTemplate) => {
    if (
      !(await confirm({
        title: `Delete member "${member.displayName}"?`,
        type: 'danger',
      }))
    )
      return;

    await api.deleteMember(member.id);
    if (selectedTeam) {
      const newTeam = {
        ...selectedTeam,
        members: selectedTeam.members?.filter((m) => m.id !== member.id),
      };
      setSelectedTeam(newTeam);
      setTeams((prev) => prev.map((t) => (t.id === newTeam.id ? newTeam : t)));
    }
  };

  // AI Configuration Generation
  const handleGenerateConfig = async () => {
    if (!selectedTeam) return;

    const existingCount = selectedTeam.members?.length || 0;
    if (existingCount > 0) {
      if (
        !(await confirm({
          title: `Team has ${existingCount} members. AI will generate and add new members. Continue?`,
          type: 'warning',
        }))
      )
        return;
    }

    setGeneratingConfig(true);
    try {
      const result = await api.generateTeamConfig({
        teamName: selectedTeam.displayName,
        teamDescription: selectedTeam.description,
        category: selectedTeam.category,
      });

      const addedMembers: AITeamMemberTemplate[] = [];
      for (const memberConfig of result.members) {
        const newMember = await api.addMember(selectedTeam.id, {
          name: memberConfig.name,
          displayName: memberConfig.displayName,
          avatar: memberConfig.avatar,
          roleId: memberConfig.roleId,
          isLeader: memberConfig.isLeader,
          roleDescription: memberConfig.roleDescription,
          personality: memberConfig.personality,
          workStyle: memberConfig.workStyle,
          capabilities: memberConfig.capabilities,
          expertiseAreas: memberConfig.expertiseAreas,
          systemPrompt: memberConfig.systemPrompt,
        });
        addedMembers.push(newMember);
      }

      const newTeam = {
        ...selectedTeam,
        members: [...(selectedTeam.members || []), ...addedMembers],
      };
      setSelectedTeam(newTeam);
      setTeams((prev) => prev.map((t) => (t.id === newTeam.id ? newTeam : t)));

      toast.success(`Added ${addedMembers.length} AI-generated members!`);
    } catch (err) {
      toast.error('AI generation failed', (err as Error).message);
    } finally {
      setGeneratingConfig(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <div className="flex items-center gap-2 text-red-700">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  // Filter teams
  const filteredTeams = teams.filter(
    (team) =>
      !searchQuery ||
      team.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      team.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      team.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Detail view
  if (selectedTeam) {
    return (
      <>
        <TeamDetailPanel
          team={selectedTeam}
          onBack={() => setSelectedTeam(null)}
          onEdit={() => {
            setEditingTeam(selectedTeam);
            setShowTeamForm(true);
          }}
          onDelete={() => handleDeleteTeam(selectedTeam)}
          onMemberSave={(data) => handleSaveMember(data, null)}
          onMemberDelete={handleDeleteMember}
          onGenerateConfig={handleGenerateConfig}
          generatingConfig={generatingConfig}
        />

        {showTeamForm && (
          <TeamFormModal
            team={editingTeam}
            onClose={() => {
              setShowTeamForm(false);
              setEditingTeam(null);
            }}
            onSave={editingTeam ? handleUpdateTeam : handleCreateTeam}
          />
        )}
      </>
    );
  }

  // Card grid view
  return (
    <>
      {/* Teams Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredTeams.map((team) => (
          <div
            key={team.id}
            onClick={() => setSelectedTeam(team)}
            className="cursor-pointer rounded-xl border-2 border-gray-200 bg-white p-5 shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
          >
            {/* Header */}
            <div className="mb-4 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div
                  className="flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
                  style={{ backgroundColor: team.color || '#E5E7EB' }}
                >
                  {team.icon || '👥'}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">
                      {team.displayName}
                    </h3>
                    {team.isSystem && (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                        System
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">
                    {team.category || 'Uncategorized'}
                  </p>
                </div>
              </div>
            </div>

            {/* Description */}
            <p className="mb-4 line-clamp-2 text-sm text-gray-600">
              {team.description || 'No description'}
            </p>

            {/* Info */}
            <div className="mb-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Members:</span>
                <span className="font-medium text-gray-700">
                  {team.members?.length || 0}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Status:</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    team.status === 'ACTIVE'
                      ? 'bg-green-100 text-green-700'
                      : team.status === 'DRAFT'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {team.status === 'ACTIVE'
                    ? 'Active'
                    : team.status === 'DRAFT'
                      ? 'Draft'
                      : 'Archived'}
                </span>
              </div>
            </div>

            {/* Member Avatars */}
            {team.members && team.members.length > 0 && (
              <div className="flex items-center gap-1">
                <div className="flex -space-x-2">
                  {team.members.slice(0, 5).map((member) => (
                    <div
                      key={member.id}
                      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-gray-100 text-sm"
                      title={member.displayName}
                    >
                      {member.avatar || member.displayName[0]}
                    </div>
                  ))}
                </div>
                {team.members.length > 5 && (
                  <span className="ml-2 text-xs text-gray-500">
                    +{team.members.length - 5} more
                  </span>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mt-4 flex gap-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedTeam(team);
                }}
                className="flex flex-1 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
              >
                <Settings className="h-4 w-4" />
                Manage
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTeam(team);
                  setShowTeamForm(true);
                }}
                className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-gray-600 transition-colors hover:bg-gray-100"
              >
                <Pencil className="h-4 w-4" />
              </button>
              {!team.isSystem && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteTeam(team);
                  }}
                  className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 transition-colors hover:bg-red-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        ))}

        {filteredTeams.length === 0 && (
          <div className="col-span-full py-12 text-center text-gray-500">
            {searchQuery
              ? 'No teams match your search'
              : 'No teams yet. Click "Add Team" to create one.'}
          </div>
        )}
      </div>

      {/* Team Form Modal */}
      {showTeamForm && (
        <TeamFormModal
          team={editingTeam}
          onClose={() => {
            setShowTeamForm(false);
            setEditingTeam(null);
          }}
          onSave={editingTeam ? handleUpdateTeam : handleCreateTeam}
        />
      )}
    </>
  );
}
