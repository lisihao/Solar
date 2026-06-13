# Collection Pipeline

## Task States

```typescript
enum TaskStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}
```

## Task Execution Flow

```typescript
async execute(taskId: string): Promise<void> {
  const task = await this.findTask(taskId);

  try {
    // 1. Update status to running
    await this.updateStatus(taskId, TaskStatus.RUNNING);

    // 2. Fetch data from source
    const rawData = await this.fetchFromSource(task.source);

    // 3. Deduplicate
    const uniqueData = await this.deduplicationService.filter(rawData);

    // 4. Store raw data with source reference
    await this.storeRawData(uniqueData, task.sourceId);

    // 5. Process and create resources
    const resources = await this.processToResources(uniqueData);

    // 6. Establish bi-directional references
    await this.linkRawDataToResources(uniqueData, resources);

    // 7. Mark complete
    await this.updateStatus(taskId, TaskStatus.COMPLETED);
  } catch (error) {
    await this.handleError(taskId, error);
  }
}
```

## Source-Specific Handlers

### HackerNews

```typescript
async fetchTopStories(limit = 30): Promise<HNStory[]> {
  const storyIds = await this.fetchStoryIds('topstories');
  const stories = await Promise.all(
    storyIds.slice(0, limit).map(id => this.fetchItem(id))
  );

  return stories
    .filter(s => s && s.url)
    .map(s => this.enrichStory(s));
}
```

### RSS Feeds

```typescript
async parseRssFeed(feedUrl: string): Promise<RssItem[]> {
  const feed = await this.parser.parseURL(feedUrl);
  return feed.items.map(item => ({
    title: item.title,
    url: item.link,
    content: item.contentSnippet || item.content,
    publishedAt: new Date(item.pubDate),
    source: feed.title,
  }));
}
```

## Error Handling

```typescript
async handleError(taskId: string, error: Error): Promise<void> {
  await this.updateStatus(taskId, TaskStatus.FAILED);

  await this.prisma.collectionTask.update({
    where: { id: taskId },
    data: {
      error: error.message,
      failedAt: new Date(),
      retryCount: { increment: 1 },
    },
  });

  // Notify for critical failures
  if (this.isCriticalError(error)) {
    await this.alertService.send({
      type: 'collection_failure',
      taskId,
      error: error.message,
    });
  }
}
```
