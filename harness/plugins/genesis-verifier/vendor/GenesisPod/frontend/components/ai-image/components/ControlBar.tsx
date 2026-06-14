import type { AIModel, AspectRatio, TemplateLayout } from '../types';
import { ASPECT_RATIOS, IMAGE_STYLES } from '../constants';
import { ModelSelect } from '@/components/common/model-config/ModelSelect';

interface ControlBarProps {
  models: AIModel[];
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  templateLayout: TemplateLayout;
  onLayoutChange: (layout: TemplateLayout) => void;
  imageStyle: string;
  onStyleChange: (style: string) => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  skipEnhancement: boolean;
  onSkipEnhancementChange: (skip: boolean) => void;
  isLoadingModels: boolean;
  onRefreshModels: () => void;
  isGenerating: boolean;
}

export function ControlBar({
  models,
  selectedModelId,
  onModelChange,
  templateLayout,
  onLayoutChange,
  imageStyle,
  onStyleChange,
  aspectRatio,
  onAspectRatioChange,
  skipEnhancement,
  onSkipEnhancementChange,
  isLoadingModels,
  onRefreshModels,
  isGenerating,
}: ControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-white px-4 py-3">
      {/* Model Selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600">Model</span>
        {isLoadingModels ? (
          <div className="h-7 w-20 animate-pulse rounded-md bg-gray-100" />
        ) : models.length > 0 ? (
          <div className="min-w-[180px]">
            <ModelSelect
              value={selectedModelId}
              onChange={onModelChange}
              models={models}
              valueKey="id"
              disabled={isGenerating}
            />
          </div>
        ) : (
          <span className="text-xs text-amber-600">N/A</span>
        )}
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-gray-200" />

      {/* Template Layout */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600">Layout</span>
        <select
          value={templateLayout}
          onChange={(e) => onLayoutChange(e.target.value as TemplateLayout)}
          className="h-7 rounded-md border border-gray-200 bg-gray-50 px-2 text-xs text-gray-700 transition-colors hover:border-gray-300 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-100"
          disabled={isGenerating}
          title="Template layout"
        >
          <option value="auto">Auto</option>
          <option value="cards">Cards</option>
          <option value="center_visual">Center</option>
          <option value="timeline">Timeline</option>
          <option value="comparison">Compare</option>
          <option value="pyramid">Pyramid</option>
          <option value="radial">Radial</option>
          <option value="statistics">Stats</option>
          <option value="checklist">Checklist</option>
          <option value="funnel">Funnel</option>
          <option value="matrix">Matrix</option>
          <option value="ranking">Ranking</option>
        </select>
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-gray-200" />

      {/* Image Style */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600">Style</span>
        <select
          value={imageStyle}
          onChange={(e) => onStyleChange(e.target.value)}
          className="h-7 max-w-[140px] rounded-md border border-gray-200 bg-gray-50 px-2 text-xs text-gray-700 transition-colors hover:border-gray-300 focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-100"
          disabled={isGenerating}
          title="Image style"
        >
          {IMAGE_STYLES.map((style) => (
            <option key={style.value} value={style.value}>
              {style.label}
            </option>
          ))}
        </select>
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-gray-200" />

      {/* Aspect Ratio */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600">Ratio</span>
        <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
          {ASPECT_RATIOS.map((ratio) => (
            <button
              key={ratio}
              onClick={() => onAspectRatioChange(ratio)}
              disabled={isGenerating}
              className={`rounded px-2 py-1 text-xs font-medium transition-all ${
                aspectRatio === ratio
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {ratio}
            </button>
          ))}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Skip AI Toggle */}
      <label
        className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 transition-colors hover:bg-gray-50"
        title="Skip AI enhancement for faster generation"
      >
        <input
          type="checkbox"
          checked={skipEnhancement}
          onChange={(e) => onSkipEnhancementChange(e.target.checked)}
          className="h-3.5 w-3.5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
          disabled={isGenerating}
        />
        <span>Skip AI</span>
      </label>

      {/* Refresh Models */}
      <button
        onClick={onRefreshModels}
        disabled={isLoadingModels}
        className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
        title="Refresh models"
      >
        <svg
          className={`h-4 w-4 ${isLoadingModels ? 'animate-spin' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    </div>
  );
}
