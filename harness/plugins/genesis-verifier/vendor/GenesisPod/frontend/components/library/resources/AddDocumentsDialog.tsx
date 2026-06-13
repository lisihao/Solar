'use client';

import { useState } from 'react';
import {
  Link as LinkIcon,
  Bookmark,
  StickyNote,
  Image as ImageIcon,
  Plus,
  FileText,
  HardDrive,
  ArrowLeft,
  ChevronRight,
  Database,
  Globe,
  Layers,
} from 'lucide-react';
import { Modal } from '@/components/ui/dialogs/Modal';
import UrlImportPanel from '../import-panels/UrlImportPanel';
import BookmarkSelectPanel from './BookmarkSelectPanel';
import NoteSelectPanel from './NoteSelectPanel';
import OcrUploadPanel from '../import-panels/OcrUploadPanel';
import ResourceSelectPanel from './ResourceSelectPanel';
import GoogleDriveImportPanel from '../import-panels/GoogleDriveImportPanel';
import NotionImportPanel from '../import-panels/NotionImportPanel';
import InternalReportsImportPanel from '../import-panels/InternalReportsImportPanel';
import { Brain, Lightbulb } from 'lucide-react';

type PanelType =
  | 'main'
  | 'resources'
  | 'gdrive'
  | 'notion'
  | 'url'
  | 'bookmark'
  | 'note'
  | 'ocr'
  | 'playground-reports'
  | 'topic-reports';

// Source configurations - easy to extend
const EXTERNAL_SOURCES = [
  {
    id: 'gdrive' as PanelType,
    label: 'Google Drive',
    description: 'Import files from your Google Drive',
    icon: HardDrive,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
  },
  {
    id: 'notion' as PanelType,
    label: 'Notion',
    description: 'Import pages from your Notion workspace',
    icon: FileText,
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
  },
];

const PLATFORM_SOURCES = [
  {
    id: 'resources' as PanelType,
    label: 'Explore Resources',
    description: 'Select from your uploaded PDFs and documents',
    icon: FileText,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
  },
  {
    id: 'bookmark' as PanelType,
    label: 'Bookmarks',
    description: 'Import your saved bookmarks',
    icon: Bookmark,
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
  },
  {
    id: 'note' as PanelType,
    label: 'Notes',
    description: 'Import your platform notes',
    icon: StickyNote,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
  },
  {
    id: 'playground-reports' as PanelType,
    label: 'Playground 报告',
    description: '从 agent-playground 完成的 mission 报告导入',
    icon: Brain,
    color: 'text-violet-600',
    bgColor: 'bg-violet-100',
  },
  {
    id: 'topic-reports' as PanelType,
    label: 'Topic Insight 报告',
    description: '从话题洞察生成的报告导入',
    icon: Lightbulb,
    color: 'text-amber-600',
    bgColor: 'bg-amber-100',
  },
];

const OTHER_METHODS = [
  {
    id: 'url' as PanelType,
    label: 'URL Fetch',
    description: 'Import content from web URLs',
    icon: LinkIcon,
    color: 'text-purple-600',
    bgColor: 'bg-purple-100',
  },
  {
    id: 'ocr' as PanelType,
    label: 'Image OCR',
    description: 'Extract text from images',
    icon: ImageIcon,
    color: 'text-pink-600',
    bgColor: 'bg-pink-100',
  },
];

interface AddDocumentsDialogProps {
  knowledgeBaseId: string;
  knowledgeBaseName: string;
  onClose: () => void;
  onDocumentsAdded?: () => void;
}

/**
 * Add Documents Dialog
 * Scalable architecture for importing content from various sources
 */
