# Quick Start: Structured AI Summary

Get up and running with the new structured AI summary system in 5 minutes.

## What's New?

The system now provides **resource-type-specific structured AI output** with enhanced visual presentation:

- Papers: Contributions, methodology, results
- News: Headlines, impact, sentiment
- Videos: Speakers, chapters, timestamps
- Projects: Features, tech stack, metrics

## Files to Know

### Frontend

```
frontend/components/features/StructuredAISummary/
├── StructuredAISummaryRouter.tsx  ← Use this for smart routing
├── PaperAISummary.tsx             ← Paper display
├── NewsAISummary.tsx              ← News display
├── VideoAISummary.tsx             ← Video display
└── ProjectAISummary.tsx           ← Project display
```

**Types:** `frontend/types/ai-office.ts`

### Backend

```
backend/src/modules/resources/
├── types/structured-ai-summary.types.ts  ← Type definitions
├── config/ai-prompts.config.ts           ← Prompt templates
├── ai-enrichment.service.ts              ← Core service
└── resources.controller.ts               ← API endpoints
```

## 1. Frontend: Display Structured Summary

```typescript
import { StructuredAISummaryRouter } from '@/components/features/StructuredAISummary';
import type { ResourceAISummary } from '@/types/ai-office';

export function ResourceDetail({ resource }) {
  const summary: ResourceAISummary = resource._structuredAISummary;

  return (
    <StructuredAISummaryRouter
      summary={summary}
      compact={false}
      expandable={true}
      onTimestampClick={(time) => videoPlayer?.seekTo(time)}
    />
  );
}
```

## 2. Backend: Generate Structured Summary

### Endpoint

```http
POST /api/v1/resources/:id/enrich-structured
```

### Example Request

```bash
curl -X POST http://localhost:4000/api/v1/resources/abc123/enrich-structured
```

### Example Response

```json
{
  "id": "abc123",
  "title": "Machine Learning Paper",
  "aiSummary": "Plain text summary...",
  "structuredAISummary": {
    "overview": "Comprehensive overview...",
    "category": "Academic",
    "keyPoints": ["point1", "point2"],
    "difficulty": "advanced",
    "contributions": ["contrib1", "contrib2"],
    "methodology": "Research methodology..."
  },
  "_structuredAISummary": {
    /* same as above */
  }
}
```

## 3. Type Safety

### Check Summary Type

```typescript
import {
  isPaperSummary,
  isNewsSummary,
  isVideoSummary,
} from "@/components/features/StructuredAISummary/StructuredAISummaryRouter";

const summary = resource._structuredAISummary;

if (isPaperSummary(summary)) {
  // Safe to access paper-specific fields
  console.log(summary.contributions);
} else if (isNewsSummary(summary)) {
  console.log(summary.headline);
}
```

## 4. Database

### Migration

```bash
# Create migration
npx prisma migrate dev --name add_structured_ai_summary

# Check what changed
cat prisma/migrations/*/migration.sql
```

### Field

```prisma
// Added to Resource model
structuredAISummary Json?    @map("structured_ai_summary")
```

## 5. AI Prompts

### Using Prompts

```typescript
import {
  getPromptTemplate,
  validateStructuredResponse,
} from "./config/ai-prompts.config";

// Get template for resource type
const template = getPromptTemplate("PAPER");

// Build messages
const systemPrompt = template.system;
const userMessage = template.user({
  title: paper.title,
  abstract: paper.abstract,
  content: paper.content,
});

// Call AI service
const response = await callAIService(systemPrompt, userMessage);

// Validate response
const validation = validateStructuredResponse(response, "PAPER");
if (!validation.valid) {
  console.error("Errors:", validation.errors);
}
```

## 6. Error Handling

The system automatically falls back if structured generation fails:

```typescript
// If AI service fails:
const plainSummary = "Original text summary...";
const converted = convertToStructuredSummary(plainSummary, "General");
// Now you have a basic structured format
```

