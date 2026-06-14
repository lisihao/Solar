/**
 * Spec Loader - loads .ui-patrol/specs/*.spec.yaml page specifications
 */

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

export interface PageSpecStructure {
  /** Description of expected element */
  description: string;
  /** CSS selector or heading text to look for */
  selector?: string;
  /** Text content to match */
  text?: string;
}

export interface PageSpec {
  route: string;
  expected_structure: PageSpecStructure[];
  i18n_assertions: string[];
  forbidden: string[];
  quality: {
    max_load_time?: number;
    min_dom_nodes?: number;
  };
}

const SPECS_DIR = ".ui-patrol/specs";

/**
 * Load all page specs from the specs directory
 */
export function loadAllSpecs(): Map<string, PageSpec> {
  const specsMap = new Map<string, PageSpec>();
  const specsDir = path.resolve(SPECS_DIR);

  if (!fs.existsSync(specsDir)) {
    return specsMap;
  }

  const files = fs
    .readdirSync(specsDir)
    .filter((f) => f.endsWith(".spec.yaml"));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(specsDir, file), "utf-8");
      const spec = yaml.load(content) as PageSpec;

      if (spec && spec.route) {
        specsMap.set(spec.route, spec);
      }
    } catch (error) {
      console.warn(
        `Failed to load spec ${file}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return specsMap;
}

/**
 * Find the spec matching a given route URL path
 */
export function findSpecForRoute(
  route: string,
  specs: Map<string, PageSpec>,
): PageSpec | undefined {
  // Exact match
  if (specs.has(route)) {
    return specs.get(route);
  }

  // Try matching by route prefix (e.g. /ai-research/topic/xxx -> /ai-research)
  for (const [specRoute, spec] of Array.from(specs)) {
    if (route.startsWith(specRoute + "/")) {
      return spec;
    }
  }

  return undefined;
}
