import { Injectable, Logger } from "@nestjs/common";
import type {
  ITaskExecutor,
  TaskExecutionContext,
  TaskExecutionResult,
} from "./task-executor.interface";

@Injectable()
export class GenericTaskExecutor implements ITaskExecutor {
  private readonly logger = new Logger(GenericTaskExecutor.name);

  async execute(context: TaskExecutionContext): Promise<TaskExecutionResult> {
    const { task } = context;
    this.logger.warn(
      `[GenericTaskExecutor] Unknown task type: ${task.taskType} — skipping execution`,
    );
    return {
      status: "skipped" as const,
      message: `Unknown task type "${task.taskType}" — no executor registered`,
    };
  }
}
