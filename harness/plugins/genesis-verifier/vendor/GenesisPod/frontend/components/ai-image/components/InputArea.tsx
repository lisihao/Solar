import { useRef } from 'react';
import type {
  InputMode,
  UploadedFile,
  GeneratedImage,
  AIModel,
  AspectRatio,
  TemplateLayout,
} from '../types';
import { ControlBar } from './ControlBar';
import SourcePool from '../SourcePool';
import { getFileIcon } from '../utils';

interface ImageSource {
  id: string;
  title: string;
  type: string;
}

export interface InputAreaProps {
  // Control bar props
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

  // Input mode
  inputMode: InputMode;
  onInputModeChange: (mode: InputMode) => void;

  // Prompt mode
  prompt: string;
  onPromptChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  showMentions: boolean;
  onShowMentionsChange: (show: boolean) => void;
  mentionQuery: string;
  onMentionQueryChange: (query: string) => void;
  cursorPosition: number;
  onCursorPositionChange: (pos: number) => void;
  filteredSources: ImageSource[];
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;

  // YouTube mode
  youtubeUrl: string;
  onYoutubeUrlChange: (value: string) => void;
  youtubePrompt: string;
  onYoutubePromptChange: (value: string) => void;

  // URL mode
  urls: string[];
  onUrlChange: (index: number, value: string) => void;
  onAddUrl: () => void;
  onRemoveUrl: (index: number) => void;
  urlPrompt: string;
  onUrlPromptChange: (value: string) => void;

  // Files mode
  uploadedFiles: UploadedFile[];
  filesPrompt: string;
  onFilesPromptChange: (value: string) => void;
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (files: FileList | null) => void;
  onRemoveFile: (id: string) => void;

  // Refine mode
  refineImage: GeneratedImage | null;
  refinePrompt: string;
  onRefinePromptChange: (value: string) => void;
  onCancelRefine: () => void;

  // Common
  error: string | null;
  isGenerating: boolean;
  onGenerate: () => void;
  hasValidInput: () => boolean;
}

