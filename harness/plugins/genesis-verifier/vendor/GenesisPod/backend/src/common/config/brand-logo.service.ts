import { Injectable, Logger } from "@nestjs/common";
import { APP_CONFIG } from "./app.config";
import * as fs from "fs";
import * as path from "path";

/**
 * Brand Logo Service
 * Provides centralized access to brand logo for backend rendering
 * (Puppeteer infographics, PDF generation, etc.)
 *
 * Supports both SVG and PNG logo files.
 * - SVG: returned as raw SVG string (inline-able in HTML)
 * - PNG/other: returned as `<img>` tag with base64 data URI
 */
@Injectable()
export class BrandLogoService {
  private readonly logger = new Logger(BrandLogoService.name);
  private cachedLogoHtml: string | null = null;

  /**
   * Get the brand logo as an HTML string suitable for embedding in Puppeteer templates.
   * For SVG files, returns raw SVG markup.
   * For PNG/other image files, returns an `<img>` tag with base64 data URI.
   */
  getLogoSvg(): string {
    if (this.cachedLogoHtml !== null) {
      return this.cachedLogoHtml;
    }

    const logoPath = APP_CONFIG.brand.logo.svgPath;
    try {
      const absolutePath = path.resolve(process.cwd(), logoPath);
      if (fs.existsSync(absolutePath)) {
        const ext = path.extname(absolutePath).toLowerCase();
        if (ext === ".svg") {
          this.cachedLogoHtml = fs.readFileSync(absolutePath, "utf-8");
        } else {
          // For PNG/JPG/other formats, create <img> with data URI
          const mimeType =
            ext === ".png"
              ? "image/png"
              : ext === ".jpg" || ext === ".jpeg"
                ? "image/jpeg"
                : "image/png";
          const base64 = fs.readFileSync(absolutePath).toString("base64");
          this.cachedLogoHtml = `<img src="data:${mimeType};base64,${base64}" style="width:100%;height:100%;object-fit:contain" />`;
        }
        this.logger.log(`Brand logo loaded from ${absolutePath}`);
        return this.cachedLogoHtml;
      }
    } catch (err) {
      this.logger.warn(
        `Failed to load brand logo from ${logoPath}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Fallback: try to find logo.png in the brand directory
    try {
      const fallbackPath = path.resolve(process.cwd(), "brand/logo.png");
      if (fs.existsSync(fallbackPath)) {
        const base64 = fs.readFileSync(fallbackPath).toString("base64");
        this.cachedLogoHtml = `<img src="data:image/png;base64,${base64}" style="width:100%;height:100%;object-fit:contain" />`;
        this.logger.log(`Brand logo loaded from fallback ${fallbackPath}`);
        return this.cachedLogoHtml;
      }
    } catch {
      // Ignore fallback errors
    }

    this.cachedLogoHtml = this.DEFAULT_LOGO;
    this.logger.log("Using default built-in brand logo");
    return this.cachedLogoHtml;
  }

  /**
   * Default fallback logo — Game-of-Life state-transition formula (wide).
   * f(n, s) → {0, 1}：邻居 n + 当前态 s → 下一态。
   * 矩形 130×32 让公式占满，editorial ink + amber 突出 {0,1}。
   */
  private readonly DEFAULT_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 130 26"><text x="65" y="20" text-anchor="middle" textLength="118" lengthAdjust="spacingAndGlyphs" font-family="Georgia, 'Times New Roman', serif" font-size="22" fill="#18181b"><tspan font-style="italic">f(n,s)</tspan> → {<tspan fill="#D97706" font-style="italic" font-weight="700">0,1</tspan>}</text></svg>`;

  /** Get brand name for watermarks and footers */
  getBrandName(): string {
    return APP_CONFIG.brand.name;
  }

  /** Get brand full name for watermarks and footers */
  getBrandFullName(): string {
    return APP_CONFIG.brand.fullName;
  }
}
