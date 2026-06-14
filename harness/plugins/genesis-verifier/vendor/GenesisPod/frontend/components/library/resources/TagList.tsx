'use client';

import { useState } from 'react';

interface TagListProps {
  tags: string[];
  onChange?: (tags: string[]) => void;
  editable?: boolean;
  maxVisible?: number;
  size?: 'sm' | 'md';
}

// Color palette for tags
const tagColors = [
  { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  { bg: 'bg-pink-100', text: 'text-pink-700', border: 'border-pink-200' },
  { bg: 'bg-cyan-100', text: 'text-cyan-700', border: 'border-cyan-200' },
  { bg: 'bg-indigo-100', text: 'text-indigo-700', border: 'border-indigo-200' },
  { bg: 'bg-rose-100', text: 'text-rose-700', border: 'border-rose-200' },
];

function getTagColor(tag: string) {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) {
    hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  }
  return tagColors[Math.abs(hash) % tagColors.length];
}

export default function TagList({
  tags,
  onChange,
  editable = false,
  maxVisible = 3,
  size = 'sm',
}: TagListProps) {
  const [showAll, setShowAll] = useState(false);
  const [showInput, setShowInput] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const visibleTags = showAll ? tags : tags.slice(0, maxVisible);
  const hiddenCount = tags.length - maxVisible;

  const handleAddTag = () => {
    if (inputValue.trim() && onChange) {
      const newTags = inputValue
        .split(',')
        .map((t) => t.trim())
        .filter((t) => t && !tags.includes(t));
      if (newTags.length > 0) {
        onChange([...tags, ...newTags]);
      }
      setInputValue('');
      setShowInput(false);
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    if (onChange) {
      onChange(tags.filter((t) => t !== tagToRemove));
    }
  };

  const sizeClasses =
    size === 'sm' ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm';

  if (tags.length === 0 && !editable) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {visibleTags.map((tag) => {
        const color = getTagColor(tag);
        return (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 rounded-md border ${color.border} ${color.bg} ${color.text} ${sizeClasses} font-medium`}
          >
            <svg
              className="h-3 w-3 opacity-60"
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
            <span className="max-w-[80px] truncate">{tag}</span>
            {editable && onChange && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveTag(tag);
                }}
                className="ml-0.5 rounded hover:bg-white/50"
              >
                <svg
                  className="h-3 w-3"
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
            )}
          </span>
        );
      })}

      {/* Show more button */}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className={`rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 ${sizeClasses} font-medium`}
        >
          +{hiddenCount} more
        </button>
      )}

      {/* Show less button */}
      {showAll && hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(false)}
          className={`rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 ${sizeClasses} font-medium`}
        >
          Show less
        </button>
      )}

      {/* Add tag button/input */}
      {editable && onChange && (
        <>
          {showInput ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTag();
                  if (e.key === 'Escape') {
                    setShowInput(false);
                    setInputValue('');
                  }
                }}
                placeholder="Add tag..."
                className={`w-20 rounded border border-gray-300 focus:border-blue-500 focus:outline-none ${sizeClasses}`}
                autoFocus
              />
              <button
                onClick={handleAddTag}
                className="rounded bg-blue-600 px-1.5 py-0.5 text-xs text-white hover:bg-blue-700"
              >
                Add
              </button>
              <button
                onClick={() => {
                  setShowInput(false);
                  setInputValue('');
                }}
                className="rounded px-1 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowInput(true)}
              className={`inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600 ${sizeClasses}`}
            >
              <svg
                className="h-3 w-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              <span>Add</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
