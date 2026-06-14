/**
 * TeamMemberAgent Tests
 * 测试 AI Teams 成员 Agent 的工具集成功能
 */

import { Test, TestingModule } from "@nestjs/testing";
import { TeamMemberAgent, TeamMemberAgentConfig } from "../team-member.agent";
import {
  ToolRegistry,
  BUILTIN_TOOLS,
  ToolContext,
  JSONSchema,
} from "@/modules/ai-harness/facade";
import { BaseTool } from "@/modules/ai-harness/facade/base-classes";
import { AICapability, AgentWorkStyle } from "@prisma/client";

// ============================================================================
// Mock Tools
// ============================================================================

class MockWebSearchTool extends BaseTool<
  { query: string },
  { results: string[] }
> {
  readonly id = BUILTIN_TOOLS.WEB_SEARCH;
  readonly name = "Mock Web Search";
  readonly description = "Mock web search tool";
  readonly category = "information";
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { results: { type: "array" } },
  };

  protected async doExecute(
    input: { query: string },
    _context: ToolContext,
  ): Promise<{ results: string[] }> {
    return { results: [`Result for: ${input.query}`] };
  }
}

class MockCodeGenerationTool extends BaseTool<
  { prompt: string },
  { code: string }
> {
  readonly id = BUILTIN_TOOLS.CODE_GENERATION;
  readonly name = "Mock Code Generation";
  readonly description = "Mock code generation tool";
  readonly category = "generation";
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: { prompt: { type: "string" } },
    required: ["prompt"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { code: { type: "string" } },
  };

  protected async doExecute(
    input: { prompt: string },
    _context: ToolContext,
  ): Promise<{ code: string }> {
    return { code: `// Generated code for: ${input.prompt}` };
  }
}

class MockDataAnalysisTool extends BaseTool<
  { data: unknown },
  { analysis: string }
