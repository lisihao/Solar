/**
 * HTML Capture Service
 * 从 DOM 中提取渲染后的 HTML + CSS，用于 WYSIWYG 导出
 */

export interface CaptureOptions {
  /** 内联关键 CSS 以确保 Puppeteer 渲染一致 */
  inlineStyles?: boolean;
  /** 冻结交互式图表为静态 SVG */
  freezeCharts?: boolean;
  /** 等待并冻结 Mermaid 图 */
  freezeMermaid?: boolean;
  /** 将 <img> 和 CSS background-image URL 转为 data: URL，避免 Puppeteer 请求拦截导致图片缺失 */
  inlineImages?: boolean;
  /**
   * 导出文档标题（原文 topic）。提供时在抓取内容顶部插入一个 <h1>。
   * 报告标题通常只在页面 header 渲染、不在 data-export-content 内，导出成品
   * 因此无标题；由公共抓取层统一补，所有走 ExportDialog 的 App 都受益。
   */
  documentTitle?: string;
  /** 最大等待时间 (ms) */
  timeout?: number;
}

export interface CaptureResult {
  html: string;
  css: string;
}

export class HtmlCaptureService {
  /**
   * 主入口：捕获容器的 HTML + 所有相关 CSS
   */
  static async capture(
    containerSelector: string,
    options: CaptureOptions = {}
  ): Promise<CaptureResult> {
    const {
      inlineStyles = true,
      freezeCharts = true,
      freezeMermaid = true,
      inlineImages = true,
      documentTitle,
      timeout = 5000,
    } = options;

    const container = document.querySelector(containerSelector);
    if (!container) {
      throw new Error(`Container not found: ${containerSelector}`);
    }

    // 克隆以避免修改 live DOM
    const clone = container.cloneNode(true) as HTMLElement;

    // 处理交互式图表
    if (freezeCharts) {
      HtmlCaptureService.freezeRechartsElements(
        container as HTMLElement,
        clone
      );
    }

    // 处理 Mermaid 图
    if (freezeMermaid) {
      await HtmlCaptureService.captureMermaid(
        container as HTMLElement,
        clone,
        timeout
      );
    }

    // ★ 将 <img> 转为 data: URL（Puppeteer 会拦截所有非 data: 外部请求，导致图片缺失）
    if (inlineImages) {
      await HtmlCaptureService.inlineImagesAsDataUrls(
        container as HTMLElement,
        clone
      );
    }

    // 内联关键样式
    if (inlineStyles) {
      HtmlCaptureService.inlineCriticalStyles(container as HTMLElement, clone);
    }

    // 移除导出排除元素和交互元素
    HtmlCaptureService.removeExportExcluded(clone);
    HtmlCaptureService.removeInteractivity(clone);

    // 使 sr-only 数据表格在导出中可见（图表的无障碍回退）
    HtmlCaptureService.revealSrOnlyTables(clone);

    // ★ v4.3: 为标题添加 ID 锚点（支持 TOC 跳转）
    HtmlCaptureService.addHeadingAnchors(clone);

    // ★ 2026-05-25：导出顶部补报告标题（原文 topic）。在所有"按 index 对齐
    //   original/clone"的处理（inlineImages / inlineCriticalStyles）之后插入，
    //   避免给 clone 多塞一个元素打乱下标映射。用内联样式确保即使 CSS 抽取漏掉
    //   也能正确呈现。仅导出时插入，不影响 live 视图。
    if (documentTitle && documentTitle.trim()) {
      HtmlCaptureService.prependDocumentTitle(clone, documentTitle.trim());
    }

    // 提取 CSS (filtered by selectors used in container)
    let css = HtmlCaptureService.extractStyles(container as HTMLElement);

    // ★ v4.3: 去重 CSS 规则，减少导出文件体积
    css = HtmlCaptureService.deduplicateCss(css);

    return {
      html: clone.outerHTML,
      css,
    };
  }

