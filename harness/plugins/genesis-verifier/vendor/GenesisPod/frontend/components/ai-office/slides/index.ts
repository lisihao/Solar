/**
 * Slides Engine - Components
 */

// Main components
export { SlidesTab } from './SlidesTab';
export { AgentTeamPanel } from './AgentTeamPanel';
export { ThemeSelector, SLIDE_THEMES } from './ThemeSelector';
export type { SlideThemeId } from './ThemeSelector';

// Rendering
export { SlideRenderer } from './SlideRenderer';

// Editor components
export { ConversationPanel, ToolCallCard } from './SlidesEditor';
export type { ToolCallItem } from './SlidesEditor';

// Preview components
export { PreviewPanel, ThumbnailCard } from './SlidesPreview';

// AI Edit components
export { AIEditDropdown } from './AIEditDropdown';
export {
  FixLayoutResultDisplay,
  PolishContentResultDisplay,
  FactCheckResultDisplay,
} from './AIEditDropdown';

// V5.0 Components
export { ThinkingPanel } from './ThinkingPanel';
export type { ThinkingEntry } from './ThinkingPanel';
export { CodePreview } from './CodePreview';
export { SourceImportModal } from './SourceImportModal';

// V5.0 Layout Components (PRD Section 12)
export { SlidesWorkspace } from './SlidesWorkspace';
export { LeftPanel } from './LeftPanel';
export { RightPanel } from './RightPanel';
export { FileSummary } from './FileSummary';
export { AISuggestions } from './AISuggestions';
export { PageNavigator } from './PageNavigator';
export { SavePointSelector } from './SavePointSelector';
export { PreviewToolbar } from './PreviewToolbar';
export { InputBox } from './InputBox';
export { VoicePlayer } from './VoicePlayer';

// Default export
export { SlidesTab as default } from './SlidesTab';