> {
  readonly id = BUILTIN_TOOLS.DATA_ANALYSIS;
  readonly name = "Mock Data Analysis";
  readonly description = "Mock data analysis tool";
  readonly category = "processing";
  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: { data: { type: "object" } },
    required: ["data"],
  };
  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: { analysis: { type: "string" } },
  };

  protected async doExecute(
    _input: { data: unknown },
    _context: ToolContext,
  ): Promise<{ analysis: string }> {
    return { analysis: "Analysis result" };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe("TeamMemberAgent", () => {
  let agent: TeamMemberAgent;
  let toolRegistry: ToolRegistry;
  let mockWebSearch: MockWebSearchTool;
  let mockCodeGen: MockCodeGenerationTool;
  let mockDataAnalysis: MockDataAnalysisTool;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TeamMemberAgent, ToolRegistry],
    }).compile();

    agent = module.get<TeamMemberAgent>(TeamMemberAgent);
    toolRegistry = module.get<ToolRegistry>(ToolRegistry);

    // 注册 mock 工具
    mockWebSearch = new MockWebSearchTool();
    mockCodeGen = new MockCodeGenerationTool();
    mockDataAnalysis = new MockDataAnalysisTool();

    toolRegistry.register(mockWebSearch);
    toolRegistry.register(mockCodeGen);
    toolRegistry.register(mockDataAnalysis);
  });

  afterEach(() => {
    toolRegistry.clear();
  });

  // ==========================================================================
  // resolveTools - 根据成员配置解析工具列表
  // ==========================================================================

  describe("resolveTools", () => {
    it("应该为 researcher 角色分配搜索和知识工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-1",
        displayName: "Researcher",
        role: "researcher",
        capabilities: [],
        expertiseAreas: [],
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      expect(tools).toContain(BUILTIN_TOOLS.WEB_SEARCH);
      expect(tools).toContain(BUILTIN_TOOLS.WEB_SCRAPER);
      expect(tools).toContain(BUILTIN_TOOLS.RAG_SEARCH);
      expect(tools).toContain(BUILTIN_TOOLS.KNOWLEDGE_GRAPH);
      expect(tools).toContain(BUILTIN_TOOLS.SHORT_TERM_MEMORY);
    });

    it("应该为 analyst 角色分配数据分析工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-2",
        displayName: "Analyst",
        role: "analyst",
        capabilities: [],
        expertiseAreas: [],
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      expect(tools).toContain(BUILTIN_TOOLS.DATA_ANALYSIS);
      expect(tools).toContain(BUILTIN_TOOLS.PYTHON_EXECUTOR);
      expect(tools).toContain(BUILTIN_TOOLS.DATA_VALIDATION);
      expect(tools).toContain(BUILTIN_TOOLS.DATA_CLEANING);
      expect(tools).toContain(BUILTIN_TOOLS.STRUCTURED_OUTPUT);
    });

    it("应该为 developer 角色分配代码工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-3",
        displayName: "Developer",
        role: "developer",
        capabilities: [],
        expertiseAreas: [],
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      expect(tools).toContain(BUILTIN_TOOLS.CODE_GENERATION);
      expect(tools).toContain(BUILTIN_TOOLS.PYTHON_EXECUTOR);
      expect(tools).toContain(BUILTIN_TOOLS.JAVASCRIPT_EXECUTOR);
      expect(tools).toContain(BUILTIN_TOOLS.SQL_EXECUTOR);
      expect(tools).toContain(BUILTIN_TOOLS.GITHUB_INTEGRATION);
    });

    it("应该为 writer 角色分配文档工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-4",
        displayName: "Writer",
        role: "writer",
        capabilities: [],
        expertiseAreas: [],
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      expect(tools).toContain(BUILTIN_TOOLS.TEXT_GENERATION);
      expect(tools).toContain(BUILTIN_TOOLS.EXPORT_DOCX);
      expect(tools).toContain(BUILTIN_TOOLS.EXPORT_PDF);
      expect(tools).toContain(BUILTIN_TOOLS.TEMPLATE_RENDER);
      expect(tools).toContain(BUILTIN_TOOLS.WEB_SEARCH);
    });

    it("应该为 leader 角色分配协作工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-5",
        displayName: "Leader",
        role: "leader",
        capabilities: [],
        expertiseAreas: [],
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      expect(tools).toContain(BUILTIN_TOOLS.TEXT_GENERATION);
      expect(tools).toContain(BUILTIN_TOOLS.TASK_DELEGATION);
      expect(tools).toContain(BUILTIN_TOOLS.AGENT_HANDOFF);
      expect(tools).toContain(BUILTIN_TOOLS.CONSENSUS_MECHANISM);
      expect(tools).toContain(BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION);
      expect(tools).toContain(BUILTIN_TOOLS.HUMAN_APPROVAL);
    });

    it("应该根据 capabilities 分配额外工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-6",
        displayName: "GeneralMember",
        role: "general",
        capabilities: [
          AICapability.CODE_GENERATION,
          AICapability.IMAGE_GENERATION,
          AICapability.WEB_SEARCH,
        ],
        expertiseAreas: [],
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      // CODE_GENERATION capability
      expect(tools).toContain(BUILTIN_TOOLS.CODE_GENERATION);
      expect(tools).toContain(BUILTIN_TOOLS.PYTHON_EXECUTOR);
      expect(tools).toContain(BUILTIN_TOOLS.JAVASCRIPT_EXECUTOR);

      // IMAGE_GENERATION capability
      expect(tools).toContain(BUILTIN_TOOLS.IMAGE_GENERATION);
      expect(tools).toContain(BUILTIN_TOOLS.EXPORT_IMAGE);

      // WEB_SEARCH capability
      expect(tools).toContain(BUILTIN_TOOLS.WEB_SEARCH);
      expect(tools).toContain(BUILTIN_TOOLS.WEB_SCRAPER);
    });

    it("应该根据 expertiseAreas 推断工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-7",
        displayName: "Expert",
        role: "general",
        capabilities: [],
        expertiseAreas: ["数据分析", "编程", "研究"],
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      // 数据分析领域
      expect(tools).toContain(BUILTIN_TOOLS.DATA_ANALYSIS);
      expect(tools).toContain(BUILTIN_TOOLS.PYTHON_EXECUTOR);

      // 编程领域
      expect(tools).toContain(BUILTIN_TOOLS.CODE_GENERATION);

      // 研究领域
      expect(tools).toContain(BUILTIN_TOOLS.WEB_SEARCH);
      expect(tools).toContain(BUILTIN_TOOLS.RAG_SEARCH);
      expect(tools).toContain(BUILTIN_TOOLS.KNOWLEDGE_GRAPH);
    });

    it("应该为 Leader 添加额外的协作工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-8",
        displayName: "TeamLeader",
        role: "general",
        capabilities: [],
        expertiseAreas: [],
        workStyle: null,
        isLeader: true, // 设置为 Leader
      };

      const tools = agent.resolveTools(config);

      expect(tools).toContain(BUILTIN_TOOLS.TASK_DELEGATION);
      expect(tools).toContain(BUILTIN_TOOLS.WORKFLOW_ORCHESTRATION);
      expect(tools).toContain(BUILTIN_TOOLS.CONSENSUS_MECHANISM);
      expect(tools).toContain(BUILTIN_TOOLS.HUMAN_APPROVAL);
    });

    it("应该添加自定义工具", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-9",
        displayName: "CustomMember",
        role: "general",
        capabilities: [],
        expertiseAreas: [],
        workStyle: null,
        isLeader: false,
        customTools: [
          BUILTIN_TOOLS.GITHUB_INTEGRATION,
          BUILTIN_TOOLS.EMAIL_SENDER,
        ],
      };

      const tools = agent.resolveTools(config);

      expect(tools).toContain(BUILTIN_TOOLS.GITHUB_INTEGRATION);
      expect(tools).toContain(BUILTIN_TOOLS.EMAIL_SENDER);
    });

    it("应该为所有成员添加 SHORT_TERM_MEMORY", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-10",
        displayName: "AnyMember",
        role: "general",
        capabilities: [],
        expertiseAreas: [],
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      expect(tools).toContain(BUILTIN_TOOLS.SHORT_TERM_MEMORY);
    });

    it("应该去重工具列表（不重复添加）", () => {
      const config: TeamMemberAgentConfig = {
        memberId: "member-11",
        displayName: "MultiRoleMember",
        role: "researcher", // researcher 包含 WEB_SEARCH
        capabilities: [AICapability.WEB_SEARCH], // WEB_SEARCH capability 也包含 WEB_SEARCH
        expertiseAreas: ["研究"], // 研究领域也包含 WEB_SEARCH
        workStyle: null,
        isLeader: false,
      };

      const tools = agent.resolveTools(config);

      // 统计 WEB_SEARCH 出现次数
      const webSearchCount = tools.filter(
        (t) => t === BUILTIN_TOOLS.WEB_SEARCH,
      ).length;

      expect(webSearchCount).toBe(1); // 应该只出现一次
    });
  });

  // ==========================================================================
  // inferRoleFromDescription - 从描述中推断角色
  // ==========================================================================

  describe("inferRoleFromDescription", () => {
    it("应该从描述中推断 leader 角色", () => {
      expect(agent.inferRoleFromDescription("Team Leader")).toBe("leader");
      expect(agent.inferRoleFromDescription("项目负责人")).toBe("leader");
      expect(agent.inferRoleFromDescription("团队领导")).toBe("leader");
      expect(agent.inferRoleFromDescription("项目经理")).toBe("leader");
    });

    it("应该从描述中推断 researcher 角色", () => {
      expect(agent.inferRoleFromDescription("Researcher")).toBe("researcher");
      expect(agent.inferRoleFromDescription("负责研究工作")).toBe("researcher");
      expect(agent.inferRoleFromDescription("市场调研专员")).toBe("researcher");
    });

    it("应该从描述中推断 analyst 角色", () => {
      expect(agent.inferRoleFromDescription("Data Analyst")).toBe("analyst");
      expect(agent.inferRoleFromDescription("数据分析师")).toBe("analyst");
      expect(agent.inferRoleFromDescription("负责数据分析")).toBe("analyst");
    });

    it("应该从描述中推断 developer 角色", () => {
      expect(agent.inferRoleFromDescription("Software Developer")).toBe(
        "developer",
      );
      expect(agent.inferRoleFromDescription("开发工程师")).toBe("developer");
      expect(agent.inferRoleFromDescription("前端程序员")).toBe("developer");
      expect(agent.inferRoleFromDescription("Engineer")).toBe("developer");
    });

    it("应该从描述中推断 designer 角色", () => {
      expect(agent.inferRoleFromDescription("UI Designer")).toBe("designer");
      expect(agent.inferRoleFromDescription("美术设计师")).toBe("designer");
      expect(agent.inferRoleFromDescription("负责设计工作")).toBe("designer");
    });

    it("应该从描述中推断 writer 角色", () => {
      expect(agent.inferRoleFromDescription("Content Writer")).toBe("writer");
      expect(agent.inferRoleFromDescription("文案编辑")).toBe("writer");
      expect(agent.inferRoleFromDescription("负责写作工作")).toBe("writer");
    });

    it("应该从描述中推断 moderator 角色", () => {
      expect(agent.inferRoleFromDescription("Moderator")).toBe("moderator");
      expect(agent.inferRoleFromDescription("主持人")).toBe("moderator");
      expect(agent.inferRoleFromDescription("协调员")).toBe("moderator");
    });

    it("无法识别时应该返回 general", () => {
      expect(agent.inferRoleFromDescription("Some random description")).toBe(
        "general",
      );
      expect(agent.inferRoleFromDescription(null)).toBe("general");
      expect(agent.inferRoleFromDescription(undefined)).toBe("general");
      expect(agent.inferRoleFromDescription("")).toBe("general");
    });

    it("应该大小写不敏感", () => {
      expect(agent.inferRoleFromDescription("LEADER")).toBe("leader");
      expect(agent.inferRoleFromDescription("ReSeArChEr")).toBe("researcher");
      expect(agent.inferRoleFromDescription("DEVELOPER")).toBe("developer");
    });
  });

  // ==========================================================================
  // getToolInstances - 获取工具实例
  // ==========================================================================

  describe("getToolInstances", () => {
    it("应该返回已注册的工具实例列表", () => {
      const toolTypes = [
        BUILTIN_TOOLS.WEB_SEARCH,
        BUILTIN_TOOLS.CODE_GENERATION,
      ];

      const instances = agent.getToolInstances(toolTypes);

      expect(instances).toHaveLength(2);
      expect(instances[0]).toBe(mockWebSearch);
      expect(instances[1]).toBe(mockCodeGen);
    });

    it("应该跳过未注册的工具并记录警告", () => {
      const toolTypes = [
        BUILTIN_TOOLS.WEB_SEARCH,
        BUILTIN_TOOLS.IMAGE_GENERATION, // 未注册
        BUILTIN_TOOLS.CODE_GENERATION,
      ];

      const instances = agent.getToolInstances(toolTypes);

      // 应该只返回已注册的工具
      expect(instances).toHaveLength(2);
      expect(instances[0]).toBe(mockWebSearch);
      expect(instances[1]).toBe(mockCodeGen);
    });

    it("空列表应该返回空数组", () => {
      const instances = agent.getToolInstances([]);

      expect(instances).toHaveLength(0);
    });
  });

  // ==========================================================================
  // executeTool - 执行单个工具
  // ==========================================================================

  describe("executeTool", () => {
    const context = {
      topicId: "topic-1",
      memberId: "member-1",
      messageId: "message-1",
      prompt: "Test prompt",
    };

    it("应该成功执行工具", async () => {
      const result = await agent.executeTool(
        BUILTIN_TOOLS.WEB_SEARCH,
        { query: "test query" },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.toolType).toBe(BUILTIN_TOOLS.WEB_SEARCH);
      expect(result.output).toEqual({ results: ["Result for: test query"] });
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.error).toBeUndefined();
    });

    it("应该处理工具未找到的情况", async () => {
      const result = await agent.executeTool(
        BUILTIN_TOOLS.IMAGE_GENERATION, // 未注册
        { prompt: "test" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.toolType).toBe(BUILTIN_TOOLS.IMAGE_GENERATION);
      expect(result.error).toContain("Tool not found");
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("应该处理工具执行失败的情况", async () => {
      // Mock 工具抛出错误
      jest
        .spyOn(mockCodeGen, "execute")
        .mockRejectedValueOnce(new Error("Execution failed"));

      const result = await agent.executeTool(
        BUILTIN_TOOLS.CODE_GENERATION,
        { prompt: "test" },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.toolType).toBe(BUILTIN_TOOLS.CODE_GENERATION);
      expect(result.error).toBe("Execution failed");
    });

    it("应该返回执行时长", async () => {
      const result = await agent.executeTool(
        BUILTIN_TOOLS.WEB_SEARCH,
        { query: "test" },
        context,
      );

      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration).toBe("number");
    });
  });

  // ==========================================================================
  // executeToolsParallel - 并行执行多个工具
  // ==========================================================================

  describe("executeToolsParallel", () => {
    const context = {
      topicId: "topic-1",
      memberId: "member-1",
      prompt: "Test prompt",
    };

    it("应该并行执行多个工具", async () => {
      const executions = [
        { toolType: BUILTIN_TOOLS.WEB_SEARCH, input: { query: "query1" } },
        {
          toolType: BUILTIN_TOOLS.CODE_GENERATION,
          input: { prompt: "prompt1" },
        },
        { toolType: BUILTIN_TOOLS.DATA_ANALYSIS, input: { data: {} } },
      ];

      const results = await agent.executeToolsParallel(executions, context);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(results[2].success).toBe(true);
    });

    it("应该处理部分工具失败的情况", async () => {
      jest
        .spyOn(mockCodeGen, "execute")
        .mockRejectedValueOnce(new Error("Failed"));

      const executions = [
        { toolType: BUILTIN_TOOLS.WEB_SEARCH, input: { query: "query1" } },
        {
          toolType: BUILTIN_TOOLS.CODE_GENERATION,
          input: { prompt: "prompt1" },
        },
      ];

      const results = await agent.executeToolsParallel(executions, context);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe("Failed");
    });
  });

  // ==========================================================================
  // executeToolsSequential - 顺序执行多个工具
  // ==========================================================================

  describe("executeToolsSequential", () => {
    const context = {
      topicId: "topic-1",
      memberId: "member-1",
      prompt: "Test prompt",
    };

    it("应该按顺序执行多个工具", async () => {
      const executions = [
        { toolType: BUILTIN_TOOLS.WEB_SEARCH, input: { query: "query1" } },
        {
          toolType: BUILTIN_TOOLS.CODE_GENERATION,
          input: { prompt: "prompt1" },
        },
      ];

      const results = await agent.executeToolsSequential(executions, context);

      expect(results).toHaveLength(2);
      expect(results[0].toolType).toBe(BUILTIN_TOOLS.WEB_SEARCH);
      expect(results[1].toolType).toBe(BUILTIN_TOOLS.CODE_GENERATION);
    });

    it("失败后应该继续执行剩余工具", async () => {
      jest
        .spyOn(mockCodeGen, "execute")
        .mockRejectedValueOnce(new Error("Failed"));

      const executions = [
        {
          toolType: BUILTIN_TOOLS.CODE_GENERATION,
          input: { prompt: "prompt1" },
        },
        { toolType: BUILTIN_TOOLS.WEB_SEARCH, input: { query: "query1" } },
      ];

      const results = await agent.executeToolsSequential(executions, context);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(false);
      expect(results[1].success).toBe(true); // 应该继续执行
    });
  });

  // ==========================================================================
  // generateFunctionCallingSchema - 生成 Function Calling Schema
  // ==========================================================================

  describe("generateFunctionCallingSchema", () => {
    it("应该生成正确的 Function Calling Schema", () => {
      const toolTypes = [
        BUILTIN_TOOLS.WEB_SEARCH,
        BUILTIN_TOOLS.CODE_GENERATION,
      ];

      const schemas = agent.generateFunctionCallingSchema(toolTypes);

      expect(schemas).toHaveLength(2);
      expect(schemas[0].name).toBe(BUILTIN_TOOLS.WEB_SEARCH);
      expect(schemas[0].description).toBe("Mock web search tool");
      expect(schemas[0].parameters).toEqual(mockWebSearch.inputSchema);

      expect(schemas[1].name).toBe(BUILTIN_TOOLS.CODE_GENERATION);
      expect(schemas[1].description).toBe("Mock code generation tool");
      expect(schemas[1].parameters).toEqual(mockCodeGen.inputSchema);
    });

    it("应该跳过未注册的工具", () => {
      const toolTypes = [
        BUILTIN_TOOLS.WEB_SEARCH,
        BUILTIN_TOOLS.IMAGE_GENERATION, // 未注册
      ];

      const schemas = agent.generateFunctionCallingSchema(toolTypes);

      expect(schemas).toHaveLength(1); // 只有已注册的工具
      expect(schemas[0].name).toBe(BUILTIN_TOOLS.WEB_SEARCH);
    });
  });

  // ==========================================================================
  // buildToolsSystemPrompt - 构建工具系统提示词
  // ==========================================================================

  describe("buildToolsSystemPrompt", () => {
    it("应该生成包含工具描述的提示词", () => {
      const toolTypes = [
        BUILTIN_TOOLS.WEB_SEARCH,
        BUILTIN_TOOLS.CODE_GENERATION,
      ];

      const prompt = agent.buildToolsSystemPrompt(toolTypes);

      expect(prompt).toContain("可用工具");
      expect(prompt).toContain("web-search");
      expect(prompt).toContain("Mock web search tool");
      expect(prompt).toContain("code-generation");
      expect(prompt).toContain("Mock code generation tool");
    });

    it("空工具列表应该返回空字符串", () => {
      const prompt = agent.buildToolsSystemPrompt([]);

      expect(prompt).toBe("");
    });

    it("应该跳过未注册的工具", () => {
      const toolTypes = [
        BUILTIN_TOOLS.WEB_SEARCH,
        BUILTIN_TOOLS.IMAGE_GENERATION, // 未注册
      ];

      const prompt = agent.buildToolsSystemPrompt(toolTypes);

      expect(prompt).toContain("web-search");
      expect(prompt).not.toContain("image-generation");
    });
  });

  // ==========================================================================
  // getExecutionStrategy - 获取执行策略
  // ==========================================================================

  describe("getExecutionStrategy", () => {
    it("AUTONOMOUS 工作风格应该返回并行、高并发策略", () => {
      const strategy = agent.getExecutionStrategy(AgentWorkStyle.AUTONOMOUS);

      expect(strategy.parallel).toBe(true);
      expect(strategy.maxConcurrent).toBe(5);
      expect(strategy.retryOnFailure).toBe(true);
      expect(strategy.timeoutMs).toBe(60000);
    });

    it("COLLABORATIVE 工作风格应该返回中等并发策略", () => {
      const strategy = agent.getExecutionStrategy(AgentWorkStyle.COLLABORATIVE);

      expect(strategy.parallel).toBe(true);
      expect(strategy.maxConcurrent).toBe(3);
      expect(strategy.retryOnFailure).toBe(true);
      expect(strategy.timeoutMs).toBe(45000);
    });

    it("ANALYTICAL 工作风格应该返回顺序执行策略", () => {
      const strategy = agent.getExecutionStrategy(AgentWorkStyle.ANALYTICAL);

      expect(strategy.parallel).toBe(false);
      expect(strategy.maxConcurrent).toBe(1);
      expect(strategy.retryOnFailure).toBe(true);
      expect(strategy.timeoutMs).toBe(90000); // 更长的超时时间
    });

    it("CREATIVE 工作风格应该返回并行、不重试策略", () => {
      const strategy = agent.getExecutionStrategy(AgentWorkStyle.CREATIVE);

      expect(strategy.parallel).toBe(true);
      expect(strategy.maxConcurrent).toBe(4);
      expect(strategy.retryOnFailure).toBe(false); // 创意工作不重试
      expect(strategy.timeoutMs).toBe(60000);
    });

    it("SUPPORTIVE 工作风格应该返回低并发策略", () => {
      const strategy = agent.getExecutionStrategy(AgentWorkStyle.SUPPORTIVE);

      expect(strategy.parallel).toBe(false);
      expect(strategy.maxConcurrent).toBe(2);
      expect(strategy.retryOnFailure).toBe(true);
      expect(strategy.timeoutMs).toBe(30000);
    });

    it("null 工作风格应该返回默认策略", () => {
      const strategy = agent.getExecutionStrategy(null);

      expect(strategy.parallel).toBe(true);
      expect(strategy.maxConcurrent).toBe(3);
      expect(strategy.retryOnFailure).toBe(true);
      expect(strategy.timeoutMs).toBe(45000);
    });
  });
});
