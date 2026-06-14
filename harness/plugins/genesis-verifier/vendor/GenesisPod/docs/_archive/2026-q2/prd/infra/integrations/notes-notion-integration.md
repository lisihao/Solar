# Notes + Notion Integration PRD

> **Version**: 1.0
> **Author**: PM Agent
> **Created**: 2025-12-21
> **Status**: Draft

---

## Document Information

| Field          | Value         |
| -------------- | ------------- |
| Module         | notes-notion  |
| Type           | prd           |
| Priority       | P0 (Critical) |
| Target Release | v1.1.0        |

---

## 1. Executive Summary

### 1.1 Background

The current Notion editor implementation (`NotionBlockEditor.tsx`) using BlockNote has critical usability issues that severely impact user experience:

1. **Double Character Input (IME Issue)**: Chinese/Japanese input methods cause characters to be duplicated
2. **Cursor Position Bug**: Cursor always resets to the first position after input
3. **Canvas Size Issue**: Editor canvas is too small for comfortable editing
4. **Missing Formatting Toolbar**: Lack of visible editing navigation (font options, formatting tools)

These issues make the editor essentially unusable for non-English users and provide a subpar editing experience overall.

### 1.2 Goals

1. **Fix Critical Bugs**: Resolve IME double input, cursor positioning, and canvas sizing issues
2. **Unified Notes Experience**: Create a seamless Notes system where content can be local-first or synced to Notion
3. **Professional Editing**: Implement a Notion-like editing experience with proper formatting toolbar
4. **Industry Best Practices**: Follow established patterns from leading rich text editors

### 1.3 Non-Goals

- Full offline-first database implementation (Phase 2)
- Real-time collaborative editing (Phase 3)
- Mobile-native editor (separate project)
- Notion API feature parity (focus on commonly used features)

---

## 2. Problem Analysis

### 2.1 Current Implementation Issues

#### Issue 1: IME Double Character Input

**File**: `D:\projects\genesis\frontend\components\notion\NotionBlockEditor.tsx`

**Root Cause Analysis**:

- BlockNote is built on Tiptap and ProseMirror
- ProseMirror has documented issues with IME composition events
- The editor may not properly handle `compositionstart`, `compositionupdate`, and `compositionend` events
- Version `@blocknote/core: ^0.45.0` may have unpatched IME bugs

**Evidence from Research**:

- [ProseMirror Changelog](https://prosemirror.net/docs/changelog/) documents multiple IME fixes for Chinese input methods
- [Tiptap IME Issues](https://github.com/ueberdosis/tiptap/issues/2780) show similar patterns
- Fix requires proper composition event handling during IME input

#### Issue 2: Cursor Always at First Position

**Root Cause Analysis**:

- Editor re-initialization on every change
- `useMemo` dependency on `initialContent` causes editor recreation
- Missing cursor position preservation in `handleChange`

**Current Problematic Code**:

```typescript
// Line 44-50: Editor recreates on initialContent change
const editor = useMemo(() => {
  if (typeof window === "undefined") return null;
  return BlockNoteEditor.create({
    initialContent: initialContent as PartialBlock[],
  });
}, [initialContent]); // <-- This dependency causes recreation
```

#### Issue 3: Canvas Too Small

**Root Cause Analysis**:

- CSS constraint: `min-height: 400px` (Line 234)
- No full-width container support
- Missing responsive height calculation

**Current CSS**:

```css
.notion-block-editor .bn-editor {
  padding: 1rem;
  min-height: 400px; /* Too restrictive */
}
```

#### Issue 4: Missing Formatting Toolbar

**Root Cause Analysis**:

- Using default BlockNoteView without custom toolbar configuration
- No `FormattingToolbar` component customization
- Missing toolbar visibility controls

---

## 3. Technical Solution Design

### 3.1 Architecture Overview

```
+------------------+     +------------------+     +------------------+
|   Notes Module   |     |   Sync Engine    |     | External Services|
+------------------+     +------------------+     +------------------+
|                  |     |                  |     |                  |
|  Local Notes     |<--->| Sync Manager     |<--->| Notion API       |
|  - IndexedDB     |     | - Queue          |     | - Pages          |
|  - Draft State   |     | - Conflict Res.  |     | - Blocks         |
|                  |     |                  |     |                  |
+------------------+     +------------------+     +------------------+
        |                        |
        v                        v
+------------------+     +------------------+
|  BlockNote Editor|     |  Block Converter |
+------------------+     +------------------+
|  - IME Handler   |     | - Notion <-> BN  |
|  - Custom Toolbar|     | - Validation     |
|  - Full Canvas   |     | - Transform      |
+------------------+     +------------------+
```

### 3.2 IME Fix Implementation

#### Solution: Proper Composition Event Handling

```typescript
// Proposed fix in editor configuration
const editor = useMemo(() => {
  if (typeof window === "undefined") return null;

  return BlockNoteEditor.create({
    initialContent: initialContent as PartialBlock[],
    // Disable input rules during composition
    _tiptapOptions: {
      enableInputRules: true,
      enablePasteRules: true,
      // Key fix: Let ProseMirror handle composition properly
      editorProps: {
        handleDOMEvents: {
          compositionstart: () => {
            // Mark composition in progress
            return false; // Let default handling continue
          },
          compositionend: () => {
            // Composition ended, resume normal input
            return false;
          },
        },
      },
    },
  });
}, []); // Remove initialContent dependency
```

#### BlockNote Version Upgrade

Current: `@blocknote/core: ^0.45.0`

Recommended: Upgrade to latest stable version with IME fixes:

```json
{
  "@blocknote/core": "^0.50.0",
  "@blocknote/mantine": "^0.50.0",
  "@blocknote/react": "^0.50.0"
}
```

### 3.3 Cursor Position Fix

#### Solution: Decouple Editor Creation from Content

```typescript
// Create editor only once
const editor = useMemo(() => {
  if (typeof window === "undefined") return null;
  return BlockNoteEditor.create({});
}, []); // No dependencies - create once

// Update content imperatively when needed
useEffect(() => {
  if (!editor || !initialContent) return;

  // Only set content on initial load or explicit refresh
  const shouldUpdateContent = !editorInitialized.current;

  if (shouldUpdateContent) {
    editor.replaceBlocks(editor.document, initialContent);
    editorInitialized.current = true;
  }
}, [editor, initialContent]);
```

### 3.4 Canvas Size Fix

#### Solution: Full-Height Responsive Canvas

```css
/* New CSS for full-height editor */
.notion-block-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0; /* Allow flex shrinking */
}

.notion-block-editor .editor-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.notion-block-editor .bn-container {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.notion-block-editor .bn-editor {
  flex: 1;
  padding: 2rem;
  min-height: 500px;
  max-height: calc(100vh - 200px);
  overflow-y: auto;
}

/* Fullscreen mode */
.notion-block-editor.fullscreen {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 50;
  background: white;
}

.notion-block-editor.fullscreen .bn-editor {
  max-height: calc(100vh - 120px);
}
```

### 3.5 Formatting Toolbar Implementation

#### Solution: Custom FormattingToolbar with All Options

Based on [BlockNote Formatting Toolbar documentation](https://www.blocknotejs.org/docs/react/components/formatting-toolbar):

```typescript
import {
  FormattingToolbar,
  FormattingToolbarController,
  BasicTextStyleButton,
  BlockTypeSelect,
  ColorStyleButton,
  CreateLinkButton,
  TextAlignButton,
  NestBlockButton,
  UnnestBlockButton,
} from '@blocknote/react';

function CustomFormattingToolbar() {
  return (
    <FormattingToolbar>
      {/* Block Type Selector */}
      <BlockTypeSelect key="blockTypeSelect" />

      {/* Divider */}
      <span className="toolbar-divider" />

      {/* Text Style Buttons */}
      <BasicTextStyleButton basicTextStyle="bold" key="bold" />
      <BasicTextStyleButton basicTextStyle="italic" key="italic" />
      <BasicTextStyleButton basicTextStyle="underline" key="underline" />
      <BasicTextStyleButton basicTextStyle="strike" key="strike" />
      <BasicTextStyleButton basicTextStyle="code" key="code" />

      {/* Divider */}
      <span className="toolbar-divider" />

      {/* Color Buttons */}
      <ColorStyleButton key="textColor" />

      {/* Divider */}
      <span className="toolbar-divider" />

      {/* Alignment */}
      <TextAlignButton textAlignment="left" key="alignLeft" />
      <TextAlignButton textAlignment="center" key="alignCenter" />
      <TextAlignButton textAlignment="right" key="alignRight" />

      {/* Divider */}
      <span className="toolbar-divider" />

      {/* Nesting */}
      <NestBlockButton key="nest" />
      <UnnestBlockButton key="unnest" />

      {/* Link */}
      <CreateLinkButton key="createLink" />
    </FormattingToolbar>
  );
}
```

#### Static Toolbar Option

For always-visible toolbar (based on [Static Formatting Toolbar example](https://www.blocknotejs.org/examples/ui-components/static-formatting-toolbar)):

```typescript
function EditorWithStaticToolbar({ editor }) {
  return (
    <div className="editor-with-static-toolbar">
      {/* Static toolbar at top */}
      <div className="static-toolbar-container">
        <CustomFormattingToolbar />
      </div>

      {/* Editor area */}
      <BlockNoteView
        editor={editor}
        formattingToolbar={false} // Disable default floating toolbar
      />
    </div>
  );
}
```

---

## 4. Feature Requirements

### 4.1 Notes Module (New)

#### F-001: Local Notes Management

**Description**: Users can create, edit, and manage notes locally without requiring Notion connection.

**User Stories**:
| ID | Story | Priority |
|----|-------|----------|
| US-001 | As a user, I want to create a new note quickly | P0 |
| US-002 | As a user, I want my notes saved automatically | P0 |
| US-003 | As a user, I want to organize notes with folders/tags | P1 |
| US-004 | As a user, I want to search my notes | P1 |

**Data Model**:

```typescript
interface Note {
  id: string;
  title: string;
  content: Block[]; // BlockNote format
  createdAt: Date;
  updatedAt: Date;
  folderId?: string;
  tags: string[];
  syncStatus: "local" | "synced" | "pending" | "conflict";
  notionPageId?: string; // If synced to Notion
  version: number;
}

interface NoteFolder {
  id: string;
  name: string;
  parentId?: string;
  createdAt: Date;
}
```

**Acceptance Criteria**:

- [ ] Can create new note with Ctrl+N
- [ ] Note auto-saves after 2 seconds of inactivity
- [ ] Notes persist in IndexedDB for offline access
- [ ] Can delete notes with confirmation
- [ ] Can rename notes inline

#### F-002: Notion Sync Integration

**Description**: Users can optionally sync local notes to Notion.

**User Stories**:
| ID | Story | Priority |
|----|-------|----------|
| US-005 | As a user, I want to push my note to Notion | P0 |
| US-006 | As a user, I want to pull updates from Notion | P0 |
| US-007 | As a user, I want to see sync status | P1 |
| US-008 | As a user, I want to resolve conflicts | P2 |

**Sync Flow**:

```
Local Note --> Sync Button --> Block Converter --> Notion API
                                                      |
                                                      v
                                               Create/Update Page
```

**Acceptance Criteria**:

- [ ] One-click sync to Notion
- [ ] Visual indicator for sync status
- [ ] Conflict detection when both local and remote changed
- [ ] Sync history log

### 4.2 Editor Improvements

#### F-003: IME Input Fix

**Description**: Fix double character input for Chinese, Japanese, Korean input methods.

**Priority**: P0 (Blocker)

**Acceptance Criteria**:

- [ ] Chinese Pinyin input works correctly
- [ ] Japanese IME input works correctly
- [ ] Korean IME input works correctly
- [ ] No duplicate characters on composition end
- [ ] Works in Chrome, Firefox, Safari, Edge

#### F-004: Cursor Position Fix

**Description**: Cursor maintains correct position during editing.

**Priority**: P0 (Blocker)

**Acceptance Criteria**:

- [ ] Cursor stays at insertion point after typing
- [ ] Cursor position correct after paste
- [ ] Cursor position correct after undo/redo
- [ ] Selection preserved during formatting operations

#### F-005: Full-Size Canvas

**Description**: Editor canvas expands to fill available space.

**Priority**: P0

**Acceptance Criteria**:

- [ ] Editor fills available height (min 500px)
- [ ] Responsive on different screen sizes
- [ ] Fullscreen mode available (F11 or button)
- [ ] Smooth transition in/out of fullscreen

#### F-006: Formatting Toolbar

**Description**: Comprehensive formatting toolbar with all essential options.

**Priority**: P0

**Toolbar Items**:
| Item | Description | Shortcut |
|------|-------------|----------|
| Block Type | Paragraph, H1, H2, H3, Quote, Code | - |
| Bold | Bold text | Ctrl+B |
| Italic | Italic text | Ctrl+I |
| Underline | Underline text | Ctrl+U |
| Strikethrough | Strikethrough text | Ctrl+Shift+S |
| Code | Inline code | Ctrl+E |
| Text Color | Change text color | - |
| Background Color | Change background | - |
| Align Left | Left alignment | - |
| Align Center | Center alignment | - |
| Align Right | Right alignment | - |
| Indent | Increase indent | Tab |
| Outdent | Decrease indent | Shift+Tab |
| Link | Create/edit link | Ctrl+K |

**Acceptance Criteria**:

- [ ] Floating toolbar appears on text selection
- [ ] Static toolbar option available
- [ ] All formatting options accessible
- [ ] Keyboard shortcuts work
- [ ] Mobile-friendly touch targets

---

## 5. User Interface Design

### 5.1 Notes List View

```
+------------------------------------------------------------------+
|  [+] New Note    [Search...]                        [Sort v]     |
+------------------------------------------------------------------+
|                                                                   |
|  Today                                                           |
|  +---------------------------------------------------------------+
|  | Meeting Notes                              2 hours ago        |
|  | Quick summary of the project discussion...                    |
|  +---------------------------------------------------------------+
|  | Research Ideas                             5 hours ago        |
|  | Some thoughts on the new feature...                           |
|  +---------------------------------------------------------------+
|                                                                   |
|  Yesterday                                                        |
|  +---------------------------------------------------------------+
|  | Product Roadmap                            [Synced] Yesterday |
|  | Q1 priorities and milestones...                               |
|  +---------------------------------------------------------------+
|                                                                   |
+------------------------------------------------------------------+
```

### 5.2 Editor View

```
+------------------------------------------------------------------+
|  [<] Back     Meeting Notes                    [Save] [Sync]     |
+------------------------------------------------------------------+
|  [P v] | B  I  U  S  `  | A  A  | = = = | -> <- | Link          |
+------------------------------------------------------------------+
|                                                                   |
|  # Meeting Notes                                                  |
|                                                                   |
|  ## Attendees                                                     |
|  - Alice                                                         |
|  - Bob                                                           |
|  - Charlie                                                       |
|                                                                   |
|  ## Discussion Points                                             |
|                                                                   |
|  1. Project timeline review                                       |
|     - Current status: On track                                   |
|     - Next milestone: Feb 15                                     |
|                                                                   |
|  2. Resource allocation                                           |
|     > Need to hire 2 more developers                             |
|                                                                   |
|  [Type / for commands...]                                        |
|                                                                   |
+------------------------------------------------------------------+
|  Last saved: 2 minutes ago  |  Synced to Notion  |  1,234 words  |
+------------------------------------------------------------------+
```

### 5.3 Sync Status Indicators

| Status     | Icon        | Color  | Description               |
| ---------- | ----------- | ------ | ------------------------- |
| Local Only | Cloud-off   | Gray   | Not synced to Notion      |
| Synced     | Cloud-check | Green  | Up to date with Notion    |
| Pending    | Cloud-arrow | Yellow | Changes pending sync      |
| Syncing    | Cloud-spin  | Blue   | Currently syncing         |
| Conflict   | Cloud-alert | Red    | Conflict needs resolution |
| Error      | Cloud-x     | Red    | Sync failed               |

---

## 6. Technical Implementation

### 6.1 Component Structure

```
frontend/
  components/
    notes/
      NotesLayout.tsx           # Main notes layout
      NotesList.tsx             # Notes list sidebar
      NoteCard.tsx              # Note list item
      NoteEditor.tsx            # Main editor component (replaces NotionBlockEditor)
      EditorToolbar.tsx         # Custom formatting toolbar
      SyncStatusBadge.tsx       # Sync status indicator
      ConflictResolver.tsx      # Conflict resolution UI

  lib/
    notes/
      storage.ts                # IndexedDB operations
      sync-manager.ts           # Sync queue and conflict resolution
      block-converter.ts        # Enhanced block converter (existing file)

  hooks/
    useNotes.ts                 # Notes state management
    useEditor.ts                # Editor state and operations
    useSync.ts                  # Sync operations
```

### 6.2 State Management

```typescript
// Zustand store for notes
interface NotesStore {
  notes: Note[];
  activeNoteId: string | null;
  isLoading: boolean;

  // Actions
  createNote: () => Promise<Note>;
  updateNote: (id: string, content: Block[]) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
  setActiveNote: (id: string) => void;

  // Sync
  syncNote: (id: string) => Promise<void>;
  syncAllNotes: () => Promise<void>;
}
```

### 6.3 API Endpoints (Backend)

| Endpoint              | Method | Description              |
| --------------------- | ------ | ------------------------ |
| `/api/notes`          | GET    | List all notes           |
| `/api/notes`          | POST   | Create new note          |
| `/api/notes/:id`      | GET    | Get note by ID           |
| `/api/notes/:id`      | PUT    | Update note              |
| `/api/notes/:id`      | DELETE | Delete note              |
| `/api/notes/:id/sync` | POST   | Sync note to Notion      |
| `/api/notes/:id/pull` | POST   | Pull changes from Notion |
| `/api/notes/sync-all` | POST   | Sync all notes           |

---

## 7. Task Breakdown

### Phase 1: Critical Bug Fixes (3 days)

| ID    | Task                                     | Type     | Est. | Priority |
| ----- | ---------------------------------------- | -------- | ---- | -------- |
| T-001 | Upgrade BlockNote to latest version      | Frontend | 0.5d | P0       |
| T-002 | Implement IME composition event handling | Frontend | 1d   | P0       |
| T-003 | Fix editor initialization (cursor issue) | Frontend | 0.5d | P0       |
| T-004 | Implement full-height canvas CSS         | Frontend | 0.5d | P0       |
| T-005 | Add fullscreen mode support              | Frontend | 0.5d | P0       |

### Phase 2: Formatting Toolbar (2 days)

| ID    | Task                                     | Type     | Est.  | Priority |
| ----- | ---------------------------------------- | -------- | ----- | -------- |
| T-006 | Create CustomFormattingToolbar component | Frontend | 1d    | P0       |
| T-007 | Add block type selector                  | Frontend | 0.25d | P0       |
| T-008 | Add text style buttons                   | Frontend | 0.25d | P0       |
| T-009 | Add color picker                         | Frontend | 0.25d | P1       |
| T-010 | Add alignment controls                   | Frontend | 0.25d | P1       |

### Phase 3: Notes Module (5 days)

| ID    | Task                        | Type     | Est. | Priority |
| ----- | --------------------------- | -------- | ---- | -------- |
| T-011 | Create Note data model      | Backend  | 0.5d | P0       |
| T-012 | Implement IndexedDB storage | Frontend | 1d   | P0       |
| T-013 | Create NotesList component  | Frontend | 1d   | P0       |
| T-014 | Create NoteEditor component | Frontend | 1d   | P0       |
| T-015 | Implement auto-save         | Frontend | 0.5d | P0       |
| T-016 | Create notes API endpoints  | Backend  | 1d   | P0       |

### Phase 4: Notion Sync (3 days)

| ID    | Task                         | Type     | Est. | Priority |
| ----- | ---------------------------- | -------- | ---- | -------- |
| T-017 | Implement sync manager       | Frontend | 1d   | P1       |
| T-018 | Add sync status UI           | Frontend | 0.5d | P1       |
| T-019 | Implement conflict detection | Backend  | 1d   | P1       |
| T-020 | Create conflict resolver UI  | Frontend | 0.5d | P2       |

---

## 8. Milestones

| Milestone              | Date   | Deliverables                    |
| ---------------------- | ------ | ------------------------------- |
| M1: Bug Fixes Complete | Day 3  | IME fix, cursor fix, canvas fix |
| M2: Toolbar Complete   | Day 5  | Full formatting toolbar         |
| M3: Notes MVP          | Day 10 | Local notes CRUD                |
| M4: Sync Complete      | Day 13 | Notion sync integration         |

---

## 9. Testing Requirements

### 9.1 IME Testing Matrix

| IME            | Browser | OS      | Status   |
| -------------- | ------- | ------- | -------- |
| Chinese Pinyin | Chrome  | Windows | Required |
| Chinese Pinyin | Chrome  | macOS   | Required |
| Chinese Wubi   | Chrome  | Windows | Required |
| Japanese       | Chrome  | Windows | Required |
| Korean         | Chrome  | Windows | Required |
| Chinese Pinyin | Firefox | Windows | Required |
| Chinese Pinyin | Safari  | macOS   | Required |
| Chinese Pinyin | Edge    | Windows | Required |

### 9.2 Editor Test Cases

| Test Case | Description                                  |
| --------- | -------------------------------------------- |
| TC-001    | Type Chinese text with Pinyin, no duplicates |
| TC-002    | Type in empty paragraph, cursor stays at end |
| TC-003    | Paste content, cursor at end of paste        |
| TC-004    | Undo/redo preserves cursor position          |
| TC-005    | Bold selection maintains selection           |
| TC-006    | Fullscreen toggle works                      |
| TC-007    | Auto-save triggers after 2s inactivity       |
| TC-008    | Sync button shows correct status             |

---

## 10. Risks and Mitigations

| Risk                              | Impact | Probability | Mitigation                                        |
| --------------------------------- | ------ | ----------- | ------------------------------------------------- |
| BlockNote version incompatibility | High   | Medium      | Test thoroughly before upgrade, maintain fallback |
| IME issues persist after fix      | High   | Low         | Implement custom composition handler              |
| Notion API rate limits            | Medium | Medium      | Implement queue with backoff                      |
| Data loss during sync conflict    | High   | Low         | Always preserve local version, show diff          |
| Performance with large notes      | Medium | Medium      | Implement virtualization for long documents       |

---

## 11. Success Metrics

| Metric                      | Current | Target |
| --------------------------- | ------- | ------ |
| IME input accuracy          | 50%     | 100%   |
| Editor crash rate           | Unknown | < 0.1% |
| Auto-save success rate      | N/A     | > 99%  |
| Sync conflict rate          | N/A     | < 5%   |
| User satisfaction (editing) | Low     | > 4/5  |

---

## 12. References

### Research Sources

- [BlockNote GitHub Repository](https://github.com/TypeCellOS/BlockNote)
- [BlockNote Formatting Toolbar Documentation](https://www.blocknotejs.org/docs/react/components/formatting-toolbar)
- [ProseMirror Changelog - IME Fixes](https://prosemirror.net/docs/changelog/)
- [Tiptap IME Issues](https://github.com/ueberdosis/tiptap/issues/2780)
- [Rich Text Editor Comparison 2025](https://liveblocks.io/blog/which-rich-text-editor-framework-should-you-choose-in-2025)
- [Notion Text Formatting Guide](https://thomasjfrank.com/a-guide-to-editing-and-formatting-text-in-notion-notion-fundamentals/)

### Related Files

- `D:\projects\genesis\frontend\components\notion\NotionBlockEditor.tsx`
- `D:\projects\genesis\frontend\app\notion\[pageId]\page.tsx`
- `D:\projects\genesis\frontend\lib\notion\block-converter.ts`
- `D:\projects\genesis\frontend\package.json`

---

## 13. Appendix

### A. BlockNote Version Comparison

| Version               | IME Support | Key Features                  |
| --------------------- | ----------- | ----------------------------- |
| 0.45.0 (current)      | Partial     | Basic blocks, some IME issues |
| 0.50.0+ (recommended) | Improved    | Better IME, new block types   |

### B. Alternative Editors Considered

| Editor    | Pros                      | Cons                   | Decision      |
| --------- | ------------------------- | ---------------------- | ------------- |
| BlockNote | Block-based, Notion-like  | IME issues (fixable)   | **Selected**  |
| Tiptap    | Flexible, well-maintained | Need to build block UI | Backup option |
| Plate     | Plugin system             | Complex setup          | Not selected  |
| Lexical   | Facebook backing          | No pure decorations    | Not selected  |
| Yoopta    | Notion-like               | Less mature            | Not selected  |

### C. Keyboard Shortcuts Reference

| Shortcut     | Action            |
| ------------ | ----------------- |
| Ctrl+N       | New note          |
| Ctrl+S       | Save note         |
| Ctrl+B       | Bold              |
| Ctrl+I       | Italic            |
| Ctrl+U       | Underline         |
| Ctrl+K       | Insert link       |
| Ctrl+E       | Inline code       |
| Ctrl+Shift+S | Strikethrough     |
| Tab          | Indent            |
| Shift+Tab    | Outdent           |
| /            | Slash commands    |
| F11          | Toggle fullscreen |

---

## Change Log

| Version | Date       | Changes     | Author   |
| ------- | ---------- | ----------- | -------- |
| 1.0     | 2025-12-21 | Initial PRD | PM Agent |
