'use client';

import Link from 'next/link';
import {
  Search,
  PenLine,
  Users,
  Image,
  Presentation,
  TrendingUp,
  MessageSquare,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';
import { useCrossModuleContext } from '@/stores/cross-module-context';

export interface SuggestedAction {
  id: string;
  label: string;
  description: string;
  module: string;
  iconName: string;
  url: string;
}

const ICON_MAP: Record<string, LucideIcon> = {
  Search,
  PenLine,
  Users,
  Image,
  Presentation,
  TrendingUp,
  MessageSquare,
};

export function ActionCards({ actions }: { actions: SuggestedAction[] }) {
  const { setContext } = useCrossModuleContext();

  if (!actions || actions.length === 0) return null;

  const handleActionClick = (action: SuggestedAction) => {
    // Derive the query from the URL (last param value)
    let query = '';
    try {
      const url = new URL(action.url, 'http://localhost');
      query = url.searchParams.get('q') ?? url.searchParams.get('topic') ?? '';
    } catch {
      // ignore malformed URL
    }

    setContext({
      sourceModule: 'ask',
      query,
      contextData: {
        relatedTopics: [action.description],
      },
    });
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <p className="mb-2 text-xs text-gray-400">想继续深入？</p>
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = ICON_MAP[action.iconName] ?? Search;
          return (
            <Link
              key={action.id}
              href={action.url}
              onClick={() => handleActionClick(action)}
              className="group flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 transition-all hover:border-blue-500/40 hover:bg-blue-50"
            >
              <Icon
                size={16}
                className="shrink-0 text-gray-400 group-hover:text-blue-500"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight text-gray-700">
                  {action.label}
                </p>
                <p className="text-xs leading-tight text-gray-400">
                  {action.description}
                </p>
              </div>
              <ArrowRight
                size={14}
                className="ml-1 shrink-0 text-gray-300 group-hover:text-blue-500"
              />
            </Link>
          );
        })}
      </div>
    </div>
  );
}