export function InputArea({
  // Control bar props
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

  // Input mode
  inputMode,
  onInputModeChange,

  // Prompt mode
  prompt,
  onPromptChange,
  textareaRef,
  showMentions,
  onShowMentionsChange,
  mentionQuery,
  onMentionQueryChange,
  cursorPosition,
  onCursorPositionChange,
  filteredSources,
  onKeyDown,

  // YouTube mode
  youtubeUrl,
  onYoutubeUrlChange,
  youtubePrompt,
  onYoutubePromptChange,

  // URL mode
  urls,
  onUrlChange,
  onAddUrl,
  onRemoveUrl,
  urlPrompt,
  onUrlPromptChange,

  // Files mode
  uploadedFiles,
  filesPrompt,
  onFilesPromptChange,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
  onRemoveFile,

  // Refine mode
  refineImage,
  refinePrompt,
  onRefinePromptChange,
  onCancelRefine,

  // Common
  error,
  isGenerating,
  onGenerate,
  hasValidInput,
}: InputAreaProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canGenerate = hasValidInput() && !isGenerating && models.length > 0;

  return (
    <div className="flex-shrink-0">
      {/* Control Bar */}
      <ControlBar
        models={models}
        selectedModelId={selectedModelId}
        onModelChange={onModelChange}
        templateLayout={templateLayout}
        onLayoutChange={onLayoutChange}
        imageStyle={imageStyle}
        onStyleChange={onStyleChange}
        aspectRatio={aspectRatio}
        onAspectRatioChange={onAspectRatioChange}
        skipEnhancement={skipEnhancement}
        onSkipEnhancementChange={onSkipEnhancementChange}
        isLoadingModels={isLoadingModels}
        onRefreshModels={onRefreshModels}
        isGenerating={isGenerating}
      />

      {/* Source Pool */}
      <div className="px-3 pt-2">
        <SourcePool />
      </div>

      {/* Error Message */}
      {error && (
        <div className="mx-3 mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Input Mode Tabs */}
      {inputMode !== 'refine' && (
        <div className="flex border-b border-gray-100 px-4">
          {[
            {
              mode: 'prompt' as InputMode,
              label: 'Prompt',
              icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
            },
            {
              mode: 'youtube' as InputMode,
              label: 'YouTube',
              icon: 'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
            },
            {
              mode: 'url' as InputMode,
              label: 'URL',
              icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
            },
            {
              mode: 'files' as InputMode,
              label: 'Files',
              icon: 'M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12',
            },
          ].map(({ mode, label, icon }) => (
            <button
              key={mode}
              onClick={() => onInputModeChange(mode)}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-all ${
                inputMode === mode
                  ? 'text-purple-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={icon}
                />
              </svg>
              {label}
              {inputMode === mode && (
                <span className="absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-purple-600" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Refine Mode Header */}
      {inputMode === 'refine' && (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-t-lg border border-purple-200 bg-purple-50 px-3 py-2">
          <svg
            className="h-4 w-4 text-purple-500"
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
          <span className="text-xs font-medium text-purple-700">
            Refine Image
          </span>
          <button
            onClick={onCancelRefine}
            className="ml-auto text-gray-400 hover:text-gray-600"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Input Area Content */}
      <div className="p-3">
        {/* Prompt Input */}
        {inputMode === 'prompt' && (
          <PromptInput
            prompt={prompt}
            onPromptChange={onPromptChange}
            textareaRef={textareaRef}
            showMentions={showMentions}
            onShowMentionsChange={onShowMentionsChange}
            mentionQuery={mentionQuery}
            onMentionQueryChange={onMentionQueryChange}
            cursorPosition={cursorPosition}
            onCursorPositionChange={onCursorPositionChange}
            filteredSources={filteredSources}
            onKeyDown={onKeyDown}
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            onGenerate={onGenerate}
          />
        )}

        {/* YouTube Input */}
        {inputMode === 'youtube' && (
          <YouTubeInput
            youtubeUrl={youtubeUrl}
            onYoutubeUrlChange={onYoutubeUrlChange}
            youtubePrompt={youtubePrompt}
            onYoutubePromptChange={onYoutubePromptChange}
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            onGenerate={onGenerate}
          />
        )}

        {/* URL Input */}
        {inputMode === 'url' && (
          <URLInput
            urls={urls}
            onUrlChange={onUrlChange}
            onAddUrl={onAddUrl}
            onRemoveUrl={onRemoveUrl}
            urlPrompt={urlPrompt}
            onUrlPromptChange={onUrlPromptChange}
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            onGenerate={onGenerate}
          />
        )}

        {/* Files Input */}
        {inputMode === 'files' && (
          <FilesInput
            fileInputRef={fileInputRef}
            uploadedFiles={uploadedFiles}
            filesPrompt={filesPrompt}
            onFilesPromptChange={onFilesPromptChange}
            isDragging={isDragging}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onFileSelect={onFileSelect}
            onRemoveFile={onRemoveFile}
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            onGenerate={onGenerate}
          />
        )}

        {/* Refine Input */}
        {inputMode === 'refine' && refineImage && (
          <RefineInput
            refineImage={refineImage}
            refinePrompt={refinePrompt}
            onRefinePromptChange={onRefinePromptChange}
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            onGenerate={onGenerate}
          />
        )}
      </div>
    </div>
  );
}

// ==================== Sub-components ====================

interface PromptInputProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  showMentions: boolean;
  onShowMentionsChange: (show: boolean) => void;
  mentionQuery: string;
  onMentionQueryChange: (query: string) => void;
  cursorPosition: number;
  onCursorPositionChange: (pos: number) => void;
  filteredSources: ImageSource[];
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}

function PromptInput({
  prompt,
  onPromptChange,
  textareaRef,
  showMentions,
  onShowMentionsChange,
  cursorPosition,
  onCursorPositionChange,
  filteredSources,
  onKeyDown,
  isGenerating,
  canGenerate,
  onGenerate,
}: PromptInputProps) {
  return (
    <div className="relative">
      <div className="rounded-xl border border-gray-300 bg-white focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-500">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => {
            const value = e.target.value;
            onPromptChange(value);
            const cursor = e.target.selectionStart || 0;
            onCursorPositionChange(cursor);
            const lastAt = value.lastIndexOf('@', cursor);
            if (lastAt !== -1 && lastAt < cursor) {
              const query = value.slice(lastAt + 1, cursor);
              if (!query.includes(' ')) {
                onShowMentionsChange(true);
                return;
              }
            }
            onShowMentionsChange(false);
          }}
          onKeyDown={onKeyDown}
          placeholder="Describe what you want to create... (Type @ to mention sources, Shift+Enter for new line)"
          className="max-h-[200px] min-h-[80px] w-full resize-none bg-transparent px-3 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          disabled={isGenerating}
          rows={3}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-[10px] text-gray-400">Enter to generate</span>
          <GenerateButton
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            onGenerate={onGenerate}
            variant="purple"
          />
        </div>
      </div>
      {/* Mentions Dropdown */}
      {showMentions && filteredSources.length > 0 && (
        <div className="absolute bottom-full left-0 z-10 mb-2 w-full max-w-xs overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
          <div className="border-b border-gray-200 bg-gray-50 px-3 py-1.5 text-[10px] text-gray-500">
            Mention source...
          </div>
          <div className="max-h-40 overflow-y-auto">
            {filteredSources.map((source) => (
              <button
                key={source.id}
                onClick={() => {
                  const lastAt = prompt.lastIndexOf('@', cursorPosition);
                  if (lastAt !== -1) {
                    const newPrompt =
                      prompt.slice(0, lastAt) +
                      `@[${source.title}]` +
                      prompt.slice(cursorPosition);
                    onPromptChange(newPrompt);
                    onShowMentionsChange(false);
                    textareaRef.current?.focus();
                  }
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
              >
                <span className="flex-shrink-0">
                  {source.type === 'paper'
                    ? '📄'
                    : source.type === 'youtube'
                      ? '🎬'
                      : '🔗'}
                </span>
                <span className="truncate">{source.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface YouTubeInputProps {
  youtubeUrl: string;
  onYoutubeUrlChange: (value: string) => void;
  youtubePrompt: string;
  onYoutubePromptChange: (value: string) => void;
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}

function YouTubeInput({
  youtubeUrl,
  onYoutubeUrlChange,
  youtubePrompt,
  onYoutubePromptChange,
  isGenerating,
  canGenerate,
  onGenerate,
}: YouTubeInputProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500">
        <svg
          className="h-4 w-4 flex-shrink-0 text-red-500"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
        <input
          type="url"
          value={youtubeUrl}
          onChange={(e) => onYoutubeUrlChange(e.target.value)}
          placeholder="Paste YouTube video URL..."
          className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          disabled={isGenerating}
        />
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 focus-within:border-red-500 focus-within:ring-1 focus-within:ring-red-500">
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <input
          type="text"
          value={youtubePrompt}
          onChange={(e) => onYoutubePromptChange(e.target.value)}
          placeholder="Describe what to generate from video..."
          className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          disabled={isGenerating}
        />
      </div>

      <p className="text-[10px] text-gray-500">
        Extract video subtitles and generate an image based on content
      </p>
      <div className="flex justify-end">
        <GenerateButton
          isGenerating={isGenerating}
          canGenerate={canGenerate}
          onGenerate={onGenerate}
          variant="red"
        />
      </div>
    </div>
  );
}

interface URLInputProps {
  urls: string[];
  onUrlChange: (index: number, value: string) => void;
  onAddUrl: () => void;
  onRemoveUrl: (index: number) => void;
  urlPrompt: string;
  onUrlPromptChange: (value: string) => void;
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}

function URLInput({
  urls,
  onUrlChange,
  onAddUrl,
  onRemoveUrl,
  urlPrompt,
  onUrlPromptChange,
  isGenerating,
  canGenerate,
  onGenerate,
}: URLInputProps) {
  return (
    <div className="space-y-2">
      {urls.map((url, index) => (
        <div key={index} className="flex items-center gap-2">
          <div className="flex flex-1 items-center rounded-xl border border-gray-300 bg-white px-3 py-2 focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-500">
            <svg
              className="mr-2 h-3.5 w-3.5 flex-shrink-0 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
            <input
              type="text"
              value={url}
              onChange={(e) => onUrlChange(index, e.target.value)}
              placeholder="https://example.com/article"
              className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
              disabled={isGenerating}
            />
          </div>
          {urls.length > 1 && (
            <button
              onClick={() => onRemoveUrl(index)}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      ))}
      <button
        onClick={onAddUrl}
        className="flex items-center gap-1 text-[10px] text-gray-500 hover:text-gray-700"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        Add URL
      </button>

      <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-500">
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <input
          type="text"
          value={urlPrompt}
          onChange={(e) => onUrlPromptChange(e.target.value)}
          placeholder="Describe what to generate from URLs..."
          className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          disabled={isGenerating}
        />
      </div>

      <div className="flex justify-end">
        <GenerateButton
          isGenerating={isGenerating}
          canGenerate={canGenerate}
          onGenerate={onGenerate}
          variant="purple"
        />
      </div>
    </div>
  );
}

interface FilesInputProps {
  fileInputRef: React.RefObject<HTMLInputElement>;
  uploadedFiles: UploadedFile[];
  filesPrompt: string;
  onFilesPromptChange: (value: string) => void;
  isDragging: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onFileSelect: (files: FileList | null) => void;
  onRemoveFile: (id: string) => void;
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}

function FilesInput({
  fileInputRef,
  uploadedFiles,
  filesPrompt,
  onFilesPromptChange,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
  onRemoveFile,
  isGenerating,
  canGenerate,
  onGenerate,
}: FilesInputProps) {
  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".txt,.md,.html,.json,.pdf,.srt,.vtt,image/*"
        onChange={(e) => onFileSelect(e.target.files)}
        className="hidden"
      />
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 transition-all ${
          isDragging
            ? 'border-purple-400 bg-purple-50/80 shadow-inner'
            : 'border-gray-300 bg-gray-50 hover:border-purple-400'
        }`}
      >
        <svg
          className={`mb-1 h-6 w-6 ${isDragging ? 'text-purple-500' : 'text-gray-400'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-xs text-gray-600">
          {isDragging ? 'Drop files here' : 'Click or drag files'}
        </p>
        <p className="mt-0.5 text-[10px] text-gray-400">
          PDF, TXT, MD, HTML, JSON, Images (max 50MB)
        </p>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2 focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-500">
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
          />
        </svg>
        <input
          type="text"
          value={filesPrompt}
          onChange={(e) => onFilesPromptChange(e.target.value)}
          placeholder="Describe what to generate from files..."
          className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          disabled={isGenerating}
        />
      </div>

      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {uploadedFiles.map((uf) => (
            <div
              key={uf.id}
              className="group flex items-center gap-1.5 rounded border border-gray-200 bg-gray-100 px-2 py-1"
            >
              {uf.preview ? (
                <img
                  src={uf.preview}
                  alt={uf.file.name}
                  className="h-5 w-5 rounded object-cover"
                />
              ) : (
                <svg
                  className="h-4 w-4 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={getFileIcon(uf.file)}
                  />
                </svg>
              )}
              <span className="max-w-[100px] truncate text-[10px] text-gray-600">
                {uf.file.name}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFile(uf.id);
                }}
                className="text-gray-400 opacity-0 hover:text-gray-600 group-hover:opacity-100"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <GenerateButton
          isGenerating={isGenerating}
          canGenerate={canGenerate}
          onGenerate={onGenerate}
          variant="purple"
        />
      </div>
    </div>
  );
}

interface RefineInputProps {
  refineImage: GeneratedImage;
  refinePrompt: string;
  onRefinePromptChange: (value: string) => void;
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
}

function RefineInput({
  refineImage,
  refinePrompt,
  onRefinePromptChange,
  isGenerating,
  canGenerate,
  onGenerate,
}: RefineInputProps) {
  return (
    <div className="space-y-2">
      {/* Reference image preview */}
      <div className="flex items-start gap-3 rounded-xl border border-purple-200 bg-purple-50 p-3">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg">
          <img
            src={refineImage.imageUrl}
            alt="Reference"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-purple-700">Reference Image</p>
          <p className="mt-0.5 line-clamp-2 text-[10px] text-gray-600">
            {refineImage.enhancedPrompt || refineImage.prompt}
          </p>
          <p className="mt-0.5 text-[10px] text-gray-500">
            {refineImage.width} x {refineImage.height}
          </p>
        </div>
      </div>

      {/* Refine prompt input */}
      <div className="rounded-xl border border-gray-300 bg-white focus-within:border-purple-500 focus-within:ring-1 focus-within:ring-purple-500">
        <textarea
          value={refinePrompt}
          onChange={(e) => onRefinePromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onGenerate();
            }
          }}
          placeholder="Describe how to refine... (e.g., 'make it more vibrant', 'add snow')"
          className="min-h-[60px] w-full resize-none bg-transparent px-3 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          disabled={isGenerating}
          autoFocus
          rows={2}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-[10px] text-gray-400">Enter to generate</span>
          <GenerateButton
            isGenerating={isGenerating}
            canGenerate={canGenerate}
            onGenerate={onGenerate}
            variant="pink"
            label="Refine"
            icon="refine"
          />
        </div>
      </div>
    </div>
  );
}

// Shared Generate Button component
interface GenerateButtonProps {
  isGenerating: boolean;
  canGenerate: boolean;
  onGenerate: () => void;
  variant?: 'purple' | 'red' | 'pink';
  label?: string;
  icon?: 'sparkle' | 'refine';
}

function GenerateButton({
  isGenerating,
  canGenerate,
  onGenerate,
  variant = 'purple',
  label = 'Generate',
  icon = 'sparkle',
}: GenerateButtonProps) {
  const gradients = {
    purple:
      'from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700',
    red: 'from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700',
    pink: 'from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700',
  };

  const icons = {
    sparkle:
      'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z',
    refine:
      'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
  };

  return (
    <button
      onClick={onGenerate}
      disabled={!canGenerate}
      className={`flex items-center gap-1.5 rounded-lg bg-gradient-to-r ${gradients[variant]} px-3 py-1.5 text-xs text-white transition disabled:opacity-50`}
    >
      {isGenerating ? (
        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
      ) : (
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d={icons[icon]}
          />
        </svg>
      )}
      {label}
    </button>
  );
}
