'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';

interface BackToOverviewButtonProps {
  className?: string;
}

export default function BackToOverviewButton({
  className,
}: BackToOverviewButtonProps) {
  const { t } = useTranslation();

  return (
    <Link
      href="/admin/overview"
      className={`inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm transition-all hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900 hover:shadow ${className || ''}`}
    >
      <ArrowLeft className="h-4 w-4" />
      <span>{t('admin.architecture.backToOverview')}</span>
    </Link>
  );
}
