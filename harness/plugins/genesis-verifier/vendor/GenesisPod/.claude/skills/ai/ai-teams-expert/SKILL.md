---
name: AI Teams Expert
description: |
  Multi-agent collaboration, mission orchestration, and Canvas visualization.
  Trigger keywords: ai teams, multi-agent, collaboration, mission, canvas, orchestration
  Not for: AI Engine core (-> ai-engine-development-paradigm), Real-time (-> realtime-communication-expert)
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob]
tags: [ai-teams, multi-agent, collaboration, canvas, orchestration]
boundaries:
  includes:
    - Multi-agent collaboration workflows
    - Mission orchestration logic
    - Canvas visualization with D3/SVG
    - Task dependencies and execution
    - Leader review and feedback loops
  excludes:
    - AI Engine core mechanisms
    - WebSocket infrastructure
  handoff:
    - skill: ai-engine-development-paradigm
      when: AI Engine changes needed
    - skill: realtime-communication-expert
      when: WebSocket implementation
---

# AI Teams Expert

> Detailed docs: `references/`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    AI Teams System                           │
├─────────────────────────────────────────────────────────────┤
│  Frontend  │ TeamCanvas │ ChatPanel │ MissionControl        │
├─────────────────────────────────────────────────────────────┤
│  Backend   │ MissionOrchestrator │ TaskManager │ AgentCoord │
├─────────────────────────────────────────────────────────────┤
│  AI        │ GPT-4 │ Claude │ Grok │ Gemini                 │
└─────────────────────────────────────────────────────────────┘
```

## Key Files

```
frontend/components/ai-teams/
├── TeamCanvasModal.tsx         # Canvas visualization
├── TeamChatPanel.tsx           # Chat interface
├── MissionCard.tsx             # Mission display
└── AgentNode.tsx               # Agent visualization

backend/src/modules/ai/ai-teams/
├── mission.service.ts          # Mission orchestration
├── task.service.ts             # Task management
└── agent.service.ts            # Agent coordination
```

## Core Data Models

```typescript
interface TeamMission {
  id: string;
  title: string;
  status: MissionStatus;
  leaderId: string;
  memberIds: string[];
  tasks: AgentTask[];
}

enum MissionStatus {
  PENDING,
  PLANNING,
  IN_PROGRESS,
  REVIEW,
  COMPLETED,
  FAILED,
}

interface AgentTask {
  id: string;
  missionId: string;
  title: string;
  assignedToId: string;
  status: AgentTaskStatus;
  result?: string;
  dependsOn?: string[];
}

interface TopicAIMember {
  id: string;
  displayName: string;
  modelProvider: string; // 'openai' | 'anthropic' | 'xai'
  modelId: string;
  role: AgentRole;
}

enum AgentRole {
  LEADER,
  RESEARCHER,
  ANALYST,
  WRITER,
  REVIEWER,
}
```

## Mission Orchestration Flow

```typescript
async executeMission(missionId: string): Promise<void> {
  // Phase 1: Planning
  await this.updateStatus(missionId, MissionStatus.PLANNING);
  const tasks = await this.planTasks(mission);

  // Phase 2: Execution
  await this.updateStatus(missionId, MissionStatus.IN_PROGRESS);
  await this.executeTasks(mission, tasks);

  // Phase 3: Review
  await this.updateStatus(missionId, MissionStatus.REVIEW);
  const finalResult = await this.consolidateResults(mission);

  // Phase 4: Complete
  await this.completeMission(missionId, finalResult);
}
```

## WebSocket Events

```typescript
enum TeamEventType {
  MISSION_STARTED,
  TASK_ASSIGNED,
  TASK_STARTED,
  TASK_COMPLETED,
  AGENT_TYPING,
  MISSION_COMPLETED,
}
```

## Related Docs

- [Mission Orchestration](references/mission-orchestration.md)
- [Canvas Visualization](references/canvas-visualization.md)
- [Real-time Events](references/realtime-events.md)
