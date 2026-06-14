---
name: Data Pipeline Expert
description: |
  Unified data collection, quality management, and pipeline orchestration.
  Trigger keywords: data pipeline, crawler, deduplication, data quality, etl
  Not for: Database schema (-> schema-architect), API endpoints (-> api-developer)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [data, crawler, collection, deduplication, quality, pipeline, etl]
boundaries:
  includes:
    - Data collection pipeline design
    - Crawler implementation
    - Deduplication strategies
    - Data quality monitoring
  excludes:
    - Database schema design
    - API endpoint development
  handoff:
    - skill: schema-architect
      when: Schema changes needed
    - skill: devops-platform
      when: Deploy data services
---

# Data Pipeline Expert

> Detailed docs: `references/`

## Architecture

```
External Sources → Crawlers → Processing → Quality → Storage
      ↓              ↓           ↓          ↓        ↓
  Web/APIs      Raw Data      ETL      Quality    Final
                (MongoDB)   Pipeline   Checks     Data
```

## Key Files

```
backend/src/modules/data-services/
├── data-collection/
│   └── collection-task.service.ts
├── crawler/
│   ├── hackernews.service.ts
│   └── deduplication.service.ts
└── data-quality/
    ├── quality-checker.service.ts
    └── anomaly-detector.service.ts
```

## Collection Task Flow

```typescript
async execute(taskId: string): Promise<void> {
  const task = await this.findTask(taskId);

  try {
    await this.updateStatus(taskId, TaskStatus.RUNNING);
    const rawData = await this.fetchFromSource(task.source);
    const uniqueData = await this.deduplicationService.filter(rawData);
    await this.storeRawData(uniqueData, task.sourceId);
    const resources = await this.processToResources(uniqueData);
    await this.linkRawDataToResources(uniqueData, resources);
    await this.updateStatus(taskId, TaskStatus.COMPLETED);
  } catch (error) {
    await this.handleError(taskId, error);
  }
}
```

## Deduplication Strategies

| Strategy               | Implementation                     |
| ---------------------- | ---------------------------------- |
| URL Normalization      | Remove tracking params, lowercase  |
| Content Fingerprinting | SHA-256 hash of normalized content |
| Similarity Detection   | Fuzzy matching with 85% threshold  |
| Pre-Insert Check       | Check both URL and fingerprint     |

```typescript
normalizeUrl(url: string): string {
  const parsed = new URL(url);
  ['utm_source', 'utm_medium', 'ref'].forEach(p => parsed.searchParams.delete(p));
  return parsed.toString().replace(/\/$/, '').toLowerCase();
}

generateFingerprint(content: string): string {
  const normalized = content.toLowerCase().replace(/\s+/g, ' ').trim();
  return crypto.createHash('sha256').update(normalized).digest('hex');
}
```

## Data Quality Dimensions

```
Completeness | Accuracy | Consistency | Timeliness
```

```typescript
interface DataQualityMetrics {
  completenessScore: number;
  accuracyScore: number;
  consistencyScore: number;
  freshnessScore: number;
  overallScore: number;
}
```

## Scheduled Jobs

```typescript
const qualityJobs = [
  {
    name: "daily-quality-check",
    schedule: "0 2 * * *",
    task: "runFullQualityAudit",
  },
  {
    name: "hourly-anomaly-detection",
    schedule: "0 * * * *",
    task: "detectAnomalies",
  },
  { name: "weekly-cleanup", schedule: "0 3 * * 0", task: "cleanupInvalidData" },
];
```

## Commands

```bash
npm run collect:hackernews     # Fetch from HackerNews
npm run collect:rss            # Fetch from RSS feeds
npm run data-quality:audit     # Full audit
npm run data-quality:report    # Generate report
```

## Related Docs

- [Collection Pipeline](references/collection-pipeline.md)
- [Deduplication](references/deduplication.md)
- [Quality Management](references/quality-management.md)
