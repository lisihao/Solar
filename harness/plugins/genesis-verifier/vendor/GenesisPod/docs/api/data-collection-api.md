# Data Collection API Documentation

## Overview

The Data Collection API provides endpoints for managing data sources, collection tasks, quality monitoring, and historical records in the DeepDive system.

**Base URL:** `http://localhost:3001/data-collection`

**Authentication:** All requests require valid session credentials.

---

## Table of Contents

1. [Dashboard](#dashboard)
2. [Data Sources](#data-sources)
3. [Collection Tasks](#collection-tasks)
4. [Monitor](#monitor)
5. [Quality](#quality)
6. [History](#history)

---

## Dashboard

### Get Dashboard Statistics

Retrieve aggregated statistics for the dashboard overview.

**Endpoint:** `GET /dashboard`

**Response:**

```json
{
  "success": true,
  "data": {
    "sourceStats": {
      "total": 10,
      "active": 8,
      "paused": 1,
      "failed": 1
    },
    "taskStats": {
      "total": 45,
      "running": 3,
      "completed": 40,
      "failed": 2
    },
    "todayStats": {
      "collected": 1247,
      "successRate": 95.0,
      "avgQuality": 87.5
    },
    "qualityMetrics": {
      "avgCompleteness": 92.3,
      "avgAccuracy": 88.7,
      "avgTimeliness": 85.2,
      "avgUsability": 90.1
    },
    "recentTasks": [
      {
        "id": "task-uuid",
        "name": "arXiv AI Papers",
        "status": "RUNNING",
        "progress": 65.5,
        "successItems": 45,
        "duplicateItems": 3,
        "startedAt": "2025-01-22T10:30:00Z"
      }
    ],
    "timeSeries": [
      {
        "date": "2025-01-22",
        "collected": 1247,
        "duplicates": 47,
        "failed": 15
      }
    ]
  }
}
```

---

## Data Sources

### List All Data Sources

**Endpoint:** `GET /sources`

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "source-uuid",
      "name": "arXiv",
      "description": "arXiv is a free distribution service...",
      "type": "ARXIV",
      "category": "PAPER",
      "baseUrl": "https://arxiv.org",
      "apiEndpoint": "http://export.arxiv.org/api/query",
      "crawlerType": "API",
      "crawlerConfig": {
        "method": "GET",
        "responseType": "xml"
      },
      "rateLimit": 3,
      "status": "ACTIVE",
      "totalCollected": 12453,
      "successRate": 98.5,
      "averageQuality": 92.3,
      "lastSuccessAt": "2025-01-22T10:25:00Z",
      "createdAt": "2025-01-20T00:00:00Z",
      "updatedAt": "2025-01-22T10:25:00Z"
    }
  ]
}
```

### Get Single Data Source

**Endpoint:** `GET /sources/:id`

**Parameters:**

- `id` (path) - Data source UUID

**Response:** Same as single item in list response

### Create Data Source

**Endpoint:** `POST /sources`

**Request Body:**

```json
{
  "name": "New Source",
  "type": "CUSTOM",
  "category": "BLOG",
  "baseUrl": "https://example.com",
  "crawlerType": "SCRAPER",
  "crawlerConfig": {
    "selectors": {
      "title": "h1",
      "content": "article"
    }
  },
  "rateLimit": 10,
  "description": "Custom data source"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "new-source-uuid",
    ...
  }
}
```

### Update Data Source

**Endpoint:** `PUT /sources/:id`

**Parameters:**

- `id` (path) - Data source UUID

**Request Body:** Same as create, all fields optional

**Response:**

```json
{
  "success": true,
  "data": {
    ...
  }
}
```

### Delete Data Source

**Endpoint:** `DELETE /sources/:id`

**Parameters:**

- `id` (path) - Data source UUID

**Response:** `204 No Content`

### Test Data Source

**Endpoint:** `POST /sources/:id/test`

**Parameters:**

- `id` (path) - Data source UUID

**Response:**

```json
{
  "success": true,
  "message": "Data source test successful",
  "data": {
    "responseTime": 245,
    "statusCode": 200,
    "sampleData": {...}
  }
}
```

### Get Source Statistics

**Endpoint:** `GET /sources/stats`

**Response:**

```json
{
  "success": true,
  "data": {
    "totalSources": 10,
    "byType": {
      "ARXIV": 1,
      "HACKERNEWS": 1,
      "RSS": 3
    },
    "byStatus": {
      "ACTIVE": 8,
      "PAUSED": 1,
      "FAILED": 1
    }
  }
}
```

---

## Collection Tasks

### List Collection Tasks

**Endpoint:** `GET /tasks`

**Query Parameters:**

- `status` (optional) - Filter by status: PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
- `sourceId` (optional) - Filter by data source ID

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "task-uuid",
      "sourceId": "source-uuid",
      "name": "Daily arXiv Collection",
      "description": "Collect latest AI papers",
      "status": "RUNNING",
      "progress": 65.5,
      "totalItems": 100,
      "processedItems": 65,
      "successItems": 60,
      "failedItems": 2,
      "duplicateItems": 3,
      "skippedItems": 0,
      "startedAt": "2025-01-22T10:00:00Z",
      "createdAt": "2025-01-22T09:55:00Z",
      "updatedAt": "2025-01-22T10:30:00Z",
      "source": {
        "id": "source-uuid",
        "name": "arXiv"
      }
    }
  ]
}
```

### Get Single Task

**Endpoint:** `GET /tasks/:id`

**Parameters:**

- `id` (path) - Task UUID

**Response:** Same as single item in list response

### Create Collection Task

**Endpoint:** `POST /tasks`

**Request Body:**

```json
{
  "sourceId": "source-uuid",
  "name": "Custom Collection Task",
  "description": "Collect specific items",
  "config": {
    "maxItems": 100,
    "filters": {
      "category": "cs.AI"
    }
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "new-task-uuid",
    "status": "PENDING",
    ...
  }
}
```

### Execute Task

**Endpoint:** `POST /tasks/:id/execute`

**Parameters:**

- `id` (path) - Task UUID

**Response:**

```json
{
  "success": true,
  "message": "Task execution started"
}
```

### Pause Task

**Endpoint:** `POST /tasks/:id/pause`

**Parameters:**

- `id` (path) - Task UUID

**Response:**

```json
{
  "success": true,
  "message": "Task paused successfully"
}
```

### Resume Task

**Endpoint:** `POST /tasks/:id/resume`

**Parameters:**

- `id` (path) - Task UUID

**Response:**

```json
{
  "success": true,
  "message": "Task resumed successfully"
}
```

### Cancel Task

**Endpoint:** `POST /tasks/:id/cancel`

**Parameters:**

- `id` (path) - Task UUID

**Response:**

```json
{
  "success": true,
  "message": "Task cancelled successfully"
}
```

---

## Monitor

### Get Running Tasks

**Endpoint:** `GET /monitor/running`

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "task-uuid",
      "name": "arXiv Collection",
      "status": "RUNNING",
      "progress": 65.5,
      ...
    }
  ]
}
```

### Get System Metrics

**Endpoint:** `GET /monitor/metrics`

**Response:**

```json
{
  "success": true,
  "data": {
    "cpu": {
      "usage": 45.2,
      "cores": 8
    },
    "memory": {
      "used": 4294967296,
      "total": 17179869184,
      "percentage": 25.0
    },
    "activeTasks": 3,
    "queuedTasks": 5
  }
}
```

### Get Task Logs

**Endpoint:** `GET /monitor/logs/:taskId`

**Parameters:**

- `taskId` (path) - Task UUID
- `level` (query, optional) - Filter by log level: INFO, WARN, ERROR
- `limit` (query, optional) - Number of logs to return (default: 100)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2025-01-22T10:30:45Z",
      "level": "INFO",
      "message": "Processed 65 items",
      "metadata": {
        "successCount": 60,
        "errorCount": 2
      }
    }
  ]
}
```

