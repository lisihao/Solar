'use client';

import { useState, useEffect } from 'react';
import {
  Topic,
  TopicResource,
  TopicResourceType,
  AddResourceDto,
} from '@/lib/types/ai-teams';
import { useAiGroupStore } from '@/stores/ai-teams';
import { EmptyState } from '@/components/ui/states/EmptyState';
import { LoadingState } from '@/components/ui';
import { Archive } from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';

interface ResourcesPanelProps {
  topic: Topic;
  onClose: () => void;
}

export default function ResourcesPanel({
  topic,
  onClose,
}: ResourcesPanelProps) {
  const {
    resources,
    isLoadingResources,
    fetchResources,
    addResource,
    removeResource,
  } = useAiGroupStore();
  const [showAddDialog, setShowAddDialog] = useState(false);

  useEffect(() => {
    fetchResources(topic.id);
  }, [topic.id, fetchResources]);

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getResourceIcon = (resource: TopicResource) => {
    switch (resource.type) {
      case TopicResourceType.LINK:
        return (
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
            />
          </svg>
        );
      case TopicResourceType.FILE:
        return (
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        );
      case TopicResourceType.LIBRARY_RESOURCE:
        return (
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
        );
      default:
        return (
          <svg
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        );
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Shared Resources"
      size="lg"
      contentClassName="flex-1 overflow-auto p-6"
    >
      <div className="flex h-[calc(70vh-8rem)] flex-col">
        {/* Add Resource Button in header area */}
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => setShowAddDialog(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Resource
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isLoadingResources ? (
            <LoadingState size="lg" />
          ) : (resources || []).length === 0 ? (
            <EmptyState
              icon={<Archive className="h-12 w-12" />}
              title="No resources yet"
              description="Share links, files, or library resources with the group"
            />
          ) : (
            <div className="space-y-3">
              {(resources || []).map((resource) => (
                <div
                  key={resource.id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 p-4 transition-colors hover:bg-gray-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100 text-gray-600">
                      {getResourceIcon(resource)}
                    </div>
                    <div>
                      <a
                        href={resource.url || resource.fileUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 hover:text-blue-600"
                      >
                        {resource.name}
                      </a>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{resource.type}</span>
                        {resource.fileSize && (
                          <span>• {formatFileSize(resource.fileSize)}</span>
                        )}
                        <span>
                          • Added by{' '}
                          {resource.addedBy.fullName ||
                            resource.addedBy.username}
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => removeResource(topic.id, resource.id)}
                    className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                    title="Remove resource"
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
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Resource Dialog */}
      <AddResourceDialog
        open={showAddDialog}
        topicId={topic.id}
        onAdd={async (dto) => {
          await addResource(topic.id, dto);
          setShowAddDialog(false);
        }}
        onClose={() => setShowAddDialog(false)}
      />
    </Modal>
  );
}

// Add Resource Dialog
function AddResourceDialog({
  open,
  topicId: _topicId,
  onAdd,
  onClose,
}: {
  open: boolean;
  topicId: string;
  onAdd: (dto: AddResourceDto) => Promise<void>;
  onClose: () => void;
}) {
  const [type, setType] = useState<TopicResourceType>(TopicResourceType.LINK);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    if (!name.trim() || !url.trim()) return;

    setIsAdding(true);
    try {
      await onAdd({
        type,
        name: name.trim(),
        url: url.trim(),
      });
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Resource"
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
            onClick={() => void handleAdd()}
            disabled={!name.trim() || !url.trim() || isAdding}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isAdding ? 'Adding...' : 'Add Resource'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-2 block text-sm font-medium text-gray-700">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as TopicResourceType)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          >
            <option value={TopicResourceType.LINK}>Link</option>
            <option value={TopicResourceType.FILE}>File</option>
            <option value={TopicResourceType.LIBRARY_RESOURCE}>
              Library Resource
            </option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Resource name"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">URL</label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
          />
        </div>
      </div>
    </Modal>
  );
}
