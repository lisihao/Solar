'use client';

import Link from 'next/link';
import { ArrowLeft, ArrowRight, Layers } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { ALL_DIAGRAMS } from '@/lib/features/admin/dependency-diagrams';
import { cn } from '@/lib/utils/common';
import { EmptyState } from '@/components/ui/states/EmptyState';

export default function DependenciesIndexPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full flex-col bg-gray-50/50">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-gray-200 bg-white/95 px-6 py-4 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <Link
            href="/admin/overview"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-600"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-lg font-semibold text-gray-900">
              {t('admin.architecture.dependencies.title')}
            </h1>
            <p className="text-xs text-gray-500">
              {t('admin.architecture.dependencies.subtitle')}
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {ALL_DIAGRAMS.map((diagram) => (
            <Link
              key={diagram.slug}
              href={`/admin/overview/dependencies/${diagram.slug}`}
              className="group flex items-center gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm transition-all hover:border-gray-300 hover:shadow-md"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                <Layers className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900">
                  {t(diagram.titleKey)}
                </div>
                <div className="text-xs text-gray-500">
                  {t(diagram.subtitleKey)}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>
                  {diagram.layers.length} layers, {diagram.depCards.length} deps
                </span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </div>
            </Link>
          ))}

          {ALL_DIAGRAMS.length === 0 && (
            <EmptyState
              icon={<Layers className="h-12 w-12" />}
              title="No dependency diagrams configured yet."
            />
          )}
        </div>
      </main>
    </div>
  );
}
