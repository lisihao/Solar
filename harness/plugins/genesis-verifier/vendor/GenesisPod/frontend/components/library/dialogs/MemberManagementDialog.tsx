'use client';

import { useState, useEffect } from 'react';
import {
  UserPlus,
  Trash2,
  Loader2,
  Crown,
  Shield,
  Pencil,
  Eye,
  ChevronDown,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { getAuthHeader } from '@/lib/utils/auth';
import { Modal } from '@/components/ui/dialogs/Modal';

import { logger } from '@/lib/utils/logger';
import { confirm } from '@/stores';
interface Member {
  id: string;
  role: 'OWNER' | 'ADMIN' | 'EDITOR' | 'VIEWER';
  joinedAt: string;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    avatarUrl: string | null;
  };
}

interface MemberManagementDialogProps {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  onClose: () => void;
}

const ROLE_CONFIG = {
  OWNER: { label: '所有者', icon: Crown, color: 'text-amber-600 bg-amber-50' },
  ADMIN: {
    label: '管理员',
    icon: Shield,
    color: 'text-purple-600 bg-purple-50',
  },
  EDITOR: { label: '编辑者', icon: Pencil, color: 'text-blue-600 bg-blue-50' },
  VIEWER: { label: '查看者', icon: Eye, color: 'text-gray-600 bg-gray-50' },
};

export default function MemberManagementDialog({
  knowledgeBaseId,
  knowledgeBaseName,
  onClose,
}: MemberManagementDialogProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add member form
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<
    'ADMIN' | 'EDITOR' | 'VIEWER'
  >('VIEWER');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Role dropdown
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  // Fetch members
  const fetchMembers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/members`,
        {
          headers: { ...getAuthHeader() },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch members');
      }

      const result = await response.json();
      // Handle wrapped API response { success: true, data: T }
      const data = result?.data ?? result;
      setMembers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch members');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMembers();
  }, [knowledgeBaseId]);

  // Add member
  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMemberEmail.trim()) return;

    setAdding(true);
    setAddError(null);

    try {
      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/members`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify({
            email: newMemberEmail.trim(),
            role: newMemberRole,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to add member');
      }

      setNewMemberEmail('');
      setNewMemberRole('VIEWER');
      await fetchMembers();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAdding(false);
    }
  };

  // Update member role
  const handleUpdateRole = async (
    memberId: string,
    role: 'ADMIN' | 'EDITOR' | 'VIEWER'
  ) => {
    try {
      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/members/${memberId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...getAuthHeader(),
          },
          body: JSON.stringify({ role }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update role');
      }

      setEditingMemberId(null);
      await fetchMembers();
    } catch (err) {
      logger.error('Failed to update role:', err);
    }
  };

  // Remove member
  const handleRemoveMember = async (memberId: string) => {
    if (!(await confirm({ title: '确定要移除这个成员吗？', type: 'danger' })))
      return;

    try {
      const response = await fetch(
        `${config.apiUrl}/rag/knowledge-bases/${knowledgeBaseId}/members/${memberId}`,
        {
          method: 'DELETE',
          headers: { ...getAuthHeader() },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to remove member');
      }

      await fetchMembers();
    } catch (err) {
      logger.error('Failed to remove member:', err);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="成员管理"
      subtitle={knowledgeBaseName}
      size="md"
      contentClassName="p-0 flex flex-col overflow-hidden"
      footer={
        <div className="grid w-full grid-cols-2 gap-2 text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <Crown className="h-3.5 w-3.5 flex-shrink-0 text-amber-600" />
            <span>所有者：完全控制</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Shield className="h-3.5 w-3.5 flex-shrink-0 text-purple-600" />
            <span>管理员：管理成员</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Pencil className="h-3.5 w-3.5 flex-shrink-0 text-blue-600" />
            <span>编辑者：编辑内容</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Eye className="h-3.5 w-3.5 flex-shrink-0 text-gray-600" />
            <span>查看者：只读</span>
          </div>
        </div>
      }
      footerClassName="border-t border-gray-200 px-6 py-3"
    >
      {/* Add Member Form */}
      <form
        onSubmit={handleAddMember}
        className="border-b border-gray-200 px-6 py-4"
      >
        <div className="flex gap-2">
          <input
            type="email"
            value={newMemberEmail}
            onChange={(e) => setNewMemberEmail(e.target.value)}
            placeholder="输入用户邮箱..."
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            disabled={adding}
          />
          <select
            value={newMemberRole}
            onChange={(e) =>
              setNewMemberRole(e.target.value as 'ADMIN' | 'EDITOR' | 'VIEWER')
            }
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none focus:ring-1 focus:ring-purple-500"
            disabled={adding}
          >
            <option value="VIEWER">查看者</option>
            <option value="EDITOR">编辑者</option>
            <option value="ADMIN">管理员</option>
          </select>
          <button
            type="submit"
            disabled={adding || !newMemberEmail.trim()}
            className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-purple-700 disabled:opacity-50"
          >
            {adding ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            添加
          </button>
        </div>
        {addError && <p className="mt-2 text-sm text-red-600">{addError}</p>}
      </form>

      {/* Members List */}
      <div className="overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : error ? (
          <div className="py-8 text-center text-sm text-red-600">{error}</div>
        ) : members.length === 0 ? (
          <EmptyState
            size="sm"
            title="暂无其他成员"
            description="使用上方表单邀请成员"
          />
        ) : (
          <div className="space-y-3">
            {members.map((member) => {
              const roleConfig = ROLE_CONFIG[member.role];
              const RoleIcon = roleConfig.icon;

              return (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
                >
                  <div className="flex items-center gap-3">
                    {member.user.avatarUrl ? (
                      <img
                        src={member.user.avatarUrl}
                        alt={member.user.fullName || member.user.email}
                        className="h-10 w-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-purple-600">
                        {(member.user.fullName || member.user.email)
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-gray-900">
                        {member.user.fullName || member.user.email}
                      </p>
                      <p className="text-xs text-gray-500">
                        {member.user.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Role Badge / Dropdown */}
                    {member.role === 'OWNER' ? (
                      // OWNER 角色不可编辑
                      <span
                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${roleConfig.color}`}
                      >
                        <RoleIcon className="h-3 w-3" />
                        {roleConfig.label}
                      </span>
                    ) : editingMemberId === member.id ? (
                      <div className="relative">
                        <select
                          value={member.role}
                          onChange={(e) =>
                            void handleUpdateRole(
                              member.id,
                              e.target.value as 'ADMIN' | 'EDITOR' | 'VIEWER'
                            )
                          }
                          onBlur={() => setEditingMemberId(null)}
                          autoFocus
                          className="rounded-lg border border-purple-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                        >
                          <option value="VIEWER">查看者</option>
                          <option value="EDITOR">编辑者</option>
                          <option value="ADMIN">管理员</option>
                        </select>
                      </div>
                    ) : (
                      <button
                        onClick={() => setEditingMemberId(member.id)}
                        className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${roleConfig.color}`}
                      >
                        <RoleIcon className="h-3 w-3" />
                        {roleConfig.label}
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    )}

                    {/* Remove Button - 不显示给 OWNER */}
                    {member.role !== 'OWNER' && (
                      <button
                        onClick={() => void handleRemoveMember(member.id)}
                        className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                        title="移除成员"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
