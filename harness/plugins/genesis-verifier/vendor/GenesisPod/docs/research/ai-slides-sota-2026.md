# State-of-the-Art AI Slides/Presentation Generation - Technical Research 2026

**Research Date**: 2026-02-05
**Focus**: Implementation patterns, technical architecture, and business logic for AI-powered presentation generation

---

## 1. Leading AI Presentation Products (2026)

### 1.1 Top-Tier Platforms

| Product                            | Positioning               | Key Strengths                                                            |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| **Gamma**                          | AI-native design partner  | 50M+ users, 700K creations/day, Gamma Agent (agentic design), web-native |
| **Beautiful.ai**                   | Smart Slides + automation | Automatic layout adaptation, Smart Slides technology, enterprise focus   |
| **Canva Magic Design**             | Mass market + AI          | 5B+ AI uses, OpenAI GPT-4 integration, 100M+ asset library               |
| **Microsoft Copilot (PowerPoint)** | Enterprise integration    | Claude model for agents, Agent Mode, SharePoint brand asset integration  |
| **Tome**                           | Narrative + storytelling  | Scrollable format, real-time collaboration, AI narrative generation      |
| **Presentations.AI**               | Brand-first enterprise    | Instant brand sync, advanced text-to-deck, PowerPoint export fidelity    |
| **Decktopus**                      | Simplified workflow       | Content prompts → outline → slides, team collaboration                   |
| **SlidesAI**                       | Google Slides integration | Direct GSlides integration, template marketplace                         |
| **Pitch**                          | Fast-moving teams         | Streaming generation (progressive display), real-time collaboration      |

### 1.2 Market Trends (2026)

- **AI features are now standard**: Nearly every top presentation tool offers AI generation
- **Human-in-the-loop dominant**: Full automation hype replaced by practical "AI handles low-value tasks, humans guide strategy"
- **Enterprise brand integration**: Direct access to SharePoint OAL, Templafy libraries
- **Streaming/progressive generation**: Slides appear progressively rather than batch generation
- **Real-time collaboration**: Standard feature across all major platforms

---

## 2. Core Business Logic Flow

### 2.1 Standard AI Presentation Pipeline

```
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 1: Input & Intent Analysis                                    │
├─────────────────────────────────────────────────────────────────────┤
│ • User prompt/topic                                                  │
│ • Document upload (PDF, Notion, Google Docs)                        │
│ • Settings: slides count, audience, tone, aspect ratio              │
│ • Web research (Gamma Agent conducts real-time research)            │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 2: Outline Generation                                         │
├─────────────────────────────────────────────────────────────────────┤
│ • LLM generates hierarchical outline                                │
│ • User reviews/reorganizes outline                                  │
│ • Slide-level structure defined                                     │
│ • Content approval checkpoint                                       │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 3: Content Generation (Slide-by-Slide)                       │
├─────────────────────────────────────────────────────────────────────┤
│ • Title + body text generation                                      │
│ • Bullet points / structured content                                │
│ • Speaker notes generation                                          │
│ • Image/visual suggestions                                          │
│ • Citations/sources integration                                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 4: Layout Selection & Application                            │
├─────────────────────────────────────────────────────────────────────┤
│ • Content-aware layout matching                                     │
│ • Template selection from library                                   │
│ • Smart layout constraints applied                                  │
│ • 4+ design variations generated                                    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 5: Design & Theme Application                                │
├─────────────────────────────────────────────────────────────────────┤
│ • Brand assets (logo, colors, fonts) from enterprise library       │
│ • Color palette generation                                          │
│ • Visual hierarchy application                                      │
│ • Auto-alignment & spacing rules                                    │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 6: Visual Asset Generation/Integration                       │
├─────────────────────────────────────────────────────────────────────┤
│ • AI image generation (DALL-E 3 via Gemini/ChatGPT)               │
│ • Smart diagrams from text descriptions                             │
│ • Stock photo selection (Canva: 100M+ assets)                      │
│ • Charts/data visualizations                                        │
│ • AI-generated images labeled in speaker notes                     │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ Stage 7: Export & Collaboration                                    │
├─────────────────────────────────────────────────────────────────────┤
│ • PPTX export (PowerPoint format)                                   │
│ • PDF export                                                        │
│ • Web-native format (Gamma, Tome)                                  │
│ • Real-time collaboration mode                                      │
│ • API-driven automation (Gamma API → Zapier/Make)                  │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Progressive Refinement Pattern

**Best Practice**: Outline-first approach with multiple refinement passes

```
Pass 1: Skeleton Outline
├─ Headlines only
├─ Slide count + structure
└─ Story arc validation

