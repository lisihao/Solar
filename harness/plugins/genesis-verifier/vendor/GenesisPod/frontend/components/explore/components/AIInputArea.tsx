'use client';

import { Resource, AIMessage } from '../utils/types';

interface AIInputAreaProps {
  selectedResource: Resource | null;
  aiInput: string;
  setAiInput: (input: string) => void;
  aiLoading: boolean;
  attachments: File[];
  onSendMessage: () => void;
  onAttachmentClick: () => void;
  onRemoveAttachment: (index: number) => void;
  onSaveConversation: () => void;
  attachmentFileInputRef: React.RefObject<HTMLInputElement>;
  onAttachmentFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  aiMessages: AIMessage[];
}

export default function AIInputArea({
  selectedResource,
  aiInput,
  setAiInput,
  aiLoading,
  attachments,
  onSendMessage,
  onAttachmentClick,
  onRemoveAttachment,
  onSaveConversation,
  attachmentFileInputRef,
  onAttachmentFileChange,
  aiMessages,
}: AIInputAreaProps) {
  return (
    <div className="border-t border-gray-200 p-4">
      {/* Attachments Display */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((file, index) => (
            <div
              key={index}
              className="flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 text-sm"
            >
              <svg
                className="h-4 w-4 flex-shrink-0 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <span className="max-w-[150px] truncate text-gray-700">
                {file.name}
              </span>
              <button
                onClick={() => onRemoveAttachment(index)}
                className="flex-shrink-0 text-gray-400 hover:text-red-500"
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
          ))}
        </div>
      )}

      {/* Hidden File Input */}
      <input
        ref={attachmentFileInputRef}
        type="file"
        multiple
        accept=".pdf,.doc,.docx,.txt,.jpg,.jpeg,.png"
        onChange={onAttachmentFileChange}
        className="hidden"
      />

      <div className="relative">
        <textarea
          value={aiInput}
          onChange={(e) => setAiInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSendMessage();
            }
          }}
          disabled={!selectedResource || aiLoading}
          placeholder={
            selectedResource
              ? 'Ask anything about this content...'
              : 'Select a resource first...'
          }
          rows={3}
          className="w-full resize-none rounded-lg border border-gray-300 bg-gray-50 px-4 py-3 pr-24 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
        />
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          <button
            onClick={onAttachmentClick}
            className="p-1.5 text-gray-400 transition-colors hover:text-gray-600"
            disabled={!selectedResource}
            title="Upload attachment"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
              />
            </svg>
          </button>
          <button
            onClick={onSaveConversation}
            className="p-1.5 text-gray-400 transition-colors hover:text-gray-600"
            disabled={!selectedResource || aiMessages.length === 0}
            title="Save conversation to notes"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
              />
            </svg>
          </button>
          <button
            onClick={onSendMessage}
            disabled={!selectedResource || !aiInput.trim() || aiLoading}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiLoading ? (
              <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
            ) : (
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
                  d="M5 10l7-7m0 0l7 7m-7-7v18"
                />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
