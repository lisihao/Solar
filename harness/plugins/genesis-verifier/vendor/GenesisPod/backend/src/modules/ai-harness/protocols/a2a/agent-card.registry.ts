/**
 * Agent Card Registry
 * 构建和提供 GenesisPod 的 A2A Agent Card
 */

import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { A2AAgentCard, A2ASkill } from "./a2a.types";
import type { AgentCard as AgentCardV03 } from "./a2a-spec.types";
import { APP_CONFIG } from "@/common/config/app.config";

@Injectable()
export class AgentCardRegistry {
  constructor(private readonly configService: ConfigService) {}

  /**
   * 获取 GenesisPod 的 Agent Card
   */
  getAgentCard(): A2AAgentCard {
    const baseUrl = this.getBaseUrl();

    return {
      name: APP_CONFIG.brand.fullName,
      description:
        "Enterprise-grade AI research and content management platform with multi-agent collaboration, deep research, intelligent Q&A, document generation, and AI writing capabilities.",
      url: `${baseUrl}/a2a/tasks`,
      provider: {
        organization: APP_CONFIG.brand.name,
        url: baseUrl,
      },
      version: "1.0.0",
      capabilities: {
        streaming: false, // 暂不支持流式响应
        // T4: tasks/pushNotificationConfig/{set,get} 当前返回 METHOD_NOT_FOUND，
        // 接通 Webhook 注册前不得宣称支持（避免 A2A 规范一致性谎言）。
        pushNotifications: false,
        stateTransitionHistory: true, // tasks/get 返回 history，真实支持
      },
      authentication: {
        schemes: ["Bearer", "X-API-Key"],
        credentials:
          "API key required. Use Bearer token or X-API-Key header for authentication.",
      },
      defaultInputModes: ["text", "text/plain"],
      defaultOutputModes: ["text", "text/plain", "text/markdown"],
      skills: this.buildSkills(),
    };
  }

  /**
   * 构建技能列表
   */
  private buildSkills(): A2ASkill[] {
    return [
      {
        id: "deep-research",
        name: "Deep Research",
        description:
          "Conduct comprehensive AI-powered research with multi-step investigation, web search, and structured report generation. Ideal for in-depth analysis on complex topics.",
        tags: ["research", "analysis", "web-search", "report-generation", "ai"],
        examples: [
          "Research the latest developments in quantum computing",
          "Analyze the impact of AI on healthcare industry",
          "Investigate sustainable energy solutions for urban environments",
        ],
        inputModes: ["text", "text/plain"],
        outputModes: ["text/markdown", "text/plain"],
      },
      {
        id: "ai-ask",
        name: "AI Ask",
        description:
          "Intelligent question answering with web search integration, multi-model support (GPT-4, Claude, Grok), and context-aware responses. Perfect for quick information retrieval.",
        tags: ["qa", "search", "ai", "gpt-4", "claude", "grok"],
        examples: [
          "What are the key differences between TypeScript and JavaScript?",
          "Explain blockchain technology in simple terms",
          "How does photosynthesis work?",
        ],
        inputModes: ["text", "text/plain"],
        outputModes: ["text/markdown", "text/plain"],
      },
      {
        id: "team-debate",
        name: "Team Debate",
        description:
          "Multi-agent structured debate system where AI agents with different perspectives collaborate, challenge ideas, and synthesize insights. Best for exploring complex topics from multiple angles.",
        tags: [
          "debate",
          "collaboration",
          "multi-agent",
          "perspective",
          "synthesis",
        ],
        examples: [
          "Debate the pros and cons of remote work vs office work",
          "Discuss ethical implications of AI in education",
          "Analyze different approaches to climate change mitigation",
        ],
        inputModes: ["text", "text/plain"],
        outputModes: ["text/markdown", "text/plain"],
      },
      {
        id: "document-generation",
        name: "Document Generation",
        description:
          "AI-powered office document creation including Word documents, PowerPoint presentations, and design assets. Automate content creation workflows.",
        tags: [
          "document",
          "office",
          "word",
          "powerpoint",
          "design",
          "automation",
        ],
        examples: [
          "Generate a business proposal document",
          "Create a presentation on market trends",
          "Design a product launch slide deck",
        ],
        inputModes: ["text", "text/plain"],
        outputModes: ["application/vnd.openxmlformats-officedocument"],
      },
      {
        id: "ai-writing",
        name: "AI Writing",
        description:
          "Long-form content creation with AI assistance. Generate blog posts, articles, essays, and creative writing with style customization and iterative refinement.",
        tags: [
          "writing",
          "content-creation",
          "blog",
          "article",
          "creative-writing",
        ],
        examples: [
          "Write a comprehensive guide on machine learning basics",
          "Create a blog post about sustainable living tips",
          "Draft an article on the future of work",
        ],
        inputModes: ["text", "text/plain"],
        outputModes: ["text/markdown", "text/plain"],
      },
    ];
  }

