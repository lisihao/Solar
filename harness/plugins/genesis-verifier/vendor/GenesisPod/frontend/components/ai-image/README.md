# AI Image Generator - Refactored Architecture

## Quick Start

```typescript
import ImageGenerator from '@/components/ai-image/ImageGenerator';

// Use in your app
<ImageGenerator initialImageId="optional-id" />
```

## Module Structure

### Core Modules

- **`types.ts`** - TypeScript type definitions
- **`constants.ts`** - Application constants
- **`utils.ts`** - Utility functions

### Components (`components/`)

- **`ThumbnailGallery`** - Image gallery with selection
- **`CanvasToolbar`** - Floating action toolbar
- **`InsightCard`** - Collapsible insight card
- **`InsightsPanel`** - Insights and processing steps
- **`LightboxModal`** - Full-screen image viewer
- **`ContextMenu`** - Right-click context menu

## Import Patterns

```typescript
// Import types
import type { GeneratedImage, InputMode } from './types';

// Import constants
import { ASPECT_RATIOS, MAX_FILE_SIZE } from './constants';

// Import utilities
import { downloadImage, copyImageToClipboard } from './utils';

// Import components (barrel export)
import { ThumbnailGallery, InsightsPanel } from './components';

// Or individual component imports
import { ThumbnailGallery } from './components/ThumbnailGallery';
```

## Component Usage

### ThumbnailGallery

```typescript
<ThumbnailGallery
  images={generatedImages}
  selectedImage={selectedImage}
  bookmarkedImages={bookmarkedSet}
  onSelect={handleSelect}
  onContextMenu={handleContextMenu}
  onWheel={handleWheel}
  isVertical={!isMobile}
/>
```

### InsightsPanel

```typescript
<InsightsPanel
  image={selectedImage}
  activeTab={insightsTab}
  onTabChange={setInsightsTab}
  templateLayout={templateLayout}
/>
```

### CanvasToolbar

```typescript
<CanvasToolbar
  image={selectedImage}
  onExpand={() => setLightboxImage(selectedImage)}
  onDownload={() => handleDownload(selectedImage)}
  onRefine={() => handleRefine(selectedImage)}
  onCopy={() => handleCopy(selectedImage)}
/>
```

### LightboxModal

```typescript
<LightboxModal
  image={lightboxImage}
  onClose={() => setLightboxImage(null)}
  onDownload={handleDownload}
  onContextMenu={handleContextMenu}
/>
```

### ContextMenu

```typescript
<ContextMenu
  position={contextMenu}
  image={contextMenu?.image}
  isBookmarked={bookmarkedImages.has(image.id)}
  isInLightbox={!!lightboxImage}
  onBookmark={handleBookmark}
  onRefine={handleRefine}
  onDownload={handleDownload}
  onCopyImage={handleCopyImage}
  onCopyLink={handleCopyLink}
  onOpenInNewTab={handleOpenInNewTab}
  onViewFullscreen={handleViewFullscreen}
  onDelete={handleDelete}
/>
```

## File Organization

```
ai-image/
├── types.ts                    # Type definitions
├── constants.ts                # App constants
├── utils.ts                    # Helper functions
├── components/
│   ├── index.ts               # Barrel exports
│   ├── ThumbnailGallery.tsx   # Gallery component
│   ├── CanvasToolbar.tsx      # Toolbar component
│   ├── InsightCard.tsx        # Card component
│   ├── InsightsPanel.tsx      # Insights panel
│   ├── LightboxModal.tsx      # Lightbox modal
│   └── ContextMenu.tsx        # Context menu
├── ImageGenerator.tsx         # Main component
├── SourcePool.tsx            # Source pool widget
└── README.md                 # This file
```

## Key Features

### Image Generation

- Prompt-based generation
- YouTube video subtitle extraction
- URL content extraction
- File upload support
- Image refinement mode

### UI Components

- Three-column layout (thumbnails, canvas, insights)
- Responsive mobile design
- Real-time SSE streaming progress
- Context menu for quick actions
- Lightbox for full-screen viewing

### Models & Settings

- Multiple AI model support
- Template layout selection
- Aspect ratio control (1:1, 16:9, 9:16, 4:3)
- AI enhancement toggle

### Source Pool

- @ mention support in prompts
- URL-based source references
- Automatic content extraction

## API Integration

The component integrates with the following API endpoints:

- `GET /api/v1/ai-image/models` - Fetch available models
- `GET /api/v1/ai-image/history` - Fetch image history
- `POST /api/v1/ai-image/generate/stream` - Generate image (SSE)
- `POST /api/v1/ai-image/generate-with-files` - Generate from files
- `POST /api/v1/ai-image/generate` - Generate with reference image
- `POST /api/v1/ai-image/{id}/bookmark` - Add bookmark
- `DELETE /api/v1/ai-image/{id}/bookmark` - Remove bookmark
- `DELETE /api/v1/ai-image/{id}` - Delete image

## Development

### Adding New Components

1. Create component in `components/` directory
2. Add to `components/index.ts` barrel export
3. Import in main component
4. Update this README

### Modifying Types

1. Update `types.ts`
2. Components will automatically get type checking
3. Update API integration if needed

### Adding Constants

1. Add to `constants.ts`
2. Use throughout components
3. No hardcoded values

### Creating Utilities

1. Add pure functions to `utils.ts`
2. Keep functions focused and testable
3. Export and document

## Testing

```bash
# Run component tests
npm test components/ai-image

# Type checking
npm run type-check

# Linting
npm run lint
```

## Performance

- Components use React.memo where appropriate
- Callbacks are memoized with useCallback
- Expensive computations use useMemo
- SSE streaming for real-time updates
- Lazy loading opportunities

## Browser Support

- Modern browsers (Chrome, Firefox, Safari, Edge)
- ES2015+ required
- CSS Grid and Flexbox support needed
- Clipboard API for copy functions

## Accessibility

- Keyboard navigation support
- ARIA labels on interactive elements
- Focus management in modals
- Semantic HTML structure

## Documentation

- `REFACTORING_SUMMARY.md` - Refactoring plan and progress
- `REFACTORING_COMPLETE.md` - Complete refactoring report
- `README.md` - This quick reference guide

## Contributing

When making changes:

1. Follow existing patterns from `/explore` and `/ai-simulation`
2. Keep components focused and small (< 300 lines ideal)
3. Extract reusable logic to utils
4. Add TypeScript types for all props
5. Update documentation

## License

Part of the DeepDive project.