---

## Quality

### Get Quality Issues

**Endpoint:** `GET /quality/issues`

**Query Parameters:**

- `severity` (optional) - Filter by severity: LOW, MEDIUM, HIGH, CRITICAL
- `reviewStatus` (optional) - Filter by review status: PENDING, REVIEWING, RESOLVED, IGNORED
- `limit` (optional) - Number of issues to return (default: 50)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "issue-uuid",
      "resourceId": "resource-uuid",
      "type": "MISSING_TITLE",
      "severity": "HIGH",
      "message": "Resource is missing required title field",
      "detectedAt": "2025-01-22T10:00:00Z",
      "reviewStatus": "PENDING",
      "resource": {
        "id": "resource-uuid",
        "title": "",
        "type": "PAPER"
      }
    }
  ],
  "total": 42
}
```

### Get Quality Statistics

**Endpoint:** `GET /quality/stats`

**Response:**

```json
{
  "success": true,
  "data": {
    "totalIssues": 42,
    "byType": {
      "MISSING_TITLE": 15,
      "INCOMPLETE_DATA": 12,
      "POOR_QUALITY": 8
    },
    "bySeverity": {
      "CRITICAL": 3,
      "HIGH": 12,
      "MEDIUM": 18,
      "LOW": 9
    },
    "byReviewStatus": {
      "PENDING": 25,
      "RESOLVED": 15,
      "IGNORED": 2
    },
    "avgQualityScore": 87.5,
    "trends": [
      {
        "date": "2025-01-22",
        "issues": 8,
        "resolved": 5
      }
    ]
  }
}
```

### Assess Resource Quality

**Endpoint:** `POST /quality/assess/:resourceId`

**Parameters:**

- `resourceId` (path) - Resource UUID

**Response:**

```json
{
  "success": true,
  "data": {
    "resourceId": "resource-uuid",
    "qualityScore": 85.5,
    "completeness": 90,
    "accuracy": 85,
    "timeliness": 80,
    "usability": 87,
    "issues": [
      {
        "type": "MISSING_ABSTRACT",
        "severity": "MEDIUM"
      }
    ]
  }
}
```

### Batch Assess Quality

**Endpoint:** `POST /quality/batch-assess`

**Query Parameters:**

- `limit` (optional) - Number of resources to assess (default: 100)

**Response:**

```json
{
  "success": true,
  "message": "Assessed 100 resources",
  "data": {
    "assessed": 100
  }
}
```

### Update Review Status

**Endpoint:** `PUT /quality/review/:resourceId`

**Parameters:**

- `resourceId` (path) - Resource UUID

**Request Body:**

```json
{
  "status": "RESOLVED",
  "note": "Fixed missing title issue"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Review status updated"
}
```

---

## History

### Get Collection History

**Endpoint:** `GET /history`

**Query Parameters:**

- `status` (optional) - Filter by status
- `sourceId` (optional) - Filter by source ID
- `startDate` (optional) - ISO 8601 date string
- `endDate` (optional) - ISO 8601 date string
- `limit` (optional) - Number of records (default: 50)
- `offset` (optional) - Pagination offset (default: 0)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "task-uuid",
      "taskName": "Daily arXiv Collection",
      "sourceName": "arXiv",
      "status": "COMPLETED",
      "totalItems": 100,
      "successItems": 95,
      "failedItems": 2,
      "duplicateItems": 3,
      "skippedItems": 0,
      "duration": 245,
      "startedAt": "2025-01-22T10:00:00Z",
      "completedAt": "2025-01-22T10:04:05Z"
    }
  ],
  "total": 150
}
```