export default function AddDocumentsDialog({
  knowledgeBaseId,
  knowledgeBaseName,
  onClose,
  onDocumentsAdded,
}: AddDocumentsDialogProps) {
  const [activePanel, setActivePanel] = useState<PanelType>('main');
  const [totalImported, setTotalImported] = useState(0);

  const handleImportComplete = (count: number) => {
    setTotalImported((prev) => prev + count);
    onDocumentsAdded?.();
  };

  const getPanelTitle = () => {
    switch (activePanel) {
      case 'resources':
        return 'Explore Resources';
      case 'gdrive':
        return 'Google Drive';
      case 'notion':
        return 'Notion';
      case 'url':
        return 'URL Fetch';
      case 'bookmark':
        return 'Bookmarks';
      case 'note':
        return 'Notes';
      case 'ocr':
        return 'Image OCR';
      case 'playground-reports':
        return 'Playground 报告';
      case 'topic-reports':
        return 'Topic Insight 报告';
      default:
        return 'Add Content';
    }
  };

  const renderSourceCard = (source: {
    id: PanelType;
    label: string;
    description: string;
    icon: React.ElementType;
    color: string;
    bgColor: string;
  }) => {
    const Icon = source.icon;
    return (
      <button
        key={source.id}
        onClick={() => setActivePanel(source.id)}
        className="group flex w-full items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50 hover:shadow-sm"
      >
        <div
          className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${source.bgColor}`}
        >
          <Icon className={`h-5 w-5 ${source.color}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900">{source.label}</p>
          <p className="truncate text-xs text-gray-500">{source.description}</p>
        </div>
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-gray-400 transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  };

  const renderMainPanel = () => (
    <div className="space-y-5">
      {/* External Sources */}
      {EXTERNAL_SOURCES.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
            <Globe className="h-3.5 w-3.5" />
            External Sources
          </div>
          <div className="space-y-2">
            {EXTERNAL_SOURCES.map(renderSourceCard)}
          </div>
        </div>
      )}

      {/* Platform Content */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          <Database className="h-3.5 w-3.5" />
          Platform Content
        </div>
        <div className="space-y-2">
          {PLATFORM_SOURCES.map(renderSourceCard)}
        </div>
      </div>

      {/* Other Methods */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-gray-500">
          <Layers className="h-3.5 w-3.5" />
          Other Methods
        </div>
        <div className="space-y-2">{OTHER_METHODS.map(renderSourceCard)}</div>
      </div>
    </div>
  );

  const renderActivePanel = () => {
    switch (activePanel) {
      case 'resources':
        return (
          <ResourceSelectPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
          />
        );
      case 'gdrive':
        return (
          <GoogleDriveImportPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
          />
        );
      case 'notion':
        return (
          <NotionImportPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
          />
        );
      case 'url':
        return (
          <UrlImportPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
          />
        );
      case 'bookmark':
        return (
          <BookmarkSelectPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
          />
        );
      case 'note':
        return (
          <NoteSelectPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
          />
        );
      case 'ocr':
        return (
          <OcrUploadPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
          />
        );
      case 'playground-reports':
        return (
          <InternalReportsImportPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
            mode="playground"
          />
        );
      case 'topic-reports':
        return (
          <InternalReportsImportPanel
            knowledgeBaseId={knowledgeBaseId}
            onImportComplete={handleImportComplete}
            mode="topic"
          />
        );
      default:
        return renderMainPanel();
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={
        <div className="flex items-center gap-3">
          {activePanel !== 'main' && (
            <button
              onClick={() => setActivePanel('main')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          )}
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
            <Plus className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <div className="text-base font-semibold text-gray-900">
              {getPanelTitle()}
            </div>
            <div className="text-xs text-gray-500">
              {activePanel === 'main'
                ? `Add to "${knowledgeBaseName}"`
                : 'Select content to import'}
            </div>
          </div>
        </div>
      }
      size="md"
      headerClassName="border-b border-gray-100 px-5 py-4"
      contentClassName="p-5"
      footer={
        <div className="flex w-full items-center justify-between">
          <div className="text-sm text-gray-500">
            {totalImported > 0 && (
              <span className="text-green-600">
                Imported {totalImported} documents
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
          >
            Done
          </button>
        </div>
      }
      footerClassName="border-t border-gray-100 px-5 py-3"
    >
      {renderActivePanel()}
    </Modal>
  );
}
