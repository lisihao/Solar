import { Injectable } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs/promises";
import { PrismaService } from "../../prisma/prisma.service";
import { ISeeder, SeederResult } from "./seeder.interface";

interface YouTubeChannel {
  name: string;
  channelId: string;
  handle: string;
  description: string;
  keywords: string[];
}

@Injectable()
export class YouTubeSourcesSeeder implements ISeeder {
  readonly name = "youtube-sources";

  constructor(private readonly prisma: PrismaService) {}

  async sync(): Promise<SeederResult> {
    const dataPath = path.join(__dirname, "../data/youtube-sources.json");
    const raw = await fs.readFile(dataPath, "utf-8");
    const channels = JSON.parse(raw) as YouTubeChannel[];

    let created = 0;
    let skipped = 0;

    for (const channel of channels) {
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;

      const existing = await this.prisma.dataSource.findFirst({
        where: {
          OR: [{ name: channel.name }, { baseUrl: rssUrl }],
        },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await this.prisma.dataSource.create({
        data: {
          name: channel.name,
          description: channel.description,
          type: "YOUTUBE",
          category: "YOUTUBE_VIDEO",
          baseUrl: rssUrl,
          apiEndpoint: `https://www.youtube.com/${channel.handle}`,
          authType: "NONE",
          crawlerType: "RSS",
          crawlerConfig: {
            channelId: channel.channelId,
            handle: channel.handle,
            fetchTranscript: true,
            maxItems: 10,
            schedule: {
              frequency: "daily",
              time: "06:00",
              enabled: true,
            },
          },
          rateLimit: 1,
          keywords: channel.keywords,
          categories: ["Technology", "Business"],
          languages: ["en"],
          minQualityScore: 0,
          deduplicationConfig: {
            checkFields: ["externalId", "title"],
            strategy: "SKIP_DUPLICATE",
          },
          status: "ACTIVE",
          isVerified: false,
        },
      });
      created++;
    }

    return { created, updated: 0, skipped };
  }
}