Pass 2: Content Placeholders
├─ Bullet points
├─ Visual placeholders
└─ Speaker notes outline

Pass 3: Full Content
├─ Complete text
├─ Generated images
└─ Layout application

Pass 4: Polish & Brand
├─ Brand asset integration
├─ Design refinement
└─ Export-ready format
```

**Rationale**: Fixed time, flex scope (inspired by agile "Earliest Lovable Product")

---

## 3. Technical Architecture Patterns

### 3.1 Outline vs Content vs Layout Separation

Most successful implementations use a **3-layer separation**:

#### Layer 1: Content Generation (LLM-heavy)

- **Input**: User prompt, research data, uploaded docs
- **Process**: LLM generates structured text (title, bullets, notes)
- **Output**: JSON/structured data (no design info)
- **Model choice**: GPT-4o, Claude 3.5 Sonnet, Gemini 2.5 Pro

#### Layer 2: Layout Selection (Rule-based + ML)

- **Input**: Content structure (title, N bullets, image flag)
- **Process**: Match content type to layout templates
- **Output**: Layout ID + constraints
- **Technology**:
  - Rule-based mapping (e.g., "3 bullets + image" → "Two Column Layout")
  - ML-based layout recommendation (trained on design corpus)

#### Layer 3: Design Application (Template Engine)

- **Input**: Content + Layout + Theme
- **Process**: Apply brand colors, fonts, spacing rules
- **Output**: Rendered slide
- **Technology**:
  - Smart constraint solver (Beautiful.ai's Smart Slides)
  - Auto-alignment algorithms
  - Responsive layout engine

### 3.2 JSON Schema for Slide Representation

Multiple schema patterns observed in industry:

#### Pattern A: Hierarchical Slide Array

```json
{
  "presentation": {
    "title": "Company Strategy 2026",
    "theme": "modern-professional",
    "slides": [
      {
        "id": "slide-1",
        "type": "title",
        "layout": "title-only",
        "content": {
          "title": "Our Vision",
          "subtitle": "Q1 2026 Review"
        }
      },
      {
        "id": "slide-2",
        "type": "content",
        "layout": "two-column",
        "content": {
          "title": "Key Achievements",
          "body": [
            { "type": "bullet", "text": "Revenue growth 45%" },
            { "type": "bullet", "text": "Market expansion" }
          ],
          "image": {
            "source": "ai-generated",
            "prompt": "chart showing growth",
            "url": "..."
          }
        },
        "speakerNotes": "Emphasize revenue growth..."
      }
    ]
  }
}
```

#### Pattern B: Shape-Based (PowerPoint Generator API)

```json
{
  "presentation": {
    "slides": [
      {
        "templateId": "content-slide",
        "shapes": [
          { "name": "Title", "text": "Key Achievements" },
          { "name": "Body", "text": "Revenue growth 45%\nMarket expansion" },
          { "name": "Image1", "imageUrl": "..." }
        ]
      }
    ]
  }
}
```

#### Pattern C: Template + Data Merge (think-cell, PPTXMailMerge)

```json
{
  "template": "quarterly-report.pptx",
  "data": {
    "title": "Q1 2026",
    "revenue": 5200000,
    "growthPercent": 45,
    "chartData": [...]
  }
}
```

**Observation**: Most AI tools use **Pattern A** (hierarchical) for full generation, while **Pattern C** is common for template-based automation.

### 3.3 Template System Architecture

#### Beautiful.ai: Smart Slides System

- **Core Concept**: Templates with embedded layout constraints
- **Behavior**: Auto-realign/resize/rebalance as content changes
- **Rules**: Professional design principles encoded as constraints
- **Implementation**: Likely constraint-satisfaction solver + CSS Grid/Flexbox

#### PPT AI: Algorithm-Based Design

- **Training**: Millions of professional presentations analyzed
- **Features**: Content structure + design principle analysis
- **Output Quality**: 96% user satisfaction reported
- **Approach**: ML model trained on design corpus → layout recommendations

#### Gamma: Dynamic Web-Native

- **Format**: Web-first (not PPTX-first)
- **Flexibility**: Seamless transition between docs/decks/web pages
- **Performance**: 50x faster than manual design
- **Technology**: Likely React-based with real-time rendering

### 3.4 LLM Role vs Rule-Based Layout

| Component              | LLM Role                        | Rule-Based/ML Role               |
| ---------------------- | ------------------------------- | -------------------------------- |
| **Outline Generation** | ✅ Primary (structured output)  | ❌ Minimal                       |
| **Content Writing**    | ✅ Primary (text generation)    | ❌ None                          |
| **Layout Selection**   | ⚠️ Suggestion only              | ✅ Primary (constraint matching) |
| **Visual Hierarchy**   | ❌ None                         | ✅ Primary (design rules)        |
| **Alignment/Spacing**  | ❌ None                         | ✅ Primary (CSS engine)          |
| **Brand Consistency**  | ❌ None                         | ✅ Primary (asset database)      |
| **Image Generation**   | ✅ Primary (DALL-E, Midjourney) | ❌ None                          |

**Key Insight**: LLMs handle **content and semantics**, while **rule-based systems handle design and layout**. Attempting to use LLMs for layout directly leads to poor results (see PreGenie research).

---

## 4. Key Differentiators

### 4.1 Real-Time Collaboration

- **Standard in 2026**: Google Slides, Canva, Tome, Pitch, Decktopus
- **Features**: Multi-user editing, comments, version history
- **Implementation**: Operational Transform (OT) or CRDT for conflict resolution

### 4.2 Image Generation Integration

#### Microsoft Copilot (PowerPoint)

- Uses DALL-E 3 for image generation
- AI-generated images labeled in speaker notes
- Enterprise brand assets from SharePoint OAL integration

#### Canva Magic Design

- OpenAI GPT-4 + Canva's 100M+ asset library
- Magic Switch: GPT-4-powered summarize/translate/rearrange
- 5 billion AI uses to date

#### Google Slides (Gemini)

- DALL-E 3 integration via Gemini
- Type request → inline rendering in Docs/Slides
- Duet AI generates images/charts from text prompts

#### Industry Trend (2026)

- **Midjourney**: Web Alpha workspace (no longer Discord-only)
- **Prompt patterns**: "with empty space on the left for text overlay"
- **Integration focus**: Image gen → broader creative pipeline (video, animation)

### 4.3 Smart Layout Algorithms

#### Beautiful.ai's Smart Slides

```
User edits content → Smart Slide detects change
    ↓
