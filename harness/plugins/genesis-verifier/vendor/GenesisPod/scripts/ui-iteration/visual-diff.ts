/**
 * Visual Diff - compares screenshots against baselines
 */

import * as fs from "fs";
import * as path from "path";

// Both pixelmatch and pngjs are optional - graceful degradation if not installed
/* eslint-disable @typescript-eslint/no-var-requires */
let pixelmatch:
  | ((
      img1: Buffer,
      img2: Buffer,
      output: Buffer | null,
      width: number,
      height: number,
      options?: { threshold?: number },
    ) => number)
  | undefined;
let PNGLib:
  | {
      new (options: { width: number; height: number }): {
        data: Uint8Array;
        width: number;
        height: number;
      };
      sync: {
        read(buf: Buffer): { data: Uint8Array; width: number; height: number };
        write(png: { data: Uint8Array; width: number; height: number }): Buffer;
      };
    }
  | undefined;

try {
  pixelmatch = require("pixelmatch");
  PNGLib = require("pngjs").PNG;
} catch {
  // pixelmatch/pngjs not installed - visual diff disabled
}

export interface DiffResult {
  route: string;
  viewport: string;
  diffPercentage: number;
  classification: "identical" | "minor" | "major";
  diffImagePath?: string;
}

const BASELINE_DIR = ".ui-patrol/baselines";

/**
 * Compare a screenshot against its baseline
 */
export function compareWithBaseline(
  screenshotPath: string,
  route: string,
  viewport: string,
): DiffResult | undefined {
  if (!pixelmatch || !PNGLib) {
    console.warn(
      "pixelmatch/pngjs not installed. Run: npm install --save-dev pixelmatch pngjs",
    );
    return undefined;
  }

  const baselineName = `${route.replace(/\//g, "_").replace(/^_/, "")}_${viewport}.png`;
  const baselinePath = path.join(BASELINE_DIR, baselineName);

  if (!fs.existsSync(baselinePath)) {
    return undefined;
  }

  try {
    const img1 = PNGLib.sync.read(fs.readFileSync(baselinePath));
    const img2 = PNGLib.sync.read(fs.readFileSync(screenshotPath));

    // Handle different sizes
    const width = Math.min(img1.width, img2.width);
    const height = Math.min(img1.height, img2.height);

    if (width === 0 || height === 0) {
      return { route, viewport, diffPercentage: 100, classification: "major" };
    }

    // Crop to common size
    const cropped1 = cropPNG(img1, width, height);
    const cropped2 = cropPNG(img2, width, height);

    const diff = new PNGLib({ width, height });
    const numDiffPixels = pixelmatch(
      cropped1.data as unknown as Buffer,
      cropped2.data as unknown as Buffer,
      diff.data as unknown as Buffer,
      width,
      height,
      { threshold: 0.1 },
    );

    const totalPixels = width * height;
    const diffPercentage = (numDiffPixels / totalPixels) * 100;

    let classification: DiffResult["classification"];
    if (diffPercentage < 0.1) {
      classification = "identical";
    } else if (diffPercentage < 2) {
      classification = "minor";
    } else {
      classification = "major";
    }

    // Save diff image if there are differences
    let diffImagePath: string | undefined;
    if (classification !== "identical") {
      const diffDir = ".ui-patrol/diffs";
      fs.mkdirSync(diffDir, { recursive: true });
      diffImagePath = path.join(diffDir, baselineName);
      fs.writeFileSync(diffImagePath, PNGLib.sync.write(diff));
    }

    return { route, viewport, diffPercentage, classification, diffImagePath };
  } catch (error) {
    console.warn(
      `Visual diff failed for ${route} [${viewport}]:`,
      error instanceof Error ? error.message : error,
    );
    return undefined;
  }
}

function cropPNG(
  img: { data: Uint8Array; width: number; height: number },
  width: number,
  height: number,
): { data: Uint8Array; width: number; height: number } {
  if (img.width === width && img.height === height) {
    return img;
  }
  // PNGLib is guaranteed non-null when cropPNG is called (guarded in compareWithBaseline)
  const cropped = new PNGLib!({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (img.width * y + x) << 2;
      const dstIdx = (width * y + x) << 2;
      cropped.data[dstIdx] = img.data[srcIdx];
      cropped.data[dstIdx + 1] = img.data[srcIdx + 1];
      cropped.data[dstIdx + 2] = img.data[srcIdx + 2];
      cropped.data[dstIdx + 3] = img.data[srcIdx + 3];
    }
  }
  return cropped;
}

/**
 * Save current screenshots as baselines
 */
export function updateBaselines(screenshotDir: string): number {
  fs.mkdirSync(BASELINE_DIR, { recursive: true });

  const files = fs.readdirSync(screenshotDir).filter((f) => f.endsWith(".png"));
  for (const file of files) {
    fs.copyFileSync(
      path.join(screenshotDir, file),
      path.join(BASELINE_DIR, file),
    );
  }

  console.log(`Updated ${files.length} baselines`);
  return files.length;
}

/**
 * Mask dynamic content before comparison
 */
export async function maskDynamicContent(page: {
  evaluate: (fn: () => void) => Promise<void>;
}): Promise<void> {
  await page.evaluate(() => {
    // Mask timestamps
    document
      .querySelectorAll("[data-testid='timestamp'], time, [datetime]")
      .forEach((el) => {
        (el as HTMLElement).textContent = "2026-01-01";
      });
    // Mask avatars
    document
      .querySelectorAll("img[alt*='avatar'], img[alt*='Avatar']")
      .forEach((el) => {
        (el as HTMLImageElement).src =
          "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%23ccc'/%3E%3C/svg%3E";
      });
    // Mask random IDs in text
    document.querySelectorAll("[data-testid='id']").forEach((el) => {
      (el as HTMLElement).textContent = "xxx-xxx";
    });
  });
}
