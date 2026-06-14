/**
 * FixtureStore — record/replay 用的事件流持久化（文件系统）
 *
 * record 模式：把一次真实 agent 执行的事件流写到 .json 文件
 * replay 模式：从文件读出事件流，按顺序 yield，绕过 LLM/tool 真实调用
 *
 * 文件格式：
 *   {
 *     "version": 1,
 *     "input": <original input>,
 *     "events": [<IAgentEvent>, ...],
 *     "recordedAt": <timestamp>,
 *     "agentId": "topic-extractor"
 *   }
 *
 * 用例：
 *   - 集成测试：录一次真实 LLM，replay 时确定性 + 零 token
 *   - 调试：录生产/dev 的 trace，本地 replay 复现 bug
 */

import { promises as fs } from "fs";
import { dirname } from "path";
import type { IAgentEvent } from "../abstractions";

export interface RecordedRun {
  readonly version: 1;
  readonly agentId: string;
  readonly input: unknown;
  readonly events: readonly IAgentEvent[];
  readonly recordedAt: number;
}

export class FixtureStore {
  /** 写入一次执行的快照 */
  async write(filePath: string, run: RecordedRun): Promise<void> {
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(run, null, 2), "utf8");
  }

  /** 读取 fixture */
  async read(filePath: string): Promise<RecordedRun> {
    const text = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(text) as RecordedRun;
    if (parsed.version !== 1) {
      throw new Error(
        `Unsupported fixture version ${parsed.version} at ${filePath}`,
      );
    }
    return parsed;
  }

  /** Replay：按顺序 yield 事件（保留时间间隔，可选 fast=true 跳过 sleep） */
  async *replay(
    filePath: string,
    options: { fast?: boolean } = { fast: true },
  ): AsyncIterable<IAgentEvent> {
    const run = await this.read(filePath);
    let prevTs: number | null = null;
    for (const ev of run.events) {
      if (!options.fast && prevTs != null) {
        const delay = Math.max(0, ev.timestamp - prevTs);
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, Math.min(delay, 200)));
        }
      }
      prevTs = ev.timestamp;
      yield ev;
    }
  }
}
