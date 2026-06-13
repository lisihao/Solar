/**
 * AI Engine Knowledge Consistency Module
 *
 * v1.5.3 P0a-3: new sub-module containing semantic-consistency primitives.
 *
 * Single service for now (StaleDetectorService); separate module to keep the
 * knowledge sub-tree organized alongside synthesis/extraction/evidence.
 */

import { Module } from "@nestjs/common";
import { StaleDetectorService } from "./stale-detector.service";

@Module({
  providers: [StaleDetectorService],
  exports: [StaleDetectorService],
})
export class ConsistencyModule {}
