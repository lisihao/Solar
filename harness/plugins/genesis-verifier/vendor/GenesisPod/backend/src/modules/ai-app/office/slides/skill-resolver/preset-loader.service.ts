import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { promises as fs } from "fs";
import * as path from "path";
import type { Preset } from "./skill-policy.types";
import { ALL_SLOT_IDS, type SlidesSlotId } from "./slot-ids";

const SLOT_SET = new Set<SlidesSlotId>(ALL_SLOT_IDS);

/**
 * Loads JSON presets from the `presets/` directory on module init.
 *
 * File naming: `<preset-id>.json`.
 * Content schema: matches {@link Preset}.
 *
 * Validation: unknown slot IDs are rejected (typo guard); bindings with
 * empty skillId are dropped (treated as "use default").
 */
@Injectable()
export class PresetLoader implements OnModuleInit {
  private readonly logger = new Logger(PresetLoader.name);
  private readonly presets = new Map<string, Preset>();
  private readonly presetsDir = path.resolve(__dirname, "..", "presets");

  async onModuleInit(): Promise<void> {
    await this.loadAll();
  }

  get(id: string): Preset | undefined {
    return this.presets.get(id);
  }

  list(): Preset[] {
    return [...this.presets.values()];
  }

  /**
   * Public for tests / hot reload.
   */
  async loadAll(): Promise<void> {
    let entries: string[] = [];
    try {
      entries = await fs.readdir(this.presetsDir);
    } catch (err) {
      this.logger.warn(
        `Preset directory missing, skipping load: ${this.presetsDir} (${
          err instanceof Error ? err.message : String(err)
        })`,
      );
      return;
    }

    const files = entries.filter((f) => f.endsWith(".json"));
    let loaded = 0;
    let skipped = 0;
    for (const file of files) {
      try {
        const full = path.join(this.presetsDir, file);
        const raw = await fs.readFile(full, "utf8");
        const parsed: unknown = JSON.parse(raw);
        const preset = this.validate(parsed, file);
        this.presets.set(preset.id, preset);
        loaded++;
      } catch (err) {
        skipped++;
        this.logger.error(
          `Failed to load preset ${file}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    this.logger.log(
      `Presets loaded: ${loaded} from ${this.presetsDir} (skipped: ${skipped})`,
    );
  }

  private validate(raw: unknown, fileName: string): Preset {
    if (!raw || typeof raw !== "object") {
      throw new Error(`Invalid preset (not an object): ${fileName}`);
    }
    const obj = raw as Record<string, unknown>;
    if (typeof obj.id !== "string" || obj.id.length === 0) {
      throw new Error(`Preset missing string 'id': ${fileName}`);
    }
    if (!obj.bindings || typeof obj.bindings !== "object") {
      throw new Error(`Preset missing 'bindings' object: ${fileName}`);
    }

    const rawBindings = obj.bindings as Record<string, unknown>;
    const bindings: Partial<Record<SlidesSlotId, string>> = {};
    for (const [slot, skill] of Object.entries(rawBindings)) {
      if (!SLOT_SET.has(slot as SlidesSlotId)) {
        throw new Error(`Preset '${obj.id}' references unknown slot '${slot}'`);
      }
      if (typeof skill !== "string") continue;
      if (skill.trim().length === 0) continue;
      bindings[slot as SlidesSlotId] = skill;
    }

    return {
      id: obj.id,
      description:
        typeof obj.description === "string" ? obj.description : undefined,
      appliesTo:
        obj.appliesTo && typeof obj.appliesTo === "object"
          ? (obj.appliesTo as Preset["appliesTo"])
          : undefined,
      bindings,
    };
  }
}
