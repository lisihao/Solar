import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../common/prisma/prisma.service";
import { BibleSnapshot } from "../bible/bible-entity.types";

@Injectable()
export class PreWriteInjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async injectContext(chapterId: string, bibleSnapshot: BibleSnapshot) {
    // Extract entities from chapter outline
    const chapter = await this.prisma.writingChapter.findUnique({
      where: { id: chapterId },
    });

    if (!chapter?.outline) {
      return { injected: false, reason: "No outline available" };
    }

    // Extract character names, locations, etc. from outline
    const extractedEntities = this.extractEntitiesFromOutline(chapter.outline);

    // Filter relevant settings from bible
    const relevantCharacters = bibleSnapshot.characters.filter((c) =>
      extractedEntities.characterNames.some(
        (name) => c.name.includes(name) || c.aliases?.includes(name),
      ),
    );

    const relevantSettings = bibleSnapshot.worldSettings.filter((s) =>
      extractedEntities.locations.some(
        (loc) => s.name.includes(loc) || s.description.includes(loc),
      ),
    );

    return {
      injected: true,
      context: {
        characters: relevantCharacters,
        worldSettings: relevantSettings,
        terminology: bibleSnapshot.terminologies,
        timeline: bibleSnapshot.timelineEvents,
      },
    };
  }

  private extractEntitiesFromOutline(outline: string) {
    // Simple entity extraction (could be enhanced with NER)
    const characterNames: string[] = [];
    const locations: string[] = [];

    // Extract names in quotes or after common patterns
    const nameMatches = outline.match(/["「]([^"」]+)["」]/g) || [];
    characterNames.push(...nameMatches.map((m) => m.slice(1, -1)));

    // Extract location patterns
    const locationPatterns = /(?:在|到|去|于)([^\s，。,\.]+)/g;
    let match;
    while ((match = locationPatterns.exec(outline)) !== null) {
      locations.push(match[1]);
    }

    return { characterNames, locations };
  }
}
