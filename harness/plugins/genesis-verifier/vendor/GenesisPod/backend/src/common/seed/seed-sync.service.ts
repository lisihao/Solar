import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ISeeder, SeederResult } from "./seeders/seeder.interface";
import { SimulationProvidersSeeder } from "./seeders/simulation-providers.seeder";
import { YouTubeSourcesSeeder } from "./seeders/youtube-sources.seeder";
import { AiProvidersSeeder } from "./seeders/ai-providers.seeder";

/**
 * Idempotent system-data sync at backend boot.
 *
 * Handles "every fresh install needs this baseline data to be usable"
 * cases that aren't covered by prisma migration-embedded INSERTs:
 *   - Simulation external providers (4 entries → SystemSetting JSON)
 *   - YouTube default channels (5 entries → DataSource rows)
 *   - AI provider catalog (system scope ai_providers rows; create-only so it
 *     never clobbers admin edits). Single source: data/ai-provider-catalog.ts.
 *     Replaces the one-shot migration INSERTs (20260505b / 20260510b) so that
 *     adding a built-in provider no longer requires a new migration.
 *
 * NOT covered (intentionally):
 *   - ai_models, data_sources → seeded via SQL migrations
 *   - Tools / Skills → code-registered at onModuleInit / file-bundled
 *   - User-scoped customizations → admin creates in UI
 *
 * Failures are logged but never block boot. Disable via SEED_SYNC_ENABLED=false.
 */
@Injectable()
export class SeedSyncService implements OnModuleInit {
  private readonly logger = new Logger(SeedSyncService.name);
  private readonly seeders: ISeeder[];

  constructor(
    private readonly config: ConfigService,
    simulationSeeder: SimulationProvidersSeeder,
    youtubeSeeder: YouTubeSourcesSeeder,
    aiProvidersSeeder: AiProvidersSeeder,
  ) {
    this.seeders = [simulationSeeder, youtubeSeeder, aiProvidersSeeder];
  }

  async onModuleInit(): Promise<void> {
    const enabled = this.config.get<string>("SEED_SYNC_ENABLED", "true");
    if (enabled !== "true") {
      this.logger.log("SEED_SYNC_ENABLED=false; skipping system data sync");
      return;
    }

    this.logger.log(`Running ${this.seeders.length} seeder(s)...`);
    const summary: Array<{ name: string; result: SeederResult | string }> = [];

    for (const seeder of this.seeders) {
      try {
        const result = await seeder.sync();
        summary.push({ name: seeder.name, result });
        this.logger.log(
          `  ${seeder.name}: created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        summary.push({ name: seeder.name, result: `FAILED: ${msg}` });
        this.logger.warn(`  ${seeder.name}: FAILED — ${msg}`);
      }
    }

    this.logger.log("System data sync complete");
  }
}
