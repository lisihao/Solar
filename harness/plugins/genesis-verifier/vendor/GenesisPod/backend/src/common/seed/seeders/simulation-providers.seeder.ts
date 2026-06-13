import { Injectable, Logger } from "@nestjs/common";
import * as path from "path";
import * as fs from "fs/promises";
import { PrismaService } from "../../prisma/prisma.service";
import { ISeeder, SeederResult } from "./seeder.interface";

interface SimulationProvider {
  id: string;
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  headers: Record<string, string>;
}

@Injectable()
export class SimulationProvidersSeeder implements ISeeder {
  readonly name = "simulation-providers";
  private readonly logger = new Logger(SimulationProvidersSeeder.name);

  constructor(private readonly prisma: PrismaService) {}

  async sync(): Promise<SeederResult> {
    const dataPath = path.join(__dirname, "../data/simulation-providers.json");
    const raw = await fs.readFile(dataPath, "utf-8");
    const providers = JSON.parse(raw) as SimulationProvider[];

    const existing = await this.prisma.systemSetting.findUnique({
      where: { key: "external.providers" },
    });

    let existingProviders: SimulationProvider[] = [];
    if (existing?.value) {
      try {
        existingProviders = JSON.parse(existing.value) as SimulationProvider[];
      } catch {
        this.logger.warn("Existing external.providers JSON invalid; replacing");
      }
    }

    let updated = 0;
    let created = 0;

    const merged = providers.map((seed) => {
      const prior = existingProviders.find((p) => p.id === seed.id);
      if (prior) {
        updated++;
        return {
          ...seed,
          apiKey: prior.apiKey || seed.apiKey,
          enabled: prior.enabled !== undefined ? prior.enabled : seed.enabled,
          baseUrl: prior.baseUrl || seed.baseUrl,
          headers: prior.headers || seed.headers,
        };
      }
      created++;
      return seed;
    });

    const customProviders = existingProviders.filter(
      (p) => !providers.find((sp) => sp.id === p.id),
    );
    merged.push(...customProviders);

    await this.prisma.systemSetting.upsert({
      where: { key: "external.providers" },
      create: {
        key: "external.providers",
        value: JSON.stringify(merged),
        description: "External data providers for AI Simulation",
        category: "external",
      },
      update: {
        value: JSON.stringify(merged),
        description: "External data providers for AI Simulation",
      },
    });

    return { created, updated, skipped: customProviders.length };
  }
}