Constraint solver evaluates:
├─ Text overflow?           → Reduce font size / reflow
├─ Image aspect ratio?      → Crop intelligently
├─ Element alignment?       → Auto-align to grid
└─ Visual balance?          → Redistribute whitespace
    ↓
Render updated slide (instant, no user action)
```

#### PPT AI's Training Approach

- Corpus: Millions of professional presentations
- Analysis: Content structure + design principles
- Output: High-quality layouts with 96% satisfaction
- Approach: Supervised learning on design decisions

### 4.4 Export Formats

| Platform         | PPTX             | PDF | Web       | Reveal.js | API               |
| ---------------- | ---------------- | --- | --------- | --------- | ----------------- |
| Gamma            | ✅               | ✅  | ✅ Native | ❌        | ✅ (Zapier, Make) |
| Beautiful.ai     | ✅               | ✅  | ✅        | ❌        | ❌                |
| Canva            | ✅               | ✅  | ✅        | ❌        | ✅ (limited)      |
| Microsoft        | ✅ Native        | ✅  | ❌        | ❌        | ✅ (Graph API)    |
| Tome             | ⚠️ Limited       | ✅  | ✅ Native | ❌        | ❌                |
| Presentations.AI | ✅ High fidelity | ✅  | ✅        | ❌        | ❌                |

**PPTX Export Challenge**: Web-native tools (Gamma, Tome) prioritize web format; PPTX export often loses interactive features.

**Library for PPTX**: `python-pptx` (Python) and `Aspose.Slides` (multi-format) are industry standards.

### 4.5 Streaming/Progressive Generation

#### Pitch's Implementation

- **Behavior**: Slides "stream into digital existence" as generated
- **UX**: User sees progress slide-by-slide, not batch wait
- **Technology**: Likely WebSocket/SSE for real-time updates

#### Agent Mode (Microsoft Copilot)

- **Conversational**: Maintains context, asks clarifying questions
- **Surgical edits**: Modify specific slides without regenerating deck
- **Efficiency**: 1-3 prompts per deck (vs 5-10 standard mode)

#### Progressive Refinement Pattern

- **Pass 1**: Headlines + structure (fast)
- **Pass 2**: Placeholders (mid)
- **Pass 3**: Full content + visuals (slow)
- **User Control**: Can stop/approve at any stage

---

## 5. Slide Schema Patterns

### 5.1 Slide Content Hierarchy

Standard hierarchy across all platforms:

```
Slide
├─ Metadata
│  ├─ id: unique identifier
│  ├─ type: "title" | "content" | "image" | "section-divider"
│  ├─ layout: template identifier
│  └─ theme: colors/fonts reference
│
├─ Content
│  ├─ title: string (30pt min font)
│  ├─ subtitle: string (optional)
│  ├─ body: array of elements
│  │  ├─ text: paragraph or bullet list (max 5 lines, 5 words/line)
│  │  ├─ image: {source, url, caption, placement}
│  │  ├─ chart: {type, data, style}
│  │  └─ diagram: {type, nodes, edges}
│  └─ speakerNotes: string
│
└─ Layout Constraints
   ├─ textArea: {x, y, width, height, maxLines}
   ├─ imageArea: {x, y, width, height, aspectRatio}
   └─ alignment: "left" | "center" | "right"
