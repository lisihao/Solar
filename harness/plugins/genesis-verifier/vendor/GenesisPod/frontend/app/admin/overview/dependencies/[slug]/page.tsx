'use client';

import { useParams, redirect } from 'next/navigation';
import { DependencyDiagram } from '@/components/admin/overview';
import { getDiagramBySlug } from '@/lib/features/admin/dependency-diagrams';

export default function DependencyDiagramPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const config = getDiagramBySlug(slug);

  if (!config) {
    redirect('/admin/overview/dependencies');
  }

  return <DependencyDiagram config={config} />;
}
