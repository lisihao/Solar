/**
 * SubagentHandle — 父 Agent 持有的子 Agent 运行句柄
 *
 * 提供：
 *   - events: 子 agent 事件的 async stream
 *   - waitForResult(): 等待子 agent 的 final output
 *   - abort(): 中止子 agent 执行（真正调 child.cancel() 传播 AbortSignal）
 */

import { randomUUID } from "crypto";
import type {
  IAgent,
  IAgentEvent,
  ISubagentHandle,
  ISubagentSpec,
} from "@/modules/ai-harness/agents/abstractions";

export class SubagentHandle implements ISubagentHandle {
  readonly id: string;
  readonly name: string;
  readonly parent: IAgent;
  readonly spec: ISubagentSpec;
  readonly events: AsyncIterable<IAgentEvent>;

  private readonly child: IAgent;
  private resultPromise: Promise<string | Record<string, unknown>>;
  private resolveResult!: (value: string | Record<string, unknown>) => void;
  private rejectResult!: (err: Error) => void;
  private settled = false;
  private aborted = false;

  constructor(params: {
    name: string;
    parent: IAgent;
    spec: ISubagentSpec;
    child: IAgent;
  }) {
    this.id = randomUUID();
    this.name = params.name;
    this.parent = params.parent;
    this.spec = params.spec;
    this.child = params.child;

    this.resultPromise = new Promise((resolve, reject) => {
      this.resolveResult = (v) => {
        if (this.settled) return;
        this.settled = true;
        resolve(v);
      };
      this.rejectResult = (e) => {
        if (this.settled) return;
        this.settled = true;
        reject(e);
      };
    });

    this.events = this.consume(params.child);
  }

  private async *consume(child: IAgent): AsyncIterable<IAgentEvent> {
    try {
      for await (const ev of child.execute({
        goal: this.spec.prompt,
      })) {
        yield ev;

        if (ev.type === "output") {
          const payload = ev.payload as {
            output: string | Record<string, unknown>;
          };
          this.resolveResult(payload.output);
        } else if (ev.type === "error") {
          const payload = ev.payload as { message: string };
          this.rejectResult(new Error(payload.message));
        } else if (ev.type === "terminated") {
          // Final safety net — if no output/error event fired, reject/resolve here
          if (this.aborted) {
            this.rejectResult(new Error("Subagent aborted"));
          } else {
            // No output and no error? Resolve with empty (completed but silent)
            this.resolveResult("");
          }
        }
      }
    } catch (err) {
      this.rejectResult(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // Guarantee the caller never hangs on waitForResult()
      if (!this.settled) {
        this.rejectResult(new Error("Subagent stream ended without result"));
      }
    }
  }

  async waitForResult(): Promise<string | Record<string, unknown>> {
    return this.resultPromise;
  }

  async abort(reason = "aborted by parent"): Promise<void> {
    this.aborted = true;
    // Propagate cancellation to the child agent's AbortController
    await this.child.cancel(reason);
  }
}
