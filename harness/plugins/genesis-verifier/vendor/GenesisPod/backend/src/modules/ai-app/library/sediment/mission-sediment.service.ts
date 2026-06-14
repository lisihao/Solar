import { Injectable, Logger } from "@nestjs/common";

import { NotesService } from "../notes/notes.service";

export interface MissionSedimentInput {
  missionId: string;
  userId: string;
  title: string;
  /** 报告 markdown 正文（沉淀为 note content）。 */
  content: string;
  /** 来源标识：playground / company。 */
  source: string;
  tags?: string[];
}

/**
 * MissionSedimentService —— mission 完成后把研究产物沉淀进应用内资源库（library notes）。
 *
 * playground / company 两个消费侧对称复用本服务（避免两侧各写一遍沉淀逻辑）。沉淀为一条
 * library note：title=任务主题、content=报告 markdown、source=来源、tags=来源+维度。
 * fire-and-forget + best-effort：失败只 warn，绝不阻断 mission 终态主流程。
 *
 * 注：当前只落 note（note 本身即 library 资源）。是否再归入某 collection 属用户组织层
 * 决策，暂不自动建集合，避免臆测集合结构。
 */
@Injectable()
export class MissionSedimentService {
  private readonly log = new Logger(MissionSedimentService.name);

  constructor(private readonly notes: NotesService) {}

  /** 把一条已完成 mission 的报告沉淀为 library note。失败 best-effort（仅 warn 不抛）。 */
  async sedimentMission(input: MissionSedimentInput): Promise<void> {
    const content = (input.content ?? "").trim();
    if (!content) {
      // 无正文不沉淀空 note。
      return;
    }
    try {
      const note = await this.notes.createNote(input.userId, {
        title: input.title || "AI 任务报告",
        content,
        source: input.source,
        tags: input.tags ?? [],
        isPublic: false,
      });
      this.log.log(
        `[sediment] mission ${input.missionId} → library note ${note.id} (source=${input.source})`,
      );
    } catch (err: unknown) {
      this.log.warn(
        `[sediment] mission ${input.missionId} sediment failed (best-effort): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