  /**
   * 提取页面上影响容器内容的样式表（基于选择器过滤）
   */
  private static extractStyles(container: HTMLElement): string {
    const styles: string[] = [];

    // 收集容器中使用的选择器信息
    const elements = container.querySelectorAll('*');
    const usedClasses = new Set<string>();
    const usedTags = new Set<string>();
    const usedIds = new Set<string>();

    for (const el of Array.from(elements)) {
      usedTags.add(el.tagName.toLowerCase());
      el.classList.forEach((cls) => usedClasses.add(cls));
      if (el.id) usedIds.add(el.id);
    }
    // Also add the container itself
    usedTags.add(container.tagName.toLowerCase());
    container.classList.forEach((cls) => usedClasses.add(cls));
    if (container.id) usedIds.add(container.id);

    try {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          // 跳过跨域样式表
          if (sheet.href && !sheet.href.startsWith(window.location.origin)) {
            continue;
          }

          const rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;

          for (const rule of Array.from(rules)) {
            if (rule instanceof CSSStyleRule) {
              // 快速启发式：检查选择器是否可能匹配容器中的元素
              if (
                this.selectorMightMatch(
                  rule.selectorText,
                  usedClasses,
                  usedTags,
                  usedIds
                )
              ) {
                styles.push(rule.cssText);
              }
            } else if (rule instanceof CSSMediaRule) {
              // @media: 只保留内部有匹配规则的 media query
              const matchedInner: string[] = [];
              for (const inner of Array.from(rule.cssRules)) {
                if (
                  inner instanceof CSSStyleRule &&
                  this.selectorMightMatch(
                    inner.selectorText,
                    usedClasses,
                    usedTags,
                    usedIds
                  )
                ) {
                  matchedInner.push(inner.cssText);
                }
              }
              if (matchedInner.length > 0) {
                styles.push(
                  `@media ${rule.conditionText} { ${matchedInner.join(' ')} }`
                );
              }
            } else if (rule instanceof CSSKeyframesRule) {
              // @keyframes: 只保留容器中实际使用的动画
              const animName = rule.name;
              const isUsed = Array.from(elements).some((el) => {
                const computed = window.getComputedStyle(el);
                return computed.animationName.includes(animName);
              });
              if (isUsed) {
                styles.push(rule.cssText);
              }
            } else if (rule instanceof CSSFontFaceRule) {
              // @font-face: 只保留容器中实际使用的字体
              const fontFamily = rule.style
                .getPropertyValue('font-family')
                .replace(/['"]/g, '')
                .trim();
              if (fontFamily) {
                const isUsed = Array.from(elements).some((el) => {
                  const computed = window.getComputedStyle(el);
                  return computed.fontFamily.includes(fontFamily);
                });
                if (isUsed) {
                  styles.push(rule.cssText);
                }
              }
            }
            // 其他 at-rules（@layer, @supports 等）跳过以减少体积
          }
        } catch {
          // 跨域样式表无法访问 cssRules，跳过
        }
      }
    } catch {
      // 降级：收集 <style> 标签内容
      const styleTags = document.querySelectorAll('style');
      for (const tag of Array.from(styleTags)) {
        styles.push(tag.textContent || '');
      }
    }

    return styles.join('\n');
  }

