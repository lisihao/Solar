# Development Patterns

## Pattern 1: LLM Calling

```typescript
import { AiChatService } from "@/modules/ai-engine/llm/services/ai-chat.service";
import { AIModelType } from "@prisma/client";

@Injectable()
export class MyService {
  constructor(private aiChatService: AiChatService) {}

  async analyze(content: string): Promise<string> {
    const response = await this.aiChatService.chat({
      messages: [
        { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
        { role: "user", content },
      ],
      modelType: AIModelType.CHAT,
      taskProfile: {
        creativity: "low", // Analysis task needs low creativity
        outputLength: "medium",
      },
    });

    return response.content;
  }
}
```

## Pattern 2: Search Enhancement

```typescript
import { SearchService } from "@/modules/ai-engine/search/search.service";

@Injectable()
export class ResearchService {
  constructor(private searchService: SearchService) {}

  async research(query: string): Promise<SearchResults> {
    const results = await this.searchService.search({
      query,
      maxResults: 10,
      searchDepth: "advanced",
      includeAnswer: true,
    });

    return results;
  }
}
```

## Pattern 3: Event-Driven Progress

```typescript
import { EventEmitter2 } from "@nestjs/event-emitter";

@Injectable()
export class TaskExecutionService {
  constructor(private eventEmitter: EventEmitter2) {}

  async executeTask(task: Task): Promise<void> {
    this.eventEmitter.emit("task:started", { taskId: task.id });

    try {
      this.eventEmitter.emit("task:progress", {
        taskId: task.id,
        progress: 50,
        message: "Processing...",
      });

      const result = await this.doWork(task);

      this.eventEmitter.emit("task:completed", {
        taskId: task.id,
        result,
      });
    } catch (error) {
      this.eventEmitter.emit("task:failed", {
        taskId: task.id,
        error: error.message,
      });
    }
  }
}
```

## Pattern 4: Leader-Member Collaboration

```typescript
// Leader Service - responsible for planning and assignment
@Injectable()
export class LeaderService {
  async planMission(mission: Mission): Promise<TaskPlan[]> {
    const modelConfig = await this.aiChatService.getReasoningModelConfig();

    const plan = await this.aiChatService.chat({
      model: modelConfig?.modelId,
      messages: [
        { role: "system", content: LEADER_PLANNING_PROMPT },
        { role: "user", content: this.buildPlanningInput(mission) },
      ],
      taskProfile: {
        creativity: "medium",
        outputLength: "long",
      },
    });

    return this.parsePlan(plan.content);
  }
}

// Member Service - responsible for executing specific tasks
@Injectable()
export class MemberService {
  async executeTask(task: Task, context: Context): Promise<TaskResult> {
    const response = await this.aiChatService.chat({
      modelType: AIModelType.CHAT,
      messages: [
        { role: "system", content: this.buildMemberPrompt(task.role) },
        { role: "user", content: this.buildTaskInput(task, context) },
      ],
      taskProfile: {
        creativity: task.requiresCreativity ? "high" : "medium",
        outputLength: "long",
      },
    });

    return { content: response.content };
  }
}
```

## TaskProfile Reference

| creativity    | temperature | Use Case                                   |
| ------------- | ----------- | ------------------------------------------ |
| deterministic | 0.1         | Classification, extraction, JSON parsing   |
| low           | 0.3         | Analysis, summarization, structured output |
| medium        | 0.7         | Conversation, research, general tasks      |
| high          | 0.9         | Creative writing, brainstorming            |

| outputLength | maxTokens | Use Case                               |
| ------------ | --------- | -------------------------------------- |
| minimal      | 500       | Classification labels, short answers   |
| short        | 1500      | Summaries, briefs                      |
| medium       | 4000      | Standard analysis, paragraphs          |
| standard     | 6000      | Editing tasks, detailed analysis       |
| long         | 8000      | Report chapters, long-form             |
| extended     | 16000     | Super long content, complete documents |
