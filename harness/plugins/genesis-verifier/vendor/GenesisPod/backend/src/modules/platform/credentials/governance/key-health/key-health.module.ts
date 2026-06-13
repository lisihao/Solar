import { Module } from "@nestjs/common";
import { KeyErrorClassifier } from "./key-error-classifier";
import { KeyHealthStore } from "./key-health.store";
import { ProviderProbeService } from "./provider-probe.service";

/**
 * KeyHealthModule — 提供 KeyErrorClassifier + KeyHealthStore + ProviderProbeService。
 *
 * CacheModule 是 @Global，KeyHealthStore Optional 注入 CacheService，
 * 因此本模块无需显式 imports CacheModule。
 */
@Module({
  providers: [KeyErrorClassifier, KeyHealthStore, ProviderProbeService],
  exports: [KeyErrorClassifier, KeyHealthStore, ProviderProbeService],
})
export class KeyHealthModule {}
