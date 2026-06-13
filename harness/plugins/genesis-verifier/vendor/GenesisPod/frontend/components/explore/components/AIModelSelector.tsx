'use client';

import { Cpu } from 'lucide-react';
import { ModelSelect } from '@/components/common/model-config/ModelSelect';
import type { AIModel } from '@/hooks';

interface AIModelSelectorProps {
  aiModel: string;
  setAiModel: (model: string) => void;
  aiModels: AIModel[];
}

export default function AIModelSelector({
  aiModel,
  setAiModel,
  aiModels,
}: AIModelSelectorProps) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gradient-to-r from-gray-50 to-gray-100 p-3">
      <div className="flex items-center gap-2">
        <Cpu size={16} className="text-gray-500" aria-hidden />
        <span className="text-xs font-medium text-gray-700">AI Model</span>
      </div>
      <div className="min-w-[200px]">
        <ModelSelect value={aiModel} onChange={setAiModel} models={aiModels} />
      </div>
    </div>
  );
}
