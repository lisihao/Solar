# AI Studio Optimization PRD (v3.0)

## 1. Overview

**Project Name:** AI Studio Optimization (DeepDive Vertical Flow)
**Version:** 3.0
**Status:** Draft
**Date:** 2025-11-28

### 1.1 Design Philosophy

The previous "Three-Column" layout (NotebookLM style) was deemed too fragmented for the DeepDive workflow. The new design prioritizes **screen real estate** and a **logical information flow**: from **Research (Top)** to **Analysis (Bottom)** to **Creation (Right)**.

This "Vertical Split" approach allows users to focus deeply on resource gathering and reading (Top) or chat analysis (Bottom) by collapsing the other section, while keeping generated artifacts accessible on the side.

### 1.2 Objective

Refactor AI Studio into a **Vertical Split Layout** with a **Global Sidebar** and a **Right Output Panel**:

1.  **Top (Research Hub)**: Problem definition, Deep Search, and Resource Management.
2.  **Bottom (Deep Chat)**: Contextual analysis based on the resources above.
3.  **Right (Studio Gallery)**: A dedicated space for multimodal outputs (Audio, Video, PPT, Images).

## 2. User Stories

- **As a Researcher**, I want to maximize the **Top Panel** to review 20+ search results and select the best ones without the chat interface taking up space.
- **As an Analyst**, I want to focus on the **Bottom Panel** to have a long conversation with the AI about the selected documents, while referencing the file list occasionally.
- **As a Curator**, I want to save high-quality papers from my search directly to **AI Picks** (Library) for future use.
- **As a Creator**, I want to see my generated **PPT and Video** in the **Right Panel** without obscuring my chat or resources.

## 3. Functional Requirements

### 3.1 Layout & Navigation

- **Global Sidebar (Left)**: Existing DeepDive navigation (unchanged).
- **Main Content Area (Center)**:
  - **Vertical Split**: Divided into Top and Bottom sections.
  - **Flexible Resizing**: Draggable divider between Top and Bottom.
  - **Collapsible Modes**:
    - _Default_: 50% Top / 50% Bottom.
    - _Research Focus_: Top expanded (90%), Bottom collapsed (bar only).
    - _Chat Focus_: Top collapsed (header only), Bottom expanded.
- **Output Panel (Right)**:
  - Collapsible, fixed width (300-400px).
  - Displays generated artifacts.

### 3.2 Top Panel: Research Hub (Input & Resources)

- **Problem Definition**:
  - Large, central input field: "What do you want to research?"
  - **Deep Insight Options**: Toggles for "Deep Search", "Academic Sources", "Market Reports".
- **Resource List (The "Desk")**:
  - **Display**: Grid or List view of gathered files/links.
  - **Actions per Item**:
    - 👁️ **Preview**: Quick look.
    - ⭐ **Add to AI Picks**: Save to global library.
    - ⬇️ **Download**: Save local copy.
    - ❌ **Remove**: Exclude from context.
- **Ingestion**: "Add Source" button (Upload, URL) remains available here.

### 3.3 Bottom Panel: Deep Chat (Analysis)

- **Context Awareness**: Automatically grounded in the files listed in the Top Panel.
- **Chat Interface**:
  - Standard chat stream.
  - **Reference Linking**: Clicking a citation `[1]` scrolls the Top Panel to the relevant resource (if visible).
- **Action Triggers**:
  - Commands to generate artifacts (e.g., "/ppt", "/video") which then appear in the Right Panel.

### 3.4 Right Panel: Studio Gallery (Outputs)

- **Unified Feed**: A timeline of all generated artifacts from this session.
- **Artifact Types**:
  - 🎵 **Audio Overview**: Podcast player card.
  - 🎬 **Video**: Video player card.
  - 📊 **PPT/Slides**: Preview thumbnail with "Open" and "Download" buttons.
  - 🖼️ **Images**: Generated charts or visualizations.
- **Management**:
  - Click to preview/edit.
  - Download/Share actions.

## 4. Technical Architecture

### 4.1 Component Structure

- `AIStudioPage`
  - `Sidebar` (Global)
  - `StudioLayout`
    - `ResearchPanel` (Top)
    - `ChatPanel` (Bottom)
    - `ArtifactPanel` (Right)

### 4.2 State Management (Zustand)

- **`useStudioLayoutStore`**:
  - `splitRatio`: Number (0-100) defining Top/Bottom split.
  - `rightPanelOpen`: Boolean.
- **`useResearchStore`**:
  - `query`: Current research question.
  - `resources`: List of active files.
- **`useArtifactStore`**:
  - `artifacts`: List of generated outputs.

## 5. UI/UX Refinements

- **Transitions**: Smooth animation when collapsing/expanding Top/Bottom panels.
- **Visual Clarity**:
  - Top Panel: "Desk/Workspace" feel (light gray background).
  - Bottom Panel: "Communication" feel (white background).
  - Right Panel: "Gallery" feel (darker or distinct background).

## 6. Implementation Roadmap

1.  **Layout Refactor**: Implement the Vertical Split with Resizer.
2.  **Research Hub**: Build the Search + File List with "Add to Picks" action.
3.  **Chat Integration**: Connect Chat to the new Resource Store.
4.  **Studio Gallery**: Build the Right Panel for displaying dummy artifacts (Phase 1) then real outputs (Phase 2).
