module.exports = {
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: ["tsconfig.json", "tsconfig.eslint.json"],
    tsconfigRootDir: __dirname,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint/eslint-plugin"],
  extends: [
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "prettier",
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: [
    ".eslintrc.js",
    "dist",
    "node_modules",
    "scripts",
    "tests/**/*.ts",
    "tests/__mocks__/**/*.ts",
  ],
  rules: {
    // TypeScript规则
    "@typescript-eslint/interface-name-prefix": "off",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",

    // 类型安全 - 核心规则保持error
    "@typescript-eslint/no-explicit-any": "error", // Production code must not use any (tests override to off)
    "@typescript-eslint/no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],
    // Promise handling - temporarily relaxed for legacy code
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-misused-promises": "warn",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-unnecessary-type-assertion": "error",

    // Unsafe操作 - 降级为warn（MongoDB/Neo4j等场景需要）
    "@typescript-eslint/no-unsafe-assignment": "warn",
    "@typescript-eslint/no-unsafe-member-access": "warn",
    "@typescript-eslint/no-unsafe-return": "warn",
    "@typescript-eslint/no-unsafe-call": "warn",
    "@typescript-eslint/no-unsafe-argument": "warn",

    // 其他规则调整
    "@typescript-eslint/restrict-template-expressions": "warn",
    "@typescript-eslint/require-await": "warn",
    "@typescript-eslint/prefer-nullish-coalescing": "warn",
    "@typescript-eslint/prefer-optional-chain": "warn",

    // 临时降级 - 技术债务需要逐步清理
    "@typescript-eslint/no-redundant-type-constituents": "warn",
    "@typescript-eslint/no-unsafe-enum-comparison": "warn",
    "@typescript-eslint/ban-ts-comment": "warn",
    "@typescript-eslint/no-var-requires": "warn",
    // Note: await-thenable is already "error" above - do NOT re-declare here
    "@typescript-eslint/no-base-to-string": "warn",
    "@typescript-eslint/ban-types": "warn",
    "@typescript-eslint/no-implied-eval": "error", // Promoted: eval-like code is a security risk
    "@typescript-eslint/unbound-method": "warn",

    // 代码质量
    "no-console": [
      "error",
      {
        allow: ["warn", "error"],
      },
    ],
    "no-debugger": "error",
    "prefer-const": "error",
    "no-var": "error",

    // NestJS特定规则
    "@typescript-eslint/no-inferrable-types": "off",

    // ★ 2026-05-05 散点 antipattern 看护（task #16 + #17）
    // 目的：在写代码时拦截已知 antipattern，杜绝 listener leak / 无 timeout 等
    // 系统性问题再发生。已有存量按渐进迁移走（部分 warn 级，让旧代码不阻塞）。
    "no-restricted-syntax": [
      "warn",
      {
        // task #16: no-naked-abort-listener
        // 禁止裸 signal.addEventListener("abort", ...) — 必须用 AbortableScope。
        // AbortableScope 内部 add 实现是唯一豁免，本规则不会误伤（只检测调用点
        // 含 'abort' 字面量字符串作为第 1 参的 addEventListener 调用）。
        selector:
          "CallExpression[callee.property.name='addEventListener'][arguments.0.type='Literal'][arguments.0.value='abort']",
        message:
          "Use AbortableScope from @/modules/platform/resilience instead of raw addEventListener('abort', ...). Naked listeners with {once:true} leak when abort never fires.",
      },
      {
        // task #6 + 看护：禁止 admin 直接 return process.env.* 的密钥字段。
        // 防止 S1 类漏洞复发（密钥经 admin endpoint 明文传到前端）。
        selector:
          "ReturnStatement > LogicalExpression[operator='||'] > MemberExpression.left[object.object.name='process'][object.property.name='env'][property.name=/_API_KEY|_SECRET|_TOKEN|_PASSWORD/]",
        message:
          "Do not return process.env.*_API_KEY/SECRET/TOKEN/PASSWORD directly in admin endpoint. Use Boolean(...) or maskSensitiveSetting().",
      },
    ],

    // ★ task #17: 限制 axios 直接 import（warn 级渐进迁移）
    // 改用 NestJS HttpService（HttpModule 全局 timeout 已配 120000ms）。
    // 现有 30+ 处旧代码 warn 不阻塞，新代码统一走 httpService。
    "no-restricted-imports": [
      "warn",
      {
        paths: [
          {
            name: "axios",
            message:
              "Prefer NestJS HttpService (HttpModule.register has global timeout). Direct axios imports lack timeout safety net by default.",
          },
        ],
      },
    ],
  },
  overrides: [
    {
      // Test files need special handling
      files: [
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/tests/**/*.ts",
        "**/__tests__/**/*.ts",
      ],
      rules: {
        // Jest's expect().toHaveBeenCalled() triggers this incorrectly
        "@typescript-eslint/unbound-method": "off",
        // Tests often need to use any for mocking
        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/no-unsafe-assignment": "off",
        "@typescript-eslint/no-unsafe-member-access": "off",
        "@typescript-eslint/no-unsafe-call": "off",
        "@typescript-eslint/no-unsafe-return": "off",
        "@typescript-eslint/no-unsafe-argument": "off",
        // Test files may directly import internal paths for mocking purposes
        "no-restricted-imports": "off",
      },
    },
    {
      // AI-App modules must access AI Engine only through AIFacade or Registry
      // See CLAUDE.md: "所有 AI App 模块只通过 AIFacade 和 Registry 访问 AI Engine"
      files: ["**/modules/ai-app/**/*.ts"],
      excludedFiles: [
        // Test files may directly import internals for mocking
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/__tests__/**/*.ts",
        // 2026-05-01 (PR-X-U): NestJS *.module.ts 装配 imports: [...] 必须用具体
        // module class（facade re-export 类型不能装配）。Engine 6 个子 module 现已
        // 收在子目录下（PR-X-U：llm/tools/skills/knowledge/safety），ai-app 模块
        // 装配它们时必然指向子路径。Service 层访问仍走 facade —— 本例外只针对装配。
        "**/modules/ai-app/**/*.module.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              // ════════════════════════════════════════════════════════════
              // ★ SECTION 1: Registry & Agent internals
              //   AgentRegistry, TeamRegistry, RoleRegistry, SkillRegistry,
              //   ToolRegistry, BUILTIN_TOOLS, BUILTIN_ROLES, IAgent, etc.
              //   are all re-exported from facade/index.ts — use that path.
              // ════════════════════════════════════════════════════════════
              {
                group: ["**/ai-engine/agents/**"],
                message:
                  "Import AgentRegistry, IAgent, BaseAgent types, etc. from 'ai-engine/facade'. " +
                  "If you need to extend BaseAgent/PlanBasedAgent (class inheritance), add your file to ESLint excludedFiles.",
              },
              {
                group: ["**/ai-engine/tools/**"],
                message:
                  "Import ToolRegistry, ToolContext, ITool, BUILTIN_TOOLS, etc. from 'ai-engine/facade'.",
              },
              {
                group: ["**/ai-engine/core/**"],
                message:
                  "Import BUILTIN_TOOLS, BUILTIN_ROLES, agent type constants, etc. from 'ai-engine/facade'.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 2: LLM types
              //   TaskProfile, AIModelType, ModelFallbackOptions, AIModelConfig
              //   are re-exported from facade/index.ts.
              // ════════════════════════════════════════════════════════════
              {
                group: ["**/ai-engine/llm/**"],
                message:
                  "Import TaskProfile, AIModelType, ModelFallbackOptions, etc. from 'ai-engine/facade'.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 3: Skills internals
              //   SkillRegistry and PromptSkillBridge are re-exported from facade.
              // ════════════════════════════════════════════════════════════
              {
                group: ["**/ai-engine/skills/**"],
                message:
                  "Import SkillRegistry, SkillContext, PromptSkillBridge, etc. from 'ai-engine/facade'. " +
                  "If you need to implement ISkill (class inheritance), add your file to ESLint excludedFiles.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 4: Teams internals
              //   TeamRegistry, RoleRegistry, TeamConfig, WorkflowConfig,
              //   ConstraintProfile, createConstraintProfile, MissionContext,
              //   MissionEvent, ITeam, etc. are re-exported from facade.
              // ════════════════════════════════════════════════════════════
              {
                group: [
                  "**/ai-engine/teams/abstractions/**",
                  "**/ai-engine/teams/constraints/**",
                  "**/ai-engine/teams/registry/**",
                  "**/ai-engine/teams/services/**",
                ],
                message:
                  "Import TeamRegistry, RoleRegistry, TeamConfig, WorkflowConfig, ConstraintProfile, " +
                  "createConstraintProfile, MissionEvent, MissionContext, ITeam, etc. from 'ai-engine/facade'. " +
                  "For team *.config.ts files (which reference many abstractions), they are in ESLint excludedFiles.",
              },
              // ★ Team orchestration services — must go through AIFacade
              {
                group: [
                  "**/ai-engine/teams/orchestrator/mission-orchestrator*",
                  "**/ai-engine/teams/factory/team-factory*",
                ],
                message:
                  "Use facade.missionOrchestrator or facade.teamFactory instead.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 5: Orchestration internals
              // ════════════════════════════════════════════════════════════
              // Barrel index (covers 'import ... from ".../orchestration/services"'):
              {
                group: ["**/ai-engine/planning/services"],
                message:
                  "Import orchestration types from 'ai-engine/facade'. " +
                  "Use AIFacade getters instead of the barrel index.",
              },
              // Specific services with dedicated facade accessors:
              {
                group: [
                  "**/ai-engine/planning/services/intent-detection*",
                  "**/ai-engine/planning/services/output-reviewer*",
                  "**/ai-engine/planning/services/context-evolution*",
                  "**/ai-engine/planning/services/circuit-breaker*",
                  "**/ai-engine/planning/services/agent-executor*",
                  "**/ai-engine/planning/services/task-planner*",
                  "**/ai-engine/planning/services/task-decomposer*",
                ],
                message:
                  "Inject AIFacade and access via facade.intentDetector / facade.outputReviewer / etc.",
              },
              // Broader orchestration internals:
              {
                group: [
                  "**/ai-engine/planning/executors/**",
                  "**/ai-engine/planning/state-machine/**",
                  "**/ai-engine/planning/utils/**",
                  "**/ai-engine/planning/interfaces/**",
                  "**/ai-engine/planning/capabilities/**",
                ],
                message:
                  "Access orchestration internals only through AIFacade. " +
                  "If a type is missing from facade/index.ts, add it there first.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 6: Knowledge bounded context internals
              //   Covers: knowledge/rag, knowledge/search, knowledge/evidence,
              //   knowledge/memory — all types re-exported from facade/index.ts.
              // ════════════════════════════════════════════════════════════
              {
                group: ["**/ai-engine/knowledge/rag/**"],
                message:
                  "Import EmbeddingResult, SimilaritySearchOptions, SimilarityResult from 'ai-engine/facade'. " +
                  "For RAGPipelineService, add it to facade/index.ts exports first.",
              },
              // Memory — must go through AIFacade
              {
                group: [
                  "**/ai-engine/knowledge/memory/stores/**",
                  "**/ai-engine/knowledge/memory/abstractions/**",
                  "**/ai-engine/knowledge/memory/memory-coordinator.service*",
                ],
                message: "Use AIFacade.storeMemory()/retrieveMemory() instead.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 7: Content bounded context internals
              //   Covers: content/long-form, content/fetch, content/image,
              //   content/analysis, content/synthesis.
              // ════════════════════════════════════════════════════════════
              {
                group: [
                  "**/ai-engine/content/long-form/services/long-content-engine*",
                ],
                message: "Use facade.longContentEngine instead.",
              },
              {
                group: [
                  "**/ai-engine/content/long-form/interfaces/**",
                  "**/ai-engine/content/long-form/types/**",
                  "**/ai-engine/content/long-form/long-content.module*",
                ],
                message:
                  "Do not import LongContentModule or its interfaces directly. " +
                  "AiEngineModule already includes it. Add missing types to facade/index.ts.",
              },
              // Content fetch — must go through AIFacade
              {
                group: ["**/ai-engine/content/fetch/**"],
                message: "Use facade.contentFetch instead.",
              },
              // Image engine internals
              {
                group: ["**/ai-engine/content/image/**"],
                message:
                  "Add image matching types to facade/index.ts, then import from 'ai-engine/facade'.",
              },
              // Content analysis internals
              {
                group: ["**/ai-engine/content/analysis/**"],
                message:
                  "Add content analysis types to facade/index.ts, then import from 'ai-engine/facade'.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 8: Infra bounded context internals
              //   Covers: infra/realtime, infra/observability, infra/a2a.
              // ════════════════════════════════════════════════════════════
              // Realtime — must go through AIFacade
              {
                group: ["**/ai-engine/runtime/realtime/**"],
                message: "Use AIFacade.emitToRoom()/emitProgress() instead.",
              },
              // MCP abstractions
              {
                group: ["**/ai-engine/mcp/**"],
                message:
                  "Add MCP abstractions to facade/index.ts, then import from 'ai-engine/facade'.",
              },
              // ════════════════════════════════════════════════════════════
              // ★ SECTION 9: Preventive — not yet accessed but must stay clean
              //   Uses top-level bounded context paths to cover all sub-paths.
              // ════════════════════════════════════════════════════════════
              {
                group: [
                  // Safety bounded context: guardrails, quality, constraint
                  "**/ai-engine/safety/**",
                  // Knowledge bounded context (catchall beyond rag/memory above)
                  "**/ai-engine/knowledge/search/**",
                  "**/ai-engine/knowledge/evidence/**",
                  // Content bounded context (catchall beyond long-form/fetch/image/analysis above)
                  "**/ai-engine/content/synthesis/**",
                  // Agents collaboration sub-context
                  "**/ai-engine/agents/collaboration/**",
                  // Infra bounded context (catchall beyond realtime above)
                  "**/ai-engine/runtime/observability/**",
                  "**/ai-engine/runtime/a2a/**",
                  // API core internals
                  "**/ai-engine/api/**",
                ],
                message:
                  "Access AI Engine internals only through 'ai-engine/facade'. " +
                  "If a symbol is missing from facade/index.ts, add it there first.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 10 (2026-05-06 v1.4 报告装配重构 + MECE 11 顶层聚合):
              //   ai-app 必须通过 ai-harness/facade 访问 harness 能力，不得穿透。
              //   每个 export 都已通过 facade 暴露，ai-app 没有理由绕开。
              //
              //   v1.2 旧路径（kernel/execution/governance/process/protocol/runtime）已删，
              //   现行 10 个顶层聚合（不含 facade 自身）按 standards/16 写入。
              // ════════════════════════════════════════════════════════════
              {
                group: [
                  "**/ai-harness/agents/**",
                  "**/ai-harness/runner/**",
                  "**/ai-harness/teams/**",
                  "**/ai-harness/handoffs/**",
                  "**/ai-harness/memory/**",
                  "**/ai-harness/protocols/**",
                  "**/ai-harness/evaluation/**",
                  "**/ai-harness/guardrails/**",
                  "**/ai-harness/tracing/**",
                  "**/ai-harness/lifecycle/**",
                ],
                message:
                  "Access AI Harness internals only through 'ai-harness/facade'. " +
                  "If a symbol is missing from facade/index.ts, add it there first. " +
                  "Includes new symbols: ReportSegments / ReportTemplate / SlotBodySource / " +
                  "MULTI_DIMENSION_REPORT_TEMPLATE / SINGLE_AGENT_FREEFORM_TEMPLATE / " +
                  "expectedSectionCount / StructuralReportAssembler.",
              },

              // ════════════════════════════════════════════════════════════
              // ★ SECTION 11 (2026-06-02 MECE 审计修复): 12-聚合 catch-all。
              //   SECTION 1-9 按"子目录"枚举，refactor 后大量路径漂移成死规则
              //   （agents/core/teams/credentials/orchestration/mcp/api/runtime/
              //    knowledge.rag/knowledge.memory/content.long-form/analysis/
              //    synthesis 均已不存在），且新顶层聚合 rag/routing/reliability/
              //    evaluation 从未被守护。本组按"聚合根"枚举当前 12 个 engine 聚合
              //    （facade 自身除外），一次性补齐覆盖并防未来漂移。验证：ai-app
              //    非 *.module.ts 文件 0 处穿透这些路径（2026-06-02）。
              //   旧的 SECTION 1-9 子目录组保留（匹配为空、无害），其更具体的
              //    报错信息对仍存活路径仍有指引价值；死路径清理为独立 follow-up。
              // ════════════════════════════════════════════════════════════
              {
                group: [
                  "**/ai-engine/llm/**",
                  "**/ai-engine/tools/**",
                  "**/ai-engine/rag/**",
                  "**/ai-engine/knowledge/**",
                  "**/ai-engine/content/**",
                  "**/ai-engine/routing/**",
                  "**/ai-engine/reliability/**",
                  "**/ai-engine/evaluation/**",
                  "**/ai-engine/skills/**",
                  "**/ai-engine/planning/**",
                  "**/ai-engine/safety/**",
                ],
                message:
                  "ai-app 必须通过 'ai-engine/facade' 访问 AI Engine 内部，不得穿透任何聚合内部路径。" +
                  "缺口符号先在 ai-engine/facade/index.ts 补 export 再用（CLAUDE.md Facade 边界红线）。" +
                  "*.module.ts 装配例外见 excludedFiles。",
              },
            ],
          },
        ],
      },
    },
    {
      // ════════════════════════════════════════════════════════════════
      // ★ 2026-05-29 open-api facade 收口（与 ai-app 同等边界）：
      //   open-api(L4) 访问 ai-engine(L2) / ai-harness(L2.5) 能力必须走各自
      //   facade，不得穿透内部路径。缺口符号先补进 facade/index.ts 再用。
      //
      //   excludedFiles 例外（经用户确认）：深层内省 / 协议实现控制器，其职责
      //   本就是深入 harness 内部，强行搬进 facade 会让 facade 表面积膨胀并触发
      //   PR-E0 式循环加载风险，故文档化豁免：
      //     - admin/harness/harness-inspector.controller.ts（LoopRegistry /
      //       SpecAgentRegistry / AgentEventStore / SkillLearningCoordinator 内省）
      //     - admin/observability/observability-admin.controller.ts（TraceCollector）
      //     - a2a-server.controller.ts / a2a-rpc.controller.ts（A2A 协议内部）
      //   *.module.ts 同 ai-app 例外（NestJS DI 装配必须用具体 module class）。
      // ════════════════════════════════════════════════════════════════
      files: ["**/modules/open-api/**/*.ts"],
      excludedFiles: [
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/__tests__/**/*.ts",
        "**/modules/open-api/**/*.module.ts",
        // 深层内省 / 协议实现控制器豁免（见上方注释）
        "**/modules/open-api/admin/harness/harness-inspector.controller.ts",
        "**/modules/open-api/admin/observability/observability-admin.controller.ts",
        "**/modules/open-api/external/a2a/a2a-server.controller.ts",
        "**/modules/open-api/external/a2a/a2a-rpc.controller.ts",
        // agents-api 直引 agent.types primitive：facade re-export 的 legacy
        // plan-based AgentResult<AgentOutput> 会遮蔽 agent.types 的 AgentResult
        // （含 tokensUsed），类型不兼容，故整目录走 agent.types 直引。
        "**/modules/open-api/user/agents/**/*.ts",
        // 2026-06-03: credential-admin 面（credentials 已迁 L1 platform/credentials）。这些是
        // 管理 BYOK key 的 admin 端点，本就紧贴 credentials；从 facade 大 barrel 取 credential
        // service 会触发循环加载 → NestJS DI 构造参数 undefined（admin.service index[6] 解析
        // 失败）。与 ai-app/byok 同理，直引 platform/credentials source。
        "**/modules/open-api/admin/admin.service.ts",
        "**/modules/open-api/admin/byok/admin-key-assignments.controller.ts",
        "**/modules/open-api/admin/byok/admin-key-requests.controller.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/ai-engine/llm/**",
                  "**/ai-engine/tools/**",
                  "**/ai-engine/rag/**",
                  "**/ai-engine/knowledge/**",
                  "**/ai-engine/skills/**",
                  "**/ai-engine/planning/**",
                  "**/ai-engine/safety/**",
                  "**/ai-engine/content/**",
                  // 2026-06-02 MECE 审计：credentials 已迁至 L1 ai-infra（dead path 删除），
                  // 补齐 2026-06-02 前缺失的新聚合 routing/reliability/evaluation。
                  "**/ai-engine/routing/**",
                  "**/ai-engine/reliability/**",
                  "**/ai-engine/evaluation/**",
                ],
                message:
                  "open-api 访问 AI Engine 必须走 'ai-engine/facade'，不得穿透内部路径。" +
                  "缺口符号先在 ai-engine/facade/index.ts 补 export 再用。",
              },
              {
                group: [
                  "**/ai-harness/agents/**",
                  "**/ai-harness/runner/**",
                  "**/ai-harness/teams/**",
                  "**/ai-harness/handoffs/**",
                  "**/ai-harness/memory/**",
                  "**/ai-harness/protocols/**",
                  "**/ai-harness/evaluation/**",
                  "**/ai-harness/guardrails/**",
                  "**/ai-harness/tracing/**",
                  "**/ai-harness/lifecycle/**",
                ],
                message:
                  "open-api 访问 AI Harness 必须走 'ai-harness/facade'，不得穿透内部路径。" +
                  "缺口符号先在 ai-harness/facade/index.ts 补 export 再用。",
              },
            ],
          },
        ],
      },
    },
    {
      // Phase H1: Harness 第一公民独立。ai-engine 永远不允许 import ai-harness
      // （依赖方向必须单向：ai-app → ai-harness → ai-engine）
      //
      // 单向依赖 ai-app → ai-harness → ai-engine
      //
      // PR-X18: 通过 DI tokens（ai-engine/abstractions/runtime-deps.tokens.ts）
      // 完全消除 ai-engine-planning.module 的反向 import；engine 端只看
      // Symbol token + 接口契约，harness 用 useExisting 绑定具体实现。
      // 现在 ai-engine/** 全部生产代码 0 反向 import，零 eslint 例外（除测试）。
      files: ["**/modules/ai-engine/**/*.ts"],
      excludedFiles: [
        // Specs/tests are allowed to import harness facade for mocking purposes
        "**/modules/ai-engine/**/*.spec.ts",
        "**/modules/ai-engine/**/*.test.ts",
        "**/modules/ai-engine/**/__tests__/**/*.ts",
        // 2026-05-01 (PR-X-R): K commit 的 ai-engine → ai-harness 适配器
        // 实现 harness ISkillProvider 端口（Dependency Inversion 模式）。
        // 这是合法的反向 import：ai-engine 主动 expose 用户自定义 skill 给 harness，
        // 不依赖任何 harness 实现，仅依赖 harness 抽象类型（IKernelSkill / ISkillProvider）。
        // jest layer-boundaries.spec.ts 同步 allowlist。
        "**/modules/ai-engine/skills/runtime/adapters/engine-skill-provider.adapter.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/ai-harness/**", "**/modules/ai-harness/**"],
                message:
                  "ai-engine 不允许 import ai-harness（依赖方向必须单向）。" +
                  "如果是 harness 抽象类型，应该 ai-harness 主动暴露给 ai-engine 使用，" +
                  "而不是 ai-engine 反向引用。",
              },
            ],
          },
        ],
      },
    },
    {
      // ════════════════════════════════════════════════════════════════
      // ★ Rev 5 / S0-6 (2026-05-09): R8 agent/skill primitive isolation
      //
      // ai-harness/agents/**(含 skill-runtime 子树)是 agent / role / tool primitive
      // 层；不得逆向 import mission/stage/pipeline 概念,防止 mission-aware 类型污染
      // primitive 抽象。详见 docs/architecture/ai-harness/facade/sediment-topology.md §4 +
      // boundary audit §6.5。
      // ════════════════════════════════════════════════════════════════
      files: ["**/modules/ai-harness/agents/**/*.ts"],
      excludedFiles: [
        "**/modules/ai-harness/agents/**/*.spec.ts",
        "**/modules/ai-harness/agents/**/*.test.ts",
        "**/modules/ai-harness/agents/**/__tests__/**/*.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/ai-harness/teams/**",
                  "**/ai-harness/lifecycle/mission-lifecycle/**",
                ],
                message:
                  "R8 agent/skill primitive isolation: ai-harness/agents/** 不得 import " +
                  "mission/stage/pipeline 类型(ai-harness/teams/** 或 ai-harness/lifecycle/" +
                  "mission-lifecycle/**)。primitive 层应保持 mission-unaware。" +
                  "详见 docs/architecture/ai-harness/facade/sediment-topology.md §4。",
              },
            ],
          },
        ],
      },
    },
    {
      // ════════════════════════════════════════════════════════════════
      // ★ 2026-05-08 PR-E0 真因护栏：ai-harness 内部成员禁止反向 import facade barrel。
      //
      // 起因：facade/index.ts re-export business-team/lifecycle/mission-runtime-shell.framework，
      //       同时 re-export RuntimeEnvironmentService。framework 又从 facade barrel 取
      //       RuntimeEnvironmentService，构成 facade ⇄ framework 循环加载。framework
      //       加载早于 facade 执行到 RuntimeEnvironmentService 那行 → emit-decorator-metadata
      //       捕获到 `facade_1.RuntimeEnvironmentService = undefined` → NestJS DI ctor
      //       参数 [1] 为 undefined token → "Nest can't resolve dependencies" → 启动崩溃。
      //
      // 规则：harness 内部所有 ts 文件（除装配 module / 测试 / facade 自身）必须从依赖
      //       的 source 文件直接导入，不得走 `@/modules/ai-harness/facade`。facade barrel
      //       是给"外部消费者"（ai-app）用的，harness 内部成员之间互引会构成 barrel 循环。
      // ════════════════════════════════════════════════════════════════
      files: ["**/modules/ai-harness/**/*.ts"],
      excludedFiles: [
        // facade 自身允许互相 re-export
        "**/modules/ai-harness/facade/**/*.ts",
        // *.module.ts 装配时引用 facade 不参与 emit-metadata 闭环，安全
        "**/modules/ai-harness/**/*.module.ts",
        // 测试文件
        "**/modules/ai-harness/**/*.spec.ts",
        "**/modules/ai-harness/**/*.test.ts",
        "**/modules/ai-harness/**/__tests__/**/*.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/ai-harness/facade", "**/ai-harness/facade/**"],
                message:
                  "ai-harness 内部成员禁止 import 自身 facade barrel —— facade 也 re-export 你，" +
                  "构成循环加载会让 emit-decorator-metadata 把 ctor 参数 token 写成 undefined " +
                  "（参见 PR-E0 真因 commit 30e2a71c4）。请直接从依赖的 source 文件导入。",
              },
            ],
          },
        ],
      },
    },
    {
      // LLM hardcoding guard: ai-app and core modules must use TaskProfile, not raw params.
      // See CLAUDE.md: "禁止硬编码 model: 'gpt-4o' 或 temperature: 0.7"
      // Legitimate exceptions (ai-engine LLM internals, common direct API calls) are outside this scope.
      files: ["**/modules/ai-app/**/*.ts", "**/modules/core/**/*.ts"],
      excludedFiles: ["**/*.spec.ts", "**/*.test.ts", "**/__tests__/**/*.ts"],
      rules: {
        "no-restricted-syntax": [
          "warn",
          {
            selector:
              "ObjectExpression > Property[key.name='temperature'][value.type='Literal']",
            message:
              "Hardcoded temperature is not allowed. Use TaskProfile ({ creativity: 'low'|'medium'|'high'|'deterministic' }) via AiChatService instead.",
          },
          {
            selector:
              "ObjectExpression > Property[key.name='maxTokens'][value.type='Literal']",
            message:
              "Hardcoded maxTokens is not allowed. Use TaskProfile ({ outputLength: 'minimal'|'short'|'medium'|'long'|'standard' }) via AiChatService instead.",
          },
        ],
      },
    },
    //
    // ============================================================================
    // v5.1 R0.5 PR-0: Plugin 系统边界（standards/19-plugin-system-governance.md）
    // ============================================================================
    //
    // 三块规则与 layer-boundaries.spec.ts "Plugin system boundaries" 一一对应：
    //   ① harness/engine 不得 import plugin:<domain> 实现（仅可 plugins/core/）
    //   ② src/plugins/<domain>/ 不得 import harness/engine/app 内部 + 不得 import 其他 plugin
    //   ③ src/plugins/core/ 不得依赖任何 module 或具体 plugin 实现
    //
    {
      files: ["**/modules/ai-harness/**/*.ts", "**/modules/ai-engine/**/*.ts"],
      excludedFiles: [
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/__tests__/**/*.ts",
        // W2 例外：harness/engine 的 *.module.ts 允许 import plugins/<domain>/*.module
        // （NestJS DI 装配，非实现使用；详见 layer-boundaries.spec 同步规则）
        "**/*.module.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "**/plugins/observability/**",
                  "**/plugins/resilience/**",
                  "**/plugins/security/**",
                  "**/plugins/storage/**",
                  "**/plugins/rag-backend/**",
                  "**/plugins/llm-augment/**",
                  "**/plugins/tool-augment/**",
                  "@/plugins/observability/**",
                  "@/plugins/resilience/**",
                  "@/plugins/security/**",
                  "@/plugins/storage/**",
                  "@/plugins/rag-backend/**",
                  "@/plugins/llm-augment/**",
                  "@/plugins/tool-augment/**",
                ],
                message:
                  "harness/engine 不得 import plugin 实现，必须通过 HookBus（plugins/core/）。" +
                  "*.module.ts 文件除外（NestJS DI 装配）。" +
                  "见 standards/19-plugin-system-governance.md 规则 4。",
              },
            ],
          },
        ],
      },
    },
    // W1-I：platform/** 不得 import plugins/storage 具体实现（object-r2/vector-pgvector/
    //   vector-jsonb），必须走 plugins/core/abstractions/storage 端口（DI token）。
    //   ai-engine/ai-harness 已由上一条规则覆盖；此条是 platform 层的新增守护。
    {
      files: ["**/modules/platform/**/*.ts"],
      excludedFiles: [
        "**/*.spec.ts",
        "**/*.test.ts",
        "**/__tests__/**/*.ts",
        // *.module.ts 允许 import plugins/storage/*.module（@Global NestJS DI 装配）
        "**/*.module.ts",
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["**/plugins/storage/**", "@/plugins/storage/**"],
                message:
                  "platform 不得 import plugins/storage 实现，必须通过 " +
                  "plugins/core/abstractions/storage 端口（DI token）。" +
                  "*.module.ts 装配除外。",
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        "**/plugins/observability/**/*.ts",
        "**/plugins/resilience/**/*.ts",
        "**/plugins/security/**/*.ts",
        "**/plugins/storage/**/*.ts",
        "**/plugins/rag-backend/**/*.ts",
        "**/plugins/llm-augment/**/*.ts",
        "**/plugins/tool-augment/**/*.ts",
      ],
      excludedFiles: ["**/*.spec.ts", "**/*.test.ts", "**/__tests__/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@/modules/ai-harness/**", "**/modules/ai-harness/**"],
                message:
                  "plugin 不得 import ai-harness 内部，仅允许通过 plugins/core/ 的 hook payload 类型。" +
                  "见 standards/19 规则 4。",
              },
              {
                group: ["@/modules/ai-engine/**", "**/modules/ai-engine/**"],
                message:
                  "plugin 不得 import ai-engine 内部，仅允许通过 plugins/core/ 的 hook payload 类型。" +
                  "见 standards/19 规则 4。",
              },
              {
                group: ["@/modules/ai-app/**", "**/modules/ai-app/**"],
                message:
                  "plugin 是平台横切，与业务无关，不得 import ai-app。" +
                  "见 standards/19 规则 3。",
              },
              {
                group: [
                  "**/plugins/observability/**",
                  "**/plugins/resilience/**",
                  "**/plugins/security/**",
                  "**/plugins/storage/**",
                  "**/plugins/rag-backend/**",
                  "**/plugins/llm-augment/**",
                  "**/plugins/tool-augment/**",
                  "@/plugins/observability/**",
                  "@/plugins/resilience/**",
                  "@/plugins/security/**",
                  "@/plugins/storage/**",
                  "@/plugins/rag-backend/**",
                  "@/plugins/llm-augment/**",
                  "@/plugins/tool-augment/**",
                ],
                message:
                  "plugin 之间仅通过 hook payload 通信，不得直接 import 其他 plugin 实现。" +
                  "见 standards/19 规则 4 + DS2。",
              },
            ],
          },
        ],
      },
    },
    {
      files: ["**/plugins/core/**/*.ts"],
      excludedFiles: ["**/*.spec.ts", "**/*.test.ts", "**/__tests__/**/*.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: ["@/modules/**", "**/modules/**"],
                message:
                  "plugins/core/ 是平台内核，不得依赖任何 module（ai-app/harness/engine/infra）。" +
                  "见 standards/19 规则 4。",
              },
              {
                group: [
                  "**/plugins/observability/**",
                  "**/plugins/resilience/**",
                  "**/plugins/security/**",
                  "**/plugins/storage/**",
                  "**/plugins/rag-backend/**",
                  "**/plugins/llm-augment/**",
                  "**/plugins/tool-augment/**",
                  "@/plugins/observability/**",
                  "@/plugins/resilience/**",
                  "@/plugins/security/**",
                  "@/plugins/storage/**",
                  "@/plugins/rag-backend/**",
                  "@/plugins/llm-augment/**",
                  "@/plugins/tool-augment/**",
                ],
                message:
                  "plugins/core/ 不得依赖具体 plugin 实现（内核不知道有哪些 plugin）。" +
                  "见 standards/19 规则 4。",
              },
            ],
          },
        ],
      },
    },
    //
    // ============================================================================
    // v3.1 F · Capability anti-pattern guard（D5 反模式 ESLint AST 拦截）
    // ============================================================================
    //
    // 背景（v3.1 §0 D5 + §6.1 F）：
    //   线上 mission 撞 deepseek-v4-pro response_format 死，溯源到 substring 判
    //   能力（modelLower.includes("deepseek-reasoner") 等）。C 阶段（commit
    //   325afdeef）+ D 阶段（commit 4e95fdba5）已把 3 个真 P0 决策路径清零，
    //   本规则是 F 阶段的 ESLint AST 守护：IDE 实时 + pre-commit 拦截，与 jest
    //   契约 spec（capability-provider-string-match.contract.spec.ts）+ audit
    //   baseline 脚本（audit:capability）三层互补。
    //
    // 范围（强禁的"能力决策路径"）：
    //   - ai-engine/llm/services/ai-api-caller.service.ts（C.A 已清）
    //   - ai-engine/llm/structured-output/**（response_format 决策入口）
    //   - ai-harness/runner/executor/**（runner 执行器，C.A 已清）
    //   - ai-app/teams/services/ai/ai-response.service.ts（C.A 已清）
    //
    // 显式豁免（TYPE B 路由 / TYPE C 装饰，v3.1 §0 D5 注释清单）：
    //   - function-calling-llm.adapter.ts          —— getDefaultEndpoint / inferProvider / parser
    //   - universal-llm.adapter.ts                 —— supportsModel 准入
    //   - ai-direct-key.service.ts                 —— Gemini 多模态/图像 routing
    //   - ai-chat.service.ts                       —— getApiFormatForProvider / getRequiredApiKeyName / getDefaultModelId
    //   - ai-api-caller.service.ts 内 getDefaultEndpoint/inferProvider —— C 已清能力决策，路由保留
    //     （路由仍在文件内，但本规则不扫该文件 —— 由 contract spec 锁能力决策 AST）
    //   - ai-model-config.service.ts               —— getIconUrl / formatModelDisplayName（TYPE C 装饰）
    //   - ai-model-discovery.service.ts            —— display name + env var name
    //   - ai-connection-test.service.ts            —— Gemini 实验模型 endpoint workaround
    //   - planning/budget/token-budget.service.ts  —— inferProvider attribution 派生
    //   - llm/types/model.utils.ts                 —— inferIsReasoning DB fallback
    //   - llm/user-config/user-models-auto-configure.service.ts —— BYOK 启发式默认
    //   - llm/capability/error-signal.types.ts     —— TYPE C provider URL 反解
    //   - llm/selection/model-fallback.service.ts  —— TYPE B fallback 选择
    //   - llm/services/ai-model-config.service.ts  —— TYPE C getIconUrl
    //   - rag/embedding/embedding.service.ts       —— TYPE B provider 路由
    //   - ai-app/image/generation/                 —— TYPE B 图像 provider 路由
    //   - ai-app/topic-insights/services/data/     —— TYPE B 数据源 provider 过滤
    //   - ai-app/research/project/research-project-tts.service.ts —— TYPE B TTS routing
    //   - ai-app/topic-insights/services/report/credibility-report.service.ts —— TYPE C domain 评分
    //   - ai-app/writing/services/mission/         —— TYPE B model manager
    //   - ai-engine/content/image/adapters/        —— TYPE B image adapter
    //   - ai-harness/tracing/                      —— TYPE C OTEL attribution
    //
    // 怎么加白名单：若新文件确属 TYPE B/C，把路径加到下面 excludedFiles。如果属
    // 能力决策，应该改用 ModelCapabilityService.resolveCapabilities(config)
    // 读结构化字段（v3.1 §3.2/§3.4）。
    //
    {
      // 强禁文件清单（这几个文件 C/D 阶段已把能力决策路径清掉，无遗留 TYPE B
      // 路由/装饰，新代码引入 substring 启发式 = 立即拒推）。
      //
      // 不列入 ai-app/teams/services/ai/ai-response.service.ts:
      //   该文件 C 阶段清掉 1217-1233 能力决策段，但同文件 1921 getDefaultModelId
      //   仍有 6 处 shorthand→modelId 探测（TYPE B 路由）。ESLint 文件级粒度无法
      //   区分函数级范围 —— 由 jest contract spec（capability-provider-string-match
      //   .contract.spec.ts）AST 锁能力决策路径，把 TYPE B 路由 helper 函数
      //   排除掉。
      files: [
        "**/modules/ai-engine/llm/services/ai-api-caller.service.ts",
        "**/modules/ai-engine/llm/structured-output/**/*.ts",
        "**/modules/ai-harness/runner/executor/**/*.ts",
      ],
      excludedFiles: ["**/*.spec.ts", "**/*.test.ts", "**/__tests__/**/*.ts"],
      rules: {
        "no-restricted-syntax": [
          "error",
          {
            // 反模式 1: x.includes / .startsWith / .endsWith / .indexOf / .search /
            //          .match 的参数是 provider/model family 名字面量。
            selector:
              "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(includes|startsWith|endsWith|indexOf|search|match)$/] > Literal[value=/^(openai|anthropic|google|xai|deepseek|gpt|claude|gemini|grok|o1|o3|o4|qwen|llama|imagen|deepseek-reasoner|deepseek-chat)/i]",
            message:
              "v3.1 §0 D5 反模式：禁止 modelId/provider.{includes|startsWith|...}('gpt'/'claude'/...) 决定 LLM 能力（response_format / maxTokens / isReasoning 等）。" +
              "改用 ModelCapabilityService.resolveCapabilities(config) 读结构化字段（v3.1 §3.2/§3.4）。" +
              "若属 TYPE B 路由 / TYPE C 装饰，需在 .eslintrc.js F 段 excludedFiles 加白名单 + PR 描述说明。",
          },
          {
            // 反模式 2: BinaryExpression `provider === '<name>'` / `!== '<name>'`
            //          直接 provider 名字面量判定能力。
            //          注：选择器只覆盖右侧字面量；左侧字面量（`'openai' === provider`）
            //          为反向写法，audit:capability 全仓扫兜底覆盖。
            selector:
              "BinaryExpression[operator=/^(===|==|!==|!=)$/][right.type='Literal'][right.value=/^(openai|anthropic|google|xai|deepseek|gpt|claude|gemini|grok|deepseek-reasoner|deepseek-chat)$/i]",
            message:
              "v3.1 §0 D5 反模式：禁止 provider === '<name>' 决定 LLM 能力。" +
              "改用 ModelCapabilityService.resolveCapabilities(config)（v3.1 §3.2/§3.4）。" +
              "若属 TYPE B 路由 / TYPE C 装饰，需在 .eslintrc.js F 段 excludedFiles 加白名单。",
          },
        ],
      },
    },
  ],
};
