import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { UpdateStoryBibleDto } from "./bible-entity.types";

@Injectable()
export class StoryBibleService {
  constructor(private readonly prisma: PrismaService) {}

  async getByProject(projectId: string, userId: string) {
    const project = await this.prisma.writingProject.findFirst({
      where: { id: projectId, ownerId: userId },
    });

    if (!project) {
      throw new ForbiddenException("Project not found or access denied");
    }

    const bible = await this.prisma.storyBible.findUnique({
      where: { projectId },
      include: {
        characters: {
          orderBy: { createdAt: "asc" },
        },
        worldSettings: {
          orderBy: { createdAt: "asc" },
        },
        terminologies: true,
        timelineEvents: {
          orderBy: { storyTime: "asc" },
        },
        factions: true,
      },
    });

    if (bible) {
      // Normalize world setting descriptions (fix existing JSON string data in DB)
      if (bible.worldSettings) {
        bible.worldSettings = bible.worldSettings.map((ws) => ({
          ...ws,
          description: this.normalizeDescription(ws.description),
        }));
      }
      // Clean premise: remove lines containing [object Object]
      if (bible.premise) {
        bible.premise = this.cleanPremise(bible.premise);
      }
    }

    return bible;
  }

  /** Remove lines containing [object Object] from premise text */
  private cleanPremise(premise: string): string {
    return premise
      .split("\n")
      .filter((line) => !line.includes("[object Object]"))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  /**
   * Normalize a description that may contain raw JSON string into readable text.
   * Handles data saved before the toStr() fix was deployed.
   */
  private normalizeDescription(desc: string): string {
    if (!desc) return desc;
    const trimmed = desc.trim();
    // Only process strings that look like JSON objects or arrays
    if (
      !(
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      )
    ) {
      return desc;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null) return desc;
      return this.flattenValue(parsed);
    } catch {
      return desc;
    }
  }

  /** Recursively flatten nested objects/arrays into readable text */
  private flattenValue(val: unknown): string {
    if (!val) return "";
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (Array.isArray(val)) {
      return val
        .map((item) => {
          if (typeof item === "string") return item;
          if (typeof item === "object" && item !== null) {
            const obj = item as Record<string, unknown>;
            if (obj.name && obj.description) {
              return `${String(obj.name)}：${String(obj.description)}`;
            }
            return this.flattenValue(obj);
          }
          return String(item);
        })
        .join("\n");
    }
    if (typeof val === "object") {
      const parts: string[] = [];
      for (const v of Object.values(val as Record<string, unknown>)) {
        const flat = this.flattenValue(v);
        if (flat) parts.push(flat);
      }
      return parts.join("\n");
    }
    return String(val);
  }

  async update(projectId: string, userId: string, dto: UpdateStoryBibleDto) {
    const project = await this.prisma.writingProject.findFirst({
      where: { id: projectId, ownerId: userId },
    });

    if (!project) {
      throw new ForbiddenException("Project not found or access denied");
    }

    return this.prisma.storyBible.update({
      where: { projectId },
      data: {
        premise: dto.premise,
        theme: dto.theme,
        tone: dto.tone,
        worldType: dto.worldType,
        version: { increment: 1 },
        lastSyncAt: new Date(),
      },
    });
  }

  async getSnapshot(projectId: string) {
    const bible = await this.prisma.storyBible.findUnique({
      where: { projectId },
      include: {
        characters: {
          orderBy: { createdAt: "asc" },
        },
        worldSettings: {
          orderBy: { createdAt: "asc" },
        },
        terminologies: true,
        timelineEvents: {
          orderBy: { storyTime: "asc" },
        },
        factions: true,
      },
    });

    if (!bible) {
      throw new NotFoundException("Story Bible not found");
    }

    // Normalize world setting descriptions (fix existing JSON string data in DB)
    if (bible.worldSettings) {
      bible.worldSettings = bible.worldSettings.map((ws) => ({
        ...ws,
        description: this.normalizeDescription(ws.description),
      }));
    }

    return {
      ...bible,
      snapshotAt: new Date(),
    };
  }

  async getCharactersByIds(bibleId: string, characterIds: string[]) {
    return this.prisma.writingCharacter.findMany({
      where: {
        bibleId,
        id: { in: characterIds },
      },
    });
  }

  async getWorldSettings(bibleId: string, categories?: string[]) {
    return this.prisma.worldSetting.findMany({
      where: {
        bibleId,
        ...(categories?.length ? { category: { in: categories } } : {}),
      },
    });
  }

  async getTerminology(bibleId: string, terms?: string[]) {
    return this.prisma.terminology.findMany({
      where: {
        bibleId,
        ...(terms?.length ? { term: { in: terms } } : {}),
      },
    });
  }

  async getTimelineContext(bibleId: string, _storyTime?: string) {
    return this.prisma.timelineEvent.findMany({
      where: { bibleId },
      orderBy: { storyTime: "asc" },
    });
  }
}
