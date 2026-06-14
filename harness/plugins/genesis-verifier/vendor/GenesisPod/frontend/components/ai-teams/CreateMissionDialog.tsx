'use client';

import { useState, useEffect } from 'react';
import {
  TopicAIMemberWithTeamRole,
  CreateMissionDto,
} from '@/lib/types/ai-teams';
import { useAiGroupStore } from '@/stores/ai-teams';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';
import { Users, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';

interface CreateMissionDialogProps {
  topicId: string;
  onClose: () => void;
  onSuccess?: () => void;
}

export default function CreateMissionDialog({
  topicId,
  onClose,
  onSuccess,
}: CreateMissionDialogProps) {
  const {
    teamMembers,
    isLoadingTeamMembers,
    fetchTeamMembers,
    setTeamLeader,
    createMission,
  } = useAiGroupStore();

  const [selectedLeaderId, setSelectedLeaderId] = useState<string>('');
  const [taskDescription, setTaskDescription] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ensure teamMembers is always an array
  const membersList = teamMembers || [];

  // Load team members on mount
  useEffect(() => {
    fetchTeamMembers(topicId);
  }, [topicId, fetchTeamMembers]);

  // Auto-select current leader if exists
  useEffect(() => {
    if (membersList.length === 0) return;
    const currentLeader = membersList.find((m) => m.isLeader);
    if (currentLeader && !selectedLeaderId) {
      setSelectedLeaderId(currentLeader.id);
    }
  }, [membersList, selectedLeaderId]);

  const handleSubmit = async () => {
    if (!selectedLeaderId || !taskDescription.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      // Set the leader first if changed
      const currentLeader = membersList.find((m) => m.isLeader);
      if (!currentLeader || currentLeader.id !== selectedLeaderId) {
        await setTeamLeader(topicId, selectedLeaderId);
      }

      // Create the mission
      const dto: CreateMissionDto = {
        title: taskDescription.trim().slice(0, 100),
        description: taskDescription.trim(),
        leaderId: selectedLeaderId,
        autoStart: true,
        ...(notificationEmail.trim() && {
          notificationEmail: notificationEmail.trim(),
        }),
      };

      await createMission(topicId, dto);
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mission');
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedLeader = membersList.find((m) => m.id === selectedLeaderId);

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Create Team Mission"
      subtitle="Assign a leader and describe the task"
      size="md"
      footer={
        <>
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={
              !selectedLeaderId || !taskDescription.trim() || isSubmitting
            }
            className="rounded-lg bg-gradient-to-r from-blue-600 to-purple-600 px-6 py-2 text-sm font-medium text-white hover:from-blue-700 hover:to-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? (
              <span className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Starting...
              </span>
            ) : (
              'Start Mission'
            )}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        {/* Leader Selection */}
        <div>
          <label className="mb-3 block text-sm font-medium text-gray-700">
            Select Team Leader
          </label>
          {isLoadingTeamMembers ? (
            <div className="py-8">
              <LoadingState size="md" />
            </div>
          ) : membersList.length === 0 ? (
            <EmptyState
              size="sm"
              icon={<Users className="h-8 w-8" />}
              title="No AI members in this topic. Please add AI members first."
            />
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {membersList.map((member) => (
                <button
                  key={member.id}
                  onClick={() => setSelectedLeaderId(member.id)}
                  className={`flex items-center gap-3 rounded-xl border-2 p-4 text-left transition-all ${
                    selectedLeaderId === member.id
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <div className="relative">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-purple-100 to-blue-100 text-2xl">
                      {member.avatar ? (
                        <img
                          src={member.avatar}
                          alt=""
                          className="h-full w-full rounded-full object-cover"
                        />
                      ) : (
                        '🤖'
                      )}
                    </div>
                    {member.isLeader && (
                      <div className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-yellow-400 text-xs">
                        👑
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-gray-900">
                      {member.agentName || member.displayName}
                    </div>
                    <div className="truncate text-xs text-gray-500">
                      {member.roleDescription || member.aiModel}
                    </div>
                  </div>
                  {selectedLeaderId === member.id && (
                    <svg
                      className="h-5 w-5 flex-shrink-0 text-blue-500"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Task Description */}
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Task Description
          </label>
          <textarea
            value={taskDescription}
            onChange={(e) => setTaskDescription(e.target.value)}
            rows={4}
            placeholder="Describe what you want the team to accomplish..."
            className="w-full resize-none rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-2 text-xs text-gray-500">
            The leader will analyze this task and coordinate the team to
            complete it.
          </p>
        </div>

        {/* Notification Email */}
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Notification Email
            <span className="ml-1 text-xs font-normal text-gray-400">
              (Optional)
            </span>
          </label>
          <input
            type="email"
            value={notificationEmail}
            onChange={(e) => setNotificationEmail(e.target.value)}
            placeholder="Enter email to receive completion notification"
            className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-2 text-xs text-gray-500">
            When the mission completes, a report link will be sent to this
            email.
          </p>
        </div>

        {/* Preview */}
        {selectedLeader && taskDescription.trim() && (
          <div className="rounded-xl bg-gradient-to-r from-blue-50 to-purple-50 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl shadow-sm">
                👑
              </div>
              <div>
                <div className="text-sm font-medium text-gray-900">
                  {selectedLeader.agentName || selectedLeader.displayName} will
                  lead this mission
                </div>
                <div className="mt-1 text-xs text-gray-600">
                  The leader will analyze the task, assign work to team members,
                  and coordinate the execution until completion.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
