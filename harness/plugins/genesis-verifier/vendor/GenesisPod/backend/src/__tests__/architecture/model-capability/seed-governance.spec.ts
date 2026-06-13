/**
 * seed-governance.spec.ts
 *
 * Enforces single seed pattern (2026-05-13):
 *   - All system-data sync goes through backend/src/common/seed/SeedSyncService
 *   - No new .ts files under backend/scripts/seed/ (directory was removed)
 *   - All *.seeder.ts implementations live under backend/src/common/seed/seeders/
 *   - Every *.seeder.ts in seeders/ is registered as a provider in SeedModule
 *
 * Why: before this guardrail, dev would write standalone scripts/seed/*.ts that
 * never got wired into customer install. Customer fresh install ended up with
 * empty tables and broken features.
 *
 * Memory: project_seed_governance_2026_05_13
 */

import * as fs from "fs";
import * as path from "path";

const BACKEND_ROOT = path.resolve(__dirname, "../../../..");
const SEED_DIR = path.join(BACKEND_ROOT, "src/common/seed");
const SEEDERS_DIR = path.join(SEED_DIR, "seeders");
const DEPRECATED_DIR = path.join(BACKEND_ROOT, "scripts/seed");

function collectFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, suffix));
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out;
}

describe("seed-governance", () => {
  it("backend/scripts/seed/ directory must not exist", () => {
    expect(fs.existsSync(DEPRECATED_DIR)).toBe(false);
  });

  it("no *.seeder.ts file outside backend/src/common/seed/seeders/", () => {
    const allSeederFiles = collectFiles(
      path.join(BACKEND_ROOT, "src"),
      ".seeder.ts",
    );
    const outsideSeedersDir = allSeederFiles.filter(
      (f) => !f.startsWith(SEEDERS_DIR),
    );
    expect(outsideSeedersDir).toEqual([]);
  });

  it("every *.seeder.ts in seeders/ is registered in SeedModule", () => {
    const seederFiles = collectFiles(SEEDERS_DIR, ".seeder.ts");
    const moduleFile = path.join(SEED_DIR, "seed.module.ts");
    expect(fs.existsSync(moduleFile)).toBe(true);
    const moduleSrc = fs.readFileSync(moduleFile, "utf-8");

    const missing: string[] = [];
    for (const file of seederFiles) {
      const base = path.basename(file, ".seeder.ts");
      // Class name convention: kebab-case → PascalCase + "Seeder"
      // e.g. "youtube-sources" → "YouTubeSourcesSeeder"
      // To keep this generic, we match by file basename appearing in the
      // module's import statement.
      const importRegex = new RegExp(
        `from\\s+["']\\./seeders/${base}\\.seeder["']`,
      );
      if (!importRegex.test(moduleSrc)) {
        missing.push(base);
      }
    }
    expect(missing).toEqual([]);
  });

  it("SeedSyncService is wired into SeedModule providers", () => {
    const moduleFile = path.join(SEED_DIR, "seed.module.ts");
    const moduleSrc = fs.readFileSync(moduleFile, "utf-8");
    expect(moduleSrc).toMatch(/SeedSyncService/);
  });

  it("package.json must not reference removed scripts/seed/ files", () => {
    const pkgFile = path.join(BACKEND_ROOT, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf-8")) as {
      scripts: Record<string, string>;
    };
    const offenders = Object.entries(pkg.scripts).filter(([, cmd]) =>
      /scripts\/seed\//.test(cmd),
    );
    expect(offenders).toEqual([]);
  });
});
