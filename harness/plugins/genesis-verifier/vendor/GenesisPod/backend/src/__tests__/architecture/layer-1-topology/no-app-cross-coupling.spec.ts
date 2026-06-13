/**
 * Architecture guard (P17a, 2026-05-24): prevent ai-app modules from naming
 * subdirectories after another app's domain — e.g. `ai-app/research/social-
 * data-source/` encoded "research serves social", coupling 7 apps to social.
 * Generic exposure must go through `integrations/<own-app>-content-source.
 * provider.ts` implementing the engine ContentSource contract.
 */

import * as fs from "fs";
import * as path from "path";

const AI_APP_ROOT = path.resolve(__dirname, "../../../modules/ai-app");
const APP_DOMAINS = [
  "research",
  "social",
  "library",
  "writing",
  "office",
  "explore",
  "ask",
  "image",
  "insight",
  "playground",
];

function walkDirs(root: string, out: { full: string; name: string }[] = []) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (["__tests__", "node_modules", "dist"].includes(e.name)) continue;
    const full = path.join(root, e.name);
    out.push({ full, name: e.name });
    walkDirs(full, out);
  }
  return out;
}

describe("no-app-cross-coupling (P17a)", () => {
  it("ai-app/<X>/ must not contain a `<other>-data-source` / `<other>-source` subdir", () => {
    const apps = fs.existsSync(AI_APP_ROOT)
      ? fs
          .readdirSync(AI_APP_ROOT, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name)
      : [];
    const violations: string[] = [];
    for (const app of apps) {
      for (const sub of walkDirs(path.join(AI_APP_ROOT, app))) {
        for (const other of APP_DOMAINS) {
          if (other === app) continue;
          if (
            sub.name === `${other}-data-source` ||
            sub.name === `${other}-source`
          ) {
            violations.push(
              path.relative(AI_APP_ROOT, sub.full).replace(/\\/g, "/"),
            );
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