  /**
   * 启发式判断 CSS 选择器是否可能匹配容器中的元素
   */
  private static selectorMightMatch(
    selector: string,
    usedClasses: Set<string>,
    usedTags: Set<string>,
    usedIds: Set<string>
  ): boolean {
    // Universal selector: always include (e.g. * { box-sizing: border-box })
    if (selector === '*') {
      return true;
    }

    // Skip html/body/:root rules — they pollute export with app-level gradients
    // (e.g. globals.css body { background: linear-gradient(...) }).
    // The export wrapper provides its own clean white background.
    if (
      selector.startsWith(':root') ||
      selector.startsWith('html') ||
      selector.startsWith('body')
    ) {
      return false;
    }

    // 检查类名匹配
    const classMatches = selector.match(/\.([a-zA-Z0-9_-]+)/g);
    if (classMatches) {
      return classMatches.some((cls) => usedClasses.has(cls.slice(1)));
    }

    // 检查 ID 匹配
    const idMatches = selector.match(/#([a-zA-Z0-9_-]+)/g);
    if (idMatches) {
      return idMatches.some((id) => usedIds.has(id.slice(1)));
    }

    // 检查标签名匹配
    const tagMatch = selector.match(/^([a-zA-Z][a-zA-Z0-9]*)/);
    if (tagMatch) {
      return usedTags.has(tagMatch[1].toLowerCase());
    }

    // 无法确定的情况下保留
    return true;
  }

  /**
   * 冻结 Recharts 交互式图表为静态 SVG
   * Recharts 使用 SVG 渲染，但包含事件监听器和动画元素
   */
  private static freezeRechartsElements(
    original: HTMLElement,
    clone: HTMLElement
  ): void {
    // 查找原始 DOM 中的 recharts 容器
    const originalCharts = original.querySelectorAll('.recharts-wrapper');
    const cloneCharts = clone.querySelectorAll('.recharts-wrapper');

    for (let i = 0; i < originalCharts.length; i++) {
      const origChart = originalCharts[i];
      const cloneChart = cloneCharts[i];
      if (!origChart || !cloneChart) continue;

      // 从原始获取渲染后的 SVG（包含正确的尺寸和位置）
      const origSvg = origChart.querySelector('svg');
      if (!origSvg || origSvg.children.length < 3) {
        // ★ Empty SVG fallback: if container was not visible (hidden tab/panel),
        // the SVG may be empty. Show the sr-only data table instead.
        const srTable = cloneChart.querySelector('.sr-only');
        if (srTable) {
          (srTable as HTMLElement).classList.remove('sr-only');
          (srTable as HTMLElement).style.display = 'block';
        }
        continue;
      }

      // 克隆 SVG
      const svgClone = origSvg.cloneNode(true) as SVGElement;

      // ★ 确保 SVG 有明确的宽高（Recharts 使用 ResponsiveContainer 动态计算尺寸）
      const svgRect = origSvg.getBoundingClientRect();
      if (svgRect.width > 0 && svgRect.height > 0) {
        svgClone.setAttribute('width', `${svgRect.width}`);
        svgClone.setAttribute('height', `${svgRect.height}`);
        svgClone.style.width = `${svgRect.width}px`;
        svgClone.style.height = `${svgRect.height}px`;
      }

      // 移除 Recharts 特有的交互层
      const interactiveElements = svgClone.querySelectorAll(
        '.recharts-tooltip-wrapper, .recharts-active-dot, [class*="cursor"]'
      );
      for (const el of Array.from(interactiveElements)) {
        el.remove();
      }

      // 移除事件监听属性
      const allElements = svgClone.querySelectorAll('*');
      for (const el of Array.from(allElements)) {
        for (const attr of Array.from(el.attributes)) {
          if (attr.name.startsWith('on')) {
            el.removeAttribute(attr.name);
          }
        }
      }

      // 替换克隆中的 chart
      cloneChart.innerHTML = '';
      cloneChart.appendChild(svgClone);
    }
  }

  /**
   * ★ 将 clone 中所有 <img> 的 src 转为 data: URL
   *
   * Puppeteer 在渲染 WYSIWYG HTML 时会拦截所有非 data:/fonts.googleapis 请求。
   * 若图片使用外部 URL（包括 /_next/image?url=... 相对路径），会直接显示为破图。
   * 在前端 fetch 并转换为 base64 data URL，Puppeteer 就能直接内联渲染。
   */
  private static async inlineImagesAsDataUrls(
    container: HTMLElement,
    clone: HTMLElement
  ): Promise<void> {
    const liveImgs = Array.from(
      container.querySelectorAll<HTMLImageElement>('img')
    );
    const cloneImgs = Array.from(
      clone.querySelectorAll<HTMLImageElement>('img')
    );

    await Promise.allSettled(
      cloneImgs.map(async (cloneImg, i) => {
        const liveImg = liveImgs[i];
        // Prefer currentSrc (the actually-loaded URL, e.g. after srcset resolution)
        const src =
          liveImg?.currentSrc ||
          liveImg?.src ||
          cloneImg.getAttribute('src') ||
          '';
        if (!src || src.startsWith('data:') || src.startsWith('blob:')) return;

        try {
          const response = await fetch(src);
          if (!response.ok) return;
          const blob = await response.blob();
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          cloneImg.src = dataUrl;
          cloneImg.removeAttribute('srcset'); // srcset would override src in Puppeteer
          cloneImg.removeAttribute('data-src'); // lazy-load attrs
        } catch {
          // Keep original src; export degrades gracefully
        }

        // If cloneImg src is still a tiny placeholder, try canvas-based capture
        if (
          cloneImg.src.startsWith('data:') &&
          cloneImg.src.length < 3000 &&
          liveImg?.naturalWidth > 100
        ) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = liveImg.naturalWidth;
            canvas.height = liveImg.naturalHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(liveImg, 0, 0);
              cloneImg.src = canvas.toDataURL('image/png');
              cloneImg.removeAttribute('srcset');
            }
          } catch {
            // CORS or tainted canvas — keep placeholder
          }
        }
      })
    );
  }

  /**
   * 捕获 Mermaid 图表（它们可能是异步渲染的）
   */
  private static async captureMermaid(
    original: HTMLElement,
    clone: HTMLElement,
    timeout: number
  ): Promise<void> {
    const mermaidContainers = original.querySelectorAll(
      '[data-mermaid], .mermaid, pre code.language-mermaid'
    );
    if (mermaidContainers.length === 0) return;

    // 等待 Mermaid SVG 渲染完成
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const svgs = original.querySelectorAll(
        '.mermaid svg, [data-mermaid] svg'
      );
      if (svgs.length >= mermaidContainers.length) break;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // 将渲染后的 SVG 复制到克隆中
    const originalMermaids = original.querySelectorAll(
      '.mermaid, [data-mermaid]'
    );
    const cloneMermaids = clone.querySelectorAll('.mermaid, [data-mermaid]');

    for (let i = 0; i < originalMermaids.length; i++) {
      const origEl = originalMermaids[i];
      const cloneEl = cloneMermaids[i];
      if (!origEl || !cloneEl) continue;

      const svg = origEl.querySelector('svg');
      if (svg) {
        const svgClone = svg.cloneNode(true) as SVGElement;
        // 确保 SVG 有明确的尺寸
        if (!svgClone.getAttribute('width')) {
          const rect = svg.getBoundingClientRect();
          svgClone.setAttribute('width', `${rect.width}`);
          svgClone.setAttribute('height', `${rect.height}`);
        }
        cloneEl.innerHTML = '';
        cloneEl.appendChild(svgClone);
      }
    }
  }

  /**
   * 内联关键计算样式
   * 确保即使没有原始样式表，渲染也能匹配
   */
  private static inlineCriticalStyles(
    original: HTMLElement,
    clone: HTMLElement
  ): void {
    // 需要保留计算样式的关键属性
    const criticalProps = [
      'color',
      'background-color',
      'font-size',
      'font-weight',
      'font-family',
      'line-height',
      'text-align',
      'padding',
      'margin',
      'border',
      'border-radius',
      'display',
      'flex-direction',
      'gap',
      'grid-template-columns',
      'width',
      'max-width',
      'min-height',
    ];

    // 只对直接子元素和标题/关键元素进行内联
    const criticalSelectors =
      'h1, h2, h3, h4, h5, h6, table, th, td, blockquote, .callout, pre, code';
    const originalElements = original.querySelectorAll(criticalSelectors);
    const cloneElements = clone.querySelectorAll(criticalSelectors);

    for (let i = 0; i < originalElements.length; i++) {
      const origEl = originalElements[i] as HTMLElement;
      const cloneEl = cloneElements[i] as HTMLElement;
      if (!origEl || !cloneEl) continue;

      const computed = window.getComputedStyle(origEl);
      const inlineStyles: string[] = [];

      for (const prop of criticalProps) {
        const value = computed.getPropertyValue(prop);
        if (value && value !== 'initial' && value !== 'inherit') {
          inlineStyles.push(`${prop}: ${value}`);
        }
      }

      if (inlineStyles.length > 0) {
        const existing = cloneEl.getAttribute('style') || '';
        cloneEl.setAttribute(
          'style',
          existing
            ? `${existing}; ${inlineStyles.join('; ')}`
            : inlineStyles.join('; ')
        );
      }
    }
  }

  /**
   * 移除标记为 data-export-exclude 的元素（工具栏、模式指示器等 UI 控件）
   */
  private static removeExportExcluded(clone: HTMLElement): void {
    const excluded = clone.querySelectorAll('[data-export-exclude]');
    for (const el of Array.from(excluded)) {
      el.remove();
    }
  }

  /**
   * 使 sr-only 数据表格在导出中可见（图表的无障碍回退）
   * 在 HTML/PDF 导出中，Recharts SVG 可能无法正确渲染，
   * 将隐藏的数据表格显示出来作为内容补充
   */
  private static revealSrOnlyTables(clone: HTMLElement): void {
    const srOnlyTables = clone.querySelectorAll('table.sr-only');
    for (const table of Array.from(srOnlyTables)) {
      (table as HTMLElement).classList.remove('sr-only');
      (table as HTMLElement).style.cssText =
        'width: 100%; border-collapse: collapse; margin: 0.5em 0; font-size: 0.85em;';
      // Style cells
      const cells = table.querySelectorAll('th, td');
      for (const cell of Array.from(cells)) {
        (cell as HTMLElement).style.cssText =
          'border: 1px solid #d1d5db; padding: 0.4em 0.6em; text-align: left;';
      }
      const headers = table.querySelectorAll('th');
      for (const th of Array.from(headers)) {
        (th as HTMLElement).style.backgroundColor = '#f3f4f6';
        (th as HTMLElement).style.fontWeight = '600';
      }
    }
  }

  /**
   * 移除克隆中的交互性元素
   */
  private static removeInteractivity(clone: HTMLElement): void {
    // 移除所有 on* 事件属性
    const allElements = clone.querySelectorAll('*');
    for (const el of Array.from(allElements)) {
      for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith('on') || attr.name.startsWith('data-radix')) {
          el.removeAttribute(attr.name);
        }
      }
    }

    // 移除 script 标签
    const scripts = clone.querySelectorAll('script');
    for (const script of Array.from(scripts)) {
      script.remove();
    }

    // 移除可能干扰布局的 hidden 元素
    const hiddenElements = clone.querySelectorAll('[aria-hidden="true"]');
    for (const el of Array.from(hiddenElements)) {
      // 保留 decorative hidden 元素（如图标），只移除真正隐藏的
      const style = (el as HTMLElement).style;
      if (style.display === 'none' || style.visibility === 'hidden') {
        el.remove();
      }
    }

    // ★ Fix opacity-0 on images: Next.js Image component uses opacity-0 + JS onLoad
    // to fade in images. In static export, images stay invisible. Force opacity:1.
    const opaqueImgs = clone.querySelectorAll(
      'img.opacity-0, img[class*="opacity-0"]'
    );
    for (const img of Array.from(opaqueImgs)) {
      (img as HTMLElement).classList.remove('opacity-0');
      (img as HTMLElement).style.opacity = '1';
      // Also remove transition-opacity since there's no JS to trigger it
      (img as HTMLElement).classList.remove('transition-opacity');
    }

    // ★ Remove loading spinners: they show forever in static HTML
    // Spinner pattern: div.absolute.inset-0 containing svg.animate-spin
    const spinnerOverlays = clone.querySelectorAll('.animate-spin');
    for (const spinner of Array.from(spinnerOverlays)) {
      // Remove the entire overlay container (parent with absolute positioning)
      const overlay = spinner.closest(
        '.absolute.inset-0, [class*="absolute"][class*="inset-0"]'
      );
      if (overlay) {
        overlay.remove();
      } else {
        spinner.remove();
      }
    }

    // ★ Remove interactive ARIA attributes that don't work in static HTML
    const interactiveEls = clone.querySelectorAll('[role="button"][tabindex]');
    for (const el of Array.from(interactiveEls)) {
      el.removeAttribute('role');
      el.removeAttribute('tabindex');
      el.removeAttribute('aria-label');
    }
  }

  /**
   * ★ v4.3: 为标题元素添加 ID 锚点，支持 TOC 内链跳转
   * ★ v5.0: 同时将角标 <sup>[N]</sup> 转为 <a href="#ref-N"> 实现导出文档内角标跳转
   *
   * Slug 算法必须与 createMarkdownComponents.tsx headingSlug() 完全一致，
   * 确保 TOC 链接的 href 和 heading id 在导出文档中能匹配。
   */
  private static addHeadingAnchors(clone: HTMLElement): void {
    const headings = clone.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const usedIds = new Set<string>();

    for (const heading of Array.from(headings)) {
      if (heading.id) {
        usedIds.add(heading.id);
        continue;
      }

      const text = heading.textContent?.trim() || '';
      if (!text) continue;

      // ★ Must match createMarkdownComponents.tsx headingSlug() exactly
      const slug = text
        .toLowerCase()
        .trim()
        .replace(/[#*`~^|\\[\]{}<>&=+!@$%;"'?,]/g, '')
        .replace(/\./g, '-')
        .replace(/\s/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-|-$/g, '');

      let finalSlug = slug;
      let counter = 1;
      while (usedIds.has(finalSlug)) {
        finalSlug = `${slug}-${counter++}`;
      }
      usedIds.add(finalSlug);
      heading.id = finalSlug;
    }

    // ★ Convert citation badges (<sup>[N]</sup>) into clickable anchor links
    // In React, citations use onClick (lost in export). Convert to native <a href>.
    const sups = clone.querySelectorAll('sup');
    for (const sup of Array.from(sups)) {
      const text = sup.textContent?.trim() || '';
      const match = text.match(/^\[(\d+)\]$/);
      if (match) {
        const anchor = clone.ownerDocument.createElement('a');
        anchor.href = `#ref-${match[1]}`;
        anchor.className = sup.className;
        anchor.textContent = text;
        anchor.style.textDecoration = 'none';
        sup.replaceWith(anchor);
      }
    }
  }

  /**
   * ★ 2026-05-25：在导出内容顶部插入报告标题 <h1>。
   * 报告标题（topic）一般渲染在页面 header（data-export-content 之外），导出
   * 抓不到。由公共抓取层统一补；用内联样式自包含，避免依赖 CSS 抽取。
   */
  private static prependDocumentTitle(clone: HTMLElement, title: string): void {
    // 已有顶层 h1 则不重复插入（部分内容自身已含标题）
    const firstEl = clone.querySelector('h1, h2');
    if (firstEl && firstEl.textContent?.trim() === title) return;

    const h1 = clone.ownerDocument.createElement('h1');
    h1.textContent = title;
    h1.setAttribute(
      'style',
      [
        'margin: 0 0 24px',
        'padding-bottom: 12px',
        'border-bottom: 1px solid #e5e7eb',
        'text-align: center',
        'font-size: 24px',
        'font-weight: 700',
        'line-height: 1.3',
        'color: #111827',
      ].join('; ')
    );
    clone.insertBefore(h1, clone.firstChild);
  }

  /**
   * ★ v4.3: CSS 去重 — 移除重复的 CSS 规则以减少导出文件体积
   * 嵌套感知：正确处理 @media / @keyframes 等包含 {} 的 at-rules
   */
  private static deduplicateCss(css: string): string {
    const seen = new Set<string>();
    const rules: string[] = [];

    // 按大括号深度追踪，提取完整的顶层规则
    let depth = 0;
    let current = '';

    for (let i = 0; i < css.length; i++) {
      const ch = css[i];
      current += ch;

      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth <= 0) {
          // 顶层规则结束
          depth = 0;
          const rule = current.trim();
          if (rule && !seen.has(rule)) {
            seen.add(rule);
            rules.push(rule);
          }
          current = '';
        }
      }
    }

    return rules.join('\n');
  }
}
