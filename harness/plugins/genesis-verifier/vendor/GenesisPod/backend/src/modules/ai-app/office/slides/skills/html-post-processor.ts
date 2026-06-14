/**
 * Slides Engine v6.0 - HTML Post-Processor
 *
 * 轻量级后处理工具函数（非 Skill）：
 * 1. 验证 HTML 包含 .slide-container 1280x720 容器
 * 2. 注入溢出保护 CSS
 * 3. 确保 CDN 资源存在（Google Fonts, Font Awesome）
 * 4. 清理 AI 可能产生的 markdown 残留
 * 5. 图片 URL 无效时替换为占位符
 */

import { CDN_RESOURCES } from "../checkpoint/checkpoint.types";

/**
 * Google Fonts CDN: Montserrat + Noto Sans SC
 * Extends CDN_RESOURCES.notoSansSC with Montserrat for slide design system
 */
const GOOGLE_FONTS_CDN =
  "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&family=Noto+Sans+SC:wght@300;400;500;700;900&display=swap";
const FONT_AWESOME_CDN = CDN_RESOURCES.fontAwesome;

interface PostProcessOptions {
  slideIndex: number;
  totalSlides: number;
}

/**
 * 后处理 AI 生成的 HTML
 */
export function postProcessSlideHtml(
  html: string,
  options: PostProcessOptions,
): string {
  let processed = html;

  // 1. Clean markdown residuals
  processed = cleanMarkdownResiduals(processed);

  // 2. Ensure CDN resources
  processed = ensureCdnResources(processed);

  // 3. Inject overflow protection
  processed = injectOverflowProtection(processed);

  // 4. Validate and fix slide-container
  processed = validateSlideContainer(processed);

  // 5. Ensure page number exists
  processed = ensurePageNumber(
    processed,
    options.slideIndex,
    options.totalSlides,
  );

  return processed;
}

/**
 * 清理 markdown 残留（```html 标记等）
 * 只清理首尾的 markdown 代码块标记，不破坏 HTML 内部内容
 */
function cleanMarkdownResiduals(html: string): string {
  // Only remove leading ```html and trailing ``` markers
  // Do NOT remove internal ``` to avoid breaking code content in slides
  return html
    .replace(/^```html\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

/**
 * 确保 CDN 资源链接存在
 */
function ensureCdnResources(html: string): string {
  let result = html;

  // Check for Google Fonts
  if (!result.includes("fonts.googleapis.com")) {
    const headEnd = result.indexOf("</head>");
    if (headEnd > -1) {
      result =
        result.substring(0, headEnd) +
        `  <link href="${GOOGLE_FONTS_CDN}" rel="stylesheet">\n` +
        result.substring(headEnd);
    }
  }

  // Check for Font Awesome
  if (!result.includes("fontawesome") && !result.includes("font-awesome")) {
    const headEnd = result.indexOf("</head>");
    if (headEnd > -1) {
      result =
        result.substring(0, headEnd) +
        `  <link href="${FONT_AWESOME_CDN}" rel="stylesheet">\n` +
        result.substring(headEnd);
    }
  }

  return result;
}

/**
 * 注入溢出保护样式
 * 使用 <style> in <head> 作为全局保护，不影响 AI 的 inline styles
 */
function injectOverflowProtection(html: string): string {
  const protectionCss = `<style>
  .slide-container { overflow: hidden !important; }
  .slide-container * { max-width: 100%; box-sizing: border-box; }
  .slide-container img { max-width: 100%; height: auto; }
  .slide-container h1, .slide-container h2, .slide-container h3 {
    overflow: hidden;
    text-overflow: ellipsis;
    word-wrap: break-word;
  }
</style>`;

  const headEnd = html.indexOf("</head>");
  if (headEnd > -1) {
    return (
      html.substring(0, headEnd) +
      protectionCss +
      "\n" +
      html.substring(headEnd)
    );
  }

  // If no </head> tag, prepend before <body> or at start
  const bodyStart = html.indexOf("<body");
  if (bodyStart > -1) {
    return (
      html.substring(0, bodyStart) +
      protectionCss +
      "\n" +
      html.substring(bodyStart)
    );
  }

  return protectionCss + "\n" + html;
}

/**
 * 验证 slide-container 存在且有正确尺寸
 */
function validateSlideContainer(html: string): string {
  // Check if slide-container exists
  if (!html.includes("slide-container")) {
    // Wrap the body content in a slide-container
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    if (bodyMatch) {
      const bodyContent = bodyMatch[1];
      const wrappedContent = `<div class="slide-container" style="width:1280px;height:720px;overflow:hidden;position:relative;font-family:'Montserrat','Noto Sans SC',sans-serif;box-sizing:border-box;">${bodyContent}</div>`;
      return html.replace(bodyMatch[1], wrappedContent);
    }
  }

  // Ensure width and height are set on slide-container
  const containerMatch = html.match(
    /(<div[^>]*class="slide-container"[^>]*style=")([^"]*)/i,
  );
  if (containerMatch) {
    let style = containerMatch[2];
    if (!style.includes("width")) {
      style += "width:1280px;";
    }
    if (!style.includes("height")) {
      style += "height:720px;";
    }
    if (!style.includes("overflow")) {
      style += "overflow:hidden;";
    }
    return html.replace(containerMatch[2], style);
  }

  return html;
}

/**
 * 确保页码存在
 */
function ensurePageNumber(
  html: string,
  slideIndex: number,
  totalSlides: number,
): string {
  const pageNumberText = `${slideIndex + 1} / ${totalSlides}`;

  // Check if page number already exists in a positioned element (bottom area)
  // Use a stricter pattern to avoid false positives from data content
  const pageNumPattern = new RegExp(
    `position\\s*:\\s*absolute[^>]*bottom[^>]*${slideIndex + 1}\\s*/\\s*${totalSlides}`,
  );
  if (pageNumPattern.test(html)) {
    return html;
  }

  // Insert page number before closing </div> of slide-container
  const pageNumberHtml = `<div style="position:absolute;bottom:20px;right:40px;font-size:12px;color:#94A3B8;font-family:'Montserrat',sans-serif;">${pageNumberText}</div>`;

  // Find the last closing </div> before </body>
  const bodyEnd = html.indexOf("</body>");
  if (bodyEnd > -1) {
    // Find the slide-container's closing div
    const beforeBody = html.substring(0, bodyEnd);
    const lastDivClose = beforeBody.lastIndexOf("</div>");
    if (lastDivClose > -1) {
      return (
        html.substring(0, lastDivClose) +
        pageNumberHtml +
        html.substring(lastDivClose)
      );
    }
  }

  return html;
}
