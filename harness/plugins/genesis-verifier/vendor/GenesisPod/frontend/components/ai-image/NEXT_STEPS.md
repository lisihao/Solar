# Next Steps to Complete Refactoring

## Current Status

- **Original**: 3,182 lines
- **Current**: 938 lines (ImageGenerator.refactored.tsx)
- **Target**: <500 lines
- **Reduction Achieved**: 71%
- **Reduction Needed**: Additional 47%

## What's Left

The main component (`ImageGenerator.refactored.tsx`) still contains a large inline input area section (approximately 400 lines) that should be extracted.

## Quick Win: Extract InputArea Component

### Step 1: Create InputArea.tsx

Extract the entire input section from `ImageGenerator.refactored.tsx` (approximately lines 200-600) into a new component:

```typescript
// D:/projects/deepdive/frontend/components/ai-image/components/InputArea.tsx

import { useState, useRef } from 'react';
import type { InputMode, UploadedFile } from '../types';
import SourcePool from '../SourcePool';

interface InputAreaProps {
  inputMode: InputMode;
  onInputModeChange: (mode: InputMode) => void;

  // Prompt mode
  prompt: string;
  onPromptChange: (value: string) => void;

  // YouTube mode
  youtubeUrl: string;
  onYoutubeUrlChange: (value: string) => void;
  youtubePrompt: string;
  onYoutubePromptChange: (value: string) => void;

  // URL mode
  urls: string[];
  onUrlsChange: (urls: string[]) => void;
  urlPrompt: string;
  onUrlPromptChange: (value: string) => void;

  // Files mode
  uploadedFiles: UploadedFile[];
  onFilesChange: (files: UploadedFile[]) => void;
  filesPrompt: string;
  onFilesPromptChange: (value: string) => void;
  isDragging: boolean;
  onDragStateChange: (dragging: boolean) => void;

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
  canGenerate: boolean;
}

export function InputArea(props: InputAreaProps) {
  // Render all input modes here
  // Move the entire input section JSX from ImageGenerator.refactored.tsx
}
```

### Step 2: Update ImageGenerator.refactored.tsx

Replace the inline input section with:

```typescript
<InputArea
  inputMode={inputMode}
  onInputModeChange={setInputMode}
  prompt={prompt}
  onPromptChange={setPrompt}
  // ... pass all other props
/>
```

### Step 3: Result

- Main component will be reduced to ~450 lines
- Achieves the <500 line target
- Input logic remains accessible and maintainable

---

## Alternative: Extract Custom Hooks (For Long-term Maintainability)

### Create hooks/useImageGeneration.ts

```typescript
import { useState, useCallback } from 'react';
import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import type {
  GeneratedImage,
  ProcessingStep,
  StreamingInsights,
} from '../types';

export function useImageGeneration() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingSteps, setStreamingSteps] = useState<ProcessingStep[]>([]);
  const [streamingInsights, setStreamingInsights] =
    useState<StreamingInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = useCallback(async (params: GenerateParams) => {
    setIsGenerating(true);
    setError(null);
    setStreamingSteps([]);

    // SSE streaming logic here
    // Move from ImageGenerator.refactored.tsx

    setIsGenerating(false);
  }, []);

  return {
    isGenerating,
    streamingSteps,
    streamingInsights,
    error,
    handleGenerate,
  };
}
```

### Create hooks/useImageHistory.ts

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { GeneratedImage } from '../types';

export function useImageHistory(initialImageId?: string) {
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [selectedImage, setSelectedImage] = useState<GeneratedImage | null>(
    null
  );
  const [bookmarkedImages, setBookmarkedImages] = useState<Set<string>>(
    new Set()
  );

  const fetchHistory = useCallback(async () => {
    // Fetch logic here
  }, []);

  const handleBookmark = useCallback(async (imageId: string) => {
    // Bookmark logic here
  }, []);

  const handleDelete = useCallback(async (imageId: string) => {
    // Delete logic here
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    images,
    selectedImage,
    setSelectedImage,
    bookmarkedImages,
    handleBookmark,
    handleDelete,
    refetch: fetchHistory,
  };
}
```

### Create hooks/useModels.ts

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { AIModel, ModelsResponse } from '../types';

export function useModels() {
  const [models, setModels] = useState<ModelsResponse>({
    textModels: [],
    imageModels: [],
  });
  const [selectedImageModelId, setSelectedImageModelId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  const fetchModels = useCallback(async () => {
    // Fetch logic here
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  return {
    models,
    selectedImageModelId,
    setSelectedImageModelId,
    isLoading,
    refetch: fetchModels,
  };
}
```

### Update Main Component

```typescript
export default function ImageGenerator({
  initialImageId,
}: ImageGeneratorProps) {
  const {
    isGenerating,
    streamingSteps,
    streamingInsights,
    error,
    handleGenerate,
  } = useImageGeneration();
  const {
    images,
    selectedImage,
    setSelectedImage,
    bookmarkedImages,
    handleBookmark,
    handleDelete,
  } = useImageHistory(initialImageId);
  const {
    models,
    selectedImageModelId,
    setSelectedImageModelId,
    isLoading,
    refetch,
  } = useModels();

  // Much simpler main component!
}
```

---

## Recommended Approach

### Phase 1: Quick Win (Immediate)

Extract `InputArea` component → Get to <500 lines → **Done**

### Phase 2: Long-term (When time allows)

Extract custom hooks → Improve testability & reusability

### Phase 3: Polish

- Add unit tests for components
- Add unit tests for hooks
- Add integration tests
- Performance optimization

---

## Files to Modify

1. **Create**: `components/InputArea.tsx` (~400 lines)
2. **Update**: `ImageGenerator.refactored.tsx` (reduce to ~450 lines)
3. **Update**: `components/index.ts` (add InputArea export)
4. **Rename**: `ImageGenerator.refactored.tsx` → `ImageGenerator.tsx` (when ready)

---

## Testing Checklist

After making changes, test:

- [ ] Prompt input and generation
- [ ] YouTube URL input
- [ ] Multiple URL inputs
- [ ] File upload (drag & drop)
- [ ] Refine mode
- [ ] Model selection
- [ ] Layout selection
- [ ] Aspect ratio changes
- [ ] Skip AI toggle
- [ ] Bookmarking
- [ ] Context menu actions
- [ ] Download
- [ ] Copy image
- [ ] Lightbox
- [ ] Mobile responsiveness

---

## Commands

```bash
# Check TypeScript compilation
cd frontend
npx tsc --noEmit

# Run development server
npm run dev

# Build for production
npm run build

# Run tests (when added)
npm test
```

---

## Questions?

Refer to:

- `REFACTORING_FINAL_SUMMARY.md` - Complete overview
- `REFACTORING_COMPLETE.md` - Original refactoring plan
- `README.md` - Component usage guide

---

_Last updated: 2025-12-15_