### Get History Statistics

**Endpoint:** `GET /history/stats`

**Query Parameters:**

- `period` (optional) - Time period: day, week, month (default: week)

**Response:**

```json
{
  "success": true,
  "data": {
    "period": "week",
    "totalTasks": 45,
    "completedTasks": 40,
    "failedTasks": 3,
    "totalCollected": 8932,
    "totalDuplicates": 421,
    "totalFailed": 87,
    "successRate": 88.9,
    "avgDuration": 178.5
  }
}
```

### Get Task History Details

**Endpoint:** `GET /history/:id`

**Parameters:**

- `id` (path) - Task UUID

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "task-uuid",
    "name": "Daily arXiv Collection",
    "status": "COMPLETED",
    "source": {...},
    "resources": [
      {
        "id": "resource-uuid",
        "title": "Paper Title",
        "createdAt": "2025-01-22T10:02:00Z"
      }
    ],
    "deduplicationRecords": [
      {
        "id": "dedup-uuid",
        "method": "URL_HASH",
        "decision": "KEEP",
        "createdAt": "2025-01-22T10:02:15Z"
      }
    ]
  }
}
```

### Delete History Record

**Endpoint:** `DELETE /history/:id`

**Parameters:**

- `id` (path) - Task UUID

**Response:** `204 No Content`

### Clean Old History

**Endpoint:** `DELETE /history/cleanup/old`

**Query Parameters:**

- `days` (optional) - Delete records older than N days (default: 30)

**Response:**

```json
{
  "success": true,
  "message": "Cleaned 25 old records",
  "data": {
    "cleaned": 25
  }
}
```

---

## Error Responses

All endpoints may return error responses in the following format:

**400 Bad Request:**

```json
{
  "error": "Invalid request parameters",
  "message": "sourceId is required"
}
```

**404 Not Found:**

```json
{
  "error": "Resource not found",
  "message": "Data source with ID 'xyz' not found"
}
```

**500 Internal Server Error:**

```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred"
}
```

---

## Data Models

### DataSourceType Enum

```
ARXIV, PUBMED, IEEE, ACL_ANTHOLOGY, MEDIUM, DEVTO, SUBSTACK, HASHNODE,
YOUTUBE, BILIBILI, HACKERNEWS, TECHCRUNCH, THE_VERGE, GITHUB, PRODUCTHUNT,
POLICY_US, POLICY_EU, POLICY_CN, GARTNER, MCKINSEY, IDC, CUSTOM, RSS
```

### DataSourceStatus Enum

```
ACTIVE, PAUSED, FAILED, MAINTENANCE
```

### CollectionTaskStatus Enum

```
PENDING, RUNNING, COMPLETED, FAILED, CANCELLED
```

### ResourceType Enum

```
PAPER, BLOG, REPORT, YOUTUBE_VIDEO, NEWS, PROJECT, EVENT, RSS
```

---

## Usage Examples

### Example 1: Create and Execute a Collection Task

```javascript
// 1. Create a task
const createResponse = await fetch(
  "http://localhost:3001/data-collection/tasks",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      sourceId: "arxiv-source-id",
      name: "Collect Latest AI Papers",
      config: {
        maxItems: 50,
        filters: { category: "cs.AI" },
      },
    }),
  },
);
const { data: task } = await createResponse.json();

