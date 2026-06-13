'use client';

/**
 * AI Research - Project Detail Page
 *
 * Slim wrapper that loads the project and renders ResearchProjectLayout.
 * All research logic (discussion, ideas, demos, report) lives in the layout component.
 */

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import { logger } from '@/lib/utils/logger';
import { ResearchProjectLayout } from '@/components/ai-research/ResearchProjectLayout';

// ==================== Types ====================

interface Project {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
}

// ==================== Page ====================

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params?.projectId as string;

  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load project
  useEffect(() => {
    async function loadProject() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `${config.apiBaseUrl}/api/v1/ai-studio/projects/${projectId}`,
          {
            headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
          }
        );
        if (!res.ok) throw new Error('Failed to fetch project');
        const json = await res.json();
        const data = json?.data ?? json;
        setProject(data);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to load project';
        setError(msg);
        logger.error('Failed to load project:', err);
      } finally {
        setLoading(false);
      }
    }
    if (projectId) {
      loadProject();
    }
  }, [projectId]);

  const handleBack = () => {
    router.push('/ai-research');
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
      </div>
    );
  }

  // Error state
  if (error || !project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <p className="text-gray-600">{error || 'Project not found'}</p>
        <button
          onClick={handleBack}
          className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to projects
        </button>
      </div>
    );
  }

  return (
    <ResearchProjectLayout
      projectId={project.id}
      projectName={project.name}
      projectDescription={project.description}
      onBack={handleBack}
    />
  );
}
