import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { firstValueFrom } from "rxjs";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

/**
 * AI Chat Prompt Service
 * 职责：Prompt 构建、URL 内容提取、Web 搜索集成
 */
@Injectable()
export class AiChatPromptService {
  private readonly logger = new Logger(AiChatPromptService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * 构建完整消息数组（包含系统提示）
   */
  buildMessages(messages: ChatMessage[], systemPrompt?: string): ChatMessage[] {
    const fullMessages: ChatMessage[] = [];

    if (systemPrompt) {
      fullMessages.push({ role: "system", content: systemPrompt });
    }

    fullMessages.push(...messages);
    return fullMessages;
  }

  /**
   * 从文本中提取 URL
   */
  extractUrls(text: string): string[] {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;
    return text.match(urlRegex) || [];
  }

  /**
   * 检测消息是否需要网络搜索
   * 查找关键词如 "搜索"、"查找"、"最新"、"新闻"、"search" 等
   */
  needsWebSearch(text: string): boolean {
    const searchKeywords = [
      "搜索",
      "搜一下",
      "查找",
      "查一下",
      "查询",
      "最新",
      "新闻",
      "今天",
      "昨天",
      "本周",
      "现在",
      "目前",
      "当前",
      "实时",
      "热点",
      "trending",
      "search",
      "look up",
      "find out",
      "latest",
      "news",
      "current",
      "recent",
      "today",
    ];
    const lowerText = text.toLowerCase();
    return searchKeywords.some((keyword) => lowerText.includes(keyword));
  }

  /**
   * 从用户消息中提取搜索查询
   */
  extractSearchQuery(text: string): string {
    // 移除常见前缀并清理查询
    let query = text
      .replace(/@[\w-]+\s*/g, "") // 移除 @mentions
      .replace(/搜索|搜一下|查找|查一下|查询|帮我|请|给我/g, "")
      .replace(/search|look up|find/gi, "")
      .trim();

    // 限制查询长度
    if (query.length > 100) {
      query = query.substring(0, 100);
    }

    return query;
  }

  /**
   * 使用 DuckDuckGo 进行网络搜索
   */
  async webSearch(query: string): Promise<string> {
    try {
      this.logger.log(`Performing web search for: ${query}`);

      // 使用 DuckDuckGo HTML 搜索
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

      const response = await firstValueFrom(
        this.httpService.get(searchUrl, {
          timeout: 10000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "text/html",
          },
          responseType: "text",
        }),
      );

      const html = response.data;

      // 从 DuckDuckGo HTML 中提取搜索结果
      const results: { title: string; snippet: string; url: string }[] = [];

      // 匹配结果块
      const resultRegex =
        /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([^<]*)</g;
      let match;
      let count = 0;

      while ((match = resultRegex.exec(html)) !== null && count < 5) {
        const url = match[1];
        const title = match[2].trim();
        const snippet = match[3].trim();

        if (title && snippet) {
          results.push({ title, snippet, url });
          count++;
        }
      }

      // 如果第一个模式没有找到结果，尝试备用提取方式
      if (results.length === 0) {
        const altRegex =
          /<h2[^>]*class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        while ((match = altRegex.exec(html)) !== null && count < 5) {
          const url = match[1];
          const title = match[2].replace(/<[^>]+>/g, "").trim();
          const snippet = match[3].replace(/<[^>]+>/g, "").trim();

          if (title && snippet) {
            results.push({ title, snippet, url });
            count++;
          }
        }
      }

      if (results.length === 0) {
        this.logger.warn(`No search results found for: ${query}`);
        return `[搜索 "${query}" 未找到结果]`;
      }

      // 格式化结果供 AI 使用
      const formattedResults = results
        .map(
          (r, i) =>
            `${i + 1}. **${r.title}**\n   ${r.snippet}\n   来源: ${r.url}`,
        )
        .join("\n\n");

      this.logger.log(`Found ${results.length} search results for: ${query}`);

      return `\n\n--- 网络搜索结果 (${query}) ---\n${formattedResults}`;
    } catch (error) {
      this.logger.error(`Web search failed for "${query}": ${error}`);
      return `[搜索失败: ${error}]`;
    }
  }

  /**
   * 从 URL 获取内容并提取文本
   * 用于为无法直接访问 URL 的 AI 模型提供上下文
   */
  async fetchUrlContent(url: string): Promise<string | null> {
    try {
      this.logger.log(`Fetching URL content: ${url}`);
      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 15000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          responseType: "text",
        }),
      );

      const html = response.data;

      // 从 HTML 中提取文本内容（简单提取）
      // 移除 scripts、styles 和 HTML 标签
      let text = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, " ")
        .trim();

      // 限制内容长度以避免超出 token 限制
      const maxLength = 8000;
      if (text.length > maxLength) {
        text = text.substring(0, maxLength) + "... [内容已截断]";
      }

      this.logger.log(`Fetched ${text.length} characters from ${url}`);
      return text;
    } catch (error) {
      this.logger.error(`Failed to fetch URL ${url}: ${error}`);
      return null;
    }
  }

  /**
   * 处理消息以获取 URL 内容并在需要时执行网络搜索
   * 这使所有 AI 模型都能访问互联网
   *
   * @param messages - 要处理的聊天消息
   * @param enableSearch - 是否执行网络搜索（默认: true）
   *                       对于内部系统调用设置为 false 以避免不必要的搜索
   */
  async augmentMessagesWithUrlContent(
    messages: ChatMessage[],
    enableSearch = true,
  ): Promise<ChatMessage[]> {
    const augmentedMessages: ChatMessage[] = [];

    for (const message of messages) {
      if (message.role === "user") {
        let augmentedContent = message.content;
        const urls = this.extractUrls(message.content);

        // 1. 如果存在 URL，获取其内容
        if (urls.length > 0) {
          const urlsToFetch = urls.slice(0, 2);

          const fetchResults = await Promise.all(
            urlsToFetch.map(async (url) => {
              const content = await this.fetchUrlContent(url);
              return content
                ? `\n\n--- 网页内容 (${url}) ---\n${content}`
                : null;
            }),
          );
          const fetchedContents = fetchResults.filter(
            (c): c is string => c !== null,
          );

          if (fetchedContents.length > 0) {
            augmentedContent += fetchedContents.join("\n");
            this.logger.log(
              `Augmented message with content from ${fetchedContents.length} URL(s)`,
            );
          }
        }

        // 2. 如果消息表明搜索意图（且没有 URL），执行网络搜索
        // ★ 跳过内部系统调用的网络搜索（enableSearch=false）
        if (
          enableSearch &&
          urls.length === 0 &&
          this.needsWebSearch(message.content)
        ) {
          const searchQuery = this.extractSearchQuery(message.content);
          if (searchQuery.length > 3) {
            this.logger.log(`Detected search intent, query: ${searchQuery}`);
            const searchResults = await this.webSearch(searchQuery);
            augmentedContent += searchResults;
          }
        }

        augmentedMessages.push({
          ...message,
          content: augmentedContent,
        });
      } else {
        augmentedMessages.push(message);
      }
    }

    return augmentedMessages;
  }
}
