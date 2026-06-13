'use client';

import { useState, useEffect } from 'react';
import { Folder } from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';

interface Collection {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  isPublic: boolean;
}

interface CollectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string;
    icon?: string;
    color?: string;
    isPublic: boolean;
  }) => Promise<void>;
  collection?: Collection | null;
  mode: 'create' | 'edit';
}

const ICONS = ['📁', '📚', '🔬', '💡', '🎯', '🚀', '💼', '🎨', '📝', '⭐'];
const COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6b7280', // gray
];

export default function CollectionModal({
  isOpen,
  onClose,
  onSave,
  collection,
  mode,
}: CollectionModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (collection && mode === 'edit') {
      setName(collection.name);
      setDescription(collection.description || '');
      setIcon(collection.icon || '');
      setColor(collection.color || COLORS[0]);
      setIsPublic(collection.isPublic);
    } else {
      setName('');
      setDescription('');
      setIcon('');
      setColor(COLORS[0]);
      setIsPublic(false);
    }
    setError('');
  }, [collection, mode, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Collection name is required');
      return;
    }

    setSaving(true);
    setError('');

    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        icon: icon || undefined,
        color,
        isPublic,
      });
      onClose();
    } catch (err) {
      setError('Failed to save collection');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={mode === 'create' ? 'New Collection' : 'Edit Collection'}
      size="sm"
      headerClassName="border-b border-gray-100 px-6 py-4"
      contentClassName="p-6"
    >
      <form onSubmit={handleSubmit}>
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Preview */}
        <div className="mb-6 flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-lg text-lg"
            style={{ backgroundColor: `${color}20`, color }}
          >
            {icon || <Folder className="h-5 w-5" />}
          </div>
          <div>
            <p className="font-medium text-gray-900">
              {name || 'Collection Name'}
            </p>
            <p className="text-sm text-gray-500">
              {description || 'No description'}
            </p>
          </div>
        </div>

        {/* Name */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., AI Research Papers"
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            maxLength={100}
          />
        </div>

        {/* Description */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this collection for?"
            rows={2}
            className="w-full resize-none rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            maxLength={500}
          />
        </div>

        {/* Icon */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Icon
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setIcon('')}
              className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-colors ${
                !icon
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <Folder className="h-4 w-4 text-gray-400" />
            </button>
            {ICONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setIcon(emoji)}
                className={`flex h-9 w-9 items-center justify-center rounded-lg border text-sm transition-colors ${
                  icon === emoji
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Color */}
        <div className="mb-4">
          <label className="mb-1.5 block text-sm font-medium text-gray-700">
            Color
          </label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-8 w-8 rounded-full transition-transform ${
                  color === c ? 'scale-110 ring-2 ring-offset-2' : ''
                }`}
                style={{
                  backgroundColor: c,
                  // @ts-expect-error - ringColor is a Tailwind CSS variable
                  '--tw-ring-color': c,
                }}
              />
            ))}
          </div>
        </div>

        {/* Public Toggle */}
        <div className="mb-6">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div>
              <p className="text-sm font-medium text-gray-700">
                Make collection public
              </p>
              <p className="text-xs text-gray-500">
                Anyone with the link can view this collection
              </p>
            </div>
          </label>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving
              ? 'Saving...'
              : mode === 'create'
                ? 'Create Collection'
                : 'Save Changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