// 2. Execute the task
await fetch(`http://localhost:3001/data-collection/tasks/${task.id}/execute`, {
  method: "POST",
  credentials: "include",
});

// 3. Monitor progress
const statusResponse = await fetch(
  `http://localhost:3001/data-collection/tasks/${task.id}`,
  {
    credentials: "include",
  },
);
const { data: status } = await statusResponse.json();
console.log(`Progress: ${status.progress}%`);
```

### Example 2: Monitor Quality Issues

```javascript
// Get all high-severity issues
const response = await fetch(
  "http://localhost:3001/data-collection/quality/issues?severity=HIGH",
  {
    credentials: "include",
  },
);
const { data: issues } = await response.json();

// Resolve an issue
for (const issue of issues) {
  await fetch(
    `http://localhost:3001/data-collection/quality/review/${issue.resourceId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        status: "RESOLVED",
        note: "Fixed manually",
      }),
    },
  );
}
```

### Example 3: View Historical Performance

```javascript
// Get last week's statistics
const statsResponse = await fetch(
  "http://localhost:3001/data-collection/history/stats?period=week",
  {
    credentials: "include",
  },
);
const { data: stats } = await statsResponse.json();

console.log(`Success Rate: ${stats.successRate}%`);
console.log(`Total Collected: ${stats.totalCollected}`);
console.log(`Avg Duration: ${stats.avgDuration}s`);
```

---

## Rate Limiting

The API implements rate limiting based on the configured `rateLimit` for each data source. When executing collection tasks, the crawler will respect these limits to avoid overloading external APIs.

---

## Best Practices

1. **Always handle errors**: Wrap API calls in try-catch blocks
2. **Use pagination**: For endpoints that support it, use `limit` and `offset`
3. **Monitor task progress**: Poll task status endpoints when running long operations
4. **Clean up regularly**: Use the history cleanup endpoint to maintain database performance
5. **Test data sources**: Always test a new data source before creating tasks
6. **Review quality issues**: Regularly check and resolve quality issues to maintain data integrity

---

## Support

For issues or questions, please refer to the main documentation at `docs/data-management/readme.md` or contact the development team.
