# Schema Design Guide

## Entity Relationship Pattern

```typescript
// Base entity with common fields
interface BaseEntity {
  id: string; // UUID
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date; // Soft delete
  createdBy?: string; // User ID
  version: number; // Optimistic locking
}

// Example: Resource entity
interface Resource extends BaseEntity {
  // Core fields
  title: string;
  content: string;
  type: ResourceType;
  status: ResourceStatus;

  // External references (explicit)
  rawDataId: string; // MongoDB ObjectId
  userId: string; // Owner
  knowledgeBaseIds: string[]; // Many-to-many

  // Metadata (JSONB for flexibility)
  metadata: {
    source: string;
    tags: string[];
    language: string;
    wordCount: number;
  };

  // Computed/cached fields
  aiSummary?: string;
  embeddings?: number[];
}
```

## Cross-Database Reference Pattern

```typescript
// Pattern for PostgreSQL ↔ MongoDB references
interface CrossDatabaseReference {
  // In PostgreSQL (Resource)
  rawDataId: string; // Store MongoDB ObjectId as string

  // In MongoDB (raw_data)
  resourceId: string; // Store PostgreSQL UUID as string
}

// Service pattern for cross-database operations
class CrossDatabaseService {
  async createWithReference(data: CreateResourceDto) {
    // 1. Create in MongoDB
    const rawData = await this.mongo.create(data.raw);

    // 2. Create in PostgreSQL with reference
    const resource = await this.prisma.resource.create({
      data: {
        ...data.resource,
        rawDataId: rawData._id.toString(),
      },
    });

    // 3. Update MongoDB with back-reference
    await this.mongo.updateOne(
      { _id: rawData._id },
      { $set: { resourceId: resource.id } },
    );

    return resource;
  }
}
```

## Module Interface Design

```typescript
// Define clear interfaces between modules
// File: backend/src/common/interfaces/ai-service.interface.ts

export interface IAIService {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
  embed(texts: string[]): Promise<number[][]>;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  tools?: Tool[];
}

export interface ChatResponse {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: "stop" | "length" | "tool_calls";
}
```

## Design Review Checklist

### Schema Design Review

- [ ] All entities have BaseEntity fields
- [ ] Foreign keys are explicit and indexed
- [ ] JSONB fields have defined structure
- [ ] Enums are used for finite sets
- [ ] Naming follows conventions
- [ ] Soft delete supported where needed

### API Design Review

- [ ] RESTful conventions followed
- [ ] DTOs validated with class-validator
- [ ] Error responses standardized
- [ ] Swagger documentation complete
- [ ] Rate limiting considered
- [ ] Authentication/Authorization defined
