'use client';

import React from 'react';
import { Switch } from '@/components/ui/primitives/switch';
import { Button } from '@/components/ui/primitives/button';
import { MoreVertical, Edit, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/primitives/dropdown-menu';
import { ClientDate } from '@/components/common/ClientDate';

interface CollectionConfigCardProps {
  config: {
    id: string;
    type: 'KEYWORD' | 'RSS' | 'URL_PATTERN';
    value: string;
    isActive: boolean;
    lastRunAt: string | null;
    documentCount: number;
  };
  onStatusChange: (id: string, isActive: boolean) => void;
  onDelete: (id: string) => void;
}

export function CollectionConfigCard({
  config,
  onStatusChange,
  onDelete,
}: CollectionConfigCardProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition-all hover:shadow-md">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span
              className={`rounded-full px-2 py-1 text-xs font-medium ${
                config.type === 'KEYWORD'
                  ? 'bg-blue-100 text-blue-800'
                  : 'bg-green-100 text-green-800'
              }`}
            >
              {config.type}
            </span>
            <Switch
              checked={config.isActive}
              onCheckedChange={(isChecked: boolean) =>
                onStatusChange(config.id, isChecked)
              }
            />
          </div>
          <p className="mt-4 break-all text-lg font-semibold text-gray-900">
            {config.value}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>
              <Edit className="mr-2 h-4 w-4" />
              <span>编辑</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(config.id)}
              className="text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              <span>删除</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-6 flex items-center justify-between text-sm text-gray-500">
        <div>
          <p>上次运行</p>
          <p className="font-medium text-gray-700">
            {config.lastRunAt ? (
              <ClientDate date={config.lastRunAt} format="datetime" />
            ) : (
              '从未'
            )}
          </p>
        </div>
        <div className="text-right">
          <p>已采集</p>
          <p className="font-medium text-gray-700">{config.documentCount} 篇</p>
        </div>
      </div>
    </div>
  );
}