```

### 5.2 Visual Hierarchy Constraints

**Design Rules** (automatically enforced):

1. **Size Hierarchy**: Most important element = largest
   - Title: 30-44pt
   - Body text: 18-24pt
   - Captions: 12-16pt

2. **Placement Hierarchy**: Top/center = most important
   - Title: Always top
   - Key visual: Center or top-right
   - Supporting text: Below or left

3. **Text Constraints**:
   - Max 25% of slide area for text
   - 40% text : 60% visuals ratio
   - Max 5 lines per bullet list
   - Max 5 words per line

4. **Whitespace Rules**:
   - Minimum margin: 10% of slide dimension
   - Element spacing: Proportional to importance
   - Auto-rebalance when content changes

### 5.3 Common Slide Types

| Type             | Use Case                | Layout Pattern                          |
| ---------------- | ----------------------- | --------------------------------------- |
| **Title Slide**  | Opening/section divider | Large title + subtitle, minimal visuals |
| **Two Column**   | Compare/contrast        | Left: text, Right: image/chart          |
| **Bullet List**  | Key points              | Title + 3-5 bullets + optional icon     |
| **Image Focus**  | Visual emphasis         | Small title + large image + caption     |
| **Chart/Data**   | Analytics               | Title + chart + key insight callout     |
| **Process Flow** | Step-by-step            | Horizontal/vertical diagram + labels    |
| **Quote**        | Testimonial/emphasis    | Large centered text + attribution       |

---

## 6. Latest Trends (2025-2026)

### 6.1 Agentic Presentation Generation

#### PreGenie (Research Framework, EMNLP 2025)

- **Architecture**: Two-stage agentic framework
  - **Stage 1**: Analysis + Initial Generation (MLLM summarizes multimodal input → Markdown code)
  - **Stage 2**: Review + Re-generation (iteratively reviews code + rendered slides)
- **Technology**: Built on Slidev (Markdown → slides), multiple MLLMs collaborate
- **Problem Solved**: Poorly organized layouts, inaccurate summarization, mismatched visuals/text
- **Performance**: Outperforms existing models in aesthetics + content consistency, aligns with human design preferences
- **Key Insight**: Iterative review loop critical for quality

#### Microsoft Agent Mode

- **Conversational AI**: Asks questions, maintains context across edits
- **Surgical Precision**: Edit specific slides without full regeneration
- **Autonomy**: Works alongside user, reasons through changes
- **Model**: Claude (Anthropic) powers document generation agents

#### Gamma Agent

- **Natural Language**: Complex design tasks via conversation
- **Research Capability**: Conducts web research, integrates citations
- **Multi-Source**: Pulls from Notion, PDFs, web sources
- **Smart Diagrams**: Text descriptions → professional visuals

**Trend**: Shift from "single prompt → full deck" to **conversational, iterative, agentic co-creation**.

### 6.2 Vision Models for Layout

#### Vision-Language Models (VLMs) in 2026

- **Gemini 2.5 Pro**: Complex reasoning across text/images/audio/video
- **Meta VL-JEPA**: 50% fewer parameters, stronger performance
- **VisionAgent** (LandingAI): Agentic approach for complex visual reasoning

#### Layout Understanding Capabilities

- **Current**: Analyze existing slide designs → extract layout patterns
- **Emerging**: Generate layout suggestions from content analysis
- **Challenge**: Design rules still more reliable than pure VLM generation

**Status**: VLMs used for **layout analysis/understanding**, but **rule-based engines still dominate layout generation**.

### 6.3 Structured Output + Prompt Engineering

#### JSON Schema Enforcement (2026 Standard)

- **OpenAI Structured Outputs**: Native JSON Schema support in API
- **Benefits**: >99% schema adherence, 60% less integration code
- **Use Case**: Outline generation, slide metadata extraction

#### Prompt Engineering Patterns for Slides

**Pattern 1: Hierarchical Outline Prompt**

```
Generate a presentation outline in JSON format:
{
  "title": "...",
  "slides": [
    {"type": "title", "content": "..."},
    {"type": "content", "title": "...", "bullets": [...]}
  ]
}

