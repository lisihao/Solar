'use client';

import React, { useState, useEffect } from 'react';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  X,
  FolderOpen,
  Plus,
  Search,
  BookOpen,
} from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';

import { logger } from '@/lib/utils/logger';
interface ResearchProject {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  status: 'ACTIVE' | 'ARCHIVED' | 'DELETED';
  sourceCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface ResourceToAdd {
  id: string;
  title: string;
  sourceUrl?: string;
  abstract?: string;
  type?: string;
  thumbnailUrl?: string;
  authors?: Array<{ name?: string; username?: string }>;
  publishedAt?: string;
}

interface AddToAIStudioDialogProps {
  isOpen: boolean;
  onClose: () => void;
  resource: ResourceToAdd;
  onSuccess?: (projectId: string, projectName: string) => void;
}

export function AddToAIStudioDialog({
  isOpen,
  onClose,
  resource,
  onSuccess,
}: AddToAIStudioDialogProps) {
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );

  // Fetch projects when dialog opens
  useEffect(() => {
    if (isOpen) {
      fetchProjects();
    }
  }, [isOpen]);

  const fetchProjects = async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-studio/projects?status=ACTIVE`,
        {
          headers: getAuthHeader(),
        }
      );
      if (!response.ok) {
        throw new Error('Failed to fetch projects');
      }
      const result = await response.json();
      // Handle wrapped response { success: true, data: {...} }
      const data = result?.data ?? result;
      // Ensure we always set an array - API might return { projects: [...] } or [...] or { items: [...] }
      const projectsArray = Array.isArray(data.projects)
        ? data.projects
        : Array.isArray(data)
          ? data
          : Array.isArray(data.items)
            ? data.items
            : [];
      setProjects(projectsArray);
    } catch (err) {
      setError('Failed to load AI Studio projects');
      logger.error('Error fetching projects:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAddToProject = async (projectId: string) => {
    setIsAdding(true);
    setError('');
    setSelectedProjectId(projectId);

    try {
      // Map resource type to source type
      const sourceTypeMap: Record<string, string> = {
        PAPER: 'paper',
        BLOG: 'blog',
        NEWS: 'news',
        YOUTUBE_VIDEO: 'video',
        YOUTUBE: 'video',
        REPORT: 'paper',
        GITHUB: 'github',
      };

      const sourceType = sourceTypeMap[resource.type || ''] || 'blog';

      const response = await fetch(
        `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}/sources`,
        {
          method: 'POST',
          headers: {
            ...getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: resource.title,
            sourceType,
            sourceUrl: resource.sourceUrl,
            abstract: resource.abstract,
            resourceId: resource.id,
            authors: resource.authors?.map((a) => a.name || a.username) || [],
            publishedAt: resource.publishedAt,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        if (errorData.message?.includes('duplicate')) {
          throw new Error('This resource is already in the project');
        }
        throw new Error(errorData.message || 'Failed to add resource');
      }

      const project = projects.find((p) => p.id === projectId);
      setSuccess(`Added to "${project?.name || 'project'}"`);

      if (onSuccess && project) {
        onSuccess(projectId, project.name);
      }

      // Auto close after success
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError((err as Error).message || 'Failed to add resource to project');
    } finally {
      setIsAdding(false);
      setSelectedProjectId(null);
    }
  };

  const handleClose = () => {
    setError('');
    setSuccess(null);
    setSearchQuery('');
    setSelectedProjectId(null);
    onClose();
  };

  if (!isOpen) return null;

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Add to AI Studio
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Select a research project to add this resource
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Resource Preview */}
        <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="line-clamp-2 text-sm font-medium text-gray-900">
            {resource.title}
          </p>
          {resource.sourceUrl && (
            <p className="mt-1 truncate text-xs text-gray-500">
              {new URL(resource.sourceUrl).hostname}
            </p>
          )}
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-green-50 p-3 text-sm text-green-700">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
            {success}
          </div>
        )}

        {/* Search */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Projects List */}
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="py-8 text-center">
              <FolderOpen className="mx-auto h-8 w-8 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">
                {searchQuery
                  ? 'No matching projects found'
                  : 'No active projects'}
              </p>
              <a
                href="/ai-research"
                className="mt-2 inline-block text-sm text-blue-600 hover:underline"
              >
                Create a new project
              </a>
            </div>
          ) : (
            filteredProjects.map((project) => (
              <button
                key={project.id}
                onClick={() => handleAddToProject(project.id)}
                disabled={isAdding}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-all ${
                  selectedProjectId === project.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                } ${isAdding ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                {/* Project Icon */}
                <div
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-lg"
                  style={{
                    backgroundColor: project.color
                      ? `${project.color}20`
                      : '#E5E7EB',
                    color: project.color || '#6B7280',
                  }}
                >
                  {project.icon || <BookOpen className="h-5 w-5" />}
                </div>

                {/* Project Info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-gray-900">
                    {project.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {project.sourceCount ?? 0} sources
                  </p>
                </div>

                {/* Loading indicator */}
                {isAdding && selectedProjectId === project.id && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                )}

                {/* Add icon */}
                {!isAdding && (
                  <Plus className="h-4 w-4 text-gray-400 group-hover:text-blue-600" />
                )}
              </button>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button
            onClick={handleClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <a
            href="/ai-research"
            className="flex items-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New Project
          </a>
        </div>
      </div>
    </div>
  );
}

export default AddToAIStudioDialog;