  /**
   * 获取技能列表
   */
  getSkills(): A2ASkill[] {
    return this.buildSkills();
  }

  /**
   * 2026-05-01 (PR-X-P): A2A v0.3 spec-compliant AgentCard
   *
   * 与旧 getAgentCard() 区别:
   *   - url 指向 JSON-RPC 入口 /a2a/v1（不是 /a2a/tasks）
   *   - protocolVersion: "0.3.0"
   *   - securitySchemes（OpenAPI-style）替代旧 authentication.schemes
   *   - 完整 AgentCard 类型（A2A v0.3 spec）
   *
   * T4 (2026-06-01): capabilities.streaming/pushNotifications 暂置 false ——
   *   /a2a/v1/stream SSE 当前是单发 stub（一次 RPC → 一个 final event，非增量
   *   TaskStatusUpdateEvent/TaskArtifactUpdateEvent），且 tasks/pushNotificationConfig
   *   与 tasks/resubscribe 均返回 METHOD_NOT_FOUND。接通 MissionEventBuffer → SSE
   *   增量事件 + Webhook 注册后（见路线图 T9）再改回 true。
   */
  getAgentCardV03(): AgentCardV03 {
    const baseUrl = this.getBaseUrl();
    return {
      name: APP_CONFIG.brand.fullName,
      description:
        "Enterprise-grade AI research and content management platform with multi-agent collaboration, deep research, intelligent Q&A, document generation, and AI writing capabilities.",
      url: `${baseUrl}/a2a/v1`,
      protocolVersion: "0.3.0",
      provider: {
        organization: APP_CONFIG.brand.name,
        url: baseUrl,
      },
      version: "1.0.0",
      capabilities: {
        // T4: see method-doc above — SSE is a single-shot stub and push-notification
        // config methods return METHOD_NOT_FOUND, so neither is advertised yet.
        streaming: false,
        pushNotifications: false,
        stateTransitionHistory: true,
      },
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "API key as Bearer token: Authorization: Bearer <key>",
        },
        apiKeyHeader: {
          type: "apiKey",
          in: "header",
          name: "X-API-Key",
          description: "API key in X-API-Key header",
        },
      },
      security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/markdown", "text/plain"],
      skills: this.buildSkills().map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        tags: s.tags,
        examples: s.examples,
        inputModes: s.inputModes,
        outputModes: s.outputModes,
      })),
    };
  }

  /**
   * 根据ID获取技能
   */
  getSkillById(skillId: string): A2ASkill | undefined {
    return this.buildSkills().find((skill) => skill.id === skillId);
  }

  /**
   * 验证技能是否存在
   */
  isValidSkill(skillId: string): boolean {
    return this.buildSkills().some((skill) => skill.id === skillId);
  }

  /**
   * 获取基础 URL
   */
  private getBaseUrl(): string {
    // 优先使用环境变量配置的 URL
    const configuredUrl = this.configService.get<string>("AGENT_BASE_URL");
    if (configuredUrl) {
      return configuredUrl;
    }

    // Fallback: 从 API URL 推断
    const apiUrl = this.configService.get<string>("API_URL");
    if (apiUrl) {
      return apiUrl;
    }

    // 默认值
    const port = this.configService.get<number>("PORT", 3001);
    return `http://localhost:${port}`;
  }
}