## 7. Testing Your Changes

### Test Frontend Component

```typescript
// Quick test in browser console
const mockSummary = {
  overview: "Test overview",
  category: "Test",
  keyPoints: ["Test1", "Test2"],
  keywords: ["keyword"],
  difficulty: "beginner",
  readingTime: 5,
  confidence: 0.9,
  generatedAt: new Date(),
  model: "test",
};

ReactDOM.render(
  <StructuredAISummaryRouter summary={mockSummary} />,
  document.getElementById('app')
);
```

### Test Backend Endpoint

```bash
# With real resource
curl -X POST http://localhost:4000/api/v1/resources/YOUR_ID/enrich-structured

# Watch logs
tail -f backend/logs/app.log
```

## 8. Common Tasks

### Add New Resource Type

1. **Add type** in `structured-ai-summary.types.ts`:

```typescript
interface BookAISummary extends StructuredAISummary {
  author: string;
  publisher: string;
  // ... other fields
}

type ResourceAISummary = BookAISummary | /* ... */;
```

2. **Create component** in `frontend/components/features/StructuredAISummary/BookAISummary.tsx`

3. **Add router logic** in `StructuredAISummaryRouter.tsx`:

```typescript
const isBookSummary = (s: ResourceAISummary): s is BookAISummary => {
  return 'author' in s && 'publisher' in s;
};

// In render...
if (isBookSummary(summary)) return <BookAISummary summary={summary} />;
```

4. **Add prompt template** in `ai-prompts.config.ts`:

```typescript
export const BookSummaryPrompt: AIPromptTemplate = {
  name: "book_summary",
  // ...
};
```

### Customize UI Colors

Edit component's Tailwind classes:

```typescript
// In PaperAISummary.tsx
<div className="bg-gradient-to-r from-blue-50 to-indigo-50">
  {/* Change to your colors */}
</div>
```

### Adjust Prompt

Edit template in `ai-prompts.config.ts`:

```typescript
export const PaperSummaryPrompt: AIPromptTemplate = {
  user: (paper) => `
    // Your custom prompt here
    Analyze: ${paper.title}
  `,
};
```

## 9. Performance Tips

### Enable Caching

```typescript
// In AIEnrichmentService
const cacheKey = `summary:${resourceId}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

// Generate...
await redis.set(cacheKey, JSON.stringify(summary), "EX", 86400); // 24h
```

### Parallel Generation

```typescript
// Already implemented in enrichResourceWithStructured()
// Generates summary + insights + classification + structured in parallel
const [s1, s2, s3, s4] = await Promise.all([...]);
```

## 10. Troubleshooting

| Issue                     | Solution                                                |
| ------------------------- | ------------------------------------------------------- |
| Component not rendering   | Check if summary is null, verify structure matches type |
| API returns plain summary | Check AI service is available, see error logs           |
| Type errors in frontend   | Verify imports from `ai-office.ts`, check type guards   |
| Database migration fails  | Check PostgreSQL, ensure no conflicts, see prisma logs  |

## Useful Commands

```bash
# Build frontend
npm run build -w frontend

# Build backend
npm run build -w backend

# Run tests
npm test

# Type check
npm run type-check

# Format code
npm run format

# View database
npx prisma studio

# Generate types
npx prisma generate
```

## Documentation Links

- Full guide: `docs/AI-SUMMARY-RESTRUCTURING.md`
- Implementation details: `docs/IMPLEMENTATION-SUMMARY.md`
- API examples: See endpoint documentation
- Type reference: `structured-ai-summary.types.ts`

## Next Steps

1. ✅ Deploy database migration
2. ✅ Deploy backend code
3. ✅ Deploy frontend components
4. ✅ Test with real resources
5. ✅ Collect user feedback
6. ✅ Monitor metrics
7. ✅ Iterate on improvements

---

**Need help?** Check the full documentation or reach out to the team!
