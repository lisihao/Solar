import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";

export interface ParallelConflict {
  type: "CHARACTER_STATE" | "NEW_SETTING" | "TIMELINE" | "TERMINOLOGY";
  severity: "CRITICAL" | "WARNING" | "INFO";
  chapters: string[];
  description: string;
  resolution?: string;
}

@Injectable()
export class ParallelConflictDetectorService {
  private readonly logger = new Logger(ParallelConflictDetectorService.name);

  constructor(private readonly prisma: PrismaService) {
    void this.logger;
    void this.prisma;
  }

  async detect(
    chapterResults: Array<Record<string, unknown>>,
  ): Promise<ParallelConflict[]> {
    const conflicts: ParallelConflict[] = [];

    // Detect character state conflicts
    const characterConflicts =
      this.detectCharacterStateConflicts(chapterResults);
    conflicts.push(...characterConflicts);

    // Detect new setting duplicates
    const settingConflicts = this.detectNewSettingConflicts(chapterResults);
    conflicts.push(...settingConflicts);

    // Detect timeline contradictions
    const timelineConflicts = this.detectTimelineConflicts(chapterResults);
    conflicts.push(...timelineConflicts);

    // Detect terminology inconsistencies
    const termConflicts = this.detectTerminologyConflicts(chapterResults);
    conflicts.push(...termConflicts);

    return conflicts;
  }

  private detectCharacterStateConflicts(
    results: Array<Record<string, unknown>>,
  ): ParallelConflict[] {
    const conflicts: ParallelConflict[] = [];

    // Group by character mentions across chapters
    const characterMentions = new Map<string, string[]>();

    for (const result of results) {
      // Extract character state changes from content
      // This is a simplified version - would need NLP in production
      const content = result.content as string;
      const stateChanges = this.extractStateChanges(content);

      for (const change of stateChanges) {
        const existing = characterMentions.get(change.characterName) || [];
        const chapter = result.chapter as { id: string };
        existing.push(chapter.id);
        characterMentions.set(change.characterName, existing);
      }
    }

    // Check for conflicting states
    for (const [character, chapters] of characterMentions) {
      if (chapters.length > 1) {
        conflicts.push({
          type: "CHARACTER_STATE",
          severity: "WARNING",
          chapters,
          description: `角色 "${character}" 在多个并行章节中可能有状态冲突`,
          resolution: "按时间线顺序合并状态变化",
        });
      }
    }

    return conflicts;
  }

  private detectNewSettingConflicts(
    results: Array<Record<string, unknown>>,
  ): ParallelConflict[] {
    const conflicts: ParallelConflict[] = [];

    // Detect if same new entity is introduced in multiple chapters
    const newEntities = new Map<string, string[]>();

    for (const result of results) {
      const content = result.content as string;
      const entities = this.extractNewEntities(content);
      for (const entity of entities) {
        const existing = newEntities.get(entity.toLowerCase()) || [];
        const chapter = result.chapter as { id: string };
        existing.push(chapter.id);
        newEntities.set(entity.toLowerCase(), existing);
      }
    }

    for (const [entity, chapters] of newEntities) {
      if (chapters.length > 1) {
        conflicts.push({
          type: "NEW_SETTING",
          severity: "WARNING",
          chapters,
          description: `新实体 "${entity}" 在多个章节中被引入`,
          resolution: "合并或重命名以避免混淆",
        });
      }
    }

    return conflicts;
  }

  private detectTimelineConflicts(
    _results: Array<Record<string, unknown>>,
  ): ParallelConflict[] {
    // Placeholder - would need more sophisticated analysis
    return [];
  }

  private detectTerminologyConflicts(
    _results: Array<Record<string, unknown>>,
  ): ParallelConflict[] {
    // Placeholder - would need NLP analysis
    return [];
  }

  private extractStateChanges(
    content: string,
  ): { characterName: string; change: string }[] {
    // Simplified extraction - would need NLP in production
    const changes: { characterName: string; change: string }[] = [];

    // Look for patterns like "X受伤了", "X死了", "X获得了"
    const patterns = [/([^\s，。,\.]+)(?:受伤|死|获得|失去|变成)/g];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        changes.push({
          characterName: match[1],
          change: match[0],
        });
      }
    }

    return changes;
  }

  private extractNewEntities(content: string): string[] {
    // Simplified - look for quoted names that might be new
    const matches = content.match(/["「]([^"」]{2,10})["」]/g) || [];
    return matches.map((m) => m.slice(1, -1));
  }
}
