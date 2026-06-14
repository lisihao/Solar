# Core Principles

## 1. Delegation First (Delegation First)

**AI App should delegate AI Engine to execute core capabilities, not implement themselves.**

```typescript
// ❌ Wrong: Implement model selection logic in AI App
async getReasoningModel(): Promise<ModelInfo | null> {
  // 100+ lines of model selection code
  const models = await this.prisma.aIModel.findMany({...});
  const detectedModel = models.find(m => this.isReasoningModel(m));
  // ...
}

// ✅ Correct: Delegate to AI Engine
async getReasoningModel(): Promise<ModelInfo | null> {
  const modelConfig = await this.aiChatService.getReasoningModelConfig();
  if (!modelConfig) return null;
  return {
    modelId: modelConfig.modelId,
    provider: modelConfig.provider,
    isReasoning: modelConfig.isReasoning ?? false,
  };
}
```

## 2. Semantic Configuration (Semantic Configuration)

**Use `modelType` + `TaskProfile` to describe intent, let AI Engine decide implementation.**

```typescript
// ❌ Wrong: Hardcode model and parameters
const response = await this.aiService.chat({
  model: "gpt-4o",
  temperature: 0.7,
  maxTokens: 4096,
  messages: [...],
});

// ✅ Correct: Semantically describe task requirements
const response = await this.aiChatService.chat({
  modelType: AIModelType.CHAT,
  taskProfile: {
    creativity: "medium",
    outputLength: "long",
  },
  messages: [...],
});
```

## 3. Single Responsibility (Single Responsibility)

**Each service does one thing, avoid God Service.**

| Service Type      | Scope                        | Example               |
| ----------------- | ---------------------------- | --------------------- |
| Leader Service    | Task planning and assignment | ResearchLeaderService |
| Execution Service | Task execution               | TaskExecutionService  |
| Context Service   | Context management           | MissionContextService |
| Review Service    | Quality review               | OutputReviewerService |

## 4. Event-Driven (Event-Driven)

**Use events for cross-service communication, avoid tight coupling.**

```typescript
// ❌ Wrong: Directly call other services to update state
await this.uiService.updateProgress(taskId, 50);
await this.dbService.updateTask(taskId, { status: "running" });

// ✅ Correct: Publish events, let subscribers handle
this.eventEmitter.emit("task:progress", {
  taskId,
  progress: 50,
  status: "running",
});
```

## Capability Attribution Decision

```
Ask yourself: "If I make a completely different AI App tomorrow, can this capability be reused?"

                    Reusable?
                       │
         ┌─────────────┼─────────────┐
         ↓ Yes                       ↓ No
   ┌─────────────┐           ┌─────────────────────┐
   │  AI Engine  │           │   Common scenario?   │
   └─────────────┘           └─────────────────────┘
                                     │
                       ┌─────────────┼─────────────┐
                       ↓ Yes                       ↓ No
                ┌─────────────┐              ┌──────────┐
                │ Predefined  │              │  Custom  │
                │  AI Teams   │              │ AI Teams │
                └─────────────┘              └──────────┘
```
