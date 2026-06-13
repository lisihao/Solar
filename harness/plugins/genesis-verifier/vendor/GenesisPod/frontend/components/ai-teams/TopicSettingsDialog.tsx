'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Topic,
  TopicAIMember,
  UpdateTopicDto,
  AddAIMemberDto,
  TopicRole,
} from '@/lib/types/ai-teams';
import { Tabs } from '@/components/ui/tabs';
import { useAiGroupStore } from '@/stores/ai-teams';
import { useAIModels, AIModel } from '@/hooks';
import { ModelBadges } from '@/components/common/badges/ModelBadges';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import * as aiGroupApi from '@/services/ai-teams/api';
import { JoinRequest } from '@/services/ai-teams/api';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState, LoadingInline } from '@/components/ui';
import { Bot, CheckCircle } from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import { ErrorInline } from '@/components/ui/states/ErrorState';

import { logger } from '@/lib/utils/logger';
import { toast } from '@/stores';
import ClientDate from '@/components/common/ClientDate';
// User search result type
interface SearchedUser {
  id: string;
  email: string;
  username?: string;
  fullName?: string;
  avatarUrl?: string;
}

interface TopicSettingsDialogProps {
  topic: Topic;
  onClose: () => void;
}

export default function TopicSettingsDialog({
  topic,
  onClose,
}: TopicSettingsDialogProps) {
  const [activeTab, setActiveTab] = useState<
    'general' | 'ai' | 'members' | 'requests' | 'danger'
  >('general');
  const {
    updateTopic,
    addAIMember,
    updateAIMember,
    removeAIMember,
    addMember,
    removeMember,
    deleteTopic,
    fetchTopic,
  } = useAiGroupStore();

  // Join requests state
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [isLoadingRequests, setIsLoadingRequests] = useState(false);

  // Load join requests when requests tab is active
  useEffect(() => {
    if (activeTab === 'requests') {
      setIsLoadingRequests(true);
      aiGroupApi
        .getJoinRequests(topic.id)
        .then(setJoinRequests)
        .catch((err) => logger.error('Failed to fetch join requests:', err))
        .finally(() => setIsLoadingRequests(false));
    }
  }, [activeTab, topic.id]);

  const handleReviewRequest = async (requestId: string, approve: boolean) => {
    try {
      await aiGroupApi.reviewJoinRequest(requestId, approve);
      // Refresh the list
      const requests = await aiGroupApi.getJoinRequests(topic.id);
      setJoinRequests(requests);
      // Refresh topic to update member count
      await fetchTopic(topic.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to process request'
      );
    }
  };

  return (
    <Modal open onClose={onClose} title="Team Settings" size="xl">
      {/* Tabs */}
      <Tabs
        className="px-6"
        items={[
          { key: 'general', label: 'General' },
          { key: 'ai', label: 'AI Assistants' },
          { key: 'members', label: 'Members' },
          {
            key: 'requests',
            label: 'Join Requests',
            count: joinRequests.length > 0 ? joinRequests.length : undefined,
          },
          { key: 'danger', label: 'Danger Zone' },
        ]}
        value={activeTab}
        onChange={(k) => setActiveTab(k as typeof activeTab)}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {activeTab === 'general' && (
          <GeneralSettings topic={topic} onUpdate={updateTopic} />
        )}
        {activeTab === 'ai' && (
          <AISettings
            topic={topic}
            onAdd={addAIMember}
            onUpdate={updateAIMember}
            onRemove={removeAIMember}
          />
        )}
        {activeTab === 'members' && (
          <MemberSettings
            topic={topic}
            onAdd={addMember}
            onRemove={removeMember}
          />
        )}
        {activeTab === 'requests' && (
          <JoinRequestsSettings
            requests={joinRequests}
            isLoading={isLoadingRequests}
            onApprove={(requestId) => handleReviewRequest(requestId, true)}
            onReject={(requestId) => handleReviewRequest(requestId, false)}
          />
        )}
        {activeTab === 'danger' && (
          <DangerSettings
            topic={topic}
            onDelete={deleteTopic}
            onClose={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

// General Settings Tab
function GeneralSettings({
  topic,
  onUpdate,
}: {
  topic: Topic;
  onUpdate: (topicId: string, dto: UpdateTopicDto) => Promise<void>;
}) {
  const [name, setName] = useState(topic.name);
  const [description, setDescription] = useState(topic.description || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onUpdate(topic.id, {
        name: name.trim(),
        description: description.trim() || undefined,
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700">
          Team Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={!name.trim() || isSaving}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

// AI Settings Tab
function AISettings({
  topic,
  onAdd,
  onUpdate,
  onRemove,
}: {
  topic: Topic;
  onAdd: (topicId: string, dto: AddAIMemberDto) => Promise<void>;
  onUpdate: (
    topicId: string,
    aiMemberId: string,
    dto: Partial<AddAIMemberDto>
  ) => Promise<void>;
  onRemove: (topicId: string, aiMemberId: string) => Promise<void>;
}) {
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingAI, setEditingAI] = useState<TopicAIMember | null>(null);
  const { models } = useAIModels();

  // 查找模型：优先用 modelId 匹配（新方式），兼容 modelName 匹配（旧数据）
  const findModel = (aiModel: string) =>
    (models || []).find((m) => m.modelId === aiModel) ||
    (models || []).find((m) => m.modelName === aiModel);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">AI Assistants</h3>
        <button
          onClick={() => setShowAddDialog(true)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add AI
        </button>
      </div>

      {(topic.aiMembers || []).length === 0 ? (
        <EmptyState
          size="sm"
          icon={<Bot className="h-8 w-8" />}
          title="No AI assistants added yet"
        />
      ) : (
        <div className="space-y-2">
          {(topic.aiMembers || []).map((ai) => {
            const model = findModel(ai.aiModel);
            return (
              <div
                key={ai.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 p-4"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-green-100 to-blue-100 text-xl">
                    🤖
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">
                      {ai.displayName}
                    </div>
                    <div className="text-sm text-gray-500">
                      {model?.name || ai.aiModel}
                    </div>
                    {ai.roleDescription && (
                      <div className="text-xs text-gray-400">
                        {ai.roleDescription}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setEditingAI(ai)}
                    className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                  </button>
                  <button
                    onClick={() => onRemove(topic.id, ai.id)}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <svg
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add AI Dialog */}
      {showAddDialog && (
        <AddAIDialog
          topicId={topic.id}
          onAdd={onAdd}
          onClose={() => setShowAddDialog(false)}
        />
      )}

      {/* Edit AI Dialog */}
      {editingAI && (
        <EditAIDialog
          topicId={topic.id}
          ai={editingAI}
          onUpdate={onUpdate}
          onClose={() => setEditingAI(null)}
        />
      )}
    </div>
  );
}

// Add AI Dialog
function AddAIDialog({
  topicId,
  onAdd,
  onClose,
}: {
  topicId: string;
  onAdd: (topicId: string, dto: AddAIMemberDto) => Promise<void>;
  onClose: () => void;
}) {
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [displayName, setDisplayName] = useState('');
  const [roleDescription, setRoleDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [autoRespond, setAutoRespond] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { models, loading } = useAIModels();

  const handleAdd = async () => {
    if (!selectedModel || !displayName.trim()) return;

    // 找到选中的模型，获取 modelId 用于 aiModel 字段
    // 重要：使用 modelId（唯一）而不是 modelName（非唯一）
    // 这样后端可以精确匹配到用户选择的具体模型
    const selectedModelData = (models || []).find(
      (m) => m.id === selectedModel
    );
    if (!selectedModelData) return;

    setIsAdding(true);
    setError(null);
    try {
      await onAdd(topicId, {
        aiModel: selectedModelData.modelId, // 使用 modelId（唯一）而不是 modelName（可能重复）
        displayName: displayName.trim(),
        roleDescription: roleDescription.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        autoRespond,
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Failed to add AI assistant'
      );
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Add AI Assistant"
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!selectedModel || !displayName.trim() || isAdding}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAdding ? 'Adding...' : 'Add AI'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Select Model
          </label>
          {loading ? (
            <LoadingState size="sm" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(models || []).map((model) => (
                <button
                  key={model.id}
                  onClick={() => {
                    setSelectedModel(model.id);
                    if (!displayName) setDisplayName(`AI-${model.name}`);
                  }}
                  className={`flex items-center gap-2 rounded-lg border-2 p-3 text-left transition-colors ${
                    selectedModel === model.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <span className="text-xl">🤖</span>
                  <span className="flex-1 text-sm font-medium">
                    {model.name}
                  </span>
                  <ModelBadges model={model} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Role Description (optional)
          </label>
          <input
            type="text"
            value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            placeholder="e.g., Technical Expert, Meeting Facilitator"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            System Prompt (optional)
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            placeholder="Custom instructions for this AI..."
            className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoRespond}
            onChange={(e) => setAutoRespond(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">
            Auto-respond to @mentions
          </span>
        </label>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mt-4">
          <ErrorInline message={error} />
        </div>
      )}
    </Modal>
  );
}

// Edit AI Dialog
function EditAIDialog({
  topicId,
  ai,
  onUpdate,
  onClose,
}: {
  topicId: string;
  ai: TopicAIMember;
  onUpdate: (
    topicId: string,
    aiMemberId: string,
    dto: Partial<AddAIMemberDto>
  ) => Promise<void>;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState(ai.displayName);
  const [roleDescription, setRoleDescription] = useState(
    ai.roleDescription || ''
  );
  const [systemPrompt, setSystemPrompt] = useState(ai.systemPrompt || '');
  const [autoRespond, setAutoRespond] = useState(ai.autoRespond);
  const [canMentionOtherAI, setCanMentionOtherAI] = useState(
    ai.canMentionOtherAI ?? false
  );
  const [isSaving, setIsSaving] = useState(false);
  const { models } = useAIModels();

  const handleSave = async () => {
    if (!displayName.trim()) return;

    setIsSaving(true);
    try {
      await onUpdate(topicId, ai.id, {
        displayName: displayName.trim(),
        roleDescription: roleDescription.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        autoRespond,
        canMentionOtherAI,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  // 查找模型：优先用 modelId 匹配（新方式），兼容 modelName 匹配（旧数据）
  const model =
    (models || []).find((m) => m.modelId === ai.aiModel) ||
    (models || []).find((m) => m.modelName === ai.aiModel);

  return (
    <Modal
      open
      onClose={onClose}
      title="Edit AI Assistant"
      subtitle={model?.name || ai.aiModel}
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!displayName.trim() || isSaving}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Role Description
          </label>
          <input
            type="text"
            value={roleDescription}
            onChange={(e) => setRoleDescription(e.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            System Prompt
          </label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={autoRespond}
            onChange={(e) => setAutoRespond(e.target.checked)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-700">
            Auto-respond to @mentions
          </span>
        </label>

        {/* AI-AI Collaboration Toggle */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <label className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-700">
                AI-AI Collaboration
              </span>
              <p className="text-xs text-gray-500">
                Allow this AI to @mention and collaborate with other AIs
              </p>
            </div>
            <input
              type="checkbox"
              checked={canMentionOtherAI}
              onChange={(e) => setCanMentionOtherAI(e.target.checked)}
              className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}

// Member Settings Tab
function MemberSettings({
  topic,
  onAdd,
  onRemove,
}: {
  topic: Topic;
  onAdd: (topicId: string, userId: string, role?: TopicRole) => Promise<void>;
  onRemove: (topicId: string, memberId: string) => Promise<void>;
}) {
  const [showAddDialog, setShowAddDialog] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">
          Members ({topic.memberCount})
        </h3>
        <button
          onClick={() => setShowAddDialog(true)}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add Member
        </button>
      </div>

      <div className="space-y-2">
        {(topic.members || []).map((member) => (
          <div
            key={member.id}
            className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
                {member.user.avatarUrl ? (
                  <img
                    src={member.user.avatarUrl}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  (member.user.fullName ||
                    member.user.username ||
                    'U')[0].toUpperCase()
                )}
              </div>
              <div>
                <div className="font-medium text-gray-900">
                  {member.user.fullName || member.user.username}
                </div>
                {member.user.email && (
                  <div className="text-sm text-gray-500">
                    {member.user.email}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded px-2 py-1 text-xs font-medium ${
                  member.role === 'OWNER'
                    ? 'bg-yellow-100 text-yellow-700'
                    : member.role === 'ADMIN'
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                }`}
              >
                {member.role}
              </span>
              {member.role !== 'OWNER' && (
                <button
                  onClick={() => onRemove(topic.id, member.id)}
                  className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  title="Remove member"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Member Dialog */}
      {showAddDialog && (
        <AddMemberDialog
          topicId={topic.id}
          existingMemberIds={(topic.members || []).map((m) => m.user.id)}
          onAdd={onAdd}
          onClose={() => setShowAddDialog(false)}
        />
      )}
    </div>
  );
}

// Add Member Dialog with User Search
function AddMemberDialog({
  topicId,
  existingMemberIds,
  onAdd,
  onClose,
}: {
  topicId: string;
  existingMemberIds: string[];
  onAdd: (topicId: string, userId: string, role?: TopicRole) => Promise<void>;
  onClose: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchedUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<SearchedUser | null>(null);
  const [role, setRole] = useState<TopicRole>(TopicRole.MEMBER);
  const [isSearching, setIsSearching] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `${config.apiUrl}/users/search?query=${encodeURIComponent(searchQuery)}&limit=10`,
          { headers: { ...getAuthHeader() } }
        );
        if (response.ok) {
          const result = await response.json();
          // Handle wrapped response { success: true, data: [...] }
          const users = result?.data ?? result;
          // Filter out existing members
          const filtered = (Array.isArray(users) ? users : []).filter(
            (u: SearchedUser) => !existingMemberIds.includes(u.id)
          );
          setSearchResults(filtered);
        }
      } catch (err) {
        logger.error('Search failed:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery, existingMemberIds]);

  const handleSelectUser = (user: SearchedUser) => {
    setSelectedUser(user);
    setSearchQuery('');
    setSearchResults([]);
  };

  const handleAdd = async () => {
    if (!selectedUser && !searchQuery.includes('@')) return;

    setIsAdding(true);
    setError(null);

    try {
      // If a user is selected, use their ID; otherwise, use email
      const userIdOrEmail = selectedUser ? selectedUser.id : searchQuery.trim();
      await onAdd(topicId, userIdOrEmail, role);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setIsAdding(false);
    }
  };

  const canAdd =
    selectedUser || (searchQuery.includes('@') && searchQuery.includes('.'));

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite Member"
      subtitle="Search for users by name, username, or email address."
      size="sm"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!canAdd || isAdding}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAdding ? 'Inviting...' : 'Invite'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Selected User Display */}
        {selectedUser && (
          <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-center gap-3">
              {selectedUser.avatarUrl ? (
                <img
                  src={selectedUser.avatarUrl}
                  alt={selectedUser.fullName || selectedUser.username || 'User'}
                  className="h-10 w-10 rounded-full"
                />
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600">
                  {(selectedUser.fullName ||
                    selectedUser.username ||
                    selectedUser.email)[0].toUpperCase()}
                </div>
              )}
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {selectedUser.fullName || selectedUser.username || 'User'}
                </div>
                <div className="text-xs text-gray-500">
                  {selectedUser.email}
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedUser(null)}
              className="rounded p-1 text-gray-400 hover:bg-blue-100 hover:text-gray-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        )}

        {/* Search Input */}
        {!selectedUser && (
          <div className="relative">
            <label className="block text-sm font-medium text-gray-700">
              Search Users or Enter Email
            </label>
            <div className="relative mt-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, username, or enter email..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-blue-500 focus:outline-none"
              />
              {isSearching && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <LoadingInline text="" />
                </div>
              )}
            </div>

            {/* Search Results Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg">
                {searchResults.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => handleSelectUser(user)}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    {user.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt={user.fullName || user.username || 'User'}
                        className="h-8 w-8 rounded-full"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-600">
                        {(user.fullName ||
                          user.username ||
                          user.email)[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900">
                        {user.fullName || user.username || 'User'}
                      </div>
                      <div className="truncate text-xs text-gray-500">
                        {user.email}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* No Results Message */}
            {searchQuery.length >= 2 &&
              !isSearching &&
              searchResults.length === 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  No users found. You can still invite by email address.
                </div>
              )}
          </div>
        )}

        {/* Role Selection */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Role
          </label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as TopicRole)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value={TopicRole.MEMBER}>Member</option>
            <option value={TopicRole.ADMIN}>Admin</option>
          </select>
        </div>

        {error && <ErrorInline message={error} />}
      </div>
    </Modal>
  );
}

// Danger Zone Tab
function DangerSettings({
  topic,
  onDelete,
  onClose,
}: {
  topic: Topic;
  onDelete: (topicId: string) => Promise<void>;
  onClose: () => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (confirmName !== topic.name) return;

    setIsDeleting(true);
    try {
      await onDelete(topic.id);
      onClose();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <h3 className="font-medium text-red-800">Delete Team</h3>
        <p className="mt-1 text-sm text-red-600">
          This action cannot be undone. All messages, resources, and summaries
          will be permanently deleted.
        </p>

        <div className="mt-4">
          <label className="block text-sm font-medium text-red-700">
            Type "{topic.name}" to confirm
          </label>
          <input
            type="text"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            className="mt-1 w-full rounded-lg border border-red-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none"
          />
        </div>

        <button
          onClick={handleDelete}
          disabled={confirmName !== topic.name || isDeleting}
          className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isDeleting ? 'Deleting...' : 'Delete Team'}
        </button>
      </div>
    </div>
  );
}

// Join Requests Settings Tab
function JoinRequestsSettings({
  requests,
  isLoading,
  onApprove,
  onReject,
}: {
  requests: JoinRequest[];
  isLoading: boolean;
  onApprove: (requestId: string) => Promise<void>;
  onReject: (requestId: string) => Promise<void>;
}) {
  const [processingId, setProcessingId] = useState<string | null>(null);

  const handleAction = async (
    requestId: string,
    action: 'approve' | 'reject'
  ) => {
    setProcessingId(requestId);
    try {
      if (action === 'approve') {
        await onApprove(requestId);
      } else {
        await onReject(requestId);
      }
    } finally {
      setProcessingId(null);
    }
  };

  // formatTime removed - using ClientDate component instead

  if (isLoading) {
    return <LoadingState size="lg" />;
  }

  if (requests.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle className="h-12 w-12" />}
        title="No pending join requests"
        description="Requests will appear here when users apply to join"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-900">Pending Requests</h3>
        <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-sm text-orange-600">
          {requests.length} {requests.length === 1 ? 'request' : 'requests'}
        </span>
      </div>

      <div className="space-y-3">
        {requests.map((request) => (
          <div
            key={request.id}
            className="rounded-lg border border-gray-200 bg-white p-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 text-sm font-medium text-gray-600">
                  {request.user.avatarUrl ? (
                    <img
                      src={request.user.avatarUrl}
                      alt=""
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    (request.user.fullName ||
                      request.user.username ||
                      request.user.email)[0].toUpperCase()
                  )}
                </div>
                <div>
                  <div className="font-medium text-gray-900">
                    {request.user.fullName ||
                      request.user.username ||
                      request.user.email}
                  </div>
                  <div className="text-xs text-gray-500">
                    {request.user.email}
                  </div>
                </div>
              </div>
              <div className="text-xs text-gray-400">
                <ClientDate date={request.createdAt} format="datetime" />
              </div>
            </div>

            {request.requestMessage && (
              <div className="mt-3 rounded-lg bg-gray-50 p-3">
                <p className="text-sm text-gray-600">
                  {request.requestMessage}
                </p>
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => handleAction(request.id, 'reject')}
                disabled={processingId === request.id}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Reject
              </button>
              <button
                onClick={() => handleAction(request.id, 'approve')}
                disabled={processingId === request.id}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {processingId === request.id ? 'Processing...' : 'Approve'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
