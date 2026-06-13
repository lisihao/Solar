'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Trash2,
  Clock,
  Star,
  BookOpen,
  Hash,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/states/EmptyState';

export interface Collection {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  isDefault?: boolean;
  isPublic: boolean;
  itemCount?: number;
  createdAt: string;
}

export interface Tag {
  name: string;
  count: number;
}

export interface UserStats {
  totalItems: number;
  recentItems: number;
  byStatus: Record<string, number>;
}

interface CollectionNavProps {
  collections: Collection[];
  activeCollectionId: string | null;
  onSelectCollection: (id: string | null) => void;
  onCreateCollection: () => void;
  onEditCollection: (collection: Collection) => void;
  onDeleteCollection: (collection: Collection) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  tags?: Tag[];
  stats?: UserStats;
}

export default function CollectionNav({
  collections,
  activeCollectionId,
  onSelectCollection,
  onCreateCollection,
  onEditCollection,
  onDeleteCollection,
  isCollapsed = false,
  onToggleCollapse,
  tags = [],
  stats,
}: CollectionNavProps) {
  const [expandedSections, setExpandedSections] = useState({
    collections: true,
    tags: true,
    quickAccess: true,
  });
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  // Quick access items with stats
  const quickAccessItems = [
    {
      id: 'recent',
      name: 'Recent',
      icon: Clock,
      count: stats?.recentItems || null,
    },
    {
      id: 'reading',
      name: 'Reading',
      icon: BookOpen,
      count: stats?.byStatus?.READING || null,
    },
    {
      id: 'completed',
      name: 'Completed',
      icon: Star,
      count: stats?.byStatus?.COMPLETED || null,
    },
  ];

  if (isCollapsed) {
    return (
      <div className="flex h-full w-12 flex-col border-r border-gray-200 bg-white py-4">
        <button
          onClick={onToggleCollapse}
          className="mx-auto mb-4 rounded-lg p-2 text-gray-500 hover:bg-gray-100"
          title="Expand"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <div className="flex flex-col items-center gap-2">
          {collections.slice(0, 5).map((collection) => (
            <button
              key={collection.id}
              onClick={() => onSelectCollection(collection.id)}
              className={`rounded-lg p-2 transition-colors ${
                activeCollectionId === collection.id
                  ? 'bg-blue-100 text-blue-600'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
              title={collection.name}
            >
              <Folder className="h-4 w-4" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-56 flex-col border-r border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">My Library</h2>
        <button
          onClick={onToggleCollapse}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          title="Collapse"
        >
          <ChevronDown className="h-4 w-4 rotate-90" />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {/* Quick Access Section */}
        <div className="mb-4">
          <button
            onClick={() => toggleSection('quickAccess')}
            className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700"
          >
            {expandedSections.quickAccess ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Quick Access
          </button>
          {expandedSections.quickAccess && (
            <div className="mt-1 space-y-0.5">
              {quickAccessItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelectCollection(item.id)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                    activeCollectionId === item.id
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  <item.icon className="h-4 w-4 text-gray-400" />
                  <span className="flex-1 text-left">{item.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Collections Section */}
        <div className="mb-4">
          <div className="flex items-center justify-between px-2 py-1.5">
            <button
              onClick={() => toggleSection('collections')}
              className="flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700"
            >
              {expandedSections.collections ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Collections
            </button>
            <button
              onClick={onCreateCollection}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-blue-600"
              title="New Collection"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          {expandedSections.collections && (
            <div className="mt-1 space-y-0.5">
              {/* All Items */}
              <button
                onClick={() => onSelectCollection(null)}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                  activeCollectionId === null
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Folder className="h-4 w-4 text-gray-400" />
                <span className="flex-1 text-left">All Items</span>
                <span className="text-xs text-gray-400">
                  {collections.reduce((sum, c) => sum + (c.itemCount || 0), 0)}
                </span>
              </button>

              {/* Collection Items */}
              {collections.map((collection) => (
                <div key={collection.id} className="group relative">
                  <button
                    onClick={() => onSelectCollection(collection.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      activeCollectionId === collection.id
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {activeCollectionId === collection.id ? (
                      <FolderOpen className="h-4 w-4 text-blue-500" />
                    ) : (
                      <Folder className="h-4 w-4 text-gray-400" />
                    )}
                    <span className="flex-1 truncate text-left">
                      {collection.icon && (
                        <span className="mr-1">{collection.icon}</span>
                      )}
                      {collection.name}
                    </span>
                    <span className="text-xs text-gray-400">
                      {collection.itemCount || 0}
                    </span>
                  </button>

                  {/* Dropdown Menu */}
                  {!collection.isDefault && (
                    <div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpenId(
                            menuOpenId === collection.id ? null : collection.id
                          );
                        }}
                        className="rounded p-1 hover:bg-gray-200"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5 text-gray-400" />
                      </button>

                      {menuOpenId === collection.id && (
                        <div className="absolute right-0 top-full z-10 mt-1 w-32 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(null);
                              onEditCollection(collection);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Edit
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenId(null);
                              onDeleteCollection(collection);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div>
          <button
            onClick={() => toggleSection('tags')}
            className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700"
          >
            {expandedSections.tags ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            Tags
          </button>
          {expandedSections.tags && (
            <div className="mt-1 space-y-0.5">
              {tags.length === 0 ? (
                <EmptyState
                  title="No tags yet"
                  description="Add tags to your bookmarks to organize them."
                  size="sm"
                />
              ) : (
                tags.map((tag) => (
                  <button
                    key={tag.name}
                    onClick={() => onSelectCollection(`tag:${tag.name}`)}
                    className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                      activeCollectionId === `tag:${tag.name}`
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <Hash className="h-4 w-4 text-gray-400" />
                    <span className="flex-1 truncate text-left">
                      {tag.name}
                    </span>
                    <span className="text-xs text-gray-400">{tag.count}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer - Storage Info */}
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="mb-2 flex items-center justify-between text-xs text-gray-500">
          <span>Total Items</span>
          <span>
            {stats?.totalItems ||
              collections.reduce((sum, c) => sum + (c.itemCount || 0), 0)}
          </span>
        </div>
        {stats && (
          <div className="flex items-center gap-2 text-xs">
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-gray-400" />
              <span className="text-gray-500">
                {stats.byStatus?.UNREAD || 0}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="text-gray-500">
                {stats.byStatus?.READING || 0}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-gray-500">
                {stats.byStatus?.COMPLETED || 0}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
