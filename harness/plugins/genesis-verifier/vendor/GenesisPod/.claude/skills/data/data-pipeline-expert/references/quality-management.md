# Data Quality Management

## Quality Dimensions

```
┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│Completeness│  │ Accuracy  │  │Consistency│  │ Timeliness│
│  数据完整  │  │  数据准确  │  │  数据一致  │  │  数据时效  │
└───────────┘  └───────────┘  └───────────┘  └───────────┘
```

## Completeness Validation

```typescript
interface CompletenessCheck {
  entity: string;
  requiredFields: string[];
  threshold: number; // 0-1, e.g., 0.95 = 95% complete
}

const resourceCompletenessChecks: CompletenessCheck[] = [
  {
    entity: "Resource",
    requiredFields: ["title", "content", "type", "sourceUrl"],
    threshold: 0.99,
  },
];
```

## Accuracy Validation

```typescript
interface AccuracyCheck {
  field: string;
  validationRule: (value: unknown) => boolean;
  errorMessage: string;
}

const urlAccuracyCheck: AccuracyCheck = {
  field: "sourceUrl",
  validationRule: (url) => {
    if (typeof url !== "string") return false;
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  },
  errorMessage: "Invalid URL format",
};
```

## Anomaly Detection

```typescript
interface AnomalyDetector {
  metric: string;
  baseline: number;
  threshold: number;
  alertLevel: "warning" | "critical";
}

const anomalyDetectors: AnomalyDetector[] = [
  {
    metric: "daily_resource_count",
    baseline: 100,
    threshold: 0.5, // 50% deviation
    alertLevel: "warning",
  },
  {
    metric: "error_rate",
    baseline: 0.01,
    threshold: 5, // 5x increase
    alertLevel: "critical",
  },
];
```

## Quality Metrics

```typescript
interface DataQualityMetrics {
  completenessScore: number;
  missingFieldsCount: number;
  accuracyScore: number;
  invalidRecordsCount: number;
  consistencyScore: number;
  orphanedRecordsCount: number;
  freshnessScore: number;
  staleRecordsCount: number;
  overallScore: number;
  lastCheckedAt: Date;
}
```

## Quality Report Generation

```typescript
async generateQualityReport(sourceId: string): Promise<DataQualityReport> {
  const rawData = await this.getRawDataBySource(sourceId);

  return {
    totalRecords: rawData.length,
    validRecords: rawData.filter(r => this.isValid(r)).length,
    duplicates: await this.countDuplicates(rawData),
    missingFields: this.analyzeMissingFields(rawData),
    invalidUrls: rawData.filter(r => !this.isValidUrl(r.url)).length,
    orphanedRawData: await this.countOrphanedRecords(rawData),
  };
}
```

## Data Cleanup

```typescript
async cleanupInvalidRecords() {
  await prisma.resource.updateMany({
    where: {
      sourceUrl: { not: { startsWith: 'http' } },
      deletedAt: null,
    },
    data: {
      deletedAt: new Date(),
      metadata: { invalid: true, reason: 'invalid_url' },
    },
  });
}

async archiveStaleData(daysOld: number) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);

  const staleRecords = await prisma.resource.findMany({
    where: {
      updatedAt: { lt: cutoffDate },
      status: 'ARCHIVED',
    },
  });

  await archiveService.moveToArchive(staleRecords);
}
```
