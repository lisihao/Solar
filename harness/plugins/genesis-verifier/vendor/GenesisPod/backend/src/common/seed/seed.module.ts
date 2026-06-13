import { Module } from "@nestjs/common";
import { SeedSyncService } from "./seed-sync.service";
import { SimulationProvidersSeeder } from "./seeders/simulation-providers.seeder";
import { YouTubeSourcesSeeder } from "./seeders/youtube-sources.seeder";
import { AiProvidersSeeder } from "./seeders/ai-providers.seeder";

@Module({
  providers: [
    SeedSyncService,
    SimulationProvidersSeeder,
    YouTubeSourcesSeeder,
    AiProvidersSeeder,
  ],
})
export class SeedModule {}
