# AI-Powered Features

## Auto-Relationship Detection

```typescript
async detectRelationships(resourceId: string): Promise<Relationship[]> {
  const resource = await this.findResource(resourceId);
  const candidates = await this.findCandidates(resource);

  const relationships = await Promise.all(
    candidates.map(async (candidate) => {
      const similarity = await this.aiService.calculateSimilarity(
        resource.content,
        candidate.content
      );

      if (similarity > 0.7) {
        return {
          sourceId: resourceId,
          targetId: candidate.id,
          type: RelationshipType.SIMILAR_TO,
          strength: similarity,
          metadata: { aiGenerated: true },
        };
      }
      return null;
    })
  );

  return relationships.filter(Boolean);
}
```

## Entity Extraction

```typescript
async extractEntities(content: string): Promise<Entity[]> {
  const response = await this.aiService.analyze(content, {
    task: 'entity_extraction',
    prompt: `Extract named entities (people, organizations, concepts, technologies) from the text.
             Return as JSON: [{ "name": "...", "type": "...", "relevance": 0-1 }]`
  });

  return JSON.parse(response);
}
```

## Knowledge Summary

```typescript
async generateKnowledgeSummary(topicId: string): Promise<string> {
  const resources = await this.getResourcesByTopic(topicId);
  const summaries = resources.map(r => r.summary || r.description).join('\n\n');

  return this.aiService.summarize(summaries, {
    maxLength: 500,
    style: 'comprehensive',
    includeKeyPoints: true,
  });
}
```

## Semantic Search

```typescript
async semanticSearch(query: string, options: SearchOptions): Promise<SearchResult[]> {
  // 1. Get query embedding
  const queryEmbedding = await this.aiService.getEmbedding(query);

  // 2. Vector similarity search
  const similar = await this.vectorStore.search(queryEmbedding, {
    limit: options.limit || 20,
    minScore: options.minScore || 0.6,
  });

  // 3. Expand with related resources
  const expanded = await this.expandWithRelated(similar, options.expandDepth || 1);

  // 4. Rank and return
  return this.rankResults(expanded, query);
}
```
