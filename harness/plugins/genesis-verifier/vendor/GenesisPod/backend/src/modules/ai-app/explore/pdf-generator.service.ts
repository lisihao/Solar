import { Injectable, Logger } from "@nestjs/common";
import { PuppeteerPoolService } from "../../../common/browser/puppeteer-pool.service";
import type { TranscriptSegment } from "@/modules/ai-harness/facade";
import { Readable } from "stream";

export interface SubtitleExportOptions {
  format:
    | "bilingual-side"
    | "bilingual-stack"
    | "english-only"
    | "chinese-only";
  includeTimestamps: boolean;
  includeVideoUrl: boolean;
  includeMetadata: boolean;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  url: string;
  exportDate: Date;
}

export interface BilingualTranscript {
  english: TranscriptSegment[];
  chinese: TranscriptSegment[];
}

@Injectable()
export class PdfGeneratorService {
  private readonly logger = new Logger(PdfGeneratorService.name);

  constructor(private readonly browserPool: PuppeteerPoolService) {}

  /**
   * Generate PDF from subtitles using Puppeteer
   * @param transcript Bilingual transcript data
   * @param metadata Video metadata
   * @param options Export options
   * @returns PDF document stream
   */
  async generatePdf(
    transcript: BilingualTranscript,
    metadata: VideoMetadata,
    options: SubtitleExportOptions,
  ): Promise<Readable> {
    this.logger.log(`Generating PDF for video: ${metadata.videoId}`);

    const html = this.generateHtml(transcript, metadata, options);
    const pdfBuffer = await this.renderPdfFromHtml(html);

    // Convert buffer to stream
    const stream = new Readable();
    stream.push(pdfBuffer);
    stream.push(null);

    return stream;
  }

  /**
   * Generate HTML for PDF rendering
   */
  private generateHtml(
    transcript: BilingualTranscript,
    metadata: VideoMetadata,
    options: SubtitleExportOptions,
  ): string {
    const styles = this.getCssStyles();
    const contentHtml = this.generateContent(transcript, options);
    const metadataHtml = options.includeMetadata
      ? this.generateMetadata(metadata, options.includeVideoUrl)
      : "";

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>${styles}</style>
      </head>
      <body>
        ${metadataHtml}
        ${contentHtml}
      </body>
      </html>
    `;
  }

  /**
   * Get CSS styles for PDF
   */
  private getCssStyles(): string {
    return `
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
        line-height: 1.6;
        color: #333;
        padding: 50px;
      }

      .metadata {
        border-bottom: 2px solid #ccc;
        margin-bottom: 30px;
        padding-bottom: 20px;
        text-align: center;
      }

      .metadata h1 {
        font-size: 24px;
        margin-bottom: 10px;
        word-break: break-word;
      }

      .metadata a {
        color: #0066cc;
        text-decoration: none;
        font-size: 12px;
      }

      .metadata a:hover {
        text-decoration: underline;
      }

      .metadata .export-info {
        font-size: 11px;
        color: #666;
        margin-top: 10px;
        font-style: italic;
      }

      .content-section {
        margin-bottom: 40px;
      }

      .section-title {
        font-size: 16px;
        font-weight: bold;
        margin-bottom: 20px;
        text-align: center;
      }

      .transcript-container {
        display: flex;
        gap: 20px;
      }

      .transcript-column {
        flex: 1;
      }

      .column-header {
        font-size: 12px;
        font-weight: bold;
        margin-bottom: 15px;
        padding-bottom: 10px;
        border-bottom: 1px solid #ddd;
      }

      .segment {
        margin-bottom: 15px;
        page-break-inside: avoid;
      }

      .timestamp {
        font-size: 10px;
        color: #999;
        display: block;
        margin-bottom: 3px;
      }

      .text {
        font-size: 11px;
        line-height: 1.5;
        color: #333;
      }

      /* Row-aligned bilingual table: each pair occupies the same row,
         English and Chinese stay horizontally synchronized regardless of
         per-segment length differences. */
      .bilingual-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .bilingual-table thead th {
        font-size: 12px;
        font-weight: bold;
        text-align: left;
        padding: 0 10px 10px 10px;
        border-bottom: 1px solid #ddd;
        background: #fafafa;
      }

      .bilingual-table td {
        padding: 10px;
        vertical-align: top;
        border-bottom: 1px solid #f0f0f0;
        page-break-inside: avoid;
      }