Topic: {user_topic}
Target audience: {audience}
Slide count: {n_slides}
```

**Pattern 2: Progressive Refinement Prompt**

```
Stage 1: Create slide headlines only (no body text)
Stage 2: For each headline, generate 3-5 bullet points
Stage 3: For each slide, suggest visual type (image/chart/diagram)
```

**Pattern 3: Content-to-Layout Mapping**

```
Analyze this slide content and recommend layout:
- Title: "..."
- Bullets: 3
- Image required: Yes

Return: {"layout": "two-column", "reason": "..."}
```

### 6.4 Enterprise Features (2026)

#### Brand Asset Integration

- **Microsoft**: SharePoint Organization Asset Library (OAL) auto-access
- **Templafy**: Connected library for approved assets
- **Canva**: Enterprise brand kit enforcement

#### API-Driven Automation

- **Gamma API**: Mass personalization (100+ presentations from 1 template)
- **Integration**: Zapier, Make, Workato, N8N
- **Use Case**: Personalized sales decks, automated reporting

#### Security & Compliance

- **AI-generated labels**: Images marked in speaker notes
- **Audit trails**: Version history, edit logs
- **Data residency**: On-premise/cloud options

---

## 7. Implementation Recommendations

### 7.1 Recommended Architecture Stack

```
┌─────────────────────────────────────────────────────────────┐
│ User Interface Layer                                         │
├─────────────────────────────────────────────────────────────┤
│ • Prompt input + settings                                    │
│ • Outline editor (drag-drop reorder)                        │
│ • Slide preview (real-time)                                 │
│ • Export options (PPTX, PDF, Web)                           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Content Generation Layer (LLM-powered)                      │
├─────────────────────────────────────────────────────────────┤
│ • Outline generator (GPT-4o/Claude 3.5 Sonnet)             │
│ • Content writer (per-slide text generation)               │
│ • Image prompt generator (for DALL-E/Midjourney)           │
│ • Speaker notes generator                                   │
│ • Citation/research integration                             │
│                                                             │
│ Technology: OpenAI Structured Outputs API                   │
│ Schema: JSON with strict outline/slide format              │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Layout Selection Layer (Rule-based + ML)                   │
├─────────────────────────────────────────────────────────────┤
│ • Content analyzer (count bullets, detect image needs)     │
│ • Layout matcher (content signature → template ID)         │
│ • Constraint validator (does content fit template?)        │
│                                                             │
│ Technology: Decision tree or ML classifier                  │
│ Training: (content_features) → (layout_template)           │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Design Application Layer (Template Engine)                 │
├─────────────────────────────────────────────────────────────┤
│ • Template library (JSON/CSS-based templates)              │
│ • Brand asset database (logos, colors, fonts)              │
│ • Constraint solver (auto-align, resize, rebalance)        │
│ • Smart layout engine (Beautiful.ai-style)                 │
│                                                             │
│ Technology: React + CSS Grid/Flexbox for web               │
│            python-pptx for PPTX export                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Visual Asset Layer                                          │
├─────────────────────────────────────────────────────────────┤
│ • Image generation (DALL-E 3 API)                          │
│ • Stock photo search (integrated library)                  │
│ • Chart generator (data → SVG/Canvas)                      │
│ • Icon library (Lucide, Font Awesome)                      │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│ Export & Collaboration Layer                                │
├─────────────────────────────────────────────────────────────┤
│ • PPTX generator (python-pptx or Aspose.Slides)            │
│ • PDF generator (Puppeteer for web → PDF)                  │
│ • Web renderer (React/Vue-based)                           │
│ • Real-time sync (WebSocket/CRDT)                          │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Technology Choices

