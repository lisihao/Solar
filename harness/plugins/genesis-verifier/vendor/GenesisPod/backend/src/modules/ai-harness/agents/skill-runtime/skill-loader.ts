/**
 * SkillLoader — 从文件系统加载 SKILL.md 文件到 SkillRegistry
 *
 * v5.1 R0-A3 (2026-05-04): harness 不再持有任何具体 ai-app 业务 skill。
 * 加载源从 DI token EXTRA_SKILL_DIRS 注入，由各 ai-app 模块在 imports
 * 阶段提供自己的 skill 目录路径数组。
 *
 * 用法（ai-app/{app}/{app}.module.ts）：
 *   imports: [
 *     // ...
 *     {
 *       module: AgentPlaygroundSkillsModule,
 *       global: false,
 *     }
 *   ]
 *   或直接 providers: [
 *     {
 *       provide: EXTRA_SKILL_DIRS,
 *       useValue: [path.resolve(__dirname, "skills/built-in")],
 *     }
 *   ]
 *
 * OnModuleInit 时按目录顺序扫描，全部注册到 SkillRegistry；失败的 skill 记
 * warn 不阻塞启动。同 id 后注册覆盖前注册（ai-app 可覆盖 harness 默认）。
 */

import {
  Inject,
  Injectable,
  Logger,
  Optional,
  OnModuleInit,
} from "@nestjs/common";
import * as fs from "fs";
import * as path from "path";
import type { ISkillLoader, ISkill } from "../abstractions";
import { parseSkillMarkdown, SkillParseError } from "./skill-parser";
import { BuiltinSkillCatalog } from "./skill-registry";

const SKILL_FILENAME = "SKILL.md";

/**
 * DI token：ai-app 模块通过此 token 注入自己的 skill 目录绝对路径数组。
 * harness 自身**不再**注册任何 skill 目录；如未注入则 SkillLoader 是 no-op。
 */
export const EXTRA_SKILL_DIRS = "EXTRA_SKILL_DIRS";

@Injectable()
export class SkillLoader implements ISkillLoader, OnModuleInit {
  private readonly logger = new Logger(SkillLoader.name);

  constructor(
    private readonly registry: BuiltinSkillCatalog,
    @Optional()
    @Inject(EXTRA_SKILL_DIRS)
    private readonly extraDirs?: ReadonlyArray<string>,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const skills = await this.loadAll();
      this.registry.registerAll(skills);
      this.logger.log(
        `Loaded ${skills.length} SKILL.md files from ${this.dirs().length} dir(s) into SkillRegistry`,
      );
    } catch (err) {
      this.logger.warn(
        `Skill auto-load skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private dirs(): ReadonlyArray<string> {
    return this.extraDirs ?? [];
  }

  async loadById(id: string): Promise<ISkill | null> {
    for (const dir of this.dirs()) {
      const filePath = path.join(dir, id, SKILL_FILENAME);
      try {
        const raw = await fs.promises.readFile(filePath, "utf-8");
        return parseSkillMarkdown(raw, filePath);
      } catch (err) {
        if (
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code: string }).code === "ENOENT"
        ) {
          continue; // 当前 dir 没此 skill，找下一个
        }
        this.logger.warn(
          `Failed to load skill '${id}' from ${dir}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    }
    return null;
  }

  async loadAll(): Promise<readonly ISkill[]> {
    const skills: ISkill[] = [];
    for (const dir of this.dirs()) {
      const exists = await fs.promises
        .access(dir)
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        this.logger.warn(`Skill source dir not found: ${dir}`);
        continue;
      }
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const filePath = path.join(dir, entry.name, SKILL_FILENAME);
        try {
          const raw = await fs.promises.readFile(filePath, "utf-8");
          skills.push(parseSkillMarkdown(raw, filePath));
        } catch (err) {
          if (err instanceof SkillParseError) {
            this.logger.warn(
              `Skill '${entry.name}' parse error: ${err.message}`,
            );
          } else if (
            typeof err === "object" &&
            err !== null &&
            "code" in err &&
            (err as { code: string }).code === "ENOENT"
          ) {
            this.logger.debug(
              `Directory '${entry.name}' has no SKILL.md — skipped`,
            );
          } else {
            this.logger.warn(
              `Failed to read '${entry.name}': ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      }
    }
    return skills;
  }
}
