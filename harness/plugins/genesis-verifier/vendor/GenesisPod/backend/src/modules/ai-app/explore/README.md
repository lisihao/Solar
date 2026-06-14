# YouTube Subtitle Export Module

This module provides YouTube subtitle fetching and PDF export functionality with bilingual support (English + Chinese).

## Features

- Fetch YouTube subtitles in multiple languages
- Align English and Chinese subtitles by timestamp
- Export subtitles to PDF with various formatting options
- Support for multiple export formats (side-by-side, stacked, single language)
- Automatic fallback to multiple subtitle providers

## API Endpoints

### 1. Get Video Transcript

**GET** `/api/v1/youtube/transcript/:videoId`

Fetch transcript for a YouTube video.

**Parameters:**

- `videoId` (path): YouTube video ID

**Response:**

```json
{
  "videoId": "dQw4w9WgXcQ",
  "title": "Video Title",
  "transcript": [
    {
      "text": "Subtitle text",
      "start": 0.0,
      "duration": 2.5
    }
  ]
}
```

### 2. Get Bilingual Subtitles

**POST** `/api/v1/youtube/subtitles`

Fetch and align English and Chinese subtitles.

**Request Body:**

```json
{
  "videoId": "dQw4w9WgXcQ"
}
```

**Response:**

```json
{
  "videoId": "dQw4w9WgXcQ",
  "title": "Video Title",
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "english": [
    {
      "text": "English subtitle",
      "start": 0.0,
      "duration": 2.5
    }
  ],
  "chinese": [
    {
      "text": "中文字幕",
      "start": 0.0,
      "duration": 2.5
    }
  ]
}
```

### 3. Export to PDF

**POST** `/api/v1/youtube/export-pdf`

Export subtitles to PDF file.

**Request Body:**

```json
{
  "videoId": "dQw4w9WgXcQ",
  "title": "Video Title",
  "englishSubtitles": [...],
  "chineseSubtitles": [...],
  "options": {
    "format": "bilingual-side",
    "includeTimestamps": true,
    "includeVideoUrl": true,
    "includeMetadata": true
  }
}
```

**Export Format Options:**

- `bilingual-side`: English and Chinese in parallel columns
- `bilingual-stack`: English and Chinese stacked (one after another)
- `english-only`: Only English subtitles
- `chinese-only`: Only Chinese subtitles

**Response:**

- PDF file download (application/pdf)

## Services

### YoutubeService

Handles YouTube video transcript fetching with multiple fallback providers.

**Methods:**

- `getTranscript(videoId: string)`: Fetch video transcript
- `extractVideoId(url: string)`: Extract video ID from YouTube URL

### PdfGeneratorService

Generates PDF documents from subtitle data.

**Methods:**

- `generatePdf(transcript, metadata, options)`: Generate PDF from subtitles
- `alignTranscripts(english, chinese)`: Align bilingual transcripts by timestamp

## Dependencies

- `youtubei.js`: Primary YouTube data fetching
- `youtube-transcript`: Fallback transcript provider
- `pdfkit`: PDF generation
- `@types/pdfkit`: TypeScript types for PDFKit

## Usage Example

```typescript
import { YoutubeService } from "./youtube.service";
import { PdfGeneratorService } from "./pdf-generator.service";

// Fetch transcript
const transcript = await youtubeService.getTranscript("dQw4w9WgXcQ");

// Generate PDF
const pdfStream = pdfGeneratorService.generatePdf(
  { english: transcript.transcript, chinese: [] },
  {
    videoId: "dQw4w9WgXcQ",
    title: transcript.title,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    exportDate: new Date(),
  },
  {
    format: "english-only",
    includeTimestamps: true,
    includeVideoUrl: true,
    includeMetadata: true,
  },
);
```

## Error Handling

The module handles various error scenarios:

- Video not found
- Subtitles not available
- Invalid video ID
- Network errors

Automatic fallback chain:

1. Primary: `youtubei.js`
2. Secondary: `youtube-transcript` npm package
3. Tertiary: External transcript API