| Layer                | Primary Option   | Alternative       | Notes                                     |
| -------------------- | ---------------- | ----------------- | ----------------------------------------- |
| **Content LLM**      | GPT-4o           | Claude 3.5 Sonnet | Use Structured Outputs API                |
| **Image Gen**        | DALL-E 3         | Midjourney API    | DALL-E has better prompt adherence        |
| **Layout Engine**    | Custom CSS Grid  | react-grid-layout | Need constraint solver for Smart Slides   |
| **PPTX Export**      | python-pptx      | Aspose.Slides     | python-pptx simpler, Aspose more features |
| **Web Render**       | React + Tailwind | Vue + UnoCSS      | Match existing stack (Next.js)            |
| **Real-time Sync**   | Socket.io        | Yjs (CRDT)        | CRDT better for conflict resolution       |
| **Template Storage** | JSON + DB        | File-based        | DB enables versioning, search             |

### 7.3 Phased Implementation Plan

#### Phase 1: Core Generation (MVP)

- Prompt → Outline (LLM with structured output)
- Outline → Slide content (per-slide text generation)
- Basic layout selection (rule-based, 5-10 templates)
- Web preview (React-based renderer)
- PDF export (Puppeteer)

**Estimated**: 4-6 weeks, 2 developers

#### Phase 2: Smart Layouts

- Template library expansion (30+ layouts)
- Constraint-based layout engine (auto-adjust)
- Brand asset integration (logo, colors, fonts)
- PPTX export (python-pptx integration)

**Estimated**: 4-6 weeks, 2 developers

#### Phase 3: Visual Assets

- Image generation (DALL-E 3 integration)
- Chart/diagram generation
- Icon library integration
- Image placeholder → AI generation flow

**Estimated**: 3-4 weeks, 1 developer

#### Phase 4: Collaboration & Polish

- Real-time multi-user editing
- Version history
- Comments/suggestions
- API for automation (Zapier/Make)

**Estimated**: 6-8 weeks, 3 developers

### 7.4 Key Implementation Patterns

#### Pattern 1: Outline-First Generation

```typescript
// Step 1: Generate outline
const outline = await generateOutline({
  topic: userPrompt,
  slideCount: 10,
  audience: "executives",
  schema: OutlineSchema, // JSON Schema for structured output
});

// Step 2: User reviews/edits outline (UI interaction)
const approvedOutline = await waitForUserApproval(outline);

// Step 3: Generate content for each slide
const slides = await Promise.all(
  approvedOutline.slides.map((slideOutline) =>
    generateSlideContent(slideOutline),
  ),
);

// Step 4: Select layouts
const slidesWithLayouts = slides.map((slide) => ({
  ...slide,
  layout: selectLayout(slide.content), // Rule-based matcher
}));

// Step 5: Apply design
const renderedSlides = slidesWithLayouts.map((slide) =>
  applyDesign(slide, brandAssets, theme),
);
```

#### Pattern 2: Progressive Streaming

