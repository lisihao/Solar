/**
 * 文档导出服务
 * 支持导出为 Word、PPT、PDF、Markdown 等格式
 * V2.0 - 应用专业模板系统
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from 'docx';
import PptxGenJS from 'pptxgenjs';
import TurndownService from 'turndown';
import {
  PPTTemplate,
  getTemplateById,
} from '@/lib/features/ai-office/ppt-templates';
import { config } from './config';

interface ExportOptions {
  title: string;
  content: string; // HTML 或 Markdown
  format: 'word' | 'ppt' | 'pdf' | 'markdown' | 'html' | 'latex';
  template?: PPTTemplate; // 可选的模板配置
}

class DocumentExportService {
  private turndownService: TurndownService;

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
  }

  /**
   * 导出文档
   * @param options 导出选项
   * @returns 导出的文件 buffer
   */
  async exportDocument(options: ExportOptions): Promise<Buffer> {
    switch (options.format) {
      case 'word':
        return this.exportToWord(options);
      case 'ppt':
        return this.exportToPPT(options);
      case 'pdf':
        return this.exportToPDF(options);
      case 'markdown':
        return this.exportToMarkdown(options);
      case 'html':
        return this.exportToHTML(options);
      case 'latex':
        return this.exportToLaTeX(options);
      default:
        throw new Error(`Unsupported export format: ${options.format}`);
    }
  }

  /**
   * 导出为 Word 文档
   */
  private async exportToWord(options: ExportOptions): Promise<Buffer> {
    const { title, content } = options;

    // content已经是Markdown格式，直接使用
    const markdown = content;

    // 解析 Markdown 并创建 Word 文档
    const paragraphs = this.markdownToDocxParagraphs(markdown, title);

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    const buffer = await Packer.toBuffer(doc);
    return buffer;
  }

  /**
   * 导出为 PPT - V2.0 专业模板系统
   */
  private async exportToPPT(options: ExportOptions): Promise<Buffer> {
    const { title, content, template: templateOption } = options;
    const pptx = new PptxGenJS();

    // 设置文档属性
    pptx.author = 'AI Reports';
    pptx.company = config.brand.fullName;
    pptx.title = title;

    // 获取完整模板配置
    const templateId = templateOption?.id || 'corporate';
    const template = getTemplateById(templateId);

    // 获取模板颜色（移除#前缀，PPTXGenJS需要6位十六进制）
    const bgColor = template.colors.background.replace('#', '');
    const primaryColor = template.colors.primary.replace('#', '');
    const secondaryColor = template.colors.secondary.replace('#', '');
    const accentColor = template.colors.decorative.replace('#', '');
    const textColor = template.colors.text.replace('#', '');
    const textLightColor = template.colors.textLight.replace('#', '');
    const textSecondaryColor = template.colors.textSecondary.replace('#', '');
    const textTertiaryColor = template.colors.textTertiary.replace('#', '');

    // content已经是Markdown格式，直接使用
    const markdown = content;

    // 解析 Markdown 并创建幻灯片
    const slides = this.markdownToSlides(markdown);

    // 添加标题幻灯片（应用模板配置）
    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: bgColor };

    // 顶部装饰条
    if (template.decorations.showTopBar) {
      titleSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: '100%',
        h: 0.08,
        fill: { color: accentColor },
        line: { type: 'none' },
      });
    }

    // 底部装饰条
    if (template.decorations.showBottomBar) {
      titleSlide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 7.42,
        w: '100%',
        h: 0.08,
        fill: { color: accentColor },
        line: { type: 'none' },
      });
    }

    titleSlide.addText(title, {
      x: 0.5,
      y: '40%',
      w: '90%',
      fontSize: template.typography.title,
      bold: true,
      color:
        template.style.layoutStyle === 'dark' ? textLightColor : primaryColor,
      align: 'center',
      fontFace: template.fonts.heading,
    });
    titleSlide.addText(`AI Office 生成 · ${template.nameCn}风格`, {
      x: 0.5,
      y: '55%',
      w: '90%',
      fontSize: template.typography.caption,
      color:
        template.style.layoutStyle === 'dark'
          ? textSecondaryColor
          : textTertiaryColor,
      align: 'center',
      fontFace: template.fonts.body,
    });

    // 添加内容幻灯片（应用完整模板系统）
    slides.forEach((slideContent, index) => {
      const slide = pptx.addSlide();

      // 背景颜色
      slide.background = { color: bgColor };

      // 顶部装饰条
      if (template.decorations.showTopBar) {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 0,
          w: '100%',
          h: 0.08,
          fill: { color: accentColor },
          line: { type: 'none' },
        });
      }

      // 底部装饰条
      if (template.decorations.showBottomBar) {
        slide.addShape(pptx.ShapeType.rect, {
          x: 0,
          y: 7.42,
          w: '100%',
          h: 0.08,
          fill: { color: accentColor },
          line: { type: 'none' },
        });
      }

      // 半透明右侧覆盖层（深色主题专用，Genspark风格）
      if (
        template.style.layoutStyle === 'dark' &&
        template.colors.backgroundOverlay &&
        !template.colors.backgroundOverlay.startsWith('linear')
      ) {
        const overlayColor = template.colors.backgroundOverlay;
        // 提取rgba值并转换为透明度百分比
        const alphaMatch = overlayColor.match(
          /rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/
        );
        const alpha = alphaMatch
          ? Math.round(parseFloat(alphaMatch[1]) * 100)
          : 50;

        slide.addShape(pptx.ShapeType.rect, {
          x: '33%',
          y: 0,
          w: '67%',
          h: '100%',
          fill: {
            color: secondaryColor,
            transparency: 100 - alpha,
          },
          line: { type: 'none' },
        });
      }

      const startY = template.decorations.showTopBar ? 0.6 : 0.5;

      // 添加标题
      if (slideContent.title) {
        slide.addText(slideContent.title, {
          x: 0.5,
          y: startY,
          w: '90%',
          fontSize: template.typography.heading1 * 2, // PPT中需要更大的字号
          bold: true,
          color:
            template.style.layoutStyle === 'dark'
              ? textLightColor
              : primaryColor,
          fontFace: template.fonts.heading,
        });

        // 标题下划线
        if (template.decorations.showTitleUnderline) {
          slide.addShape(pptx.ShapeType.rect, {
            x: 0.5,
            y: startY + 0.35,
            w: 0.8,
            h: 0.04,
            fill: { color: accentColor },
            line: { type: 'none' },
          });
        }
      }

      // 添加内容（卡片布局或普通布局）
      if (slideContent.content && slideContent.content.length > 0) {
        const contentY = slideContent.title
          ? template.decorations.showTitleUnderline
            ? startY + 0.7
            : startY + 0.5
          : startY;

        // 处理内容文本，移除Markdown符号
        const processedContent = slideContent.content.map((line) => {
          // 移除列表符号
          let text = line.replace(/^[-•*]\s*/, '');
          // 移除加粗符号
          text = text.replace(/\*\*(.+?)\*\*/g, '$1');
          // 移除斜体符号
          text = text.replace(/\*(.+?)\*/g, '$1');
          return text;
        });

        if (template.decorations.useCardLayout) {
          // 卡片布局：为每个内容项创建卡片容器
          const cardHeight = 0.6;
          const cardSpacing = 0.15;
          const maxCards = Math.min(processedContent.length, 5); // 最多显示5个卡片

          for (let i = 0; i < maxCards; i++) {
            const cardY = contentY + i * (cardHeight + cardSpacing);

            // 卡片背景（半透明白色）
            if (template.colors.cardBackground) {
              const cardBgMatch = template.colors.cardBackground.match(
                /rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/
              );
              const cardAlpha = cardBgMatch
                ? Math.round(parseFloat(cardBgMatch[1]) * 100)
                : 10;

              slide.addShape(pptx.ShapeType.rect, {
                x: 0.5,
                y: cardY,
                w: 9,
                h: cardHeight,
                fill: {
                  color: 'FFFFFF',
                  transparency: 100 - cardAlpha,
                },
                line: { type: 'none' },
              });
            }

            // 卡片左侧蓝色边框
            if (template.decorations.showCardBorder) {
              slide.addShape(pptx.ShapeType.rect, {
                x: 0.5,
                y: cardY,
                w: 0.08,
                h: cardHeight,
                fill: { color: accentColor },
                line: { type: 'none' },
              });
            }

            // 卡片内容文本
            slide.addText(processedContent[i], {
              x: 0.8,
              y: cardY + 0.15,
              w: 8.4,
              h: cardHeight - 0.3,
              fontSize: template.typography.body + 2,
              color:
                template.style.layoutStyle === 'dark'
                  ? textColor
                  : textColor.replace('E5E7EB', '1F2937'),
              fontFace: template.fonts.body,
              valign: 'middle',
            });
          }
        } else {
          // 普通列表布局
          const contentText = processedContent
            .map((line, i) => `• ${line}`)
            .join('\n');
          slide.addText(contentText, {
            x: 0.5,
            y: contentY,
            w: '90%',
            h: 5,
            fontSize: template.typography.body + 2,
            color:
              template.style.layoutStyle === 'dark'
                ? textColor
                : textColor.replace('E5E7EB', '1F2937'),
            fontFace: template.fonts.body,
            valign: 'top',
          });
        }
      }

      // 添加页码（右下角，使用次要颜色）
      slide.addText(`${index + 1}`, {
        x: '92%',
        y: '90%',
        w: '6%',
        h: '6%',
        fontSize: template.typography.caption,
        color:
          template.style.layoutStyle === 'dark'
            ? textSecondaryColor
            : secondaryColor,
        align: 'right',
        fontFace: template.fonts.body,
      });
    });

    // 生成 PPT buffer
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    return buffer as Buffer;
  }

  /**
   * 导出为 PDF
   */
  private async exportToPDF(options: ExportOptions): Promise<Buffer> {
    // PDF 导出需要使用 puppeteer 或其他 PDF 生成库
    // 这里暂时返回 HTML 内容的简单实现
    const { content } = options;

    // 简单实现：返回 HTML 内容作为文本
    // 实际应该使用 puppeteer 将 HTML 渲染为 PDF
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${options.title}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 40px; line-height: 1.6; }
            h1, h2, h3 { color: #333; }
            code { background: #f4f4f4; padding: 2px 5px; }
            pre { background: #f4f4f4; padding: 15px; overflow-x: auto; }
          </style>
        </head>
        <body>
          ${content}
        </body>
      </html>
    `;

    return Buffer.from(htmlContent, 'utf-8');
  }

  /**
   * 导出为 Markdown
   */
  private async exportToMarkdown(options: ExportOptions): Promise<Buffer> {
    const { title, content } = options;

    // content已经是Markdown格式，直接使用
    const markdown = content;

    // 添加标题
    const fullMarkdown = `# ${title}\n\n${markdown}`;

    return Buffer.from(fullMarkdown, 'utf-8');
  }

  /**
   * 导出为 HTML - 专业学术风格
   */
  private async exportToHTML(options: ExportOptions): Promise<Buffer> {
    const { title, content, template } = options;

    // 获取模板配置用于样式
    const templateConfig = template || getTemplateById('academic');

    // 将Markdown转换为HTML（简单实现，可以用marked等库增强）
    const htmlContent = this.markdownToHTML(content);

    const htmlDocument = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="AI Office - ${config.brand.fullName}">
  <title>${this.escapeHTML(title)}</title>
  <style>
    /* 基础样式 - 学术风格 */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: ${templateConfig.fonts.body}, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 16px;
      line-height: 1.8;
      color: ${templateConfig.colors.text};
      background: ${templateConfig.colors.background};
      max-width: 900px;
      margin: 0 auto;
      padding: 60px 40px;
    }

    /* 标题样式 */
    h1, h2, h3, h4, h5, h6 {
      font-family: ${templateConfig.fonts.heading}, serif;
      color: ${templateConfig.colors.primary};
      margin-top: 1.5em;
      margin-bottom: 0.5em;
      font-weight: 600;
      line-height: 1.3;
    }

    h1 {
      font-size: 2.5em;
      text-align: center;
      border-bottom: 3px solid ${templateConfig.colors.accent};
      padding-bottom: 0.3em;
      margin-top: 0;
      margin-bottom: 1em;
    }

    h2 {
      font-size: 1.8em;
      border-bottom: 2px solid ${templateConfig.colors.decorative};
      padding-bottom: 0.2em;
    }

    h3 {
      font-size: 1.4em;
      color: ${templateConfig.colors.secondary};
    }

    h4 {
      font-size: 1.2em;
    }

    /* 段落样式 */
    p {
      margin-bottom: 1em;
      text-align: justify;
    }

    /* 列表样式 */
    ul, ol {
      margin-left: 2em;
      margin-bottom: 1em;
    }

    li {
      margin-bottom: 0.5em;
    }

    /* 代码样式 */
    code {
      background: rgba(0, 0, 0, 0.05);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: "Fira Code", "Consolas", monospace;
      font-size: 0.9em;
    }

    pre {
      background: #f5f5f5;
      border-left: 4px solid ${templateConfig.colors.accent};
      padding: 15px;
      overflow-x: auto;
      margin-bottom: 1em;
      border-radius: 4px;
    }

    pre code {
      background: none;
      padding: 0;
    }

    /* 引用样式 */
    blockquote {
      border-left: 4px solid ${templateConfig.colors.decorative};
      padding-left: 20px;
      margin: 1.5em 0;
      color: ${templateConfig.colors.textSecondary};
      font-style: italic;
    }

    /* 表格样式 */
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.5em;
    }

    th, td {
      border: 1px solid #ddd;
      padding: 12px;
      text-align: left;
    }

    th {
      background: ${templateConfig.colors.primary};
      color: white;
      font-weight: 600;
    }

    tr:nth-child(even) {
      background: #f9f9f9;
    }

    /* 链接样式 */
    a {
      color: ${templateConfig.colors.accent};
      text-decoration: none;
      border-bottom: 1px solid transparent;
      transition: border-bottom 0.2s;
    }

    a:hover {
      border-bottom: 1px solid ${templateConfig.colors.accent};
    }

    /* 水平线 */
    hr {
      border: none;
      border-top: 2px solid ${templateConfig.colors.decorative};
      margin: 2em 0;
    }

    /* 页脚 */
    .footer {
      margin-top: 4em;
      padding-top: 2em;
      border-top: 1px solid #ddd;
      text-align: center;
      color: ${templateConfig.colors.textTertiary};
      font-size: 0.9em;
    }

    /* 打印样式 */
    @media print {
      body {
        max-width: 100%;
        padding: 20px;
      }

      .footer {
        page-break-before: avoid;
      }
    }
  </style>
</head>
<body>
  <h1>${this.escapeHTML(title)}</h1>
  ${htmlContent}
  <div class="footer">
    <p>由 AI Office 生成 · ${config.brand.fullName} · ${new Date().toLocaleDateString('zh-CN')}</p>
  </div>
</body>
</html>`;

    return Buffer.from(htmlDocument, 'utf-8');
  }

  /**
   * 导出为 LaTeX - 学术论文格式
   */
  private async exportToLaTeX(options: ExportOptions): Promise<Buffer> {
    const { title, content } = options;

    // 将Markdown转换为LaTeX
    const latexContent = this.markdownToLaTeX(content);

    const latexDocument = `\\documentclass[12pt,a4paper]{article}

% 中文支持
\\usepackage[UTF8]{ctex}

% 页面设置
\\usepackage[margin=2.5cm]{geometry}

% 数学公式
\\usepackage{amsmath, amssymb, amsthm}

% 图片支持
\\usepackage{graphicx}

% 表格增强
\\usepackage{booktabs}
\\usepackage{longtable}

% 代码高亮
\\usepackage{listings}
\\usepackage{xcolor}

% 超链接
\\usepackage{hyperref}
\\hypersetup{
  colorlinks=true,
  linkcolor=blue,
  filecolor=magenta,
  urlcolor=cyan,
  citecolor=green
}

% 列表设置
\\usepackage{enumitem}

% 代码样式设置
\\lstset{
  basicstyle=\\ttfamily\\small,
  backgroundcolor=\\color{gray!10},
  frame=single,
  rulecolor=\\color{gray!30},
  breaklines=true,
  captionpos=b,
  numbers=left,
  numberstyle=\\tiny\\color{gray},
  keywordstyle=\\color{blue},
  commentstyle=\\color{green!50!black},
  stringstyle=\\color{orange}
}

% 标题信息
\\title{\\textbf{${this.escapeLaTeX(title)}}}
\\author{AI Office}
\\date{\\today}

\\begin{document}

\\maketitle

\\tableofcontents
\\newpage

${latexContent}

\\end{document}`;

    return Buffer.from(latexDocument, 'utf-8');
  }

  /**
   * 将 HTML 转换为 Markdown
   */
  private htmlToMarkdown(html: string): string {
    return this.turndownService.turndown(html);
  }

  /**
   * 将 Markdown 转换为 Word 段落
   */
  private markdownToDocxParagraphs(
    markdown: string,
    title: string
  ): Paragraph[] {
    const paragraphs: Paragraph[] = [];

    // 添加标题
    paragraphs.push(
      new Paragraph({
        text: title,
        heading: HeadingLevel.TITLE,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      })
    );

    // 解析 Markdown 内容
    const lines = markdown.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      if (!line) {
        // 空行
        paragraphs.push(new Paragraph({ text: '' }));
        continue;
      }

      // 标题
      if (line.startsWith('#')) {
        const level = line.match(/^#+/)?.[0].length || 1;
        const text = line.replace(/^#+\s*/, '');

        const headingLevel =
          level === 1
            ? HeadingLevel.HEADING_1
            : level === 2
              ? HeadingLevel.HEADING_2
              : HeadingLevel.HEADING_3;

        paragraphs.push(
          new Paragraph({
            text,
            heading: headingLevel,
            spacing: { before: 240, after: 120 },
          })
        );
      }
      // 列表项
      else if (line.startsWith('- ') || line.startsWith('* ')) {
        const text = line.replace(/^[-*]\s*/, '');
        paragraphs.push(
          new Paragraph({
            text: `• ${text}`,
            bullet: { level: 0 },
          })
        );
      }
      // 普通段落
      else {
        paragraphs.push(
          new Paragraph({
            children: [new TextRun(line)],
            spacing: { after: 120 },
          })
        );
      }
    }

    return paragraphs;
  }

  /**
   * 将 Markdown 转换为幻灯片内容
   * 与 DocumentEditor 的 parseMarkdownToSlides 逻辑保持一致
   */
  private markdownToSlides(markdown: string): Array<{
    title?: string;
    content: string[];
  }> {
    const slides: Array<{ title?: string; content: string[] }> = [];
    let currentSlide: { title?: string; content: string[] } | null = null;

    const lines = markdown.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // 检测幻灯片标题（支持多种格式）
      // ### Slide 1, ## 第X页, #### 第X页, ### 封面, ## Slide X: 标题
      const slideHeaderMatch = trimmed.match(
        /^#{2,4}\s*(Slide\s*\d+|第\s*\d+\s*[页页]|封面|目录|.*页[:：])/i
      );

      if (slideHeaderMatch) {
        if (currentSlide) {
          slides.push(currentSlide);
        }
        // 提取标题（冒号后的内容，或整个标题）
        const titleMatch =
          trimmed.match(/[:：]\s*(.+)/) || trimmed.match(/^#{2,4}\s*(.+)/);
        currentSlide = {
          title: titleMatch
            ? titleMatch[1].trim()
            : trimmed.replace(/^#{2,4}\s*/, ''),
          content: [],
        };
      } else if (trimmed === '---') {
        // 分隔符，开始新幻灯片
        if (currentSlide) {
          slides.push(currentSlide);
          currentSlide = null;
        }
      } else if (currentSlide && trimmed) {
        // 跳过图片标记，只添加文本内容
        const imageMatch = trimmed.match(/!\[.*?\]\((.+?)\)/);
        if (!imageMatch) {
          // 添加内容行（不在这里移除列表符号，保留原始格式）
          currentSlide.content.push(trimmed);
        }
      } else if (
        !currentSlide &&
        trimmed &&
        !trimmed.startsWith('#') &&
        trimmed !== '---'
      ) {
        // 如果还没有幻灯片，创建第一张
        currentSlide = {
          title: 'Slide ' + (slides.length + 1),
          content: [trimmed],
        };
      }
    }

    if (currentSlide) {
      slides.push(currentSlide);
    }

    return slides;
  }

  /**
   * 将 Markdown 转换为 HTML（简化版）
   */
  private markdownToHTML(markdown: string): string {
    let html = markdown;

    // 标题转换
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // 粗体和斜体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

    // 移除删除线标记，只保留文字
    html = html.replace(/~~(.+?)~~/g, '$1');

    // 代码
    html = html.replace(/`(.+?)`/g, '<code>$1</code>');

    // 链接
    html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

    // 图片
    html = html.replace(/!\[(.+?)\]\((.+?)\)/g, '<img src="$2" alt="$1" />');

    // 水平线
    html = html.replace(/^---$/gm, '<hr>');

    // 无序列表
    html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

    // 段落（简化处理：非标签行视为段落）
    html = html.replace(/^(?!<[^>]+>)(.+)$/gm, (match) => {
      if (match.trim()) {
        return `<p>${match}</p>`;
      }
      return match;
    });

    return html;
  }

  /**
   * 将 Markdown 转换为 LaTeX
   */
  private markdownToLaTeX(markdown: string): string {
    let latex = markdown;

    // 标题转换
    latex = latex.replace(/^#### (.+)$/gm, '\\subsubsection{$1}');
    latex = latex.replace(/^### (.+)$/gm, '\\subsection{$1}');
    latex = latex.replace(/^## (.+)$/gm, '\\section{$1}');
    latex = latex.replace(/^# (.+)$/gm, '\\section*{$1}');

    // 粗体和斜体
    latex = latex.replace(/\*\*(.+?)\*\*/g, '\\textbf{$1}');
    latex = latex.replace(/\*(.+?)\*/g, '\\textit{$1}');

    // 代码
    latex = latex.replace(/`(.+?)`/g, '\\texttt{$1}');

    // 无序列表
    const listItems: string[] = [];
    latex = latex.replace(/^[-*] (.+)$/gm, (match, p1) => {
      listItems.push(p1);
      return `\\item ${this.escapeLaTeX(p1)}`;
    });

    // 包装列表
    if (listItems.length > 0) {
      latex = latex.replace(
        /(\\item .+\n)+/g,
        '\\begin{itemize}\n$&\\end{itemize}\n'
      );
    }

    // 水平线
    latex = latex.replace(/^---$/gm, '\\hrulefill');

    // 转义特殊字符（LaTeX）
    latex = this.escapeLaTeX(latex);

    return latex;
  }

  /**
   * HTML 转义
   */
  private escapeHTML(text: string): string {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return text.replace(/[&<>"']/g, (char) => map[char] || char);
  }

  /**
   * LaTeX 转义
   */
  private escapeLaTeX(text: string): string {
    // LaTeX特殊字符转义
    const map: Record<string, string> = {
      '\\': '\\textbackslash{}',
      '&': '\\&',
      '%': '\\%',
      $: '\\$',
      '#': '\\#',
      _: '\\_',
      '{': '\\{',
      '}': '\\}',
      '~': '\\textasciitilde{}',
      '^': '\\textasciicircum{}',
    };

    // 避免重复转义
    return text.replace(/[\\&%$#_{}~^]/g, (char) => map[char] || char);
  }
}

// 单例导出
export const documentExportService = new DocumentExportService();
