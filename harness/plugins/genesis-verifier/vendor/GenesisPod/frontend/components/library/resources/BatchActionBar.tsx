'use client';

import { useState } from 'react';
import { ReadStatus, Collection } from '@/hooks';
import { confirm } from '@/stores';

interface BatchActionBarProps {
  selectedCount: number;
  selectedIds: string[];
  collections: Collection[];
  currentCollectionId?: string;
  onMove: (targetCollectionId: string) => void;
  onDelete: () => void;
  onUpdateStatus: (status: ReadStatus) => void;
  onAddTags: (tags: string[]) => void;
  onClearSelection: () => void;
}

export default function BatchActionBar({
  selectedCount,
  selectedIds,
  collections,
  currentCollectionId,
  onMove,
  onDelete,
  onUpdateStatus,
  onAddTags,
  onClearSelection,
}: BatchActionBarProps) {
  const [showMoveMenu, setShowMoveMenu] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInput, setTagInput] = useState('');

  if (selectedCount === 0) return null;

  const availableCollections = collections.filter(
    (c) => c.id !== currentCollectionId
  );

  const handleAddTag = () => {
    if (tagInput.trim()) {
      const tags = tagInput
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t);
      onAddTags(tags);
      setTagInput('');
      setShowTagInput(false);
    }
  };

  const statusConfig = {
    [ReadStatus.UNREAD]: {
      label: 'Unread',
      icon: (
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <circle cx="12" cy="12" r="10" strokeWidth={2} />
        </svg>
      ),
    },
    [ReadStatus.READING]: {
      label: 'Reading',
      icon: (
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
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      ),
    },
    [ReadStatus.COMPLETED]: {
      label: 'Completed',
      icon: (
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
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      ),
    },
    [ReadStatus.ARCHIVED]: {
      label: 'Archived',
      icon: (
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
            d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4"
          />
        </svg>
      ),
    },
  };

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transform">
      <div className="flex items-center gap-3 rounded-xl bg-gray-900 px-4 py-3 shadow-2xl">
        {/* Selection count */}
        <div className="flex items-center gap-2 border-r border-gray-700 pr-3">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
            {selectedCount}
          </span>
          <span className="text-sm font-medium text-white">selected</span>
        </div>

        {/* Move button */}
        <div className="relative">
          <button
            onClick={() => {
              setShowMoveMenu(!showMoveMenu);
              setShowStatusMenu(false);
              setShowTagInput(false);
            }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
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
                d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
              />
            </svg>
            Move
          </button>
          {showMoveMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-48 rounded-lg bg-white py-1 shadow-xl">
              {availableCollections.length === 0 ? (
                <div className="px-4 py-2 text-sm text-gray-500">
                  No other collections
                </div>
              ) : (
                availableCollections.map((collection) => (
                  <button
                    key={collection.id}
                    onClick={() => {
                      onMove(collection.id);
                      setShowMoveMenu(false);
                    }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                  >
                    <span className="text-lg">{collection.icon || '📁'}</span>
                    <span className="truncate">{collection.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        {/* Status button */}
        <div className="relative">
          <button
            onClick={() => {
              setShowStatusMenu(!showStatusMenu);
              setShowMoveMenu(false);
              setShowTagInput(false);
            }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
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
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Status
          </button>
          {showStatusMenu && (
            <div className="absolute bottom-full left-0 mb-2 w-40 rounded-lg bg-white py-1 shadow-xl">
              {Object.entries(statusConfig).map(([status, config]) => (
                <button
                  key={status}
                  onClick={() => {
                    onUpdateStatus(status as ReadStatus);
                    setShowStatusMenu(false);
                  }}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                >
                  {config.icon}
                  <span>{config.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Tag button */}
        <div className="relative">
          <button
            onClick={() => {
              setShowTagInput(!showTagInput);
              setShowMoveMenu(false);
              setShowStatusMenu(false);
            }}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
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
                d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
              />
            </svg>
            Tag
          </button>
          {showTagInput && (
            <div className="absolute bottom-full left-0 mb-2 w-64 rounded-lg bg-white p-3 shadow-xl">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTag()}
                  placeholder="Add tags (comma separated)"
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={handleAddTag}
                  className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Delete button */}
        <button
          onClick={() => {
            void (async () => {
              if (
                await confirm({
                  title: `Are you sure you want to remove ${selectedCount} item(s)?`,
                  type: 'danger',
                })
              ) {
                onDelete();
              }
            })();
          }}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/50 hover:text-red-300"
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
          Remove
        </button>

        {/* Clear selection */}
        <button
          onClick={onClearSelection}
          className="ml-2 rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          title="Clear selection"
        >
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
