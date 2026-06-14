---
name: Knowledge Graph Expert
description: |
  Knowledge graph, resource relationships, and visualization for Library module.
  Trigger keywords: knowledge graph, relationships, resources, topics, visualization
  Not for: Schema design (-> schema-architect), Frontend UI (-> frontend-expert)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [knowledge-graph, library, resources, relationships, visualization]
boundaries:
  includes:
    - Graph data model design
    - Relationship detection and management
    - D3.js graph visualization
    - AI-powered knowledge extraction
    - Semantic search capabilities
  excludes:
    - Database schema design
    - Frontend component styling
  handoff:
    - skill: schema-architect
      when: Schema changes needed
    - skill: frontend-expert
      when: UI component changes
---

# Knowledge Graph Expert

> Detailed docs: `references/`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Knowledge Graph System                     │
├─────────────────────────────────────────────────────────────┤
│  Frontend  │ GraphView (D3) │ ResourceList │ RelationPanel  │
├─────────────────────────────────────────────────────────────┤
│  Backend   │ Resources │ Relationships │ Graph Analytics    │
├─────────────────────────────────────────────────────────────┤
│  Data      │ MongoDB: resources, relationships, topics      │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

```
frontend/components/library/
├── KnowledgeGraphView.tsx      # Graph visualization
├── ResourceCard.tsx            # Resource display
└── RelationshipEditor.tsx      # Manage relationships

backend/src/modules/content/
├── resources/                  # Resource CRUD
├── relationships/              # Relationship service
└── topics/                     # Topic hierarchy
```

## Core Data Models

```typescript
interface Resource {
  id: string;
  type: ResourceType; // 'article' | 'video' | 'book' | 'note'
  title: string;
  content?: string;
  topics: string[];
  relatedResources: Relationship[];
}

interface Relationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: RelationshipType; // 'references' | 'related_to' | 'extends'
  strength: number; // 0-1
}

interface Topic {
  id: string;
  name: string;
  parentId?: string;
  children?: Topic[];
}
```

## Relationship Types

```typescript
enum RelationshipType {
  REFERENCES, // A references B
  RELATED_TO, // General relation
  PREREQUISITE, // A is prerequisite for B
  EXTENDS, // A builds on B
  SIMILAR_TO, // Content similarity
  SAME_TOPIC, // Share topic
}
```

## Related Docs

- [Graph Visualization](references/visualization.md)
- [AI-Powered Features](references/ai-features.md)
- [Graph Analytics](references/analytics.md)
