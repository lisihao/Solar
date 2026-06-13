'use client';

import { useState } from 'react';
import { TopicMessage, Topic } from '@/lib/types/ai-teams';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
import { toast } from '@/stores';
import { formatDateSafe } from '@/lib/utils/date';
interface MessageSelectionToolbarProps {
  selectedMessages: Set<string>;
  messages: TopicMessage[];
  topics: Topic[];
  currentTopicId: string;
  onClearSelection: () => void;
  onForwardSuccess: () => void;
}

type ForwardTargetType = 'TOPIC' | 'USER' | 'EXTERNAL';
type MergeMode = 'SEPARATE' | 'MERGED' | 'SUMMARY';

export default function MessageSelectionToolbar({
  selectedMessages,
  messages,
  topics,
  currentTopicId,
  onClearSelection,
  onForwardSuccess,
}: MessageSelectionToolbarProps) {
  const [showForwardDialog, setShowForwardDialog] = useState(false);
  const [forwardTargetType, setForwardTargetType] =
    useState<ForwardTargetType>('TOPIC');
  const [targetTopicId, setTargetTopicId] = useState<string>('');
  const [mergeMode, setMergeMode] = useState<MergeMode>('SEPARATE');
  const [forwardNote, setForwardNote] = useState('');
  const [isForwarding, setIsForwarding] = useState(false);

  const selectedCount = selectedMessages.size;
  const selectedMsgs = (messages || []).filter((m) =>
    selectedMessages.has(m.id)
  );

  // Include all topics (including current topic) for forward targets
  // User may want to forward messages within the same topic (e.g., to reorganize or emphasize)
  const availableTopics = topics || [];

  // Find current topic for display purposes
  const currentTopic = (topics || []).find((t) => t.id === currentTopicId);

  const handleCopyToClipboard = async () => {
    const content = selectedMsgs
      .map((m) => {
        const sender =
          m.sender?.fullName ||
          m.sender?.username ||
          m.aiMember?.displayName ||
          'Unknown';
        return `${sender}: ${m.content}`;
      })
      .join('\n\n---\n\n');

    await navigator.clipboard.writeText(content);
    toast.success('Messages copied to clipboard');
  };

  const handleExport = async () => {
    // Generate export content based on merge mode
    let content = '';
    const timestamp = new Date().toISOString().split('T')[0];
    const topicName = currentTopic?.name || 'Team';

    if (mergeMode === 'MERGED') {
      // Combine all messages into one block
      content = `# ${topicName} - Exported Messages\n`;
      content += `Date: ${timestamp}\n\n`;
      if (forwardNote) {
        content += `> Note: ${forwardNote}\n\n`;
      }
      content += '---\n\n';
      selectedMsgs.forEach((m) => {
        const sender =
          m.sender?.fullName ||
          m.sender?.username ||
          m.aiMember?.displayName ||
          'Unknown';
        const time = formatDateSafe(m.createdAt, 'datetime');
        content += `**${sender}** (${time}):\n${m.content}\n\n`;
      });
    } else if (mergeMode === 'SUMMARY') {
      // Generate a brief summary format
      content = `# ${topicName} - Message Summary\n`;
      content += `Date: ${timestamp}\n`;
      content += `Total Messages: ${selectedMsgs.length}\n\n`;
      if (forwardNote) {
        content += `> Note: ${forwardNote}\n\n`;
      }
      content += '## Participants\n';
      const participants = new Set<string>();
      selectedMsgs.forEach((m) => {
        const sender =
          m.sender?.fullName ||
          m.sender?.username ||
          m.aiMember?.displayName ||
          'Unknown';
        participants.add(sender);
      });
      content += Array.from(participants)
        .map((p) => `- ${p}`)
        .join('\n');
      content += '\n\n## Messages\n\n';
      selectedMsgs.forEach((m, i) => {
        const sender =
          m.sender?.fullName ||
          m.sender?.username ||
          m.aiMember?.displayName ||
          'Unknown';
        content += `${i + 1}. **${sender}**: ${m.content.substring(0, 200)}${m.content.length > 200 ? '...' : ''}\n\n`;
      });
    } else {
      // SEPARATE - keep original format
      content = `# ${topicName} - Exported Messages\n`;
      content += `Date: ${timestamp}\n\n`;
      if (forwardNote) {
        content += `> Note: ${forwardNote}\n\n`;
      }
      selectedMsgs.forEach((m) => {
        const sender =
          m.sender?.fullName ||
          m.sender?.username ||
          m.aiMember?.displayName ||
          'Unknown';
        const time = formatDateSafe(m.createdAt, 'datetime');
        content += `---\n\n`;
        content += `### ${sender}\n`;
        content += `*${time}*\n\n`;
        content += `${m.content}\n\n`;
      });
    }

    // Create and download the file
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${topicName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}_${timestamp}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setShowForwardDialog(false);
    onClearSelection();
  };

  const handleForward = async () => {
    // If export mode, handle export instead
    if (forwardTargetType === 'EXTERNAL') {
      handleExport();
      return;
    }

    if (forwardTargetType === 'TOPIC' && !targetTopicId) {
      toast.warning('Please select a target topic');
      return;
    }

    setIsForwarding(true);
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/topics/${currentTopicId}/messages/forward`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messageIds: Array.from(selectedMessages),
            targetType: forwardTargetType,
            targetTopicId:
              forwardTargetType === 'TOPIC' ? targetTopicId : undefined,
            mergeMode,
            forwardNote: forwardNote || undefined,
          }),
        }
      );

      if (response.ok) {
        setShowForwardDialog(false);
        onClearSelection();
        onForwardSuccess();
      } else {
        const error = await response.json();
        toast.error(`Forward failed: ${error.message || 'Unknown error'}`);
      }
    } catch (err) {
      logger.error('Forward error:', err);
      toast.error('Forward failed');
    } finally {
      setIsForwarding(false);
    }
  };

  const handleBookmark = async () => {
    // For now, bookmark each message individually
    try {
      for (const messageId of selectedMessages) {
        await fetch(
          `${config.apiBaseUrl}/api/v1/topics/${currentTopicId}/messages/${messageId}/bookmark`,
          {
            method: 'POST',
            headers: {
              ...getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({}),
          }
        );
      }
      toast.success(`${selectedCount} messages bookmarked`);
      onClearSelection();
    } catch (err) {
      logger.error('Bookmark error:', err);
      toast.error('Bookmark failed');
    }
  };

  if (selectedCount === 0) return null;

  return (
    <>
      {/* Floating Toolbar */}
      <div className="fixed bottom-20 left-1/2 z-50 -translate-x-1/2 transform">
        <div className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 shadow-lg">
          <span className="text-sm text-white">{selectedCount} selected</span>

          <div className="mx-2 h-4 w-px bg-gray-600" />

          {/* Copy Button */}
          <button
            onClick={handleCopyToClipboard}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            title="Copy to clipboard"
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
                d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
              />
            </svg>
            Copy
          </button>

          {/* Forward Button */}
          <button
            onClick={() => setShowForwardDialog(true)}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            title="Forward messages"
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
                d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
              />
            </svg>
            Forward
          </button>

          {/* Bookmark Button */}
          <button
            onClick={handleBookmark}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-white hover:bg-gray-700"
            title="Bookmark messages"
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
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
            Bookmark
          </button>

          <div className="mx-2 h-4 w-px bg-gray-600" />

          {/* Cancel Button */}
          <button
            onClick={onClearSelection}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 hover:text-white"
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
            Cancel
          </button>
        </div>
      </div>

      {/* Forward Dialog */}
      {showForwardDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">
              Forward {selectedCount} Message{selectedCount > 1 ? 's' : ''}
            </h3>

            {/* Target Type */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Forward to
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setForwardTargetType('TOPIC')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                    forwardTargetType === 'TOPIC'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Team
                </button>
                <button
                  onClick={() => setForwardTargetType('EXTERNAL')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                    forwardTargetType === 'EXTERNAL'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Export
                </button>
              </div>
            </div>

            {/* Target Team Select */}
            {forwardTargetType === 'TOPIC' && (
              <div className="mb-4">
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Select Team
                </label>
                <select
                  value={targetTopicId}
                  onChange={(e) => setTargetTopicId(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  <option value="">Select a team...</option>
                  {availableTopics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                      {topic.id === currentTopicId ? ' (current)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Merge Mode */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {forwardTargetType === 'EXTERNAL'
                  ? 'Export Format'
                  : 'Forward Mode'}
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mergeMode"
                    value="SEPARATE"
                    checked={mergeMode === 'SEPARATE'}
                    onChange={() => setMergeMode('SEPARATE')}
                    className="text-blue-600"
                  />
                  <span className="text-sm">Separate (keep original)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mergeMode"
                    value="MERGED"
                    checked={mergeMode === 'MERGED'}
                    onChange={() => setMergeMode('MERGED')}
                    className="text-blue-600"
                  />
                  <span className="text-sm">Merged (combine into one)</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="mergeMode"
                    value="SUMMARY"
                    checked={mergeMode === 'SUMMARY'}
                    onChange={() => setMergeMode('SUMMARY')}
                    className="text-blue-600"
                  />
                  <span className="text-sm">Summary (AI generated)</span>
                </label>
              </div>
            </div>

            {/* Forward Note */}
            <div className="mb-4">
              <label className="mb-2 block text-sm font-medium text-gray-700">
                Note (optional)
              </label>
              <textarea
                value={forwardNote}
                onChange={(e) => setForwardNote(e.target.value)}
                placeholder="Add a note..."
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                rows={2}
              />
            </div>

            {/* Preview */}
            <div className="mb-4 max-h-32 overflow-y-auto rounded-lg bg-gray-50 p-3">
              <p className="mb-1 text-xs font-medium text-gray-500">Preview:</p>
              {selectedMsgs.slice(0, 3).map((m) => (
                <p key={m.id} className="truncate text-xs text-gray-600">
                  {m.sender?.fullName ||
                    m.sender?.username ||
                    m.aiMember?.displayName}
                  : {m.content.substring(0, 50)}...
                </p>
              ))}
              {selectedMsgs.length > 3 && (
                <p className="text-xs text-gray-400">
                  +{selectedMsgs.length - 3} more...
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowForwardDialog(false)}
                className="rounded-lg px-4 py-2 text-sm text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                onClick={handleForward}
                disabled={
                  isForwarding ||
                  (forwardTargetType === 'TOPIC' && !targetTopicId)
                }
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isForwarding
                  ? 'Processing...'
                  : forwardTargetType === 'EXTERNAL'
                    ? 'Export'
                    : 'Forward'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
