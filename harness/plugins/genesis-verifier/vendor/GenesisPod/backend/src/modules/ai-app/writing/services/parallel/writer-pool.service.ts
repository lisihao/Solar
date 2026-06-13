import { Injectable, Logger } from "@nestjs/common";

interface WriterInstance {
  id: number;
  busy: boolean;
  currentChapterId?: string;
  startedAt?: Date;
}

@Injectable()
export class WriterPoolService {
  private readonly _logger = new Logger(WriterPoolService.name);
  private readonly pool: Map<number, WriterInstance> = new Map();
  private maxPoolSize = 5;

  constructor() {
    this.initializePool();
  }

  private initializePool() {
    for (let i = 1; i <= this.maxPoolSize; i++) {
      this.pool.set(i, { id: i, busy: false });
    }
  }

  async acquire(): Promise<WriterInstance> {
    // Find an available writer
    for (const [id, writer] of this.pool) {
      if (!writer.busy) {
        writer.busy = true;
        writer.startedAt = new Date();
        this._logger.log(`Writer ${id} acquired`);
        return writer;
      }
    }

    // All writers busy - wait for one to become available
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        for (const [id, writer] of this.pool) {
          if (!writer.busy) {
            writer.busy = true;
            writer.startedAt = new Date();
            clearInterval(checkInterval);
            this._logger.log(`Writer ${id} acquired after wait`);
            resolve(writer);
            return;
          }
        }
      }, 1000);
    });
  }

  async release(writer: WriterInstance) {
    const poolWriter = this.pool.get(writer.id);
    if (poolWriter) {
      poolWriter.busy = false;
      poolWriter.currentChapterId = undefined;
      poolWriter.startedAt = undefined;
      this._logger.log(`Writer ${writer.id} released`);
    }
  }

  setCurrentChapter(writerId: number, chapterId: string) {
    const writer = this.pool.get(writerId);
    if (writer) {
      writer.currentChapterId = chapterId;
    }
  }

  getPoolStatus() {
    const status: unknown[] = [];
    for (const [id, writer] of this.pool) {
      status.push({
        id,
        busy: writer.busy,
        currentChapterId: writer.currentChapterId,
        runningFor: writer.startedAt
          ? Date.now() - writer.startedAt.getTime()
          : null,
      });
    }
    return status;
  }

  getAvailableCount(): number {
    let count = 0;
    for (const writer of this.pool.values()) {
      if (!writer.busy) count++;
    }
    return count;
  }

  setMaxPoolSize(size: number) {
    const oldSize = this.maxPoolSize;
    this.maxPoolSize = size;

    // Add new writers if increasing
    if (size > oldSize) {
      for (let i = oldSize + 1; i <= size; i++) {
        this.pool.set(i, { id: i, busy: false });
      }
    }

    // Note: We don't remove busy writers, they'll be removed when released
  }
}
