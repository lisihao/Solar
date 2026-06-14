# Mission Orchestration

## Complete Orchestration Flow

```typescript
class MissionOrchestrator {
  async executeMission(missionId: string): Promise<void> {
    const mission = await this.getMission(missionId);

    // Phase 1: Planning
    await this.updateStatus(missionId, MissionStatus.PLANNING);
    const tasks = await this.planTasks(mission);
    await this.saveTasks(missionId, tasks);

    // Phase 2: Execution
    await this.updateStatus(missionId, MissionStatus.IN_PROGRESS);
    await this.executeTasks(mission, tasks);

    // Phase 3: Review
    await this.updateStatus(missionId, MissionStatus.REVIEW);
    const finalResult = await this.consolidateResults(mission);

    // Phase 4: Complete
    await this.completeMission(missionId, finalResult);
  }

  async planTasks(mission: TeamMission): Promise<AgentTask[]> {
    const leader = await this.getAgent(mission.leaderId);

    const planningPrompt = `
      As team leader, plan tasks for mission: "${mission.title}"
      Description: ${mission.description}

      Team members available:
      ${mission.memberIds.map((id) => this.describeMember(id)).join("\n")}

      Create a detailed task breakdown with assignments.
      Output JSON: [{ title, description, assignedToId, priority, dependsOn }]
    `;

    const response = await this.aiService.chat(leader, planningPrompt);
    return JSON.parse(response);
  }

  async executeTasks(mission: TeamMission, tasks: AgentTask[]): Promise<void> {
    // Sort by dependencies
    const sortedTasks = this.topologicalSort(tasks);

    for (const task of sortedTasks) {
      // Wait for dependencies
      await this.waitForDependencies(task);

      // Execute task
      await this.executeTask(mission, task);

      // Leader review
      await this.leaderReview(mission, task);
    }
  }
}
```

## Task Execution

```typescript
async executeTask(mission: TeamMission, task: AgentTask): Promise<void> {
  const agent = await this.getAgent(task.assignedToId);

  await this.updateTaskStatus(task.id, AgentTaskStatus.IN_PROGRESS);

  const taskPrompt = `
    Task: ${task.title}
    Description: ${task.description}

    Context from completed tasks:
    ${await this.getCompletedTasksContext(mission)}

    Complete this task and provide a detailed result.
  `;

  const result = await this.aiService.chat(agent, taskPrompt);

  await this.updateTask(task.id, {
    result,
    status: AgentTaskStatus.AWAITING_REVIEW,
  });
}
```

## Leader Review Process

```typescript
async leaderReview(mission: TeamMission, task: AgentTask): Promise<void> {
  const leader = await this.getAgent(mission.leaderId);

  const reviewPrompt = `
    Review task result:
    Task: ${task.title}
    Result: ${task.result}

    Evaluate quality and completeness.
    If acceptable, respond: {"approved": true, "feedback": "..."}
    If needs revision, respond: {"approved": false, "feedback": "..."}
  `;

  const review = await this.aiService.chat(leader, reviewPrompt);
  const { approved, feedback } = JSON.parse(review);

  if (approved) {
    await this.updateTask(task.id, {
      status: AgentTaskStatus.COMPLETED,
      leaderFeedback: feedback,
    });
  } else {
    await this.updateTask(task.id, {
      status: AgentTaskStatus.REVISION_NEEDED,
      leaderFeedback: feedback,
      revisionCount: task.revisionCount + 1,
    });

    // Re-execute with feedback
    await this.reviseTask(mission, task, feedback);
  }
}
```

## Task Status Flow

```
PENDING → IN_PROGRESS → AWAITING_REVIEW → COMPLETED
                ↓                ↓
            BLOCKED       REVISION_NEEDED → back to IN_PROGRESS
```