      .bilingual-table tr:nth-child(even) td {
        background: #fcfcfd;
      }

      .bilingual-table .col-timestamp {
        width: 60px;
        font-size: 10px;
        color: #888;
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        white-space: nowrap;
      }

      .bilingual-table .col-en,
      .bilingual-table .col-zh {
        font-size: 11px;
        line-height: 1.6;
        color: #333;
        word-break: break-word;
      }

      .stacked .segment {
        margin-bottom: 20px;
      }

      .stacked .timestamp {
        font-weight: bold;
      }

      .stacked .segment-label {
        font-size: 10px;
        font-weight: bold;
        margin-top: 5px;
        color: #666;
      }

      .stacked .english {
        color: #000;
      }

      .stacked .chinese {
        color: #333;
      }

      .single-language {
        max-width: 800px;
        margin: 0 auto;
      }

      .single-language .segment {
        margin-bottom: 12px;
      }

      @media print {
        body {
          padding: 20px;
        }

        .page-break {
          page-break-after: always;
        }
      }
    `;
  }

  /**
   * Generate metadata HTML
   */
  private generateMetadata(
    metadata: VideoMetadata,
    includeUrl: boolean,
  ): string {
    const exportDate = metadata.exportDate.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });

    return `
      <div class="metadata">
        <h1>${this.escapeHtml(metadata.title)}</h1>
        ${
          includeUrl
            ? `<a href="${metadata.url}" target="_blank">${metadata.url}</a>`
            : ""
        }
        <div class="export-info">
          导出时间: ${exportDate}
          <br>
          视频 ID: ${metadata.videoId}
        </div>
      </div>
    `;
  }

  /**
   * Generate content HTML based on format
   */
  private generateContent(
    transcript: BilingualTranscript,
    options: SubtitleExportOptions,
  ): string {
    switch (options.format) {
      case "bilingual-side":
        return this.generateBilingualSideBySide(
          transcript,
          options.includeTimestamps,
        );
      case "bilingual-stack":
        return this.generateBilingualStacked(
          transcript,
          options.includeTimestamps,
        );
      case "english-only":
        return this.generateSingleLanguage(
          transcript.english,
          "EN",
          options.includeTimestamps,
        );
      case "chinese-only":
        return this.generateSingleLanguage(
          transcript.chinese,
          "CN",
          options.includeTimestamps,
        );
      default:
        return "";
    }
  }

  /**
   * Generate bilingual side-by-side HTML.
   *
   * Uses a fixed-layout table so each English/Chinese pair occupies the same
   * row and stays horizontally aligned even when per-segment text lengths
   * differ significantly between the two languages.
   */
  private generateBilingualSideBySide(
    transcript: BilingualTranscript,
    includeTimestamps: boolean,
  ): string {
    const maxLength = Math.max(
      transcript.english.length,
      transcript.chinese.length,
    );

    let content = `<div class="content-section"><div class="section-title">双语字幕</div>`;
    content += `<table class="bilingual-table">`;
    content += `<thead><tr>`;
    if (includeTimestamps) {
      content += `<th class="col-timestamp">时间</th>`;
    }
    content += `<th class="col-en">英文</th>`;
    content += `<th class="col-zh">中文</th>`;
    content += `</tr></thead><tbody>`;

    for (let i = 0; i < maxLength; i++) {
      const english = transcript.english[i];
      const chinese = transcript.chinese[i];
      if (!english && !chinese) continue;

      const timestampSource = english?.start ?? chinese?.start ?? 0;

      content += `<tr>`;
      if (includeTimestamps) {
        content += `<td class="col-timestamp">${this.formatTimestamp(timestampSource)}</td>`;
      }
      content += `<td class="col-en">${this.escapeHtml(english?.text ?? "")}</td>`;
      content += `<td class="col-zh">${this.escapeHtml(chinese?.text ?? "")}</td>`;
      content += `</tr>`;
    }

    content += `</tbody></table></div>`;
    return content;
  }

  /**
   * Generate bilingual stacked HTML
   */
  private generateBilingualStacked(
    transcript: BilingualTranscript,
    includeTimestamps: boolean,
  ): string {
    const maxLength = Math.max(
      transcript.english.length,
      transcript.chinese.length,
    );

    let content = `<div class="content-section stacked"><div class="section-title">双语字幕</div>`;

    for (let i = 0; i < maxLength; i++) {
      const english = transcript.english[i];
      const chinese = transcript.chinese[i];

      if (english || chinese) {
        const timestamp = english ? english.start : chinese.start;
        content += `<div class="segment">`;

        if (includeTimestamps) {
          content += `<span class="timestamp">${this.formatTimestamp(timestamp)}</span>`;
        }

        if (english) {
          content += `<div class="text english">英: ${this.escapeHtml(english.text)}</div>`;
        }

        if (chinese) {
          content += `<div class="text chinese">中: ${this.escapeHtml(chinese.text)}</div>`;
        }

        content += `</div>`;
      }
    }

    content += `</div>`;
    return content;
  }

  /**
   * Generate single language HTML
   */
  private generateSingleLanguage(
    segments: TranscriptSegment[],
    language: string,
    includeTimestamps: boolean,
  ): string {
    const langLabel = language === "EN" ? "英文字幕" : "中文字幕";
    let content = `<div class="content-section single-language"><div class="section-title">${langLabel}</div>`;

    for (const segment of segments) {
      content += `<div class="segment">`;
      if (includeTimestamps) {
        content += `<span class="timestamp">${this.formatTimestamp(segment.start)}</span>`;
      }
      content += `<div class="text">${this.escapeHtml(segment.text)}</div>`;
      content += `</div>`;
    }

    content += `</div>`;
    return content;
  }

  /**
   * Render HTML to PDF using Puppeteer
   */
  private async renderPdfFromHtml(html: string): Promise<Buffer> {
    const browser = await this.browserPool.getBrowser();
    const page = await browser.newPage();

    try {
      await page.setContent(html, { waitUntil: "load" });

      const pdfBuffer = await page.pdf({
        format: "A4",
        margin: { top: 0, bottom: 0, left: 0, right: 0 },
        printBackground: true,
      });

      return Buffer.from(pdfBuffer);
    } finally {
      await page.close();
    }
  }

  /**
   * Format timestamp in HH:MM:SS format
   */
  private formatTimestamp(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `[${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}]`;
    }
    return `[${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}]`;
  }

  /**
   * Escape HTML special characters
   */
  private escapeHtml(text: string): string {
    const map: { [key: string]: string } = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return text.replace(/[&<>"']/g, (char) => map[char]);
  }

  /**
   * Align bilingual transcripts by timestamp
   * @param english English transcript segments
   * @param chinese Chinese transcript segments
   * @returns Aligned bilingual transcript
   */
  alignTranscripts(
    english: TranscriptSegment[],
    chinese: TranscriptSegment[],
  ): BilingualTranscript {
    this.logger.log(
      `Aligning transcripts: EN=${english.length}, ZH=${chinese.length}`,
    );

    // Simple alignment based on timestamps
    const aligned: BilingualTranscript = {
      english: [],
      chinese: [],
    };

    let enIndex = 0;
    let zhIndex = 0;

    while (enIndex < english.length || zhIndex < chinese.length) {
      const enSeg = english[enIndex];
      const zhSeg = chinese[zhIndex];

      if (!enSeg && zhSeg) {
        // Only Chinese left
        aligned.english.push({
          text: "",
          start: zhSeg.start,
          duration: zhSeg.duration,
        });
        aligned.chinese.push(zhSeg);
        zhIndex++;
      } else if (enSeg && !zhSeg) {
        // Only English left
        aligned.english.push(enSeg);
        aligned.chinese.push({
          text: "",
          start: enSeg.start,
          duration: enSeg.duration,
        });
        enIndex++;
      } else if (enSeg && zhSeg) {
        // Both available - align by closest timestamp
        const timeDiff = Math.abs(enSeg.start - zhSeg.start);

        if (timeDiff < 1.0) {
          // Close enough - pair them
          aligned.english.push(enSeg);
          aligned.chinese.push(zhSeg);
          enIndex++;
          zhIndex++;
        } else if (enSeg.start < zhSeg.start) {
          // English comes first
          aligned.english.push(enSeg);
          aligned.chinese.push({
            text: "",
            start: enSeg.start,
            duration: enSeg.duration,
          });
          enIndex++;
        } else {
          // Chinese comes first
          aligned.english.push({
            text: "",
            start: zhSeg.start,
            duration: zhSeg.duration,
          });
          aligned.chinese.push(zhSeg);
          zhIndex++;
        }
      }
    }

    this.logger.log(`Alignment complete: ${aligned.english.length} pairs`);
    return aligned;
  }
}
