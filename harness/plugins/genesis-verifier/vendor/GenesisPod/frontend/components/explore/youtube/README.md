# YouTube Subtitle Export Components

React components for exporting YouTube subtitles to PDF with bilingual support.

## Components

### SubtitleExportButton

A button component that triggers the subtitle export workflow.

**Props:**

- `videoId` (string, required): YouTube video ID
- `className` (string, optional): Additional CSS classes
- `variant` ('primary' | 'secondary' | 'icon', optional): Button style variant
- `position` ('top-right' | 'inline', optional): Button positioning

**Example Usage:**

```tsx
import { SubtitleExportButton } from '@/components/youtube';

// Primary button (inline)
<SubtitleExportButton videoId="dQw4w9WgXcQ" />

// Icon button in top-right corner
<SubtitleExportButton
  videoId="dQw4w9WgXcQ"
  variant="icon"
  position="top-right"
/>

// Secondary variant with custom styling
<SubtitleExportButton
  videoId="dQw4w9WgXcQ"
  variant="secondary"
  className="my-custom-class"
/>
```

### ExportDialog

A dialog component for configuring PDF export options.

**Props:**

- `isOpen` (boolean, required): Dialog open state
- `onClose` (function, required): Close handler
- `onExport` (function, required): Export handler with options
- `isLoading` (boolean, optional): Loading state

**Example Usage:**

```tsx
import { ExportDialog } from '@/components/youtube';
import { ExportOptions } from '@/hooks/useYoutubeSubtitleExport';

const [isOpen, setIsOpen] = useState(false);

const handleExport = (options: ExportOptions) => {
  console.log('Export with options:', options);
  // Handle export logic
};

<ExportDialog
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  onExport={handleExport}
  isLoading={false}
/>;
```

## Hooks

### useYoutubeSubtitleExport

Custom hook for managing subtitle fetching and PDF export.

**Returns:**

- `isLoading` (boolean): Loading state
- `error` (string | null): Error message
- `fetchSubtitles` (function): Fetch bilingual subtitles
- `exportPdf` (function): Export subtitles to PDF

**Example Usage:**

```tsx
import { useYoutubeSubtitleExport } from '@/hooks/useYoutubeSubtitleExport';

function MyComponent() {
  const { isLoading, error, fetchSubtitles, exportPdf } =
    useYoutubeSubtitleExport();

  const handleFetch = async () => {
    const subtitles = await fetchSubtitles('dQw4w9WgXcQ');
    if (subtitles) {
      console.log('Subtitles:', subtitles);
    }
  };

  const handleExport = async () => {
    await exportPdf(
      'dQw4w9WgXcQ',
      'Video Title',
      englishSubtitles,
      chineseSubtitles,
      {
        format: 'bilingual-side',
        includeTimestamps: true,
        includeVideoUrl: true,
        includeMetadata: true,
      }
    );
  };

  return (
    <div>
      <button onClick={handleFetch} disabled={isLoading}>
        Fetch Subtitles
      </button>
      <button onClick={handleExport} disabled={isLoading}>
        Export PDF
      </button>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  );
}
```

## Export Options

### Format Types

- **bilingual-side**: English and Chinese displayed in parallel columns
- **bilingual-stack**: English and Chinese stacked vertically
- **english-only**: Only English subtitles
- **chinese-only**: Only Chinese subtitles

### Additional Options

- **includeTimestamps**: Show timestamp for each subtitle segment
- **includeVideoUrl**: Include YouTube video URL in PDF header
- **includeMetadata**: Include video title, export date, and video ID

## Complete Integration Example

```tsx
'use client';

import React from 'react';
import { SubtitleExportButton } from '@/components/youtube';

export default function VideoPage({ videoId }: { videoId: string }) {
  return (
    <div className="relative">
      {/* Video player */}
      <div className="aspect-video bg-black">
        {/* Your video player component */}
      </div>

      {/* Export button in top-right corner */}
      <SubtitleExportButton
        videoId={videoId}
        variant="icon"
        position="top-right"
      />

      {/* Or as inline button below video */}
      <div className="mt-4 flex justify-end">
        <SubtitleExportButton videoId={videoId} variant="secondary" />
      </div>
    </div>
  );
}
```

## Styling

All components use Tailwind CSS classes. You can customize the appearance by:

1. Using the `className` prop to add additional styles
2. Modifying the component files directly
3. Using CSS modules or styled-components as alternatives

## Environment Variables

Set the API base URL in your `.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1
```

## Error Handling

The components include built-in error handling with:

- Toast notifications for errors
- Retry functionality for failed subtitle fetches
- Loading states during async operations
- Graceful fallbacks for missing subtitles

## Features

- Auto-fetch subtitles when dialog opens
- Bilingual subtitle alignment by timestamp
- Multiple export format options
- Responsive design
- Accessible UI components
- TypeScript support with full type safety
