# Anti-Patterns and Fixes

## Anti-Pattern 1: Direct Model Selection

```typescript
// ❌ Anti-pattern: Hardcode model selection logic in AI App
const REASONING_MODELS = ["o1", "o3", "deepseek-r1"];
const model = models.find((m) =>
  REASONING_MODELS.some((r) => m.modelId.includes(r)),
);

// ✅ Fix: Use AI Engine API
const modelConfig = await this.aiChatService.getReasoningModelConfig();
```

## Anti-Pattern 2: Repeated Context Building

```typescript
// ❌ Anti-pattern: Each service builds context itself
// service-a.ts
const context = this.buildContext(mission); // 100 lines of code

// service-b.ts
const context = this.buildContext(mission); // Similar 100 lines

// ✅ Fix: Use unified context service
const context = await this.contextService.buildMissionContext(mission);
```

## Anti-Pattern 3: Optional Dependency Check

```typescript
// ❌ Anti-pattern: @Optional() then check at runtime
constructor(
  @Optional() private searchService?: SearchService,
) {}

async search(query: string) {
  if (!this.searchService) {
    throw new Error('SearchService not available');
  }
  return this.searchService.search(query);
}

// ✅ Fix: Explicit dependency, handle in module config
constructor(private searchService: SearchService) {}
```

## Anti-Pattern 4: Hardcoded TaskProfile

```typescript
// ❌ Anti-pattern: Hardcoded TaskProfile scattered everywhere
// file1.ts
taskProfile: { creativity: 'medium', outputLength: 'long' }
// file2.ts
taskProfile: { creativity: 'medium', outputLength: 'long' }

// ✅ Fix: Define presets, centrally manage
// task-profiles.ts
export const TaskProfiles = {
  ANALYSIS: { creativity: 'low', outputLength: 'medium' },
  RESEARCH: { creativity: 'medium', outputLength: 'long' },
  CREATIVE_WRITING: { creativity: 'high', outputLength: 'extended' },
  CLASSIFICATION: { creativity: 'deterministic', outputLength: 'minimal' },
} as const;

// Usage
taskProfile: TaskProfiles.RESEARCH
```

## Anti-Pattern 5: God Service

```typescript
// ❌ Anti-pattern: One service does everything
@Injectable()
export class ResearchService {
  async createResearch() {
    /* ... */
  }
  async planTasks() {
    /* ... */
  }
  async executeTasks() {
    /* ... */
  }
  async reviewResults() {
    /* ... */
  }
  async generateReport() {
    /* ... */
  }
  async exportToPDF() {
    /* ... */
  }
  async sendEmail() {
    /* ... */
  }
}

// ✅ Fix: Split by responsibility
@Injectable()
class ResearchPlanningService {
  /* Planning */
}
@Injectable()
class ResearchExecutionService {
  /* Execution */
}
@Injectable()
class ResearchReviewService {
  /* Review */
}
@Injectable()
class ReportGenerationService {
  /* Report */
}
```

## Optimization Suggestions

### 1. Unified TaskProfile Presets

```typescript
// backend/src/modules/ai-engine/llm/task-profiles.ts
export const TaskProfiles = {
  // Analysis tasks
  ANALYSIS: { creativity: "low", outputLength: "medium" },
  DEEP_ANALYSIS: { creativity: "low", outputLength: "long" },

  // Research tasks
  RESEARCH_PLANNING: { creativity: "medium", outputLength: "long" },
  RESEARCH_EXECUTION: { creativity: "medium", outputLength: "extended" },

  // Creative tasks
  CREATIVE_WRITING: { creativity: "high", outputLength: "extended" },

  // Structured output
  JSON_EXTRACTION: { creativity: "deterministic", outputLength: "medium" },
  CLASSIFICATION: { creativity: "deterministic", outputLength: "minimal" },
} as const;
```

### 2. Event Standardization

```typescript
// backend/src/modules/ai-engine/events/types.ts
export interface TaskStartedEvent {
  taskId: string;
  missionId: string;
  timestamp: Date;
}

export interface TaskProgressEvent {
  taskId: string;
  progress: number; // 0-100
  message?: string;
  timestamp: Date;
}

export interface TaskCompletedEvent {
  taskId: string;
  result: unknown;
  duration: number; // ms
  timestamp: Date;
}

export const TaskEvents = {
  STARTED: "task:started",
  PROGRESS: "task:progress",
  COMPLETED: "task:completed",
  FAILED: "task:failed",
} as const;
```