```typescript
// Server-side (SSE)
async function* generatePresentation(prompt) {
  yield { stage: "outline", data: await generateOutline(prompt) };

  const outline = await generateOutline(prompt);

  for (const slideOutline of outline.slides) {
    const slide = await generateSlideContent(slideOutline);
    yield { stage: "slide", index: slideOutline.index, data: slide };
  }

  yield { stage: "complete" };
}

// Client-side (React)
const [slides, setSlides] = useState([]);

useEffect(() => {
  const eventSource = new EventSource(`/api/generate?prompt=${prompt}`);

  eventSource.onmessage = (event) => {
    const { stage, data } = JSON.parse(event.data);

    if (stage === "slide") {
      setSlides((prev) => [...prev, data]);
    }
  };
}, [prompt]);
```

#### Pattern 3: Smart Layout Constraints

```typescript
interface LayoutConstraint {
  id: string;
  name: string;
  contentSignature: {
    titleRequired: boolean;
    minBullets: number;
    maxBullets: number;
    imageSlots: number;
    chartSlots: number;
  };
  areas: {
    title: { x: string; y: string; width: string; height: string };
    body: { x: string; y: string; width: string; height: string };
    image?: { x: string; y: string; width: string; height: string };
  };
  rules: {
    maxTextLines: number;
    fontSizeRange: [number, number];
    autoResize: boolean;
  };
}

function selectLayout(content: SlideContent): string {
  const signature = analyzeContent(content);
  const compatibleLayouts = layouts.filter((layout) =>
    matchesSignature(layout.contentSignature, signature),
  );

  // Rank by fit score
  return compatibleLayouts.sort(
    (a, b) => calculateFitScore(b, content) - calculateFitScore(a, content),
  )[0].id;
}
```

---

## 8. References & Sources

### Research Papers

- [PreGenie: An Agentic Framework for High-quality Visual Presentation Generation (EMNLP 2025)](https://arxiv.org/abs/2505.21660)

### Product Documentation

- [Gamma AI Presentation Maker](https://gamma.app/)
- [Beautiful.ai Smart Slides](https://www.beautiful.ai/)
- [Canva Magic Design](https://www.canva.com/magic-design/)
- [Microsoft Copilot in PowerPoint](https://support.microsoft.com/en-us/office/create-a-new-presentation-with-copilot-in-powerpoint-3222ee03-f5a4-4d27-8642-9c387ab4854d)
- [Presentations.AI](https://www.presentations.ai/)
- [Decktopus AI](https://www.decktopus.com)
- [Tome AI](https://ppt.ai/tome-ai-ppt)
- [Pitch Presentation Software](https://pitch.com/)

### Technical Resources

- [OpenAI Structured Outputs API](https://platform.openai.com/docs/guides/structured-outputs)
- [python-pptx Documentation](https://python-pptx.readthedocs.io/)
- [PowerPoint Generator API](https://docs.powerpointgeneratorapi.com/)
- [think-cell JSON Automation](https://www.think-cell.com/en/resources/manual/jsondataautomation)

### Industry Analysis

- [Best AI Presentation Makers 2026 (Zapier)](https://zapier.com/blog/best-ai-presentation-maker/)
- [Top 10 AI Presentation Makers 2026 (Alai)](https://getalai.com/blog/best-ai-presentation-makers)
- [AI Presentation Tools 2026 (Prezi Blog)](https://blog.prezi.com/best-ai-presentation-makers/)
- [How JSON Schema Works for LLM Tools](https://blog.promptlayer.com/how-json-schema-works-for-structured-outputs-and-tool-integration/)
- [Structured Prompting Guide](https://codeconductor.ai/blog/structured-prompting-techniques-xml-json/)

### Design Principles

- [Ten Simple Rules for Effective Presentation Slides (PMC)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8638955/)
- [PowerPoint Design Principles (OpenStax)](https://openstax.org/books/workplace-software-skills/pages/6-3-formatting-microsoft-powerpoint-slides-layout-and-design-principles)
- [Beyond Bullet Points (Gamma Insights)](https://gamma.app/insights/beyond-bullet-points-smarter-slide-design-in-gamma)

---

**Research Compiled By**: Claude Code (Sonnet 4.5)
**Date**: 2026-02-05
**Version**: 1.0
